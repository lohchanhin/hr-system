import { getToken, clearToken } from './utils/tokenService'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers }).then(res => {
    if (res.status === 401) {
      clearToken()
      window.location.href = '/login'
    }
    return res
  })
}
