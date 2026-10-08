// 依流程關卡解析「這關的簽核人」（建立／重新送出簽核單，以及流程預覽 getWorkflow 共用）。
// 放在 service 而不是控制器裡：樣板控制器也要用，不能反過來依賴簽核單控制器。
import Employee from '../models/Employee.js'
import SubDepartment from '../models/SubDepartment.js'
import { eligibleEmployeeFilter } from './approverEligibility.js'
import { normalizeSignTag, normalizeSignTags } from '../utils/signTags.js'

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
