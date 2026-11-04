const HOME_ROUTES = Object.freeze({
  employee: '/front/attendance',
  supervisor: '/front/schedule',
  admin: '/manager/settings'
})

// 主管沒有排班權限時（2026/11 起預設只有排班人員能排班）的首頁：排班頁會擋下，出勤打卡每個人都能進
export const SUPERVISOR_WITHOUT_SCHEDULE_HOME = '/front/attendance'

/**
 * 登入後（或已登入又開登入頁時）要去的頁面。主管看排班權限（個人資料／登入回應的 scheduleAccess）：
 * 有排班權限才進排班頁，沒有（或讀不到）就進出勤打卡——以前一律進排班頁，被切開的主管登入後只看到 403、沒有任何連結。
 */
export function getAuthenticatedHomeRoute(role, scheduleAccess = null) {
  if (role === 'supervisor' && scheduleAccess?.canSchedule !== true) return SUPERVISOR_WITHOUT_SCHEDULE_HOME
  return HOME_ROUTES[role] || null
}

