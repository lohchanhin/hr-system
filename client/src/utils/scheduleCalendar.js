import dayjs from 'dayjs'
import { isCountedHoliday, getHolidayDisplayName } from './scheduleHoliday'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function holidayDateKey(value) {
  if (!value) return ''
  // 後端回傳 ISO 字串（UTC 午夜）；直接取日期部分，避免依瀏覽器時區位移一天
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : ''
}

/**
 * Builds a {"YYYY-MM-DD": holiday} lookup from the holiday records of a month.
 * 同一天有多筆紀錄時，優先保留算假日的那一筆（例如同日有補班日備註時不被蓋掉）。
 */
export function buildHolidayMap(holidays = []) {
  const map = {}
  for (const holiday of Array.isArray(holidays) ? holidays : []) {
    const key = holidayDateKey(holiday?.date)
    if (!key) continue
    const existing = map[key]
    if (existing && isCountedHoliday(existing) && !isCountedHoliday(holiday)) continue
    map[key] = holiday
  }
  return map
}

/**
 * Builds the list of {date, label, holiday} entries for every day of the
 * given month, annotating holidays looked up from holidayMap (keyed by
 * "YYYY-MM-DD"). Only counted holidays (國定假日 / 假日) are marked; 補班日,
 * 工作日 and company rest records stay plain.
 */
export function buildMonthDays(monthStr, holidayMap = {}) {
  const dt = dayjs(monthStr + '-01')
  const end = dt.endOf('month').date()
  return Array.from({ length: end }, (_, i) => {
    const date = i + 1
    const weekday = WEEKDAY_LABELS[dt.date(date).day()]
    const dateStr = `${monthStr}-${String(date).padStart(2, '0')}`
    const record = holidayMap[dateStr]
    const holiday = isCountedHoliday(record) ? record : undefined
    const holidayName = holiday ? getHolidayDisplayName(holiday) : ''
    const label = holiday ? `${date}(${weekday}) 🎊${holidayName}` : `${date}(${weekday})`
    return { date, label, holiday }
  })
}
