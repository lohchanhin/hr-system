// 依流程設定與申請人展開一張簽核單的各關。建立、退回後重新送出（approvalRequestController）、
// 申請頁的流程預覽（GET /forms/:id/workflow）與管理員的「流程試算」都用這一份程式，試算看到的就是實際送出時的結果。
//
// 順序（docs/approval-supervisor-chain.md）：
// 1. 關卡的適用條件（只有請假表單，依請假長度）：不符合的關卡整關不送，單據紀錄寫「第N關不適用（請假未滿 7 日，本次 6.5 日）」。
// 2. 解析每一關的簽核人（services/approverResolution）；主管鏈每一級主管各是一關（第n級主管）。
//    必簽的主管關卡（含一位主管都沒有的主管鏈）找不到主管時改送最高層簽核人（R5，和以前一樣）。
// 3. 必簽的關卡找不到人 → REQUIRED_APPROVER_MISSING（和以前一樣）。
// 4. 略過重複的簽核人：主管鏈的每一級一律略過「已是前面關卡簽核人」的人；通用流程規則開啟「略過重複簽核人」時其他關卡也一樣。
//    因此整關沒有人的關卡直接拿掉（不算找不到人），紀錄寫明略過了誰。
// 5. 連續且簽核人與設定完全相同的關卡合併成一關（和以前一樣）。
// 6. 展開後最多 20 關。
// 沒有用到主管鏈、條件、略過重複簽核人的流程，結果和以前完全相同。
import Employee from '../models/Employee.js'
import {
  APPLICANT_SUPERVISOR_VALUE,
  UNRESOLVED_REASON_TEXT,
  describeStepCondition,
  evaluateStepCondition,
  managerChainLevelName,
  normalizeManagerChainValue,
  normalizeStepCondition,
  resolveStepApprovers,
} from './approverResolution.js'
import { loadScheduledShiftHours } from './leaveShiftHours.js'
import { parseLeaveInterval } from '../utils/leaveDuration.js'
import { dateKeyToUtcMidnight } from '../utils/taipeiTime.js'
import { normalizeSignTag } from '../utils/signTags.js'

export const MAX_REQUEST_STEPS = 20
const HOURS_PER_DAY = 8
const MAX_LEAVE_DAY_KEYS = 400

// 錯誤訊息裡顯示用的名稱（與員工表單的簽核角色／層級選項一致）
const SIGN_ROLE_NAMES = {
  R001: '填報', R002: '覆核', R003: '審核', R004: '核定', R005: '知會', R006: '財務覆核', R007: '人資覆核',
}
const SIGN_LEVEL_NAMES = { U001: 'L1', U002: 'L2', U003: 'L3', U004: 'L4', U005: 'L5' }

/** 建立單據時要回給申請人的錯誤（400，訊息是繁體中文）；控制器轉成自己的錯誤格式 */
export class StepBuildError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'StepBuildError'
    this.status = 400
    this.extra = extra
  }
}

function normalizeId(value) {
  if (value == null) return ''
  if (typeof value === 'object' && value._id != null && value._id !== value) return normalizeId(value._id)
  return String(value)
}

/** 一關的簡短說明，例如「申請者的主管」「標籤：人資，範圍：部門」「主管鏈，到「一般假單決行」為止」 */
export function describeWorkflowStep(step) {
  const type = step?.approver_type
  const raw = Array.isArray(step?.approver_value) ? step.approver_value[0] : step?.approver_value
  let label = ''
  if (type === 'manager') {
    const value = typeof raw === 'string' ? raw : ''
    label = !value || value === APPLICANT_SUPERVISOR_VALUE ? '申請者的主管' : '指定主管'
  } else if (type === 'manager_chain') {
    const { stopAtTag, maxLevels } = normalizeManagerChainValue(step?.approver_value)
    label = stopAtTag ? `主管鏈，到「${stopAtTag}」為止` : `主管鏈，最多 ${maxLevels} 級`
  } else if (type === 'tag') {
    label = `標籤：${normalizeSignTag(raw) || '未設定'}`
  } else if (type === 'user') {
    label = '指定員工'
  } else if (type === 'role') {
    const code = String(raw ?? '').trim()
    label = SIGN_ROLE_NAMES[code] ? `角色：${SIGN_ROLE_NAMES[code]}（${code}）` : `角色：${code || '未設定'}`
  } else if (type === 'level') {
    const code = String(raw ?? '').trim()
    label = SIGN_LEVEL_NAMES[code] ? `層級：${SIGN_LEVEL_NAMES[code]}（${code}）` : `層級：${code || '未設定'}`
  } else if (type === 'department') {
    label = '部門'
  } else if (type === 'org') {
    label = '機構'
  } else if (type === 'group') {
    label = '群組'
  } else {
    label = String(type || '未設定')
  }
  if (step?.scope_type === 'dept') label += '，範圍：部門'
  if (step?.scope_type === 'org') label += '，範圍：機構'
  return label
}

function missingApproverError(form, item) {
  const stepNumber = item.position + 1
  const reason = UNRESOLVED_REASON_TEXT[item.reason]
  const detail = reason ? `：${reason}` : ''
  return new StepBuildError(
    `【${form?.name || '表單'}】第${stepNumber}關（${describeWorkflowStep(item.source)}）找不到可簽核的人員${detail}，請聯絡管理員設定`,
    { code: 'REQUIRED_APPROVER_MISSING', step: stepNumber },
  )
}

function buildDecisionList(employeeIds) {
  return employeeIds.map(id => ({ approver: id, decision: 'pending' }))
}

/* ---------------------------- 請假長度（關卡條件用） ---------------------------- */

function roundHours(value) {
  return Math.round(Number(value) * 100) / 100
}

function dayKeysBetween(startKey, lastKey) {
  const keys = []
  let cursor = dateKeyToUtcMidnight(startKey)
  const end = dateKeyToUtcMidnight(lastKey)
  if (!cursor || !end) return keys
  while (cursor <= end && keys.length < MAX_LEAVE_DAY_KEYS) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  }
  return keys
}

/**
 * 這張假單的長度：{ hours, calendarDays, calendarSource, startKey, lastKey, dayKeys, employeeId, scheduledDays?, scheduledNote? }。
 * - hours：請假時數（送出時是 analyzeLeaveRequest 算出的時數；試算時是管理員填的時數）。
 * - calendarDays：請假期間的台灣日曆日（含頭尾，有時分的請假只要碰到那一天就算一天）；沒有日期時以時數 / 8 換算（calendarSource: 'hours'）。
 * - 排班日數不在這裡算：要用到時才由 loadScheduledLeaveDays 讀班表（大部分流程不需要，不多查一次資料庫）。
 */
export function computeLeaveLength({ hours, startValue, endValue, startType, endType, employeeId = null } = {}) {
  const numericHours = hours === '' || hours === null || hours === undefined ? NaN : Number(hours)
  const hoursValue = Number.isFinite(numericHours) && numericHours >= 0 ? roundHours(numericHours) : null
  const interval = startValue && endValue ? parseLeaveInterval(startValue, endValue, { startType, endType }) : null
  const usable = interval && !interval.reversed ? interval : null
  const dayKeys = usable ? dayKeysBetween(usable.startKey, usable.lastKey) : []
  const leave = {
    hours: hoursValue,
    calendarDays: dayKeys.length ? dayKeys.length : (hoursValue !== null ? roundHours(hoursValue / HOURS_PER_DAY) : null),
    calendarSource: dayKeys.length ? 'dates' : 'hours',
    startKey: usable?.startKey || '',
    lastKey: usable?.lastKey || '',
    dayKeys,
    employeeId: employeeId ? normalizeId(employeeId) : '',
  }
  return leave
}

/**
 * 排班日數：請假期間排了工作班的日子；排休息日／例假／國定假日的日子不算；沒有班表的日子以日曆日計算（寧可多算，不能讓需要的關卡被跳過）。
 * schedule 可由呼叫端傳入已經讀過的班表（loadScheduledShiftHours 的結果），沒有就讀一次。回傳 { scheduledDays, scheduledNote }。
 */
export async function loadScheduledLeaveDays(leave, { schedule = null } = {}) {
  if (!leave?.dayKeys?.length) {
    return { scheduledDays: leave?.calendarDays ?? null, scheduledNote: '沒有請假日期，以時數換算' }
  }
  let roster = schedule
  if (!roster) {
    try {
      roster = leave.employeeId
        ? await loadScheduledShiftHours(leave.employeeId, leave.dayKeys[0], leave.dayKeys[leave.dayKeys.length - 1])
        : new Map()
    } catch (error) {
      console.error(`[approval] load roster for step condition failed: ${error?.name || 'Error'}`)
      return { scheduledDays: leave.dayKeys.length, scheduledNote: '讀不到班表，以日曆日計算' }
    }
  }
  let days = 0
  let unrostered = 0
  for (const key of leave.dayKeys) {
    const entry = roster?.get?.(key)
    if (!entry) {
      days += 1
      unrostered += 1
    } else if (entry.work) {
      days += 1
    }
  }
  let note = ''
  if (unrostered === leave.dayKeys.length) note = '期間沒有班表，以日曆日計算'
  else if (unrostered) note = `其中 ${unrostered} 天沒有班表，以日曆日計算`
  return { scheduledDays: days, scheduledNote: note }
}

function needsScheduledDays(workflowSteps) {
  return workflowSteps.some(step => normalizeStepCondition(step?.condition)?.kind === 'leave_scheduled_days_gte')
}

/* ---------------------------- 展開 ---------------------------- */

function chainStepName(source, level) {
  const levelName = managerChainLevelName(level)
  const name = typeof source?.name === 'string' ? source.name.trim() : ''
  return name ? `${name}（${levelName}）` : levelName
}

function personLabel(person) {
  if (!person) return ''
  const name = person.name || '（未命名）'
  return person.employeeId ? `${name}（${person.employeeId}）` : name
}

async function loadPeople(ids) {
  const unique = [...new Set(ids.map(normalizeId).filter(id => /^[a-f0-9]{24}$/i.test(id)))]
  if (!unique.length) return new Map()
  const rows = await Employee.find({ _id: { $in: unique } }, { _id: 1, name: 1, employeeId: 1 })
  return new Map((rows || []).map(row => [normalizeId(row._id), { name: row.name || '', employeeId: row.employeeId || '' }]))
}

/**
 * 解析整條流程，不丟錯誤：回傳 { items, units, logs, issues }（buildRequestSteps、流程預覽、流程試算共用）。
 * - items：流程設定的每一關 { source, position, label, included, condition, approverIds, reason, fallback, chain, error }
 * - units：要變成單據關卡的每一關（主管鏈每一級一個）{ item, approverIds, name, note, level, isChain, fallback, removed, emptied, emptyChain }
 *   （emptied：不放進單據；removed 是因為重複被拿掉的人，emptyChain 是選填的主管鏈一位主管都沒有）
 * - logs：要寫進單據紀錄的 { action, message }（依流程順序）
 * - issues：{ missing, allEmpty, allNotApplicable }（buildRequestSteps 依它回報錯誤）
 * options.evaluateConditions = false（流程預覽：還不知道請假長度）時有條件的關卡都當作需要，item.condition.pending 為 true；
 * options.catchStepErrors（流程預覽，傳入記錄錯誤的函式）：某一關查詢失敗時記在 item.error、呼叫它，不中斷整條流程。
 */
export async function planRequestSteps({ wf, applicantEmp, leave = null, evaluateConditions = true, catchStepErrors = false } = {}) {
  const workflowSteps = Array.from(wf?.steps || [])
  const skipRepeated = wf?.policy?.skipRepeatedApprovers === true
  let leaveInfo = leave
  if (evaluateConditions && leaveInfo && leaveInfo.scheduledDays === undefined && needsScheduledDays(workflowSteps)) {
    // 送出時檢查請假時數已經讀過班表（leave.schedule）就直接用，不再查一次
    leaveInfo = { ...leaveInfo, ...(await loadScheduledLeaveDays(leaveInfo, { schedule: leaveInfo.schedule || null })) }
  }

  const items = []
  for (let position = 0; position < workflowSteps.length; position += 1) {
    const source = workflowSteps[position]
    const item = {
      source,
      position,
      label: describeWorkflowStep(source),
      included: true,
      condition: null,
      approverIds: [],
      reason: '',
      fallback: null,
      chain: null,
      error: false,
      logs: [],
    }
    const condition = normalizeStepCondition(source?.condition)
    if (condition) {
      const evaluated = evaluateConditions
        ? evaluateStepCondition(condition, leaveInfo)
        : { applies: true, text: describeStepCondition(condition), detail: '', actual: null, pending: true }
      item.condition = { ...condition, ...evaluated }
      if (!evaluated.applies) {
        item.included = false
        item.logs.push({ action: 'step_not_applicable', message: `第${position + 1}關不適用（${evaluated.detail}）` })
        items.push(item)
        continue
      }
      if (evaluateConditions && evaluated.actual === null) {
        item.logs.push({ action: 'step_condition', message: `第${position + 1}關照常簽核（無法判斷請假長度）` })
      }
    }
    try {
      const { ids, reason, fallback, chain } = await resolveStepApprovers(source, applicantEmp)
      const approverIds = []
      const seen = new Set()
      for (const rawId of ids || []) {
        const id = rawId != null ? String(rawId) : ''
        if (!id || seen.has(id)) continue
        seen.add(id)
        approverIds.push(id)
      }
      item.approverIds = approverIds
      item.reason = reason
      item.fallback = approverIds.length ? fallback || null : null
      item.chain = chain || null
    } catch (error) {
      if (!catchStepErrors) throw error
      if (typeof catchStepErrors === 'function') catchStepErrors(error)
      item.error = true
    }
    items.push(item)
  }

  const included = items.filter(item => item.included)
  const issues = {
    missing: included.find(item => !item.error && item.source.is_required !== false && !item.approverIds.length) || null,
    allEmpty: included.length > 0 && !included.some(item => item.approverIds.length || item.error),
    allNotApplicable: items.length > 0 && included.length === 0,
  }

  // 每一關展開成單據的關卡：主管鏈每一級主管一關，其他關卡一關
  const units = []
  for (const item of included) {
    const isChain = item.source.approver_type === 'manager_chain'
    const levels = item.chain?.levels || []
    if (isChain && levels.length && !item.fallback) {
      levels.forEach((level, index) => {
        const tail = index === levels.length - 1 ? item.chain.tailNotes || [] : []
        const notes = [...(level.notes || []), ...tail]
        units.push({ item, approverIds: [level.id], name: chainStepName(item.source, level.level), note: notes.join('；'), level, isChain: true, fallback: null })
      })
    } else {
      const notes = isChain ? item.chain?.tailNotes || [] : []
      // 選填的主管鏈一位主管都沒有（例如最上層主管自己請 7 日以上的假）：這一關不放進單據，紀錄寫明（必簽的已在上面改送或回報錯誤）
      const emptyChain = isChain && !item.approverIds.length && !item.error
      units.push({ item, approverIds: [...item.approverIds], name: '', note: notes.join('；'), level: null, isChain, fallback: item.fallback, emptyChain, emptied: emptyChain })
    }
  }

  // 略過重複的簽核人：主管鏈的每一級一律略過，其他關卡只有開啟「略過重複簽核人」時；比對的是前面所有有簽核人的關卡
  const seenApprovers = new Set()
  for (const unit of units) {
    if (unit.isChain || skipRepeated) {
      const removed = unit.approverIds.filter(id => seenApprovers.has(id))
      if (removed.length) {
        unit.removed = removed
        unit.approverIds = unit.approverIds.filter(id => !seenApprovers.has(id))
        unit.emptied = unit.approverIds.length === 0
      }
    }
    unit.approverIds.forEach(id => seenApprovers.add(id))
  }

  // 紀錄：依流程順序，每一關的條件、主管鏈說明、改送最高層簽核人、略過重複的人
  const removedIds = units.flatMap(unit => (unit.removed && !unit.level ? unit.removed : []))
  const people = removedIds.length ? await loadPeople(removedIds) : new Map()
  for (const item of items) {
    if (!item.included) continue
    const prefix = `第${item.position + 1}關（${item.label}）`
    for (const note of item.chain?.notes || []) item.logs.push({ action: 'manager_chain', message: `${prefix}：${note}` })
    if (item.fallback) {
      const reasonText = item.fallback.reason_text ? `（${item.fallback.reason_text}）` : ''
      item.logs.push({ action: 'approver_fallback', message: `${prefix}${reasonText}：${item.fallback.text}` })
    }
    const mine = units.filter(unit => unit.item === item)
    if (mine.some(unit => unit.emptyChain)) {
      const reasonText = UNRESOLVED_REASON_TEXT[item.reason] ? `（${UNRESOLVED_REASON_TEXT[item.reason]}）` : ''
      item.logs.push({ action: 'manager_chain', message: `${prefix}沒有可簽核的主管${reasonText}，這一關略過` })
    }
    const removedNames = mine.flatMap(unit => (unit.removed || []).map(id => (
      unit.level ? `${personLabel(unit.level)}（${managerChainLevelName(unit.level.level)}）` : personLabel(people.get(id)) || '1 位簽核人'
    )))
    if (!removedNames.length) continue
    const allEmptied = mine.length > 0 && mine.every(unit => unit.emptied)
    item.logs.push({
      action: 'skip_repeated_approver',
      message: allEmptied
        ? `${prefix}的簽核人都已是前面關卡的簽核人（${removedNames.join('、')}），這一關略過`
        : `${prefix}略過已是前面關卡簽核人的${removedNames.join('、')}`,
    })
  }
  const logs = items.flatMap(item => item.logs)
  return { items, units, logs, issues, leave: leaveInfo }
}

/**
 * 建立、重新送出簽核單用：回傳 { steps, logs, plan, stepSources }；不能送出時丟 StepBuildError（REQUIRED_APPROVER_MISSING、TOO_MANY_STEPS）。
 * - steps：存進單據的關卡；logs：要寫進單據紀錄的 { action, message }（改送最高層簽核人、條件不適用、略過重複…）
 * - stepSources：每一關來自流程的第幾關（1 起算）與主管鏈第幾級，流程試算顯示用
 * leave：computeLeaveLength 的結果（不是請假表單傳 null；有條件的關卡讀不到長度時照常簽核）。
 */
export async function buildRequestSteps({ wf, applicantEmp, form, leave = null } = {}) {
  const plan = await planRequestSteps({ wf, applicantEmp, leave })
  if (plan.issues.allNotApplicable) {
    throw new StepBuildError(
      `【${form?.name || '表單'}】的每一關都設定了請假長度條件，這張申請都不適用，沒有人可以簽核；請聯絡管理員至少設定一關沒有條件的關卡`,
      { code: 'REQUIRED_APPROVER_MISSING', step: 1 },
    )
  }
  if (plan.issues.missing) throw missingApproverError(form, plan.issues.missing)
  if (plan.issues.allEmpty) throw missingApproverError(form, plan.items.find(item => item.included))

  // 連續且簽核人與設定完全相同的關卡合併成一關；整關被略過（簽核人都已在前面簽過）的關卡不放進單據
  const steps = []
  const stepSources = []
  let previousSignature = null
  for (const unit of plan.units) {
    if (unit.emptied) continue
    const source = unit.item.source
    const normalizedConfig = {
      approvers: [...unit.approverIds].sort(),
      // 改送最高層簽核人的關卡：任一位核准即可
      all_must_approve: unit.fallback ? false : source.all_must_approve !== false,
      is_required: source.is_required !== false,
      can_return: source.can_return !== false,
    }
    const signature = JSON.stringify(normalizedConfig)
    if (signature === previousSignature) {
      // 和前一關合併：前一關沒有說明時把這關的說明帶過去
      const previous = steps[steps.length - 1]
      if (unit.fallback && previous && !previous.fallback) previous.fallback = { ...unit.fallback }
      if (unit.note && previous && !previous.note) previous.note = unit.note
      continue
    }
    previousSignature = signature
    steps.push({
      step_order: steps.length + 1,
      ...(unit.name ? { name: unit.name } : {}),
      approvers: buildDecisionList(unit.approverIds),
      all_must_approve: normalizedConfig.all_must_approve,
      is_required: normalizedConfig.is_required,
      can_return: normalizedConfig.can_return,
      ...(unit.fallback ? { fallback: { ...unit.fallback } } : {}),
      ...(unit.note ? { note: unit.note } : {}),
    })
    stepSources.push({ position: unit.item.position + 1, level: unit.level?.level ?? null })
  }

  if (steps.length > MAX_REQUEST_STEPS) {
    throw new StepBuildError(
      `【${form?.name || '表單'}】的簽核流程展開主管鏈後共有 ${steps.length} 關，超過上限 ${MAX_REQUEST_STEPS} 關；請聯絡管理員調整關卡或「主管鏈」的最多層數`,
      { code: 'TOO_MANY_STEPS', stepCount: steps.length },
    )
  }
  return { steps, logs: plan.logs, plan, stepSources }
}

export default { MAX_REQUEST_STEPS, StepBuildError, describeWorkflowStep, computeLeaveLength, loadScheduledLeaveDays, planRequestSteps, buildRequestSteps }
