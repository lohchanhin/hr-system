import dayjs from 'dayjs'

/** Builds the canonical cell-identity key used across the schedule grid's selection/cache maps. */
export const buildCellKey = (empId, day) => `${empId}::${day}`

/** Inverse of buildCellKey. Returns { empId, day: NaN } if the key has no '::' separator. */
export const parseCellKey = key => {
  const str = String(key)
  const idx = str.lastIndexOf('::')
  if (idx === -1) {
    return { empId: str, day: NaN }
  }
  const empId = str.slice(0, idx)
  const day = Number(str.slice(idx + 2))
  return { empId, day }
}

/** Normalizes a Mongo doc / id string / undefined into a trimmed id string, or undefined. */
export const normalizeOptionalReferenceId = value => {
  const rawValue = typeof value === 'object' && value
    ? (value._id ?? value.id)
    : value
  const normalized = String(rawValue ?? '').trim()
  return normalized || undefined
}

/** Sorts employees by department then name (locale-aware), for row ordering. */
export const sortEmployeesByDept = list =>
  [...list].sort((a, b) => {
    const deptCompare = (a.department || '').localeCompare(b.department || '')
    if (deptCompare !== 0) return deptCompare
    return (a.name || '').localeCompare(b.name || '')
  })

// 伺服器把班表日期（班表、日期備忘錄、異議）存成該日的 UTC 午夜，例如 2026-11-01T00:00:00.000Z
const UTC_MIDNIGHT_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z)?$/

/**
 * 班表日期的 { year, month, day }。UTC 午夜的字串直接取日期部分，不依瀏覽器時區換算：
 * 電腦時區設在 UTC 以西時，用本地時間換算會變成前一天（1 號的班表跑到上個月最後一天）。
 * 其他格式（Date 物件、帶時分或時區位移的字串）維持用本地時間；無法解析回傳 null。
 */
export const parseScheduleDate = value => {
  if (typeof value === 'string') {
    const match = UTC_MIDNIGHT_DATE.exec(value.trim())
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  }
  if (value === null || value === undefined || value === '') return null
  const parsed = dayjs(value)
  if (!parsed.isValid()) return null
  return { year: parsed.year(), month: parsed.month() + 1, day: parsed.date() }
}

/** 班表日期是幾號（1–31）；無法解析回傳 NaN。 */
export const scheduleDayOfMonth = value => parseScheduleDate(value)?.day ?? NaN

const pad2 = value => String(value).padStart(2, '0')

/** 班表日期的 'YYYY-MM-DD'；無法解析回傳空字串。 */
export const scheduleDateKey = value => {
  const parts = parseScheduleDate(value)
  return parts ? `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` : ''
}
