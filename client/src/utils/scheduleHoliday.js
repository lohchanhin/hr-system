// 排班頁日期標頭用的假日判斷。
// 新版行事曆每一筆都有類型 kind（server/src/services/holidayCalendarRules.js），排班頁讀
// GET /api/holiday-calendar/headers 回傳的 displayKind：只有國定假日（含公司挪移後的日期）與指定應放假日要標示，
// 公務機關補假、調整放假、補行上班、公司休息日／上班日、已調移的原日期只以灰字資訊顯示。
// 還沒有 kind 的舊資料比照 server 的 legacyKindOf 判斷（假日資料的 type 預設值是「國定假日」）。

const COUNTED_DISPLAY_KINDS = new Set(['holiday', 'designated'])
const COUNTED_KINDS = new Set(['statutory', 'designated'])
const KNOWN_KINDS = new Set([
  'statutory',
  'gov_makeup_off',
  'gov_bridge_off',
  'gov_makeup_workday',
  'company_off',
  'company_workday',
  'designated'
])

const COMPANY_OFF_TYPES = new Set(['例假日', '公司休息日'])
const WORKDAY_TEXT = /工作日|補班|補行上班|調整上班|makeup\s*work/i
const HOLIDAY_TEXT = /國定|假日|holiday/i
const BRIDGE_NAMES = new Set(['調整放假', '放假'])
// 紀念日及節日實施條例 施行日：小年夜、教師節、光復節、行憲紀念日從這天起才是國定假日
const STATUTE_CUTOVER_DATE = '2025-05-28'
const STATUTORY_NAME_RULES = [
  [/^(中華民國)?開國紀念日$/, null],
  [/^(農曆)?除夕$/, null],
  [/^春節$/, null],
  [/^小年夜$/, STATUTE_CUTOVER_DATE],
  [/^和平紀念日$/, null],
  [/^兒童節$/, null],
  [/^(民族掃墓節|清明節)$/, null],
  [/^兒童節及民族掃墓節$/, null],
  [/^勞動節$/, null],
  [/^端午節$/, null],
  [/^中秋節$/, null],
  [/^(孔子誕辰紀念日(\/教師節)?|教師節)$/, STATUTE_CUTOVER_DATE],
  [/^國慶日$/, null],
  [/^([臺台]灣光復暨金門古寧頭大捷紀念日|光復節)$/, STATUTE_CUTOVER_DATE],
  [/^行憲紀念日$/, STATUTE_CUTOVER_DATE]
]

function recordDateKey(value) {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function isWeekendKey(dateKey) {
  if (!dateKey) return false
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
  return weekday === 0 || weekday === 6
}

// 舊版「一鍵載入國定假日」把每個週末都存成「國定假日」（說明為空、來源 roc-calendar）：不是真的假日。
// 沒有來源或人工新增的資料一律當成真的假日。
function isEmptyWeekendHoliday(holiday) {
  if (String(holiday.source ?? '').trim() !== 'roc-calendar') return false
  if (!isWeekendKey(recordDateKey(holiday.date))) return false
  return !String(holiday.description ?? '').trim() && !String(holiday.desc ?? '').trim()
}

// 名稱是不是法定假日：'statutory'、條例施行前的新增假日 'not_yet'，或 null
function statutoryNameStatus(name, dateKey) {
  const text = String(name ?? '').replace(/[\s　]/g, '')
  if (!text) return null
  for (const [pattern, effectiveFrom] of STATUTORY_NAME_RULES) {
    if (!pattern.test(text)) continue
    return effectiveFrom && dateKey && dateKey < effectiveFrom ? 'not_yet' : 'statutory'
  }
  return null
}

/** 沒有 kind 的舊資料的類型（對應 server 的 legacyKindOf） */
export function legacyHolidayKind(holiday) {
  const type = String(holiday?.type || '').trim() || '國定假日'
  if (COMPANY_OFF_TYPES.has(type)) return 'company_off'
  const joined = [type, holiday?.name, holiday?.description, holiday?.desc].filter(Boolean).join(' ')
  const dateKey = recordDateKey(holiday?.date)
  if (WORKDAY_TEXT.test(joined)) {
    const fromGovernment = String(holiday?.source ?? '').trim() === 'roc-calendar' || /補行上班|調整上班/.test(joined)
    return isWeekendKey(dateKey) && fromGovernment ? 'gov_makeup_workday' : 'company_workday'
  }
  const nameText = String(holiday?.name || holiday?.description || holiday?.desc || '').trim()
  const status = statutoryNameStatus(nameText, dateKey)
  if (status === 'statutory') return 'statutory'
  if (nameText === '補假') return 'gov_makeup_off'
  if (BRIDGE_NAMES.has(nameText) || (status === 'not_yet' && /^小年夜$/.test(nameText))) return 'gov_bridge_off'
  if (!HOLIDAY_TEXT.test(joined)) return 'company_off'
  return 'statutory'
}

/** 這筆行事曆資料要不要在標頭標示成假日（國定假日或指定應放假日） */
export function isCountedHoliday(holiday) {
  if (!holiday || typeof holiday !== 'object') return false
  if (holiday.displayKind) return COUNTED_DISPLAY_KINDS.has(holiday.displayKind)
  if (KNOWN_KINDS.has(holiday.kind)) return COUNTED_KINDS.has(holiday.kind)
  if (isEmptyWeekendHoliday(holiday)) return false
  return legacyHolidayKind(holiday) === 'statutory'
}

/** 標頭要顯示的假日名稱 */
export function getHolidayDisplayName(holiday) {
  return String(holiday?.name || holiday?.description || holiday?.desc || '').trim()
}
