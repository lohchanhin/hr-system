import { getToken, clearToken } from './utils/tokenService'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? window.location.origin

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
