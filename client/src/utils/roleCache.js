export function clearRoleCache() {
  if (typeof window === 'undefined') return
  window.sessionStorage?.removeItem('role')
  window.localStorage?.removeItem('role')
}

export function persistRole(role) {
  if (!role) return
  if (typeof window === 'undefined') return
  window.sessionStorage?.setItem('role', role)
  window.localStorage?.setItem('role', role)
}

export function readRoleFromCache() {
  if (typeof window === 'undefined') return null
  const sessionRole = window.sessionStorage?.getItem('role')
  if (sessionRole) return sessionRole
  const localRole = window.localStorage?.getItem('role')
  if (localRole) {
    window.sessionStorage?.setItem('role', localRole)
    return localRole
  }
  return null
}
