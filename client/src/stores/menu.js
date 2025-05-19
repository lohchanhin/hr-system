import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiFetch } from '../api'

export const useMenuStore = defineStore('menu', () => {
  const items = ref([])

  async function fetchMenu() {
    const token = localStorage.getItem('token')
    const res = await apiFetch('/api/menu', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      items.value = await res.json()
    }
  }

  function setMenu(data) {
    items.value = data
  }

  return { items, fetchMenu, setMenu }
})
