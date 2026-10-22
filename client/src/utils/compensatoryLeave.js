// 調休存摺的顯示文字與管理員表單的檢查（存摺由 GET /api/compensatory-leave/mine、?employeeId= 提供，單位是小時）。
// 狀態與來源對應 server/src/services/compensatoryLeaveService.js：
//   status：available 未使用／partial 部分使用／used 已使用／expired 已過期／void 已失效
//   usages[].kind：leave_request 調休簽核／hr_assigned HR 指定／adjustment 人資扣除
import { formatHours, formatHoursWithDays } from './leaveBalance'

export const COMP_LEAVE_HELP_TEXT = '國定假日剛好是您的休息日、例假（行政人員是週六、週日或公司休息日）時，系統自動存入一筆調休，'
  + '預設保存、不會自動放假；要使用時在申請表單選假別「調休」（或補休、補假）發起簽核，核准後從最早到期、最早取得的調休扣起。'
  + '整天的調休當天視同國定假日。'

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

/** 一筆額度的時數說明：「8 小時，已用 4 小時，剩 4 小時」 */
export function describeCreditHours(credit) {
  if (!credit) return ''
  const parts = [formatHours(credit.hours)]
  if (Number(credit.usedHours) > 0) parts.push(`已用 ${formatHours(credit.usedHours)}`)
  if (credit.status === 'available' || credit.status === 'partial') parts.push(`剩 ${formatHours(credit.remainingHours)}`)
  if (Number(credit.expiredHours) > 0) parts.push(`過期 ${formatHours(credit.expiredHours)}`)
  return parts.join('，')
}

/** 一筆使用紀錄：「調休簽核 8 小時（2026/10/26 整天，已核准）」「HR 指定 8 小時（2026/03/02）：與員工協商」 */
export function describeUsage(usage) {
  if (!usage) return ''
  const label = usage.kindLabel || { leave_request: '調休簽核', hr_assigned: 'HR 指定', adjustment: '人資扣除' }[usage.kind] || '使用'
  const details = []
  const fullDays = new Set(usage.fullDayDates || [])
  const dates = (usage.days || []).map((day) => `${formatDateKey(day.date)}${fullDays.has(day.date) ? ' 整天' : ` ${formatHours(day.hours)}`}`)
  if (dates.length) details.push(dates.join('、'))
  const approval = APPROVAL_STATUS_TEXT[usage.approvalStatus]
  if (usage.kind === 'leave_request' && approval) details.push(approval)
  const head = `${label} ${formatHours(usage.hours)}${details.length ? `（${details.join('，')}）` : ''}`
  return usage.note ? `${head}：${usage.note}` : head
}

/** 存摺的合計一行：「可用 12 小時（1 天 4 小時）；存摺剩餘 16 小時、簽核中 4 小時」 */
export function describeBankSummary(bank) {
  if (!bank) return ''
  const pending = Number(bank.pendingHours) > 0 ? `、簽核中 ${formatHours(bank.pendingHours)}` : ''
  return `可用 ${formatHoursWithDays(bank.availableHours)}；存摺剩餘 ${formatHours(bank.balanceHours)}${pending}`
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

export default {
  COMP_LEAVE_HELP_TEXT,
  CREDIT_STATUS_TAG_TYPES,
  CONFLICT_REASON_TEXT,
  formatDateKey,
  describeCreditHours,
  describeUsage,
  describeBankSummary,
  validateManualForm,
}
