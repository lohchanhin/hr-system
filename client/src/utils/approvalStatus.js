// 申請單狀態的文字與標籤顏色：全站只有這一份（簽核頁的三份清單與明細、排班頁的「相關簽核」、調休存摺的使用紀錄）。
// 以前排班頁寫「已核准／已駁回／已退回」、調休存摺寫「已核准／已退回」，和簽核頁的「已核可／已否決／已退簽」說的是同一件事。

export const APPROVAL_STATUS_TEXT = {
  pending: '待簽核',
  approved: '已核可',
  rejected: '已否決',
  returned: '已退簽',
  canceled: '已撤回',
  skipped: '已由其他人處理',
}

// 待簽核（進行中）橘、已核可綠、已否決紅、已退簽主色（等申請人修改）、已撤回與其他灰
export const APPROVAL_STATUS_TAG_TYPE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  returned: 'primary',
  canceled: 'info',
  skipped: 'info',
}

// 伺服器的狀態拼成 canceled，舊資料可能是 cancelled：兩種拼法都認
function normalizeStatus(status) {
  const key = String(status ?? '').trim()
  return key === 'cancelled' ? 'canceled' : key
}

export function approvalStatusText(status) {
  return APPROVAL_STATUS_TEXT[normalizeStatus(status)] || status || '-'
}

export function approvalStatusTagType(status) {
  return APPROVAL_STATUS_TAG_TYPE[normalizeStatus(status)] || 'info'
}
