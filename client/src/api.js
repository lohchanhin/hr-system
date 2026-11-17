import { getToken, setToken, clearToken, isTokenExpiring } from './utils/tokenService'

const runtimeBaseUrl =
  typeof window !== 'undefined' ? window.__APP_CONFIG__?.apiBaseUrl : undefined

const envBaseUrl = import.meta.env.VITE_API_BASE_URL

const locationBaseUrl =
  typeof window !== 'undefined' && window.location ? window.location.origin : ''

export const API_BASE_URL = runtimeBaseUrl ?? envBaseUrl ?? locationBaseUrl

// token 剩不到一分鐘就先續期，不等伺服器回 401
const REFRESH_MARGIN_MS = 60 * 1000
// 這些路徑本身就是登入、續期、登出：不續期、不自動跳登入頁
const AUTH_PATHS = ['/api/login', '/api/auth/refresh', '/api/auth/2fa/verify', '/api/logout']
const REFRESH_LOCK_NAME = 'hr-token-refresh'

let refreshPromise = null

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 另一個分頁剛續期過：localStorage 裡已經是新的、還沒過期的 token */
function freshTokenOtherThan(previousToken) {
  const current = getToken()
  return current && current !== previousToken && !isTokenExpiring(0) ? current : null
}

async function requestRefresh() {
  const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  if (res?.ok) {
    const data = await res.json().catch(() => null)
    if (data?.token) {
      setToken(data.token)
      return { token: data.token }
    }
    return { status: 'error' }
  }
  if (res?.status === 401) {
    const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null
    return { status: body?.code === 'REFRESH_ROTATED' ? 'rotated' : 'unauthorized' }
  }
  return { status: 'error' }
}

async function runRefresh(previousToken) {
  // 排隊等鎖的時候另一個分頁可能已經換好了
  const already = freshTokenOtherThan(previousToken)
  if (already) return { token: already }
  let result = await requestRefresh()
  if (result.status === 'rotated') {
    // 同一個瀏覽器的另一個分頁剛換過：新 token 很快會寫進 localStorage，新的 cookie 也已經存好
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await wait(200)
      const latest = freshTokenOtherThan(previousToken)
      if (latest) return { token: latest }
    }
    result = await requestRefresh()
    if (result.status === 'rotated') result = { status: 'unauthorized' }
  }
  return result
}

/**
 * 用續期 cookie 換新的 access token。
 * 回傳 { token }，或 { status: 'unauthorized' }（要重新登入）、{ status: 'error' }（網路或伺服器問題，先不登出）。
 * 同一個分頁同時多個請求只續期一次；多個分頁之間用 Web Locks 排隊，避免同一個續期 token 被用兩次。
 */
export function refreshAccessToken(previousToken = getToken()) {
  if (!refreshPromise) {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : null
    const task = () => runRefresh(previousToken)
    refreshPromise = Promise.resolve()
      .then(() => (locks?.request ? locks.request(REFRESH_LOCK_NAME, task) : task()))
      .catch(() => ({ status: 'error' }))
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function redirectToLogin() {
  clearToken()
  const currentPath = window.location.pathname || ''
  window.location.href = currentPath.startsWith('/manager') ? '/manager/login' : '/login'
}

export async function apiFetch(path, options = {}, { autoRedirect = true } = {}) {
  const isAuthPath = AUTH_PATHS.some((prefix) => path.startsWith(prefix))
  let token = getToken()
  // token 快到期或已到期（例如表單填了很久）：先續期再送，送出的資料不會因為 401 被丟掉
  if (token && !isAuthPath && isTokenExpiring(REFRESH_MARGIN_MS)) {
    const refreshed = await refreshAccessToken(token)
    if (refreshed?.token) token = refreshed.token
  }
  const send = (bearer) =>
    fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    })
  let res = await send(token)

  if (res.status === 401 && autoRedirect && !isAuthPath) {
    // 沒有 token（被其他分頁登出前的舊版本清掉）也試著用續期 cookie 換一次
    const refreshed = await refreshAccessToken(token)
    if (refreshed?.token) {
      res = await send(refreshed.token)
    } else if (refreshed?.status === 'error') {
      // 續期時網路或伺服器出錯：不登出，留在原畫面讓使用者稍後再試（填好的資料還在）
      return res
    }
  }

  if (res.status === 401 && autoRedirect) {
    redirectToLogin()
  }
  return res
}

export function importEmployeesBulk(formData, fetchOptions = {}, fetchConfig = {}) {
  const options = { method: 'POST', body: formData, ...fetchOptions }
  return apiFetch('/api/employees/import', options, fetchConfig)
}

export function importAttendanceRecords(formData, fetchOptions = {}, fetchConfig = {}) {
  const options = { method: 'POST', body: formData, ...fetchOptions }
  return apiFetch('/api/attendance/import', options, fetchConfig)
}

export function importScheduleRecords(formData, fetchOptions = {}, fetchConfig = {}) {
  const options = { method: 'POST', body: formData, ...fetchOptions }
  return apiFetch('/api/schedules/import', options, fetchConfig)
}
