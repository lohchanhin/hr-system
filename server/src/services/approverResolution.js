// 依流程關卡解析「這關的簽核人」（建立／重新送出簽核單，以及流程預覽 getWorkflow 共用）。
// 放在 service 而不是控制器裡：樣板控制器也要用，不能反過來依賴簽核單控制器。
import Employee from '../models/Employee.js'
import SubDepartment from '../models/SubDepartment.js'
import { eligibleEmployeeFilter } from './approverEligibility.js'
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

/** 這一關找不到人時要不要改送最高層簽核人：必簽的主管關卡，而且是「沒有可簽核的主管」（設定錯誤 invalid-config 不改送） */
export function isManagerFallbackCandidate(step, reason) {
  return step?.approver_type === 'manager' && step?.is_required !== false && MANAGER_FALLBACK_REASONS.includes(reason)
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
  return { ids: topLevel.ids, reason: '', fallback: describeManagerFallback({ reason: detailed.reason, source: topLevel.source }) }
}
