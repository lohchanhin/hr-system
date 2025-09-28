import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiFetch } from '../api'

function getStoredEmployeeId() {
  if (typeof window === 'undefined') return null
  return (
    window.sessionStorage?.getItem('employeeId') ||
    window.localStorage?.getItem('employeeId') ||
    null
  )
}

export const useProfileStore = defineStore('profile', () => {
  const profile = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function fetchProfile({ force = false } = {}) {
    if (profile.value && !force) {
      return profile.value
    }
    const employeeId = getStoredEmployeeId()
    if (!employeeId) {
      profile.value = null
      error.value = new Error('缺少員工識別碼')
      throw error.value
    }
    loading.value = true
    error.value = null
    try {
      const res = await apiFetch(`/api/profile?employeeId=${encodeURIComponent(employeeId)}`)
      if (!res.ok) {
        throw new Error('讀取個人資料失敗')
      }
      const data = await res.json()
      profile.value = data
      return data
    } catch (err) {
      error.value = err
      profile.value = null
      throw err
    } finally {
      loading.value = false
    }
  }

  function setProfile(data) {
    profile.value = data
  }

  function clearProfile() {
    profile.value = null
    error.value = null
  }

  return { profile, loading, error, fetchProfile, setProfile, clearProfile }
})
