// 排班頁的權限範圍與班別限制（個人資料 GET /api/profile 的 scheduleAccess；說明見 docs/scheduler-access.md）。
// - 排班人員：小單位設定的「排班人員」任何角色都能排班，只看得到被指定的小單位（部門的排班管理者 = 整個部門）
// - 主管：自己與直屬部屬（原本的規則）；其他控制設定切成「只有排班人員」時，主管不再因為是主管而能排班
// - 使用班別：小單位設定的班別；沒有設定代表全部班別

const toId = value => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return String(value._id ?? value.id ?? value.value ?? '')
  return String(value)
}

const idList = value => (Array.isArray(value) ? value.map(toId).filter(Boolean) : [])

/** 個人資料的 scheduleAccess 正規化；沒有（舊版伺服器或讀取失敗）回傳 null，畫面維持依角色判斷 */
export function normalizeScheduleAccess(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const subDepartmentIds = idList(raw.subDepartmentIds)
  const wholeDepartmentIds = idList(raw.wholeDepartmentIds)
  return {
    canSchedule: raw.canSchedule === true,
    supervisorScope: raw.supervisorScope === true,
    subDepartmentIds,
    departmentIds: idList(raw.departmentIds),
    wholeDepartmentIds,
    // 有被指定為小單位排班人員或部門排班管理者
    isScheduler: subDepartmentIds.length > 0 || wholeDepartmentIds.length > 0
  }
}

/**
 * 部門篩選可以選的部門：排班人員被指定的部門，加上 extraDepartmentIds（主管範圍的部門）；
 * 沒有任何限制條件時回傳原清單。
 */
export function filterScopeDepartments(departments, access, extraDepartmentIds = []) {
  const list = Array.isArray(departments) ? departments : []
  if (!access?.isScheduler) return list
  const allowed = new Set([...access.departmentIds, ...idList(extraDepartmentIds)])
  return list.filter(dept => allowed.has(toId(dept)))
}

/**
 * 單位篩選可以選的小單位：排班人員被指定的小單位（排班管理者的部門 = 該部門所有小單位），
 * 加上 extraSubDepartmentIds（主管範圍的小單位）。
 */
export function filterScopeSubDepartments(subDepartments, access, extraSubDepartmentIds = []) {
  const list = Array.isArray(subDepartments) ? subDepartments : []
  if (!access?.isScheduler) return list
  const allowed = new Set([...access.subDepartmentIds, ...idList(extraSubDepartmentIds)])
  const wholeDepartments = new Set(access.wholeDepartmentIds)
  return list.filter(sub => allowed.has(toId(sub)) || wholeDepartments.has(toId(sub?.department)))
}

/**
 * 正在看的小單位可以用的班別：任一個小單位沒有設定（或沒有小單位）就是全部（回傳 null），
 * 否則回傳所有小單位「使用班別」的聯集（Set）。
 */
export function resolveAllowedShiftIds(units) {
  const list = (Array.isArray(units) ? units : []).filter(Boolean)
  if (!list.length) return null
  const allowed = new Set()
  for (const unit of list) {
    const ids = idList(unit.allowedShiftIds)
    if (!ids.length) return null
    ids.forEach(id => allowed.add(id))
  }
  return allowed
}

/** 依 resolveAllowedShiftIds 的結果篩選班別；null 代表全部 */
export function restrictShifts(shifts, allowedShiftIds) {
  const list = Array.isArray(shifts) ? shifts : []
  if (!allowedShiftIds) return list
  return list.filter(shift => allowedShiftIds.has(toId(shift)))
}
