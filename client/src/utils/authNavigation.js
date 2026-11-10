import { getActivePinia } from 'pinia'
import { apiFetch } from '../api'
import { clearToken, getToken, setToken } from './tokenService'
import { persistRole } from './roleCache'
import { clearEmployeePhotoCache } from './photoUrl'
import { useMenuStore } from '../stores/menu'
import { useProfileStore } from '../stores/profile'

const HOME_ROUTES = Object.freeze({
  employee: '/front/attendance',
  supervisor: '/front/schedule',
  admin: '/manager/settings'
})

// 主管沒有排班權限時（2026/11 起預設只有排班人員能排班）的首頁：排班頁會擋下，出勤打卡每個人都能進
export const SUPERVISOR_WITHOUT_SCHEDULE_HOME = '/front/attendance'

// 前台（員工系統）與後台各自的入口：兩邊都能用的角色（管理員）在外框上互相切換
export const FRONT_HOME = '/front/attendance'
export const BACK_OFFICE_HOME = '/manager'

/**
 * 登入後（或已登入又開登入頁時）要去的頁面。主管看排班權限（個人資料／登入回應的 scheduleAccess）：
 * 有排班權限才進排班頁，沒有（或讀不到）就進出勤打卡——以前一律進排班頁，被切開的主管登入後只看到 403、沒有任何連結。
 */
export function getAuthenticatedHomeRoute(role, scheduleAccess = null) {
  if (role === 'supervisor' && scheduleAccess?.canSchedule !== true) return SUPERVISOR_WITHOUT_SCHEDULE_HOME
  return HOME_ROUTES[role] || null
}

// 前台（/front）的頁面；選單裡其餘的項目都屬於後台。要與 router 的 /front 子路由一致（tests/router.spec.js 會比對）
export const FRONT_MENU_NAMES = Object.freeze([
  'Attendance',
  'MySchedule',
  'Schedule',
  'FrontDepartmentReports',
  'PreviewWeek',
  'PreviewMonth',
  'Approval',
  'FrontChangePassword'
])

// 管理員的選單（/api/menu）只有後台項目；管理員也能使用的前台頁面在這裡補上，
// 否則管理員打開前台頁面時，員工系統的外框裡會出現整排後台選單
const ADMIN_FRONT_MENU = Object.freeze([
  Object.freeze({ name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' }),
  Object.freeze({ name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' }),
  Object.freeze({ name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }),
  Object.freeze({ name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' })
])

const CHANGE_PASSWORD_MENU_NAMES = ['FrontChangePassword', 'ManagerChangePassword']

const menuList = items => (Array.isArray(items) ? items.filter(item => item && typeof item.name === 'string') : [])

export function isFrontMenuName(name) {
  return FRONT_MENU_NAMES.includes(name)
}

/**
 * 選單裡屬於前台（員工系統）的項目。伺服器有回 frontItems（/api/menu?include=front，menu store 的 frontItems）時直接用它；
 * 舊版伺服器沒有 frontItems（null）時從選單挑出前台頁面，管理員的選單沒有前台項目時補上管理員能用的前台頁面
 */
export function frontMenuItems(items, role = '', serverFrontItems = null) {
  if (Array.isArray(serverFrontItems)) return menuList(serverFrontItems).filter(item => isFrontMenuName(item.name))
  const front = menuList(items).filter(item => isFrontMenuName(item.name))
  if (front.length === 0 && role === 'admin') return [...ADMIN_FRONT_MENU]
  return front
}

/** 選單裡屬於後台的項目 */
export function backOfficeMenuItems(items) {
  return menuList(items).filter(item => !isFrontMenuName(item.name))
}

/** 變更密碼在手機上收進頭像選單，不佔底部分頁 */
export function isChangePasswordMenuName(name) {
  return CHANGE_PASSWORD_MENU_NAMES.includes(name)
}

/**
 * 登入失敗時顯示的訊息。伺服器對「帳號或密碼錯誤」與「帳號已停用／留職停薪／離職」回同一個 401，
 * 這裡也不區分（不洩漏帳號是否存在）；伺服器有給中文訊息（message）時優先顯示
 */
export function loginFailureMessage(status, data = null) {
  const serverMessage = typeof data?.message === 'string' ? data.message.trim() : ''
  if (serverMessage) return serverMessage
  if (status === 429) return '登入失敗次數過多，請稍後再試'
  if (status === 401 || status === 400 || status === 403) return '帳號或密碼錯誤，或帳號已停用'
  return '登入失敗，請稍後再試'
}

function postLogin(body) {
  return apiFetch(
    '/api/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    { autoRedirect: false }
  )
}

/**
 * 送出登入並建立登入狀態。回傳 { destination }（要前往的首頁）或 { error }（顯示給使用者的訊息）。
 * 不送 role：角色由伺服器依帳號決定，登入頁不再讓使用者自己選（選錯只會得到一個看不懂的失敗）。
 */
export async function signIn(username, password) {
  let res
  try {
    res = await postLogin({ username, password })
  } catch (error) {
    return { error: '無法連線到伺服器，請確認網路連線後再試' }
  }
  const data = await Promise.resolve(res.json?.()).catch(() => null)
  if (!res.ok) return { error: loginFailureMessage(res.status, data) }
  const destination = beginSession(data)
  return destination ? { destination } : { error: '登入過程中發生錯誤，請稍後再試' }
}

function storeEmployeeId(id) {
  if (typeof window === 'undefined') return
  window.sessionStorage?.setItem('employeeId', id)
  window.localStorage?.setItem('employeeId', id)
}

// 上一個帳號留在記憶體裡的資料（選單、個人資料、照片）。沒有 pinia 的環境（個別元件測試）略過 store
function clearAccountCaches() {
  clearEmployeePhotoCache()
  if (!getActivePinia()) return
  useMenuStore().setMenu?.([])
  useProfileStore().clearProfile?.()
}

/**
 * 登入成功後建立登入狀態，回傳要前往的首頁；回應不完整（沒有 token、不認得的角色）時回傳 null、不留下任何登入狀態。
 * 首頁由伺服器回應的角色決定，與從哪一個登入頁進來無關：員工從主管登入頁登入一樣進員工首頁。
 */
export function beginSession(data) {
  const user = data?.user
  const destination = getAuthenticatedHomeRoute(user?.role, user?.scheduleAccess)
  const employeeId = user?.employeeId || user?.id
  if (!data?.token || !destination || !employeeId) return null

  // 同一個分頁換帳號登入（例如變更密碼後）：不沿用上一個人的選單與個人資料
  clearAccountCaches()
  setToken(data.token)
  persistRole(user.role)
  storeEmployeeId(String(employeeId))
  return destination
}

/**
 * 登出：請伺服器作廢目前的 token，再清掉本機的登入狀態與快取。
 * 以前只清本機，token 到期前（1 小時）仍然有效——共用電腦上登出後，舊 token 還能呼叫 API。
 * 作廢請求不等回應，失敗（斷線、token 已過期）也照樣登出；變更密碼後伺服器已作廢 token，傳 revokeToken: false。
 */
export function endSession({ revokeToken = true } = {}) {
  if (revokeToken && getToken()) {
    try {
      // apiFetch 在呼叫當下就讀取 token 並送出請求，所以要在 clearToken 之前
      Promise.resolve(apiFetch('/api/logout', { method: 'POST', keepalive: true }, { autoRedirect: false })).catch(() => {})
    } catch (error) {
      // 送不出去不影響登出
    }
  }
  clearToken()
  if (typeof window !== 'undefined') {
    window.sessionStorage?.removeItem('employeeId')
    window.localStorage?.removeItem('employeeId')
    window.localStorage?.removeItem('username')
  }
  clearAccountCaches()
}
