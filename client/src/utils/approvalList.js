// 簽核清單（待我簽核 / 我已簽核 / 我的申請）共用工具：載入、篩選、排序、分頁、清單上的內容摘要

import { formatTaipeiDate, formatTaipeiDateTime, formatTaipeiTime, isBlankValue, normalizeFieldOptions } from './approvalDisplay'
import { formatHoursWithDays } from './leaveBalance'
import { pickLeaveFormFields, toTaipeiDateKey } from './leaveHours'

// 一頁幾筆。清單 API 支援分頁與篩選（status、form、from、to、q、sort，見 docs/approval-list-api.md），
// 篩選、排序、分頁都交給伺服器，一次只取這一頁；伺服器回純陣列（舊版、沒有分頁）時才在前端篩選與分頁
export const PAGE_SIZE = 20
// 伺服器每頁上限（以前一次取這麼多筆回來在前端篩選；現在只剩舊版相容用）
export const LIST_FETCH_LIMIT = 200
// 關鍵字（申請人姓名或員工編號）上限，與伺服器相同
export const KEYWORD_MAX_LENGTH = 50

/** 篩選條件有沒有任何一項有值 */
export function hasActiveFilter(filter) {
  const value = filter || {}
  return Boolean(value.formId || value.status || String(value.keyword || '').trim() || value.from || value.to)
}

/**
 * 清單的查詢字串：page / limit 加上篩選與排序。
 * filter：{ formId, status, keyword, from, to }（from / to 是台灣日期 'YYYY-MM-DD'）；sort：'newest' | 'oldest' | ''。
 * 手機的起、迄是兩個各自的選擇器，選反了就對調（伺服器對「開始晚於結束」回 400）。
 */
export function listQueryString({ page = 1, limit = PAGE_SIZE, filter = {}, sort = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  const value = filter || {}
  if (value.status) params.set('status', value.status)
  if (value.formId) params.set('form', value.formId)
  let from = value.from || ''
  let to = value.to || ''
  if (from && to && from > to) [from, to] = [to, from]
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const keyword = String(value.keyword || '').trim().slice(0, KEYWORD_MAX_LENGTH)
  if (keyword) params.set('q', keyword)
  if (sort) params.set('sort', sort)
  return params.toString()
}

/** 清單網址附上 page / limit；伺服器有支援分頁時才會回傳 { items, total } */
export function pagedListUrl(path, page = 1, limit = PAGE_SIZE) {
  return `${path}?page=${page}&limit=${limit}`
}

/**
 * 同時接受兩種回應：
 * - 純陣列（沒有分頁，全部筆數都在裡面）
 * - { items, total, page, limit }（分頁）
 */
export function readListPayload(payload, requestedPage = 1) {
  if (Array.isArray(payload)) {
    return { items: payload, total: payload.length, page: 1, paged: false }
  }
  if (payload && Array.isArray(payload.items)) {
    const total = Number(payload.total)
    return {
      items: payload.items,
      total: Number.isFinite(total) ? total : payload.items.length,
      page: Number(payload.page) || requestedPage,
      paged: true,
    }
  }
  return { items: [], total: 0, page: 1, paged: false }
}

/* -------------------- 預設分頁 -------------------- */

/**
 * 進入簽核頁時先開哪個分頁：有等我簽核的單就先看「待我簽核」；
 * 自己有被退簽、等著修改的單就看「我的申請」；都沒有就直接填「申請表單」。
 */
export function pickDefaultTab({ inboxCount = 0, returnedCount = 0 } = {}) {
  if (Number(inboxCount) > 0) return 'inbox'
  if (Number(returnedCount) > 0) return 'mine'
  return 'apply'
}

/* -------------------- 篩選、排序、分頁 -------------------- */

const timeOf = (value) => {
  const time = new Date(value ?? 0).getTime()
  return Number.isFinite(time) ? time : 0
}

/** 清單列的表單編號（form 可能是已展開的物件，也可能只是編號） */
export function requestFormId(row) {
  const form = row?.form
  if (form && typeof form === 'object') return String(form._id || form.id || '')
  return form ? String(form) : ''
}

/**
 * 「表單」篩選的選項：可以申請的表單（templates：[{ _id, name }]）加上清單裡出現過的表單（seen：{ 編號: 名稱 }）。
 * 伺服器分頁後畫面上只有一頁，只看這一頁的話選項會少；別的部門的表單（只在待簽、簽過的清單出現）靠 seen 補上。
 */
export function mergeFormOptions(templates, seen = {}) {
  const map = new Map()
  for (const template of templates || []) {
    const id = template?._id ? String(template._id) : ''
    if (id) map.set(id, String(template.name || '').trim() || '（未命名的表單）')
  }
  for (const [id, name] of Object.entries(seen || {})) {
    if (id && !map.has(id)) map.set(id, String(name || '').trim() || '（未命名的表單）')
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
}

/** 清單裡出現過的表單，給「表單」篩選用：[{ value, label }]，依名稱排序 */
export function listFormOptions(rows, nameOf = (row) => row?.form?.name) {
  const seen = new Map()
  for (const row of rows || []) {
    const id = requestFormId(row)
    if (!id || seen.has(id)) continue
    seen.set(id, String(nameOf(row) || '').trim() || '（未命名的表單）')
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
}

/**
 * 依表單、狀態、日期範圍（台灣日期 'YYYY-MM-DD'，含頭尾）、關鍵字（申請人姓名或表單名稱）篩選。
 * dateOf：這份清單用哪個時間比對日期（預設送出時間）。
 */
export function filterRequests(rows, { formId = '', status = '', from = '', to = '', keyword = '' } = {}, { dateOf = (row) => row?.createdAt } = {}) {
  const word = String(keyword || '').trim().toLowerCase()
  return (rows || []).filter((row) => {
    if (formId && requestFormId(row) !== String(formId)) return false
    if (status && row?.status !== status) return false
    if (from || to) {
      const key = toTaipeiDateKey(dateOf(row))
      if (!key) return false
      if (from && key < from) return false
      if (to && key > to) return false
    }
    if (word) {
      const haystack = `${row?.applicant_employee?.name || ''} ${row?.form?.name || ''}`.toLowerCase()
      if (!haystack.includes(word)) return false
    }
    return true
  })
}

/** 依時間排序（不改動原陣列）：asc 最早的在前（待簽核：等最久的先處理）、desc 最新的在前 */
export function sortByTime(rows, direction = 'desc', dateOf = (row) => row?.createdAt) {
  const factor = direction === 'asc' ? 1 : -1
  return [...(rows || [])].sort((a, b) => factor * (timeOf(dateOf(a)) - timeOf(dateOf(b))))
}

/** 目前這一頁的資料；頁碼超過範圍時回到最後一頁 */
export function pageSlice(rows, page = 1, size = PAGE_SIZE) {
  const list = rows || []
  const lastPage = Math.max(1, Math.ceil(list.length / size))
  const current = Math.min(Math.max(1, Number(page) || 1), lastPage)
  return list.slice((current - 1) * size, current * size)
}

/* -------------------- 清單列的文字 -------------------- */

/** 多久以前送出：「剛剛」「35 分鐘前」「5 小時前」「3 天前」；時間讀不懂回傳空字串 */
export function formatAge(value, now = Date.now()) {
  const time = new Date(value ?? '').getTime()
  if (value == null || value === '' || !Number.isFinite(time)) return ''
  const minutes = Math.floor((Number(now) - time) / 60000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 「第 1／2 關」；讀不到關卡時回傳空字串 */
export function stepProgressText(row) {
  const total = Array.isArray(row?.steps) ? row.steps.length : 0
  const index = row?.current_step_index
  if (!total || !Number.isInteger(index) || index < 0) return ''
  return `第 ${Math.min(index + 1, total)}／${total} 關`
}

/** 起訖時間寫成一段文字：同一天「2026/11/12 09:00–18:00」，跨日「2026/11/12 09:00 – 2026/11/14 18:00」 */
export function formatTaipeiRange(start, end) {
  const startText = isBlankValue(start) ? '' : formatTaipeiDateTime(start, '')
  const endText = isBlankValue(end) ? '' : formatTaipeiDateTime(end, '')
  if (!startText || !endText) return startText || endText
  if (startText === endText) return startText
  const sameDay = formatTaipeiDate(start, 'a') === formatTaipeiDate(end, 'b')
  const endTime = formatTaipeiTime(end, '')
  if (sameDay && endTime && startText !== formatTaipeiDate(start, '')) return `${startText}–${endTime}`
  return `${startText} – ${endText}`
}

function optionText(field, value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value.label ?? value.name ?? value.value) : value
  if (isBlankValue(raw) || Array.isArray(raw)) return ''
  const option = normalizeFieldOptions(field).find(opt => String(opt.value) === String(raw))
  return String(option?.label ?? raw)
}

/**
 * 清單上一行看得懂的內容摘要（fields 是那張表單的欄位；清單 API 只回 form_data，欄位另外取）。
 * 請假單：「事假・2026/11/12 09:00–18:00・8 小時（1 天）」；其他表單取前兩個有填的文字、數字、選項欄位。
 * 沒有欄位資料（例如別的部門的表單讀不到欄位）回傳空字串。
 */
export function summarizeRequest(row, fields, { isLeave = false, maxParts = 2 } = {}) {
  const data = row?.form_data && typeof row.form_data === 'object' ? row.form_data : null
  const list = Array.isArray(fields) ? fields : []
  if (!data || !list.length) return ''
  const { typeField, startField, endField, hoursField } = pickLeaveFormFields(list)
  // 日期欄位（沒有時分）只顯示日期，不要多一個 00:00
  const valueOf = (field) => {
    if (!field) return ''
    const value = data[field._id]
    return field.type_1 === 'date' ? (toTaipeiDateKey(value) || '') : value
  }
  // 有開始、結束的表單（請假、加班、支援…）把起訖寫成一段
  const range = startField && endField ? formatTaipeiRange(valueOf(startField), valueOf(endField)) : ''
  if (isLeave) {
    const parts = []
    const type = typeField ? optionText(typeField, data[typeField._id]) : ''
    if (type) parts.push(type)
    if (range) parts.push(range)
    const hours = hoursField ? Number(data[hoursField._id]) : NaN
    if (Number.isFinite(hours) && hours > 0) parts.push(formatHoursWithDays(hours))
    if (parts.length) return parts.join('・')
  }
  const SIMPLE_TYPES = new Set(['text', 'textarea', 'number', 'select', 'date', 'datetime'])
  const parts = range ? [range] : []
  const used = new Set(range ? [String(startField._id), String(endField._id)] : [])
  for (const field of [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (parts.length >= maxParts) break
    if (field.is_active === false || !SIMPLE_TYPES.has(field.type_1) || used.has(String(field._id))) continue
    const value = data[field._id]
    if (isBlankValue(value) || Array.isArray(value)) continue
    let text
    if (field.type_1 === 'date') text = formatTaipeiDate(value, '')
    else if (field.type_1 === 'datetime') text = formatTaipeiDateTime(value, '')
    else if (field.type_1 === 'select') text = optionText(field, value)
    else text = String(typeof value === 'object' ? '' : value).replace(/\s+/g, ' ').trim()
    if (!text) continue
    parts.push(`${field.label}：${text.length > 24 ? `${text.slice(0, 24)}…` : text}`)
  }
  return parts.join('・')
}

/**
 * 伺服器組好的內容摘要（清單每一列的 summary，見 docs/approval-list-api.md）寫成清單上的一行字，格式與 summarizeRequest 相同：
 * 請假單「事假・2026/11/12 09:00–18:00・8 小時（1 天）」；其他表單有起訖時先寫起訖，再接前幾個有填的欄位。
 * summary 是 null（沒有可顯示的答案）或格式不對時回傳空字串。
 */
export function summaryText(summary, { maxParts = 2 } = {}) {
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.items)) return ''
  // 只有日期的欄位不要多一個 00:00
  const dateValue = (value) => (isBlankValue(value) ? '' : (summary.dateOnly ? (toTaipeiDateKey(value) || '') : value))
  const start = dateValue(summary.start)
  const end = dateValue(summary.end)
  const range = start || end ? formatTaipeiRange(start, end) : ''
  if (summary.kind === 'leave') {
    const parts = []
    if (summary.leaveType) parts.push(String(summary.leaveType))
    if (range) parts.push(range)
    const hours = Number(summary.hours)
    if (summary.hours !== null && summary.hours !== undefined && Number.isFinite(hours) && hours > 0) parts.push(formatHoursWithDays(hours))
    if (parts.length) return parts.join('・')
  }
  // 起訖已經寫成一段，伺服器 items 裡同樣的開始、結束值不再重複
  const rangeValues = new Set(range
    ? [summary.start, summary.end].filter(value => !isBlankValue(value)).flatMap(value => [formatTaipeiDateTime(value, ''), formatTaipeiDate(value, '')])
    : [])
  const parts = range ? [range] : []
  for (const item of summary.items) {
    if (parts.length >= maxParts) break
    const text = String(item?.value ?? '').replace(/\s+/g, ' ').trim()
    if (!text || rangeValues.has(text)) continue
    const clipped = text.length > 24 ? `${text.slice(0, 24)}…` : text
    parts.push(item?.label ? `${item.label}：${clipped}` : clipped)
  }
  return parts.join('・')
}
