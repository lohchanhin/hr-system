// 簽核頁（申請、待簽、明細）共用的顯示工具：台灣時間格式、表單值轉成可讀文字

export const TAIPEI_TIME_ZONE = 'Asia/Taipei'

let taipeiFormatter = null
function getTaipeiFormatter() {
  if (!taipeiFormatter) {
    // 只取數字欄位，與語系無關
    taipeiFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TAIPEI_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  }
  return taipeiFormatter
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const NAIVE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

const pad2 = (n) => String(n).padStart(2, '0')

function toTaipeiParts(date) {
  const parts = getTaipeiFormatter().formatToParts(date)
  const pick = (type) => parts.find(part => part.type === type)?.value || ''
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
  }
}

/**
 * 把表單值拆成「台灣時間的年月日時分」。
 * - Date / 數字 / 含時區的 ISO 字串：換算成 Asia/Taipei
 * - 不含時區的 'YYYY-MM-DD'、'YYYY-MM-DD HH:mm'、'HH:mm'：視為已經是台灣時間，原樣使用
 * 無法辨識時回傳 null
 */
export function parseTaipeiParts(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const text = value.trim()
    let match = DATE_ONLY_RE.exec(text)
    if (match) return { year: match[1], month: match[2], day: match[3], hour: '', minute: '', dateOnly: true }
    match = NAIVE_DATETIME_RE.exec(text)
    if (match) return { year: match[1], month: match[2], day: match[3], hour: match[4], minute: match[5] }
    match = TIME_ONLY_RE.exec(text)
    if (match) return { year: '', month: '', day: '', hour: pad2(match[1]), minute: match[2], timeOnly: true }
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return toTaipeiParts(date)
}

export function formatTaipeiDate(value, emptyText = '-') {
  const p = parseTaipeiParts(value)
  if (!p || p.timeOnly) return emptyText
  return `${p.year}/${p.month}/${p.day}`
}

export function formatTaipeiTime(value, emptyText = '-') {
  const p = parseTaipeiParts(value)
  if (!p || p.dateOnly) return emptyText
  return `${p.hour}:${p.minute}`
}

/** YYYY/MM/DD HH:mm（台灣時間）；只有日期或只有時間的值只顯示該部分 */
export function formatTaipeiDateTime(value, emptyText = '-') {
  const p = parseTaipeiParts(value)
  if (!p) return emptyText
  if (p.dateOnly) return `${p.year}/${p.month}/${p.day}`
  if (p.timeOnly) return `${p.hour}:${p.minute}`
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`
}

/* -------------------- 日期／時間選擇器 <-> 台灣時間 -------------------- */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 日期／時間選擇器回傳的 Date 是「裝置時區」的時間，但系統一律以台灣時間為準：
 * 把選擇器上看到的年月日時分當成台灣時間，換成正確的時間點。
 * 裝置本來就在台灣時區（UTC+8）時結果不變；裝置時區不同（出國、電腦時區設錯）時，
 * 選「11/12 09:00」送出的才會是台灣時間 11/12 09:00，而不是別的時區的 09:00（日期還可能差一天）。
 */
export function pickerDateToTaipeiInstant(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value
  const wallClock = Date.UTC(
    value.getFullYear(), value.getMonth(), value.getDate(),
    value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds(),
  )
  return new Date(wallClock - TAIPEI_OFFSET_MS)
}

/**
 * 反過來：把表單裡的值（Date、含時區的 ISO 字串，或不含時區、已經是台灣時間的字串）
 * 換成選擇器要顯示的 Date（選擇器上的年月日時分 = 台灣時間）。讀不懂的值原樣回傳。
 */
export function taipeiInstantToPickerDate(value) {
  if (value == null || value === '') return value
  if (typeof value === 'string') {
    const text = value.trim()
    const naive = DATE_ONLY_RE.exec(text) || NAIVE_DATETIME_RE.exec(text)
    if (naive) return new Date(Number(naive[1]), Number(naive[2]) - 1, Number(naive[3]), Number(naive[4] || 0), Number(naive[5] || 0))
    const timeOnly = TIME_ONLY_RE.exec(text)
    if (timeOnly) {
      const today = new Date()
      return new Date(today.getFullYear(), today.getMonth(), today.getDate(), Number(timeOnly[1]), Number(timeOnly[2]))
    }
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const taipei = new Date(date.getTime() + TAIPEI_OFFSET_MS)
  return new Date(
    taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate(),
    taipei.getUTCHours(), taipei.getUTCMinutes(), taipei.getUTCSeconds(), taipei.getUTCMilliseconds(),
  )
}

/* -------------------- 表單欄位值 -------------------- */

/**
 * 欄位選項統一成 [{ label, value }]。
 * 物件選項除了 { label, value } 也可能是字典 / 自訂欄位的 { name, code }：顯示用名稱，值同伺服器的字典選項一樣用名稱
 */
export function normalizeFieldOptions(field) {
  const opt = field?.options
  if (!opt) return []
  if (Array.isArray(opt)) {
    return opt.map(v => (typeof v === 'string'
      ? { label: v, value: v }
      : { label: v.label ?? v.name ?? v.value ?? v.code, value: v.value ?? v.label ?? v.name ?? v.code }))
  }
  return Object.entries(opt).map(([k, v]) => ({ label: String(v), value: String(k) }))
}

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i
const UNKNOWN_PERSON_TEXT = '（無法辨識的人員）'

/** 查不到名稱的人員編號：不把資料庫編號直接顯示給使用者 */
export function personNameOrFallback(name, id) {
  if (name) return name
  const raw = id == null ? '' : String(id)
  if (!raw) return '-'
  return OBJECT_ID_RE.test(raw) ? UNKNOWN_PERSON_TEXT : raw
}

export function isBlankValue(value) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function labelOfObject(value) {
  return value.label ?? value.name ?? value.value ?? value.code ?? null
}

/**
 * 把表單值轉成給人看的文字。
 * ctx 可提供 lookups：{ user(id), department(id), org(id) }，回傳名稱（找不到回傳空值）。
 */
export function formatFormValue(field, value, ctx = {}) {
  if (Array.isArray(value)) {
    const parts = value
      .map(item => formatFormValue(field, item, ctx))
      .filter(text => text && text !== '-')
    return parts.length ? parts.join('、') : '-'
  }
  if (isBlankValue(value)) return '-'

  const type = field?.type_1
  const lookupName = (kind) => {
    const id = value && typeof value === 'object' ? (value._id ?? value.id ?? value.value) : value
    const name = ctx.lookups?.[kind]?.(String(id))
    if (name) return name
    if (value && typeof value === 'object') return labelOfObject(value) ?? '-'
    const raw = String(value)
    // 找不到對應資料時不要把資料庫編號直接給使用者看
    return OBJECT_ID_RE.test(raw) ? '（無法辨識的資料）' : raw
  }

  if (type === 'user') return lookupName('user')
  if (type === 'department') return lookupName('department')
  if (type === 'org') return lookupName('org')

  if (typeof value === 'boolean') return value ? '是' : '否'

  if (type === 'date') return formatTaipeiDate(value, String(value))
  if (type === 'datetime') return formatTaipeiDateTime(value, String(value))
  if (type === 'time') return formatTaipeiTime(value, String(value))

  if (value && typeof value === 'object') {
    const label = labelOfObject(value)
    return label == null || label === '' ? '-' : String(label)
  }

  if (type === 'select' || type === 'checkbox') {
    const matched = normalizeFieldOptions(field).find(opt => String(opt.value) === String(value))
    if (matched && matched.label != null && matched.label !== '') return String(matched.label)
  }
  return String(value)
}
