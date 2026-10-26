// 部門可使用的簽核表單（R2「按部門顯示對應簽核」）：部門設定的「使用簽核表單」（Department.allowedFormIds，可複選）。
// - 一般員工、主管只看得到、只能送出自己部門開放的表單；部門沒有勾選任何表單（空白）時全部都可以用（與以前相同）。
// - 沒有所屬部門的員工、找不到部門資料時也是全部都可以用。
// - 管理員一律看得到全部（表單設計、簽核流程設定不受影響）。
// 只管「申請」：已經送出的單據照常開啟、簽核、撤回；簽核人看別的部門員工送來的單據也不受影響。
import Employee from '../models/Employee.js'
import Department from '../models/Department.js'

export const FORM_NOT_ALLOWED_CODE = 'FORM_NOT_ALLOWED'
// 表單清單有依部門篩選時，回應帶這個標頭（值 department），申請頁據此提示「只顯示您部門開放的表單」
export const FORM_VISIBILITY_HEADER = 'X-Form-Visibility'

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

function normalizeId(value) {
  if (value == null) return ''
  if (typeof value === 'object' && value._id != null && value._id !== value) return normalizeId(value._id)
  return String(value)
}

// 只取需要的欄位並轉成一般物件；測試替身沒有 select / lean 時直接等結果
async function readFields(query, fields) {
  const selected = typeof query?.select === 'function' ? query.select(fields) : query
  return typeof selected?.lean === 'function' ? selected.lean() : selected
}

/** 部門的 allowedFormIds 整理成不重複的表單 _id 字串；空白（或格式不對）代表不限制 */
export function normalizeAllowedFormIds(value) {
  const ids = []
  const seen = new Set()
  for (const item of Array.isArray(value) ? value : []) {
    const id = normalizeId(item).trim()
    if (!OBJECT_ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * 某位員工可以用哪些表單：回傳 { restricted, allowedIds, departmentId }。
 * restricted 為 false 時 allowedIds 是 null（全部都可以用）；為 true 時 allowedIds 是表單 _id 字串陣列。
 * employee 可以是員工文件（有 department 就不再查）或員工 _id。
 */
export async function getFormVisibilityForEmployee(employee) {
  const unrestricted = (departmentId = '') => ({ restricted: false, allowedIds: null, departmentId })
  let departmentId = ''
  // 員工文件（Mongoose 文件的欄位在原型上，所以用 in 判斷）已經帶部門時不再查一次
  if (employee && typeof employee === 'object' && 'department' in employee) {
    departmentId = normalizeId(employee.department)
  } else {
    const employeeId = normalizeId(employee)
    if (!OBJECT_ID_PATTERN.test(employeeId)) return unrestricted()
    const row = await readFields(Employee.findById(employeeId), 'department')
    departmentId = normalizeId(row?.department)
  }
  if (!OBJECT_ID_PATTERN.test(departmentId)) return unrestricted()
  const department = await readFields(Department.findById(departmentId), 'allowedFormIds')
  const allowedIds = normalizeAllowedFormIds(department?.allowedFormIds)
  if (!allowedIds.length) return unrestricted(departmentId)
  return { restricted: true, allowedIds, departmentId }
}

/** 登入者（req.user）可以用哪些表單：管理員不限制，其他人依所屬部門 */
export async function getFormVisibilityForUser(user, employee = null) {
  if (user?.role === 'admin') return { restricted: false, allowedIds: null, departmentId: '' }
  return getFormVisibilityForEmployee(employee || user?.id)
}

export function isFormAllowed(visibility, formId) {
  if (!visibility?.restricted) return true
  return visibility.allowedIds.includes(normalizeId(formId))
}

/** 部門沒有開放這張表單時回給申請人的訊息（HTTP 403） */
export function formNotAllowedMessage(formName) {
  return `您所屬的部門未開放使用【${formName || '這張表單'}】，請改選其他表單；如需使用請洽管理員`
}

export default {
  FORM_NOT_ALLOWED_CODE,
  FORM_VISIBILITY_HEADER,
  normalizeAllowedFormIds,
  getFormVisibilityForEmployee,
  getFormVisibilityForUser,
  isFormAllowed,
  formNotAllowedMessage,
}
