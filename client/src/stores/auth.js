import { ref } from 'vue'
import { defineStore } from 'pinia'
import { resolveUserRole, refreshRoleFromSource } from '../utils/roleResolver'

let roleWatcherInitialized = false
function setupRoleWatcher(refreshFn) {
  if (roleWatcherInitialized) return
  if (typeof window === 'undefined') return
  window.addEventListener('storage', event => {
    if (['token', 'role'].includes(event.key)) {
      refreshFn({ forceRefresh: true })
    }
  })
  roleWatcherInitialized = true
}

export const useAuthStore = defineStore('auth', () => {
  const role = ref('employee')

  function refreshRole({ forceRefresh = false } = {}) {
    const resolver = forceRefresh ? refreshRoleFromSource : resolveUserRole
    role.value = resolver({ defaultRole: 'employee' })
    return role.value
  }

  function loadUser(options = {}) {
    setupRoleWatcher(refreshRole)
    return refreshRole(options)
  }

  return { role, loadUser, refreshRole }
})
