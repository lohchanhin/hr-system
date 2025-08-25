import { getToken, getRefreshToken, setToken, clearToken, clearRefreshToken } from './utils/tokenService'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
  if (res.status === 401 && path !== '/api/refresh') {
    const refresh = getRefreshToken()
    if (refresh) {
      const refreshRes = await fetch(`${API_BASE_URL}/api/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh })
      })
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        setToken(data.token)
        const retryHeaders = {
          ...(options.headers || {}),
          Authorization: `Bearer ${data.token}`
        }
        return fetch(`${API_BASE_URL}${path}`, { ...options, headers: retryHeaders })
      } else {
        clearToken()
        clearRefreshToken()
      }
    }
  }
  return res
}
