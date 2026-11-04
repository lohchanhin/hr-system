// 依流程關卡解析「這關的簽核人」（建立／重新送出簽核單，以及流程預覽 getWorkflow 共用）。
// 放在 service 而不是控制器裡：樣板控制器也要用，不能反過來依賴簽核單控制器。
import Employee from '../models/Employee.js'
import SubDepartment from '../models/SubDepartment.js'
import { eligibleEmployeeFilter, isEligibleApprover } from './approverEligibility.js'
import { normalizeSignTag, normalizeSignTags } from '../utils/signTags.js'
// 用命名空間匯入：別的測試把設定存取層換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as settingsStore from './otherControlSettingsStore.js'

export const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i
const SYSTEM_ROLES = new Set(['admin', 'supervisor', 'employee'])
const SIGN_ROLE_CODE_PATTERN = /^R\d{3}$/
const SIGN_LEVEL_CODE_PATTERN = /^U\d{3}$/

function normalizeId(value) {
  if (value == null) return ''
  if (typeof value === 'object' && value._id != null && value._id !== value) {
    return normalizeId(value._id)
  }
  return String(value)
}

function isObjectIdString(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
}

export const UNRESOLVED_REASON_TEXT = {
  'applicant-department-missing': '申請人尚未設定所屬部門',
  'applicant-organization-missing': '申請人尚未設定所屬機構',
  'only-applicant': '符合條件的簽核人只有申請人本人',
  'no-supervisor': '申請人尚未設定直屬主管',
  'supervisor-inactive': '申請人的直屬主管已離職、停用或留職停薪',
  'manager-unavailable': '指定的主管已離職、停用，或不具主管身分',
  'user-unavailable': '指定的員工已離職、停用或不存在',
  'invalid-config': '此關卡的簽核設定不完整',
}

function extractReferenceId(item) {
  if (item && typeof item === 'object') return normalizeId(item._id || item.id || item.value || '')
  return item == null ? '' : String(item)
}

// 範圍（scope）只認 none / dept / org；舊資料的 group 當作 none（不縮小也不放大）。
// 申請人缺少部門／機構時不可退化成全公司，回報缺少哪個欄位。
function buildScopeFilter(scope, applicantEmp) {
  if (scope === 'dept') {
    return applicantEmp?.department
      ? { filter: { department: applicantEmp.department } }
      : { missing: 'applicant-department-missing' }
  }
  if (scope === 'org') {
    return applicantEmp?.organization
      ? { filter: { organization: applicantEmp.organization } }
      : { missing: 'applicant-organization-missing' }
  }
  return { filter: {} }
}

// 只保留「確實存在且可簽核」的員工 id（維持傳入順序）
async function eligibleIdSubset(ids, extraFilter = {}) {
  const valid = [...new Set(ids.filter(isObjectIdString))]
  if (!valid.length) return []
  const rows = await Employee.find({ _id: { $in: valid }, ...eligibleEmployeeFilter(), ...extraFilter }, { _id: 1 })
  const found = new Set((rows || []).map(row => normalizeId(row._id)))
  return valid.filter(id => found.has(id))
}

/* ---------------------------- 主管鏈（manager_chain） ---------------------------- */

// 主管鏈：從申請人的直屬主管開始，沿著每個人的「直屬主管」一路往上，每一位可簽核的主管是單據上的一關（第n級主管）。
// approver_value = { stopAtTag, maxLevels }：
// - stopAtTag（簽核標籤，可不填）：簽到第一位持有這個標籤的主管為止（含這一位）；不填就一路簽到最上層或 maxLevels。
// - maxLevels（1–10，預設 5）：最多幾位主管簽核（略過的離職者不算）。
// 規則（docs/approval-supervisor-chain.md）：
// - 申請人本人一律不在鏈上；主管資料繞回已經走過的人（循環）就停在那裡。
// - 中途的主管已離職、停用或留職停薪：略過這個人，繼續找他的直屬主管（單據的那一關留下說明）；
//   略過的人持有 stopAtTag 時，由上一級可簽核的主管代為決行，簽完就停（不會因為決行的人不在而一路簽到最上層）。
// - 一位主管都沒有（沒有直屬主管、全部都離職）時和「申請者的主管」一樣：必簽的關卡改送最高層簽核人（R5）。
export const MANAGER_CHAIN_DEFAULT_LEVELS = 5
export const MANAGER_CHAIN_MAX_LEVELS = 10
// 一路往上最多看幾個人（含略過的人）：資料異常時不會查個沒完
const MANAGER_CHAIN_MAX_HOPS = 40
const CHAIN_PERSON_FIELDS = '_id name employeeId supervisor signTags status accountEnabled'

/** 主管鏈的設定整理成 { stopAtTag, maxLevels }；格式不對的值用預設（不設停止標籤、最多 5 級） */
export function normalizeManagerChainValue(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const stopAtTag = normalizeSignTag(raw.stopAtTag)
  const levels = Number(raw.maxLevels)
  const maxLevels = Number.isInteger(levels) && levels >= 1 && levels <= MANAGER_CHAIN_MAX_LEVELS
    ? levels
    : MANAGER_CHAIN_DEFAULT_LEVELS
  return { stopAtTag, maxLevels }
}

export function managerChainLevelName(level) {
  return `第${level}級主管`
}

function inactiveText(person) {
  if (person?.accountEnabled === false) return '帳號停用'
  if (person?.status === '離職員工') return '已離職'
  if (person?.status === '留職停薪') return '留職停薪'
  return '不能簽核'
}

function personText(person) {
  const name = person?.name || '（未命名）'
  return person?.employeeId ? `${name}（${person.employeeId}）` : name
}

/**
 * 沿著直屬主管往上走：回傳 { levels, reason, end, stopAtTag, maxLevels, tailNotes, notes }。
 * - levels：[{ id, name, employeeId, level（離申請人第幾級，直屬主管是 1）, stoppedByTag, inherited,
 *   skipped: [{ id, name, employeeId, level, reason, holdsStopTag }], notes（這一級之前略過的人的說明） }]
 * - end：tag（簽到持有標籤的人）、inherited（略過的人持有標籤，由上一級代為決行）、max（到最多層數）、top（沒有更上層）、
 *   loop（繞回走過的人）、missing（找不到主管的員工資料）、hops（走太多層）
 * - reason：levels 為空時的原因（no-supervisor / only-applicant / supervisor-inactive），其餘是 ''
 * - tailNotes：最後一級之後的說明（循環、最上層的人已離職）；notes：全部說明（依順序），寫進單據紀錄
 */
export async function walkManagerChain(step, applicantEmp) {
  const { stopAtTag, maxLevels } = normalizeManagerChainValue(step?.approver_value)
  const applicantId = normalizeId(applicantEmp?._id)
  const visited = new Set(applicantId ? [applicantId] : [])
  const levels = []
  const notes = []
  let skipped = []
  let inheritStop = false
  let cursor = normalizeId(applicantEmp?.supervisor)
  let end = cursor ? '' : 'top'
  let hops = 0
  let lastPerson = null
  const tailNotes = []

  while (cursor && !end) {
    if (visited.has(cursor)) {
      end = 'loop'
      if (cursor !== applicantId || levels.length || skipped.length) {
        tailNotes.push(`主管資料形成循環（${lastPerson ? personText(lastPerson) : '申請人'}的直屬主管又回到前面的人），只簽到這裡`)
      }
      break
    }
    if (hops >= MANAGER_CHAIN_MAX_HOPS) {
      end = 'hops'
      break
    }
    visited.add(cursor)
    hops += 1
    const person = isObjectIdString(cursor) ? await Employee.findById(cursor, CHAIN_PERSON_FIELDS) : null
    if (!person) {
      end = 'missing'
      break
    }
    lastPerson = person
    const holdsStopTag = Boolean(stopAtTag) && normalizeSignTags(person.signTags).includes(stopAtTag)
    if (!isEligibleApprover(person)) {
      skipped.push({ id: cursor, name: person.name || '', employeeId: person.employeeId || '', level: hops, reason: inactiveText(person), holdsStopTag })
      if (holdsStopTag) inheritStop = true
      cursor = normalizeId(person.supervisor)
      if (!cursor) end = 'top'
      continue
    }
    const inherited = inheritStop && !holdsStopTag
    const levelNotes = skipped.map(gone => (gone.holdsStopTag
      ? `已略過${gone.reason}的${personText(gone)}（第${gone.level}級主管，持有「${stopAtTag}」標籤），由上一級主管${personText(person)}代為決行`
      : `已略過${gone.reason}的${personText(gone)}（第${gone.level}級主管），改由上一級主管簽核`))
    levels.push({ id: cursor, name: person.name || '', employeeId: person.employeeId || '', level: hops, stoppedByTag: holdsStopTag, inherited, skipped, notes: levelNotes })
    notes.push(...levelNotes)
    skipped = []
    if (holdsStopTag) end = 'tag'
    else if (inherited) end = 'inherited'
    else if (levels.length >= maxLevels) end = 'max'
    else {
      cursor = normalizeId(person.supervisor)
      if (!cursor) end = 'top'
    }
  }

  // 最上層的人已離職、沒有更上層：記下來（一位主管都沒有時改送最高層簽核人，見 resolveStepApprovers）
  for (const gone of skipped) {
    tailNotes.push(`已略過${gone.reason}的${personText(gone)}（第${gone.level}級主管），沒有更上層的主管`)
  }
  notes.push(...tailNotes)

  let reason = ''
  if (!levels.length) {
    const first = normalizeId(applicantEmp?.supervisor)
    if (!first) reason = 'no-supervisor'
    else if (first === applicantId) reason = 'only-applicant'
    else reason = 'supervisor-inactive'
  }
  return { levels, reason, end: end || 'top', stopAtTag, maxLevels, tailNotes, notes }
}

/**
 * 依流程關卡解析簽核人，回傳 { ids, reason }。
 * - 只回傳可簽核的員工（帳號未停用、不是離職／留職停薪）。
 * - 申請人本人一律排除（不能自己簽自己的單）。
 * - 範圍為部門／機構但申請人沒有對應資料時，不放寬成全公司，reason 說明缺什麼。
 * reason 只在 ids 為空時有值，用來組出可行動的錯誤訊息。
 */
export async function resolveApproversDetailed(step, applicantEmp) {
  const type = step.approver_type
  const val = step.approver_value
  const scope = step.scope_type || 'none'
  const applicantId = normalizeId(applicantEmp?._id)
  const eligible = eligibleEmployeeFilter()

  const finish = (rawIds, reason = '') => {
    const kept = []
    const seen = new Set()
    let removedApplicant = false
    for (const raw of rawIds || []) {
      const id = normalizeId(raw)
      if (!id || seen.has(id)) continue
      seen.add(id)
      if (applicantId && id === applicantId) {
        removedApplicant = true
        continue
      }
      kept.push(raw)
    }
    if (kept.length) return { ids: kept, reason: '' }
    return { ids: [], reason: removedApplicant ? 'only-applicant' : reason }
  }

  if (type === 'manager') {
    const candidates = Array.isArray(val) ? val : [val]
    const selected = candidates.find((item) => item != null && item !== '')
    const targetId = selected != null && selected !== '' ? extractReferenceId(selected) : ''

    if (!targetId || targetId === APPLICANT_SUPERVISOR_VALUE) {
      const supervisorId = normalizeId(applicantEmp?.supervisor)
      if (!supervisorId) return finish([], 'no-supervisor')
      return finish(await eligibleIdSubset([supervisorId]), 'supervisor-inactive')
    }
    if (!isObjectIdString(targetId)) return finish([], 'invalid-config')
    return finish(await eligibleIdSubset([targetId], { role: 'supervisor' }), 'manager-unavailable')
  }

  if (type === 'manager_chain') {
    // 主管鏈所有級的主管（由下往上）；建立單據時每一級各是一關（services/approvalStepBuilder），chain 留給呼叫端看每一級
    const chain = await walkManagerChain(step, applicantEmp)
    const result = finish(chain.levels.map(level => level.id), chain.reason)
    return { ...result, chain }
  }

  if (type === 'user') {
    // val 可為單一或陣列（Employee _id）
    const ids = (Array.isArray(val) ? val : [val]).map(extractReferenceId).filter(Boolean)
    if (!ids.length) return finish([], 'invalid-config')
    return finish(await eligibleIdSubset(ids), 'user-unavailable')
  }

  if (type === 'tag') {
    // 比對時兩邊都做 K3 正規化（全形轉半形、去頭尾空白、內部空白壓成一個），
    // 所以儲存值尚未被遷移成正規化格式時也找得到；在已縮小的候選名單上於記憶體中比對。
    const tag = normalizeSignTag(Array.isArray(val) ? val[0] : val)
    if (!tag) return finish([], 'invalid-config')
    const scoped = buildScopeFilter(scope, applicantEmp)
    if (scoped.missing) return finish([], scoped.missing)
    const candidates = await Employee.find(
      { ...eligible, ...scoped.filter, 'signTags.0': { $exists: true } },
      { _id: 1, signTags: 1 },
    )
    const matched = (candidates || []).filter(emp => normalizeSignTags(emp.signTags).includes(tag))
    return finish(matched.map(emp => emp._id))
  }

  if (type === 'role' || type === 'level') {
    const code = String(Array.isArray(val) ? val[0] ?? '' : val ?? '').trim()
    const match = {}
    if (type === 'role' && SYSTEM_ROLES.has(code)) match.role = code // 系統角色 admin / supervisor / employee
    else if (type === 'role' && SIGN_ROLE_CODE_PATTERN.test(code)) match.signRole = code // 簽核角色 R001-R007
    else if (type === 'level' && SIGN_LEVEL_CODE_PATTERN.test(code)) match.signLevel = code // 簽核層級 U001-U005
    else return finish([], 'invalid-config')
    const scoped = buildScopeFilter(scope, applicantEmp)
    if (scoped.missing) return finish([], scoped.missing)
    const list = await Employee.find({ ...match, ...eligible, ...scoped.filter }, { _id: 1 })
    return finish((list || []).map(x => x._id))
  }

  if (type === 'department') {
    const dept = val ? extractReferenceId(Array.isArray(val) ? val[0] : val) : normalizeId(applicantEmp?.department)
    if (!dept) return finish([], 'applicant-department-missing')
    if (!isObjectIdString(dept)) return finish([], 'invalid-config')
    const list = await Employee.find({ department: dept, ...eligible }, { _id: 1 })
    return finish((list || []).map(x => x._id))
  }

  if (type === 'org') {
    const org = val ? extractReferenceId(Array.isArray(val) ? val[0] : val) : normalizeId(applicantEmp?.organization)
    if (!org) return finish([], 'applicant-organization-missing')
    const list = await Employee.find({ organization: org, ...eligible }, { _id: 1 })
    return finish((list || []).map(x => x._id))
  }

  if (type === 'group') {
    const subDeptIds = (Array.isArray(val) ? val : [val]).map(extractReferenceId).filter(isObjectIdString)
    if (!subDeptIds.length) return finish([], 'invalid-config')

    const validSubDepts = await SubDepartment.find({ _id: { $in: subDeptIds } }, { _id: 1 })
    if (!validSubDepts.length) return finish([], 'invalid-config')

    const scoped = buildScopeFilter(scope, applicantEmp)
    if (scoped.missing) return finish([], scoped.missing)
    const validIds = validSubDepts.map((sub) => sub._id.toString())
    const list = await Employee.find({ subDepartment: { $in: validIds }, ...eligible, ...scoped.filter }, { _id: 1 })
    return finish((list || []).map((emp) => emp._id))
  }

  // 其他尚未支援的簽核類型
  return finish([], 'invalid-config')
}

/* 依流程步驟解析「此關簽核人」（只回傳 id 清單；需要原因時用 resolveApproversDetailed） */
export async function resolveApprovers(step, applicantEmp) {
  return (await resolveApproversDetailed(step, applicantEmp)).ids
}

/* ---------------------------- 無上級主管：改由最高層簽核人（R5） ---------------------------- */

// 「主管」關卡（申請者的主管、指定主管）找不到可簽核的主管時（沒設定、主管就是申請人本人、主管已離職／停用／不具主管身分），
// 必簽的關卡改送最高層簽核人：其他控制設定的 topLevelApproverIds（管理員在簽核流程設定挑選，預設空白）；
// 沒設定、或設定的人都不能簽（離職、停用、就是申請人本人）時改送所有可簽核的系統管理員（不含申請人），任一位核准即可。
// 兩者都沒有人才維持原本的「找不到可簽核的人員」（REQUIRED_APPROVER_MISSING）。選填的關卡照舊略過，不改送。
export const MANAGER_FALLBACK_REASONS = Object.freeze(['no-supervisor', 'supervisor-inactive', 'only-applicant', 'manager-unavailable'])
export const MAX_TOP_LEVEL_APPROVERS = 50
export const FALLBACK_SOURCE_LABELS = Object.freeze({ setting: '最高層簽核人', admins: '系統管理員' })
export const FALLBACK_REASON_TEXT = Object.freeze({
  'no-supervisor': '申請人沒有設定直屬主管',
  'supervisor-inactive': '直屬主管已離職、停用或留職停薪',
  'only-applicant': '主管就是申請人本人',
  'manager-unavailable': '指定的主管已離職、停用，或不具主管身分',
})

/** 設定值整理成不重複的員工 _id 字串（維持順序，最多 MAX_TOP_LEVEL_APPROVERS 位）；格式不對的略過 */
export function normalizeTopLevelApproverIds(value) {
  const ids = []
  const seen = new Set()
  for (const item of Array.isArray(value) ? value : []) {
    const id = extractReferenceId(item).trim()
    if (!isObjectIdString(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= MAX_TOP_LEVEL_APPROVERS) break
  }
  return ids
}

/** 其他控制設定的 topLevelApproverIds；讀不到（例如資料庫暫時有問題）就當作沒設定，改送系統管理員 */
export async function loadTopLevelApproverIds() {
  if (typeof settingsStore.getSettings !== 'function') return []
  try {
    const settings = await settingsStore.getSettings()
    return normalizeTopLevelApproverIds(settings?.topLevelApproverIds)
  } catch (error) {
    console.error(`[approval] load top-level approvers failed: ${error?.name || 'Error'}`)
    return []
  }
}

/**
 * 這位申請人的最高層簽核人：回傳 { ids, source }，source 是 setting（設定的人）或 admins（系統管理員），都沒有人時 ids 為空。
 * 申請人本人一律排除；configuredIds 不傳就讀設定。
 */
export async function resolveTopLevelApprovers(applicantEmp, { configuredIds } = {}) {
  const applicantId = normalizeId(applicantEmp?._id)
  const configured = configuredIds !== undefined
    ? normalizeTopLevelApproverIds(configuredIds)
    : await loadTopLevelApproverIds()
  if (configured.length) {
    const ids = (await eligibleIdSubset(configured)).filter(id => id !== applicantId)
    if (ids.length) return { ids, source: 'setting' }
  }
  const admins = await Employee.find({ role: 'admin', ...eligibleEmployeeFilter() }, { _id: 1 })
  const ids = [...new Set((admins || []).map(row => normalizeId(row._id)))].filter(id => id && id !== applicantId)
  return ids.length ? { ids, source: 'admins' } : { ids: [], source: '' }
}

/** 單據關卡、流程預覽上顯示的說明：{ reason, reason_text, source, text } */
export function describeManagerFallback({ reason, source }) {
  const label = FALLBACK_SOURCE_LABELS[source] || FALLBACK_SOURCE_LABELS.admins
  return {
    reason: reason || '',
    reason_text: FALLBACK_REASON_TEXT[reason] || '',
    source: FALLBACK_SOURCE_LABELS[source] ? source : 'admins',
    text: `無上級主管，改由${label}簽核（任一位核准即可）`,
  }
}

/**
 * 這一關找不到人時要不要改送最高層簽核人：必簽的主管關卡（申請者的主管、指定主管，或一位主管都沒有的主管鏈），
 * 而且是「沒有可簽核的主管」（設定錯誤 invalid-config 不改送）
 */
export function isManagerFallbackCandidate(step, reason) {
  const isManagerStep = step?.approver_type === 'manager' || step?.approver_type === 'manager_chain'
  return isManagerStep && step?.is_required !== false && MANAGER_FALLBACK_REASONS.includes(reason)
}

/* ---------------------------- 關卡的適用條件（請假長度） ---------------------------- */

// 與 models/approval_workflow.js 的 condition.kind 相同；只有表單性質＝請假的表單可以設定
export const STEP_CONDITION_KINDS = Object.freeze(['leave_hours_gte', 'leave_calendar_days_gte', 'leave_scheduled_days_gte'])
export const STEP_CONDITION_LIMITS = Object.freeze({
  leave_hours_gte: { min: 0.5, max: 2928, step: 0.5 },
  leave_calendar_days_gte: { min: 1, max: 366, step: 1 },
  leave_scheduled_days_gte: { min: 1, max: 366, step: 1 },
})
const CONDITION_WORDING = {
  leave_hours_gte: { need: v => `請假滿 ${v} 小時才需要`, short: v => `請假未滿 ${v} 小時`, actual: v => `本次 ${v} 小時` },
  leave_calendar_days_gte: { need: v => `請假滿 ${v} 日（日曆日）才需要`, short: v => `請假未滿 ${v} 日`, actual: v => `本次 ${v} 日` },
  leave_scheduled_days_gte: { need: v => `請假滿 ${v} 個排班日才需要`, short: v => `請假未滿 ${v} 個排班日`, actual: v => `本次 ${v} 個排班日` },
}

const roundHundredth = (value) => Math.round(Number(value) * 100) / 100

/** 關卡上的條件整理成 { kind, value }；沒有設定或格式不對回傳 null（＝每張單都要這一關） */
export function normalizeStepCondition(condition) {
  if (!condition || typeof condition !== 'object') return null
  const kind = String(condition.kind ?? '')
  const value = Number(condition.value)
  if (!STEP_CONDITION_KINDS.includes(kind) || !Number.isFinite(value) || value <= 0) return null
  return { kind, value }
}

/** 流程預覽、申請頁顯示的條件文字，例如「請假滿 56 小時才需要」；沒有條件回傳 '' */
export function describeStepCondition(condition) {
  const normalized = normalizeStepCondition(condition)
  return normalized ? CONDITION_WORDING[normalized.kind].need(normalized.value) : ''
}

/**
 * 依這張假單的長度判斷這一關要不要：回傳 { applies, text, detail, actual }。
 * leave = { hours, calendarDays, calendarSource, scheduledDays, scheduledNote }（見 approvalStepBuilder.computeLeaveLength）；
 * 沒有條件 → applies: true；有條件但讀不到請假長度（例如表單已不是請假表單）→ 照常需要這一關（寧可多簽，不能少簽），detail 說明原因。
 * 「大於或等於」：剛好 7 日也算。
 */
export function evaluateStepCondition(condition, leave) {
  const normalized = normalizeStepCondition(condition)
  if (!normalized) return { applies: true, text: '', detail: '', actual: null }
  const wording = CONDITION_WORDING[normalized.kind]
  const text = wording.need(normalized.value)
  let actual = null
  let note = ''
  if (leave && typeof leave === 'object') {
    if (normalized.kind === 'leave_hours_gte') actual = Number(leave.hours)
    else if (normalized.kind === 'leave_calendar_days_gte') {
      actual = Number(leave.calendarDays)
      if (leave.calendarSource === 'hours') note = '沒有請假日期，以時數換算'
    } else {
      actual = Number(leave.scheduledDays)
      note = leave.scheduledNote || ''
    }
  }
  if (actual === null || !Number.isFinite(actual)) {
    return { applies: true, text, detail: '無法判斷請假長度，照常簽核', actual: null }
  }
  actual = roundHundredth(actual)
  const applies = actual + 1e-9 >= normalized.value
  const parts = [applies ? text.replace(/才需要$/, '') : wording.short(normalized.value), wording.actual(actual)]
  if (note) parts.push(note)
  return { applies, text, detail: parts.join('，'), actual }
}

/**
 * 建立／重新送出簽核單、流程預覽用的解析：和 resolveApproversDetailed 相同，但必簽的主管關卡找不到主管時改送最高層簽核人，
 * 回傳 { ids, reason, fallback }（fallback 只在改送時有值，見 describeManagerFallback）。
 */
export async function resolveStepApprovers(step, applicantEmp, options = {}) {
  const detailed = await resolveApproversDetailed(step, applicantEmp)
  if (detailed.ids.length || !isManagerFallbackCandidate(step, detailed.reason)) return detailed
  const topLevel = await resolveTopLevelApprovers(applicantEmp, options)
  if (!topLevel.ids.length) return detailed
  const fallback = describeManagerFallback({ reason: detailed.reason, source: topLevel.source })
  // 主管鏈一位主管都沒有：保留往上找的經過（例如最上層的主管已離職），單據那一關的說明用得到
  return { ids: topLevel.ids, reason: '', fallback, ...(detailed.chain ? { chain: detailed.chain } : {}) }
}
