// 行事曆設定（CompanyCalendarPanel）的顯示文字與小工具：純函式，方便測試
import { CALENDAR_STATE_LABELS, HOLIDAY_KIND_LABELS } from '../constants/holidayCalendar'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

export const DIFF_TYPE_LABELS = { add: '新增', change: '變更', remove: '刪除' }

export const ORIGIN_LABELS = {
  public: '政府資料',
  rule: '系統規則',
  migrated: '舊版轉換',
  manual: '手動'
}

export const NOTICE_TYPE_LABELS = {
  new_year_available: '新年度',
  revision_available: '有新版本',
  multiple_resources: '多份檔案',
  migrated_review: '待核定',
  year_not_approved: '尚未核定'
}

export const LAST_ERROR_LABELS = {
  FETCH_TIMEOUT: '無法連線政府資料平台',
  FETCH_FAILED: '無法連線政府資料平台',
  BAD_METADATA: '政府資料平台回應格式不正確'
}

export const RECONCILIATION_PROBLEM_LABELS = {
  source_not_statutory: '原日期已不是國定假日',
  target_is_holiday: '調移日已是假日',
  duplicate_target: '和另一筆公司調移同一天',
  target_taken: '調移日已是員工的個人調移日或補假日',
  missing_agreement: '缺少協議資料',
  holiday_not_statutory: '對應的日子已不是國定假日',
  original_not_statutory: '原日期已不是國定假日'
}

export const SAVE_ERROR_MESSAGES = {
  DUPLICATE_DAY: '這一天已有相同類型的紀錄',
  NAME_REQUIRED: '請填寫名稱',
  INVALID_DATE: '日期格式不正確',
  COMPENSATES_NOT_ALLOWED: '只有公務機關補假可以設定補的是哪一天',
  EXCLUSION_NOT_ALLOWED: '只有指定應放假日可以設定不適用的員工',
  AGREEMENT_REQUIRED: '啟用「依政府調整放假」必須填寫協議文號與同意日期',
  NEEDS_REVIEW_ROWS: '還有待確認的日期',
  SOURCE_UNAVAILABLE: '無法取得政府辦公日曆表，請稍後再試',
  INVALID_CSV: '政府辦公日曆表的內容格式不正確，未寫入任何資料'
}

/** 目前台灣年度 */
export function currentTaipeiYear(now = new Date()) {
  return Number(new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 4))
}

export function weekdayOfKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay()
}

export function weekdayLabel(dateKey) {
  const weekday = weekdayOfKey(dateKey)
  return weekday === null ? '' : WEEKDAY_LABELS[weekday]
}

/** 'YYYY-MM-DD' -> 'YYYY/MM/DD' */
export function formatDateKey(dateKey) {
  return String(dateKey || '').slice(0, 10).replace(/-/g, '/')
}

/** 'YYYY-MM-DD' -> 'MM/DD' */
export function formatMonthDay(dateKey) {
  return String(dateKey || '').slice(5, 10).replace('-', '/')
}

export function formatDateWithWeekday(dateKey) {
  const label = weekdayLabel(dateKey)
  return label ? `${formatDateKey(dateKey)} (${label})` : formatDateKey(dateKey)
}

/** 時間戳記 -> 台灣時間 'YYYY/MM/DD HH:mm' */
export function formatTaipeiDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString()
  return `${shifted.slice(0, 10).replace(/-/g, '/')} ${shifted.slice(11, 16)}`
}

export function lastErrorLabel(code) {
  if (!code) return ''
  if (LAST_ERROR_LABELS[code]) return LAST_ERROR_LABELS[code]
  if (/^HTTP_\d+$/.test(code)) return `政府資料平台暫時無法使用（${code.slice(5)}）`
  return '無法連線政府資料平台'
}

/** 表格「對應」欄：補假補的是哪一天；指定應放假日排除幾人 */
export function describeDayLink(day) {
  if (!day) return ''
  if (day.kind === 'gov_makeup_off') {
    if (!day.compensatesDate) return '未對應'
    return `補 ${formatMonthDay(day.compensatesDate)} ${day.compensatesName || ''}`.trim()
  }
  if (day.kind === 'designated') {
    const count = Array.isArray(day.excludedEmployees) ? day.excludedEmployees.length : 0
    return count ? `排除 ${count} 人` : ''
  }
  return ''
}

export function originLabel(origin) {
  return ORIGIN_LABELS[origin] || '手動'
}

/** 表格「標記」欄 */
export function dayFlags(day) {
  const flags = []
  if (day?.hrEdited) flags.push('HR 已修改')
  if (day?.needsReview) flags.push('待確認')
  if (day?.archived) flags.push('已刪除')
  return flags
}

export function stateLabel(state) {
  return CALENDAR_STATE_LABELS[state] || CALENDAR_STATE_LABELS.none
}

export function stateTagType(state) {
  if (state === 'approved') return 'success'
  if (state === 'draft') return 'warning'
  return 'info'
}

/** 年度狀態說明 */
export function stateBannerText(item) {
  const year = item?.year ?? ''
  const state = item?.state || 'none'
  if (state === 'none') return `尚未建立 ${year} 年公司行事曆`
  if (state === 'approved') {
    const who = item.approvedByName ? `${item.approvedByName}，` : ''
    const when = formatTaipeiDateTime(item.approvedAt)
    return `已核定（${who}${when || '時間不明'}）`
  }
  if (item.migrated) return '此年度由舊版資料轉換，舊版把公務機關補假也當成國定假日；已依法重新分類，請確認後核定'
  return '草稿：請檢查假日分類後按「核定」；核定前排班、薪資仍會使用這份草稿，但畫面會標示「尚未核定」'
}

export function stateBannerType(item) {
  const state = item?.state || 'none'
  if (state === 'approved') return 'success'
  if (state === 'draft') return 'warning'
  return 'info'
}

/** '國定假日 16、公務機關補假 6'（只列有數量的類型） */
export function describeKindCounts(counts = {}) {
  return Object.entries(counts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([kind, count]) => `${HOLIDAY_KIND_LABELS[kind] || kind} ${count}`)
    .join('、')
}

/** 差異畫面「目前」「政府資料」欄 */
export function describeDiffSide(side) {
  if (!side) return '—'
  const label = HOLIDAY_KIND_LABELS[side.kind] || side.kind || ''
  const name = side.name && side.name !== label ? ` ${side.name}` : ''
  const link = side.kind === 'gov_makeup_off' && side.compensatesDate ? `（補 ${formatMonthDay(side.compensatesDate)}）` : ''
  const archived = side.archived ? '（已刪除）' : ''
  return `${label}${name}${link}${archived}`
}

/** 每個差異的預設處理方式（衝突預設保留目前） */
export function buildDefaultDecisions(diff) {
  const decisions = {}
  for (const change of diff?.changes || []) decisions[change.key] = change.defaultDecision || 'accept'
  return decisions
}

/** 某年度的國定假日數量（頁首統計用） */
export function statutoryCountOfYear(years = [], year) {
  const item = (years || []).find((entry) => Number(entry.year) === Number(year))
  return Number(item?.counts?.statutory || 0)
}

/** 讀取 API 錯誤回應 { error, code } */
export async function readApiError(res, fallback) {
  const body = res && typeof res.json === 'function' ? await res.json().catch(() => ({})) : {}
  const code = body?.code || ''
  return {
    code,
    count: body?.count,
    message: SAVE_ERROR_MESSAGES[code] && code !== 'NEEDS_REVIEW_ROWS'
      ? SAVE_ERROR_MESSAGES[code]
      : (body?.error || fallback)
  }
}
