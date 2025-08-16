import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getToken } from '../utils/tokenService'

export const useAuthStore = defineStore('auth', () => {
  const role = ref('employee')

  function loadUser() {
    const token = getToken()
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        role.value = payload.role || 'employee'
      } catch (e) {
        role.value = 'employee'
      }
    } else {
      role.value = 'employee'
    }
  }

  return { role, loadUser }
})
