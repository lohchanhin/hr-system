import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('stores credentials on setAuth', () => {
    const store = useAuthStore()
    store.setAuth({ token: 'tok', role: 'hr', employeeId: 'e1' })
    expect(store.token).toBe('tok')
    expect(store.role).toBe('hr')
    expect(store.employeeId).toBe('e1')
    expect(localStorage.getItem('token')).toBe('tok')
    expect(localStorage.getItem('role')).toBe('hr')
    expect(localStorage.getItem('employeeId')).toBe('e1')
  })

  it('clears all credentials', () => {
    const store = useAuthStore()
    store.setAuth({ token: 'tok', role: 'hr', employeeId: 'e1' })
    store.clearAuth()
    expect(store.token).toBe('')
    expect(store.role).toBe('')
    expect(store.employeeId).toBe('')
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('role')).toBeNull()
    expect(localStorage.getItem('employeeId')).toBeNull()
  })
})
