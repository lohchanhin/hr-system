import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { apiFetch } from '../api'

export const useMenuStore = defineStore('menu', () => {
  const items = ref([])
  const flattenedItems = computed(() => {
    const result = []
    for (const group of items.value) {
      if (group && Array.isArray(group.children)) {
        result.push(...group.children)
      }
    }
    return result
  })

  async function fetchMenu() {
    const res = await apiFetch('/api/menu')
    if (res.ok) {
      const data = await res.json()
      items.value = Array.isArray(data) ? data : []
    }
  }

  function setMenu(data) {
    items.value = Array.isArray(data) ? data : []
  }

  return { items, flattenedItems, fetchMenu, setMenu }
})
