// 管理員的「流程試算」（簽核流程設定 → 流程試算）：選一張表單、一位員工與請假長度，
// 用實際送出時同一份展開程式（services/approvalStepBuilder）算出這位員工會得到的簽核關卡，含姓名、
// 有條件的關卡適不適用、略過的重複簽核人、無上級主管改送；不建立任何單據。
// GET /api/approvals/forms/:formId/workflow/trial?employee=<員工 _id>&start=YYYY-MM-DD&end=YYYY-MM-DD&hours=56（只有管理員）
import FormTemplate from '../models/form_template.js'
import ApprovalWorkflow from '../models/approval_workflow.js'
import Employee from '../models/Employee.js'
import {
  StepBuildError,
  buildRequestSteps,
  computeLeaveLength,
  loadScheduledLeaveDays,
  planRequestSteps,
} from '../services/approvalStepBuilder.js'
import { UNRESOLVED_REASON_TEXT, managerChainLevelName } from '../services/approverResolution.js'
import { getFormVisibilityForEmployee, isFormAllowed } from '../services/formVisibilityService.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HOURS_PER_DAY = 8
const MAX_TRIAL_HOURS = 2928
const PERSON_FIELDS = '_id name employeeId title department organization supervisor'

const CHAIN_END_TEXT = {
  tag: '簽到持有停止標籤的主管為止',
  inherited: '持有停止標籤的主管不能簽核，由上一級主管代為決行後停止',
  max: '已到設定的最多層數',
  top: '已到最上層（沒有更上層的直屬主管）',
  loop: '主管資料形成循環，停在這裡',
  missing: '找不到上一級主管的員工資料',
  hops: '往上找的層數太多，停在這裡',
}

function normalizeId(value) {
  if (value == null) return ''
  if (typeof value === 'object' && value._id != null && value._id !== value) return normalizeId(value._id)
  return String(value)
}

function readQueryText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validDateKey(text) {
  if (!DATE_PATTERN.test(text)) return false
  const date = new Date(`${text}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

/** 試算的請假長度：回傳 { leave, inputs } 或 { error }；不是請假表單時 leave 是 null */
function readLeaveInputs(query, { isLeave, employeeId }) {
  const start = readQueryText(query?.start)
  const end = readQueryText(query?.end) || start
  const hoursText = readQueryText(query?.hours)
  if (start && !validDateKey(start)) return { error: '開始日期格式不正確（YYYY-MM-DD）' }
  if (end && !validDateKey(end)) return { error: '結束日期格式不正確（YYYY-MM-DD）' }
  if (start && end && end < start) return { error: '結束日期不可早於開始日期' }
  let hours = null
  if (hoursText) {
    hours = Number(hoursText)
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_TRIAL_HOURS) return { error: `請假時數必須是 0 到 ${MAX_TRIAL_HOURS} 之間的數字` }
  }
  if (!isLeave) return { leave: null, inputs: { start, end, hours } }
  if (!start && hours === null) return { error: '請輸入請假日期或時數' }
  const draft = computeLeaveLength({ hours, startValue: start || undefined, endValue: start ? end : undefined, startType: 'date', endType: 'date', employeeId })
  // 和送出時一樣：沒有填時數就依日期推算（整天，每天 8 小時）
  const leave = hours === null ? { ...draft, hours: draft.calendarDays * HOURS_PER_DAY } : draft
  return { leave, inputs: { start, end, hours } }
}

function personView(person) {
  if (!person) return null
  return { id: normalizeId(person._id ?? person.id), name: person.name || '', employeeId: person.employeeId || '', title: person.title || '' }
}

async function loadPeople(ids) {
  const unique = [...new Set(ids.map(normalizeId).filter(id => OBJECT_ID_PATTERN.test(id)))]
  if (!unique.length) return new Map()
  const rows = await Employee.find({ _id: { $in: unique } }, PERSON_FIELDS)
  return new Map((rows || []).map(row => [normalizeId(row._id), personView(row)]))
}

export async function trialWorkflow(req, res) {
  try {
    const formId = String(req.params?.formId ?? '')
    if (!OBJECT_ID_PATTERN.test(formId)) return res.status(400).json({ error: '表單編號格式不正確' })
    const employeeId = readQueryText(req.query?.employee)
    if (!OBJECT_ID_PATTERN.test(employeeId)) return res.status(400).json({ error: '請選擇要試算的員工' })

    const form = await FormTemplate.findById(formId)
    if (!form) return res.status(404).json({ error: '找不到這張表單樣板' })
    const wf = await ApprovalWorkflow.findOne({ form: form._id })
    if (!wf || !wf.steps?.length) return res.status(400).json({ error: `【${form.name}】尚未設定簽核流程，無法試算` })
    const applicant = await Employee.findById(employeeId)
    if (!applicant) return res.status(404).json({ error: '找不到這位員工' })

    const isLeave = isLeaveFormTemplate(form)
    const inputs = readLeaveInputs(req.query, { isLeave, employeeId })
    if (inputs.error) return res.status(400).json({ error: inputs.error })
    const warnings = []
    if (!isLeave && (inputs.inputs.start || inputs.inputs.hours !== null)) {
      warnings.push('這張表單的表單性質不是「請假」，不看請假長度（請假長度條件只用在請假表單）')
    }
    if (!form.is_active) warnings.push('這張表單已停用，員工目前不能送出')
    try {
      const visibility = await getFormVisibilityForEmployee(applicant)
      if (!isFormAllowed(visibility, form._id)) warnings.push('這位員工所屬的部門沒有開放這張表單（部門的「使用簽核表單」），實際送出會被擋下（403）')
    } catch (error) {
      console.error(`[approval-trial] form visibility failed: ${error?.name || 'Error'}`)
    }
    if (applicant.accountEnabled === false || ['離職員工', '留職停薪'].includes(applicant.status)) {
      warnings.push('這位員工已離職、留職停薪或帳號停用，實際上無法登入送出申請')
    }

    // 試算一律算出排班日數給管理員參考（實際送出時只有用到「排班日數」條件才讀班表）
    const leave = inputs.leave ? { ...inputs.leave, ...(await loadScheduledLeaveDays(inputs.leave)) } : null
    let built = null
    let error = null
    try {
      built = await buildRequestSteps({ wf, applicantEmp: applicant, form, leave })
    } catch (buildError) {
      if (!(buildError instanceof StepBuildError)) throw buildError
      error = { message: buildError.message, code: buildError.extra?.code || '', step: buildError.extra?.step ?? null }
    }
    const plan = built?.plan || await planRequestSteps({ wf, applicantEmp: applicant, leave })

    const ids = [
      normalizeId(applicant.supervisor),
      ...(built?.steps || []).flatMap(step => step.approvers.map(approver => approver.approver)),
      ...plan.units.flatMap(unit => [...unit.approverIds, ...(unit.removed || [])]),
      ...plan.items.flatMap(item => item.approverIds),
    ]
    const people = await loadPeople(ids)
    const nameOf = (id) => people.get(normalizeId(id)) || { id: normalizeId(id), name: '', employeeId: '', title: '' }

    const steps = (built?.steps || []).map((step, index) => ({
      step_order: step.step_order,
      name: step.name || '',
      source_position: built.stepSources[index]?.position ?? null,
      chain_level: built.stepSources[index]?.level ?? null,
      approvers: step.approvers.map(approver => nameOf(approver.approver)),
      all_must_approve: step.all_must_approve,
      is_required: step.is_required,
      can_return: step.can_return,
      fallback_text: step.fallback ? `${step.fallback.text}${step.fallback.reason_text ? `（${step.fallback.reason_text}）` : ''}` : '',
      note: step.note || '',
    }))

    const workflow = plan.items.map((item) => {
      const units = plan.units.filter(unit => unit.item === item)
      const chain = item.source.approver_type === 'manager_chain' && item.chain
        ? {
          stop_at_tag: item.chain.stopAtTag || '',
          max_levels: item.chain.maxLevels,
          end: item.chain.end,
          end_text: CHAIN_END_TEXT[item.chain.end] || '',
          levels: item.chain.levels.map((level) => {
            const unit = units.find(candidate => candidate.level === level)
            return {
              level: level.level,
              label: managerChainLevelName(level.level),
              approver: nameOf(level.id),
              repeated: Boolean(unit?.emptied),
              stopped_by_tag: Boolean(level.stoppedByTag),
              notes: level.notes || [],
            }
          }),
          notes: item.chain.tailNotes || [],
        }
        : null
      return {
        position: item.position + 1,
        label: item.label,
        name: item.source.name || '',
        approver_type: item.source.approver_type,
        is_required: item.source.is_required !== false,
        condition_text: item.condition?.text || '',
        condition_applies: item.condition ? item.condition.applies : null,
        condition_detail: item.condition?.detail || '',
        included: item.included,
        approvers: item.included && !chain ? item.approverIds.map(nameOf) : [],
        unresolved_reason: item.included && !item.approverIds.length ? (UNRESOLVED_REASON_TEXT[item.reason] || '目前找不到符合條件的在職簽核人') : '',
        fallback_text: item.fallback ? `${item.fallback.text}${item.fallback.reason_text ? `（${item.fallback.reason_text}）` : ''}` : '',
        repeated: units.flatMap(unit => (unit.removed || []).map(nameOf)),
        skipped_as_repeat: units.length > 0 && units.every(unit => unit.emptied && !unit.emptyChain),
        chain,
      }
    })

    res.json({
      form: { id: normalizeId(form._id), name: form.name, isLeave, isActive: form.is_active !== false },
      applicant: { ...personView(applicant), supervisor: applicant.supervisor ? nameOf(applicant.supervisor) : null },
      leave: leave
        ? {
          hours: leave.hours,
          calendarDays: leave.calendarDays,
          scheduledDays: plan.leave?.scheduledDays ?? null,
          scheduledNote: plan.leave?.scheduledNote || '',
          startDate: leave.startKey || '',
          endDate: leave.lastKey || '',
        }
        : null,
      warnings,
      ok: !error,
      error,
      steps,
      workflow,
      logs: plan.logs.map(log => log.message),
    })
  } catch (error) {
    console.error(`[approval-trial] trial failed: ${error?.name || 'Error'}`)
    if (error?.name === 'CastError') return res.status(400).json({ error: '資料格式不正確，請檢查後再試' })
    res.status(500).json({ error: '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員' })
  }
}

export default { trialWorkflow }
