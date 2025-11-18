import { getToken } from '@/utils/tokenService'
import { clearRoleCache, persistRole, readRoleFromCache } from './roleCache'

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

export function resolveUserRole({ token, defaultRole = 'employee', skipCache = false } = {}) {
  if (typeof window === 'undefined') {
    return defaultRole
  }

  const cachedRole = readRoleFromCache()
  if (!skipCache && cachedRole) {
    return cachedRole
  }

  const effectiveToken = token ?? getToken()
  if (!effectiveToken) {
    if (cachedRole) return cachedRole
    return defaultRole
  }

  const decodedRole = decodeRoleFromToken(effectiveToken)
  if (decodedRole) {
    persistRole(decodedRole)
    return decodedRole
  }

  if (cachedRole) {
    persistRole(cachedRole)
    return cachedRole
  }

  if (skipCache) {
    clearRoleCache()
  }

  return defaultRole
}

export function refreshRoleFromSource(options = {}) {
  return resolveUserRole({ ...options, skipCache: true })
}

export { clearRoleCache }
