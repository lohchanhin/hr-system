import dayjs from 'dayjs'
import { isCountedHoliday, getHolidayDisplayName } from './scheduleHoliday'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 灰字資訊的預設文字（舊版 by-month 資料沒有 label 時用）
const INFO_LABELS = {
  gov_makeup_off: '公務機關補假',
  gov_bridge_off: '公務機關調整放假',
  gov_makeup_workday: '公務機關補行上班',
  company_off: '公司休息日',
  company_workday: '公司上班日'
}

function holidayDateKey(value) {
  if (!value) return ''
  // 後端回傳 ISO 字串（UTC 午夜）；直接取日期部分，避免依瀏覽器時區位移一天
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : ''
}

function isDesignated(entry) {
  return entry?.displayKind === 'designated' || (!entry?.displayKind && entry?.kind === 'designated')
}

// 不算假日的資料在標頭下方顯示的灰字：新版標頭資料用 label；舊版資料只有標了 kind 的才顯示
function infoLabelOf(entry) {
  if (entry?.displayKind) return String(entry.label || INFO_LABELS[entry.kind] || '').trim()
  return INFO_LABELS[entry?.kind] || ''
}

function isSlot(value) {
  return Boolean(value) && typeof value === 'object' && Array.isArray(value.infos) && 'holiday' in value
}

/**
 * 把一個月的行事曆標頭資料（GET /api/holiday-calendar/headers 的 entries，也接受舊版 by-month 紀錄）
 * 整理成 { 'YYYY-MM-DD': { holiday, infos } }：
 * holiday 是當天要標示的國定假日（國定假日優先於指定應放假日），infos 是灰字資訊（公務機關補假等）。
 */
export function buildHolidayMap(entries = []) {
  const map = {}
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue
    const key = holidayDateKey(entry.date)
    if (!key) continue
    const slot = map[key] || (map[key] = { holiday: null, infos: [] })
    if (isCountedHoliday(entry)) {
      if (!slot.holiday || (isDesignated(slot.holiday) && !isDesignated(entry))) slot.holiday = entry
    } else if (infoLabelOf(entry)) {
      slot.infos.push(entry)
    }
  }
  return map
}

/**
 * 產生月份每一天的標頭：[{ date, label, holiday, infos, displayKind }]。
 * 國定假日標 🎊、指定應放假日標 📌；公務機關補假、調整放假、公司休息日等不標示，只放進 infos（灰字）。
 * holidayMap 是 buildHolidayMap 的結果（也接受舊版 { 日期: 紀錄 }）。
 */
export function buildMonthDays(monthStr, holidayMap = {}) {
  const dt = dayjs(monthStr + '-01')
  const end = dt.endOf('month').date()
  return Array.from({ length: end }, (_, i) => {
    const date = i + 1
    const weekday = WEEKDAY_LABELS[dt.date(date).day()]
    const dateStr = `${monthStr}-${String(date).padStart(2, '0')}`
    const value = holidayMap?.[dateStr]
    const slot = isSlot(value)
      ? value
      : { holiday: isCountedHoliday(value) ? value : null, infos: [] }
    const holiday = slot.holiday || undefined
    const infos = slot.infos.map(infoLabelOf).filter(Boolean)
    let label = `${date}(${weekday})`
    let displayKind = ''
    if (holiday) {
      displayKind = isDesignated(holiday) ? 'designated' : 'holiday'
      label = `${label} ${displayKind === 'designated' ? '📌' : '🎊'}${getHolidayDisplayName(holiday)}`
    } else if (slot.infos.length) {
      displayKind = slot.infos[0].displayKind || ''
    }
    return { date, label, holiday, infos, displayKind }
  })
}
