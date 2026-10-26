// 調休存摺的顯示文字與管理員表單的檢查（存摺由 GET /api/compensatory-leave/mine、?employeeId= 提供，單位是小時）。
// 狀態與來源對應 server/src/services/compensatoryLeaveService.js：
//   status：available 未使用／partial 部分使用／used 已使用／expired 已過期／void 已失效
//   usages[].kind：leave_request 調休簽核／hr_assigned HR 指定／adjustment 人資扣除
import { formatBankHours, formatDays, formatHours } from './leaveBalance'

export const COMP_LEAVE_HELP_TEXT = '國定假日剛好是您的休息日、例假（行政人員是週六、週日或公司休息日）時，系統自動存入一筆調休（移休），'
  + '預設保存、不會自動放假；要使用時在申請表單選假別「調休」（或移休、補休、補假）發起簽核，核准後從最早到期、最早取得的調休扣起。'
  + '整天的調休當天視同國定假日。時數旁的天數以 1 天 = 8 小時換算。'

/**
 * 調休（客戶稱為移休）以天計：時數旁邊一律附上天數（1 天 = 8 小時，取到小數第 2 位）。
 * 8 -> '8 小時（1 天）'、4 -> '4 小時（0.5 天）'、12 -> '12 小時（1.5 天）'；沒有值時是 '—'
 */
export function formatCompHours(hours) {
  return formatBankHours(hours)
}

export const CREDIT_STATUS_TAG_TYPES = {
  available: 'success',
  partial: 'primary',
  used: 'info',
  expired: 'danger',
  void: 'info',
}

export const CONFLICT_REASON_TEXT = {
  trigger_gone: '這筆調休已使用，但取得條件已不成立（例如班表改成上班或排了「國」），請人資確認',
  holiday_removed: '這筆調休已使用，但這天已不是國定假日（行事曆已修改），請人資確認',
  date_not_workday: '整天調休的日子之後被排成休息日／例假，員工並沒有因此多休一天，請人資確認',
}

const APPROVAL_STATUS_TEXT = {
  approved: '已核准',
  pending: '簽核中',
  rejected: '已否決',
  returned: '已退回',
  canceled: '已撤回',
}

/** 'YYYY-MM-DD' -> 'YYYY/MM/DD' */
export function formatDateKey(value) {
  const text = String(value || '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10).replaceAll('-', '/') : ''
}

/** 一筆額度的時數說明：「8 小時（1 天），已用 4 小時（0.5 天），剩 4 小時（0.5 天）」 */
export function describeCreditHours(credit) {
  if (!credit) return ''
  const parts = [formatCompHours(credit.hours)]
  if (Number(credit.usedHours) > 0) parts.push(`已用 ${formatCompHours(credit.usedHours)}`)
  if (credit.status === 'available' || credit.status === 'partial') parts.push(`剩 ${formatCompHours(credit.remainingHours)}`)
  if (Number(credit.expiredHours) > 0) parts.push(`過期 ${formatCompHours(credit.expiredHours)}`)
  return parts.join('，')
}

/** 一筆使用紀錄：「調休簽核 8 小時（1 天；2026/10/26 整天，已核准）」「HR 指定 8 小時（1 天；2026/03/02 整天）：與員工協商」 */
export function describeUsage(usage) {
  if (!usage) return ''
  const label = usage.kindLabel || { leave_request: '調休簽核', hr_assigned: 'HR 指定', adjustment: '人資扣除' }[usage.kind] || '使用'
  const details = []
  const fullDays = new Set(usage.fullDayDates || [])
  const dates = (usage.days || []).map((day) => `${formatDateKey(day.date)}${fullDays.has(day.date) ? ' 整天' : ` ${formatHours(day.hours)}`}`)
  if (dates.length) details.push(dates.join('、'))
  const approval = APPROVAL_STATUS_TEXT[usage.approvalStatus]
  if (usage.kind === 'leave_request' && approval) details.push(approval)
  const head = `${label} ${formatHours(usage.hours)}（${formatDays(usage.hours)}${details.length ? `；${details.join('，')}` : ''}）`
  return usage.note ? `${head}：${usage.note}` : head
}

/** 存摺的合計一行：「可用 12 小時（1.5 天）；存摺剩餘 16 小時（2 天）、簽核中 4 小時（0.5 天）」 */
export function describeBankSummary(bank) {
  if (!bank) return ''
  const pending = Number(bank.pendingHours) > 0 ? `、簽核中 ${formatCompHours(bank.pendingHours)}` : ''
  return `可用 ${formatCompHours(bank.availableHours)}；存摺剩餘 ${formatCompHours(bank.balanceHours)}${pending}`
}

/** 管理員填的存摺備註顯示在備註下方的一行：「人資小林 2026/10/26 更新」 */
export function describeNoteMeta(note) {
  if (!note || !note.text) return ''
  const who = note.updatedBy?.name || ''
  const when = note.updatedAt ? formatTaipeiDate(note.updatedAt) : ''
  const parts = [who, when].filter(Boolean)
  return parts.length ? `${parts.join(' ')} 更新` : ''
}

// 時間戳記轉成台灣日期 'YYYY/MM/DD'（伺服器存的是 UTC）
function formatTaipeiDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return taipei.toISOString().slice(0, 10).replaceAll('-', '/')
}

/**
 * 管理員手動給予／扣除的表單檢查：回傳要提醒的訊息，沒問題回傳空字串。
 * 時數要大於 0、是最小單位（預設 0.5 小時）的倍數；備註必填。
 */
export function validateManualForm({ hours, note } = {}, { minUnitHours = 0.5 } = {}) {
  const value = Number(hours)
  if (!Number.isFinite(value) || value <= 0) return '請輸入大於 0 的時數'
  const ratio = value / minUnitHours
  if (Math.abs(ratio - Math.round(ratio)) > 1e-6) return `時數必須是 ${minUnitHours} 小時的倍數`
  if (!String(note ?? '').trim()) return '請填寫備註（給予或調整的原因）'
  return ''
}

/** 存摺備註的長度檢查（與伺服器相同：最多 1000 字；空白代表清除）：回傳要提醒的訊息，沒問題回傳空字串 */
export const MAX_BANK_NOTE_LENGTH = 1000
export function validateBankNote(text) {
  return String(text ?? '').trim().length > MAX_BANK_NOTE_LENGTH ? `備註不可超過 ${MAX_BANK_NOTE_LENGTH} 個字` : ''
}

export default {
  COMP_LEAVE_HELP_TEXT,
  CREDIT_STATUS_TAG_TYPES,
  CONFLICT_REASON_TEXT,
  MAX_BANK_NOTE_LENGTH,
  formatCompHours,
  formatDateKey,
  describeCreditHours,
  describeUsage,
  describeBankSummary,
  describeNoteMeta,
  validateManualForm,
  validateBankNote,
}
