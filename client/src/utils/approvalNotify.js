// 簽核頁的提示與確認：成功用不擋畫面的訊息、失敗用停留較久的錯誤訊息、破壞性操作用確認對話框。
// 取代瀏覽器原生的 alert / confirm（手機上會多按一次，樣式也和系統其他地方不一致）。
import { h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const cleanLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map(line => String(line ?? '').trim())
  .filter(Boolean)

/**
 * 成功訊息。伺服器附帶提醒（例如超過額度但仍可送出、特休扣減失敗）時改用警告樣式，
 * 而且不會自動消失，要使用者自己關掉才算看過。
 */
export function notifySuccess(message, warnings = []) {
  const extra = cleanLines(warnings)
  if (!extra.length) {
    ElMessage({ type: 'success', message, duration: 3000 })
    return
  }
  ElMessage({
    type: 'warning',
    duration: 0,
    showClose: true,
    message: h('div', null, [message, ...extra].map(line => h('p', { style: 'margin: 0; line-height: 1.6' }, line))),
  })
}

/** 失敗訊息：「標題：伺服器回傳的中文原因」，停留 6 秒、可手動關閉 */
export function notifyFailure(title, message) {
  ElMessage({
    type: 'error',
    message: title ? `${title}：${message}` : String(message || ''),
    duration: 6000,
    showClose: true,
  })
}

/** 二次確認：按確認回傳 true，取消或關閉回傳 false */
export async function confirmAction(message, { title = '請確認', confirmText = '確定', cancelText = '取消', danger = false } = {}) {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      type: 'warning',
      confirmButtonClass: danger ? 'el-button--danger' : '',
    })
    return true
  } catch {
    return false
  }
}

export default { notifySuccess, notifyFailure, confirmAction }
