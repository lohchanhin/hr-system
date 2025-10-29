import { getToken } from '@/utils/tokenService'

function decodePayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const decoded = JSON.parse(atob(payload))
    return decoded
  } catch (error) {
    return null
  }
}

export function decodeRoleFromToken(token) {
  const payload = typeof token === 'string' ? decodePayload(token) : null
  if (!payload) return null

  if (typeof payload.role === 'string') return payload.role
  if (payload.user && typeof payload.user.role === 'string') return payload.user.role
  return null
}

function persistRole(role) {
  if (!role) return
  if (typeof window === 'undefined') return
  if (window.sessionStorage) {
    window.sessionStorage.setItem('role', role)
  }
  if (window.localStorage) {
    window.localStorage.setItem('role', role)
  }
}

export function resolveUserRole({ token, defaultRole = 'employee' } = {}) {
  if (typeof window === 'undefined') {
    return defaultRole
  }

  const sessionRole = window.sessionStorage?.getItem('role')
  if (sessionRole) {
    return sessionRole
  }

  const localRole = window.localStorage?.getItem('role')
  if (localRole) {
    if (window.sessionStorage) {
      window.sessionStorage.setItem('role', localRole)
    }
    return localRole
  }

  const effectiveToken = token ?? getToken()
  if (!effectiveToken) {
    return defaultRole
  }

  const decodedRole = decodeRoleFromToken(effectiveToken)
  if (decodedRole) {
    persistRole(decodedRole)
    return decodedRole
  }

  return defaultRole
}
