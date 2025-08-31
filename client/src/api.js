import { getToken, clearToken } from './utils/tokenService'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? window.location.origin

export function apiFetch(path, options = {}, { autoRedirect = true } = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers }).then(res => {
    if (res.status === 401 && autoRedirect) {
      clearToken()
      const path = window.location.pathname || ''
      window.location.href = path.startsWith('/manager')
        ? '/manager/login'
        : '/login'
    }
    return res
  })
}
