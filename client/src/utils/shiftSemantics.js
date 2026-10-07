// 班別性質（semanticType）的推斷與顯示工具。
// 推斷規則必須與 server/src/services/shiftSemanticService.js 的
// inferLegacyShiftSemanticType 保持一致：前端只用來預設表單與顯示，最終仍以伺服器為準。

export const SHIFT_SEMANTIC_OPTIONS = Object.freeze([
  { value: 'work', label: '工作班' },
  { value: 'rest_day', label: '休息日' },
  { value: 'regular_rest', label: '例假' },
  { value: 'holiday', label: '國定假日' },
  { value: 'leave', label: '請假' },
])

export const SHIFT_SEMANTIC_LABELS = Object.freeze(
  Object.fromEntries(SHIFT_SEMANTIC_OPTIONS.map(({ value, label }) => [value, label]))
)

export const SHIFT_SEMANTIC_TAG_TYPES = Object.freeze({
  work: 'primary',
  rest_day: 'success',
  regular_rest: 'info',
  holiday: 'danger',
  leave: 'warning',
})

const NON_WORK_SEMANTIC_TYPES = new Set(['rest_day', 'regular_rest', 'holiday', 'leave'])

// 非工作班別固定的時間設定：00:00-00:00、休息 0 分鐘、不跨日、不是夜班
export const NON_WORK_SHIFT_DEFAULTS = Object.freeze({
  startTime: '00:00',
  endTime: '00:00',
  breakDuration: 0,
  crossDay: false,
})

const LEAVE_CODES = new Set([
  '特', '病', '事', '喪', '公', '原', '補',
  '公傷', '婚', '生', '檢', '陪', '產', '家',
])
const LEAVE_NAMES = new Set([
  '特休', '特別休假', '病假', '事假', '喪假', '公假', '原民假', '補休',
  '公傷假', '婚假', '生理假', '產檢假', '陪產檢假', '分娩假', '家庭照顧假',
])

function normalized(value) {
  return String(value || '').trim().toUpperCase()
}

// 8:00、08:00:00 這類寫法統一成 HH:mm 再比較（與伺服器一致）
function normalizedTime(value) {
  const text = normalized(value)
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text
}

/** 休息日 / 例假 / 國定假日 / 請假：這些班別性質都不需要上班 */
export function isNonWorkSemanticType(type) {
  return NON_WORK_SEMANTIC_TYPES.has(String(type || '').trim().toLowerCase())
}

/** 開始等於結束、而且沒有勾跨日（例如 00:00-00:00）：沒有任何工作時間 */
export function hasNoWorkingTime(shift = {}) {
  const start = normalizedTime(shift.startTime)
  const end = normalizedTime(shift.endTime)
  return Boolean(start) && start === end && !shift.crossDay
}

/**
 * 依班別代碼／名稱（以及是否沒有工作時間）推斷班別性質。
 * 表單輸入中只提供代碼與名稱時，時間視為「尚未填寫」，不會被當成沒有工作時間。
 */
export function inferShiftSemanticType(shift = {}) {
  const code = normalized(shift.code)
  const name = normalized(shift.name)
  const text = `${code} ${name}`
  const zeroTime = normalizedTime(shift.startTime) === normalizedTime(shift.endTime)

  if (code === '國' || code === '国' || /^(國定假日|国定假日)$/.test(name)) {
    return 'holiday'
  }
  if (LEAVE_CODES.has(code) || LEAVE_NAMES.has(name)) {
    return 'leave'
  }
  if (code === '例' || /^(例|例假|例假日)$/.test(name)) {
    return 'regular_rest'
  }
  if (zeroTime && (/REGULAR[_ -]?REST/.test(text) || /(?:^|[_-])例$/.test(code))) {
    return 'regular_rest'
  }
  if (code === '休' || code === 'OFF' || code === 'REST' || /^(休|休假|休息日)$/.test(name)) {
    return 'rest_day'
  }
  if (zeroTime && (
    /REST[_ -]?DAY/.test(text)
    || /RULE[_ -]?REST(?:$|\s)/.test(text)
    || /(?:^|[_-])休$/.test(code)
  )) {
    return 'rest_day'
  }
  // 沒有工作時間又不屬於休息 / 例假 / 國定假日：一律視為請假，絕不當成工作班
  if (hasNoWorkingTime(shift)) {
    return 'leave'
  }
  return 'work'
}

/** 取得班別的班別性質：有明確值就用明確值，否則依代碼／名稱推斷 */
export function resolveShiftSemanticType(shift = {}) {
  const explicit = String(shift.semanticType || '').trim().toLowerCase()
  return SHIFT_SEMANTIC_OPTIONS.some(option => option.value === explicit)
    ? explicit
    : inferShiftSemanticType(shift)
}

export function getShiftSemanticLabel(shift = {}) {
  return SHIFT_SEMANTIC_LABELS[resolveShiftSemanticType(shift)] || ''
}

/** 標成「工作班」卻沒有工作時間：排班時會被當成 24 小時或 0 小時，需要提醒管理者修正 */
export function isWorkShiftWithoutWorkingTime(shift = {}) {
  return resolveShiftSemanticType(shift) === 'work' && hasNoWorkingTime(shift)
}
