import { getToken, clearToken } from './utils/tokenService'

const runtimeBaseUrl =
  typeof window !== 'undefined' ? window.__APP_CONFIG__?.apiBaseUrl : undefined

const envBaseUrl = import.meta.env.VITE_API_BASE_URL

const locationBaseUrl =
  typeof window !== 'undefined' && window.location ? window.location.origin : ''

export const API_BASE_URL = runtimeBaseUrl ?? envBaseUrl ?? locationBaseUrl

export async function apiFetch(path, options = {}, { autoRedirect = true } = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
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
