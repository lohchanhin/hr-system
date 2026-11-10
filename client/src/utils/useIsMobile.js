// 畫面寬度是否小於 768px（手機）：簽核頁的清單在手機改成卡片、對話框改成全螢幕（規範見 docs/ui-guidelines.md 第 6 節）。
// 沒有 matchMedia 的環境（測試、舊瀏覽器）一律當成桌機。
import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'

export const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile(query = MOBILE_QUERY) {
  const isMobile = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return isMobile
  const media = window.matchMedia(query)
  if (!media) return isMobile
  isMobile.value = Boolean(media.matches)
  const onChange = (event) => { isMobile.value = Boolean(event.matches) }
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange)
  else if (typeof media.addListener === 'function') media.addListener(onChange)
  // 元件卸載時移除監聽，避免切換頁面後留下監聽
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange)
      else if (typeof media.removeListener === 'function') media.removeListener(onChange)
    })
  }
  return isMobile
}

export default useIsMobile
