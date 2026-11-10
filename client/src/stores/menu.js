import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiFetch } from '../api'

// 選單（/api/menu?include=front）：items 是角色的選單（後台側欄、主管與員工的前台頁面），
// frontItems 是伺服器整理好的前台（員工系統）項目，管理員也有。舊版伺服器只回陣列，這時 frontItems 是 null，
// 前台外框改用 utils/authNavigation 的 frontMenuItems 從 items 挑出前台頁面（管理員補上固定的清單）
export const useMenuStore = defineStore('menu', () => {
  const items = ref([])
  const frontItems = ref(null)
  // 同一時間只送一次：外框、登入頁、排班頁可能同時要選單，後到的共用前一個請求
  let pending = null

  function fetchMenu() {
    if (pending) return pending
    pending = (async () => {
      const res = await apiFetch('/api/menu?include=front')
      if (res.ok) {
        setMenu(await res.json())
      }
    })().finally(() => {
      pending = null
    })
    return pending
  }

  function setMenu(data) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      items.value = Array.isArray(data.items) ? data.items : []
      frontItems.value = Array.isArray(data.frontItems) ? data.frontItems : null
      return
    }
    items.value = Array.isArray(data) ? data : []
    frontItems.value = null
  }

  return { items, frontItems, fetchMenu, setMenu }
})
