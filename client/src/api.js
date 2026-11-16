import { getToken, setToken, clearToken } from './utils/tokenService'

const runtimeBaseUrl =
  typeof window !== 'undefined' ? window.__APP_CONFIG__?.apiBaseUrl : undefined

const envBaseUrl = import.meta.env.VITE_API_BASE_URL

const locationBaseUrl =
  typeof window !== 'undefined' && window.location ? window.location.origin : ''

export const API_BASE_URL = runtimeBaseUrl ?? envBaseUrl ?? locationBaseUrl

let refreshPromise = null

async function tryRefreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = Promise.resolve()
      .then(() =>
        fetch(`${API_BASE_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
      )
      .then(async (res) => {
        if (!res?.ok) return null
        const data = await res.json().catch(() => null)
        if (data?.token) {
          setToken(data.token)
          return data.token
        }
        return null
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

export async function apiFetch(path, options = {}, { autoRedirect = true } = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
  let res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  })

  if (
    res.status === 401 &&
    autoRedirect &&
    token &&
    !path.startsWith('/api/login') &&
    !path.startsWith('/api/auth/refresh') &&
    !path.startsWith('/api/auth/2fa/verify')
  ) {
    const newToken = await tryRefreshAccessToken()
    if (newToken) {
      res = await fetch(`${API_BASE_URL}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${newToken}`,
        },
      })
    }
  }

  if (res.status === 401 && autoRedirect) {
    clearToken()
    const path_1 = window.location.pathname || ''
    window.location.href = path_1.startsWith('/manager')
      ? '/manager/login'
      : '/login'
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
