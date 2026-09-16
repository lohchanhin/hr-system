import dayjs from 'dayjs'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * Builds the list of {date, label, holiday} entries for every day of the
 * given month, annotating holidays looked up from holidayMap (keyed by
 * "YYYY-MM-DD").
 */
export function buildMonthDays(monthStr, holidayMap = {}) {
  const dt = dayjs(monthStr + '-01')
  const end = dt.endOf('month').date()
  return Array.from({ length: end }, (_, i) => {
    const date = i + 1
    const weekday = WEEKDAY_LABELS[dt.date(date).day()]
    const dateStr = `${monthStr}-${String(date).padStart(2, '0')}`
    const holiday = holidayMap[dateStr]
    const label = holiday ? `${date}(${weekday}) 🎊${holiday.name}` : `${date}(${weekday})`
    return { date, label, holiday }
  })
}
