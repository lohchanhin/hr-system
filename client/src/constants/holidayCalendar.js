// 公司行事曆的類型、顯示文字與假日制度（和伺服器 services/holidayCalendarRules.js 一致）

export const HOLIDAY_KINDS = [
  'statutory',
  'gov_makeup_off',
  'gov_bridge_off',
  'gov_makeup_workday',
  'company_off',
  'company_workday',
  'designated'
]

export const HOLIDAY_KIND_LABELS = {
  statutory: '國定假日',
  gov_makeup_off: '公務機關補假',
  gov_bridge_off: '公務機關調整放假',
  gov_makeup_workday: '公務機關補行上班',
  company_off: '公司休息日',
  company_workday: '公司上班日',
  designated: '指定應放假日'
}

export const HOLIDAY_KIND_TAG_TYPES = {
  statutory: 'danger',
  gov_makeup_off: 'info',
  gov_bridge_off: 'info',
  gov_makeup_workday: 'warning',
  company_off: 'success',
  company_workday: 'warning',
  designated: 'primary'
}

export const HOLIDAY_KIND_DESCRIPTIONS = {
  statutory: '勞基法第 37 條國定假日，全體員工適用（含落在週末的日子）',
  gov_makeup_off: '政府機關的補假日：調休存摺上線後只是行政人員的建議調休日（國定假日落在週末改存入調休，要用時申請調休）；輪班人員僅供參考',
  gov_bridge_off: '政府機關調整放假：只有啟用「依政府調整放假」並有勞資會議同意時，行政人員改為休息日',
  gov_makeup_workday: '政府機關補行上班：只有啟用「依政府調整放假」時，行政人員改為上班日',
  company_off: '公司自訂休息日（不是國定假日）',
  company_workday: '公司自訂上班日',
  designated: '選舉、罷免、公投等指定應放假日：只適用當天原應出勤且有投票權的員工，不補假、不可調移'
}

export const HOLIDAY_DISPLAY_KIND_LABELS = {
  holiday: '國定假日',
  designated: '指定應放假日',
  gov_info: '公務機關資訊',
  company_off: '公司休息日',
  company_workday: '公司上班日',
  moved_away: '已調移'
}

export const CALENDAR_STATE_LABELS = {
  none: '尚未建立',
  draft: '草稿',
  approved: '已核定'
}

export const HOLIDAY_REGIME_OPTIONS = [
  { value: '', label: '依預設（需排班＝輪班、不需排班＝行政）' },
  { value: 'roster', label: '輪班人員（依班表個別補假）' },
  { value: 'office', label: '行政人員（週一至週五，依政府補假日）' }
]

export const HOLIDAY_REGIME_LABELS = { roster: '輪班', office: '行政' }

// 員工實際適用的假日制度：有設定就用設定；沒設定時不需要排班＝行政，其餘＝輪班
export function resolveHolidayRegime(employee) {
  const value = employee?.holidayRegime
  if (value === 'roster' || value === 'office') return value
  return employee?.requiresScheduling === false ? 'office' : 'roster'
}

export const CONSENT_METHOD_OPTIONS = [
  { value: 'signature', label: '本人簽名' },
  { value: 'written_form', label: '書面同意書' },
  { value: 'electronic', label: '電子同意紀錄' }
]

export const COMPENSATION_STATUS_LABELS = {
  open: '待排補假',
  assigned: '已排補假',
  void: '已失效'
}
