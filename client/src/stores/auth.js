import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const role = ref(localStorage.getItem('role') || '')
  const employeeId = ref(localStorage.getItem('employeeId') || '')

  function setAuth({ token: t, role: r, employeeId: id }) {
    token.value = t
    role.value = r
    employeeId.value = id
    localStorage.setItem('token', t)
    localStorage.setItem('role', r)
    localStorage.setItem('employeeId', id)
  }

  function clearAuth() {
    token.value = ''
    role.value = ''
    employeeId.value = ''
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    localStorage.removeItem('employeeId')
  }

  return { token, role, employeeId, setAuth, clearAuth }
})
