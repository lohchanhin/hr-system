// 簽核清單（我的申請／待我簽核／我已簽核）每一列的「內容摘要」，由伺服器組好一起回傳。
// 以前畫面要自己向 /api/approvals/forms/:id/fields 取每張表單的欄位再組摘要；別的部門的表單會被 403 FORM_NOT_ALLOWED 擋下，
// 跨部門的簽核人在清單上就看不到這張單在申請什麼。清單本來就只列出這個人看得到的單（自己的、要簽的、簽過的），
// 摘要只取那張單自己的幾個答案，沒有多開放任何資料。
// 整頁清單只查一次欄位（FormField.find({ form: { $in } })），不會每一列各查一次。
import FormField from '../models/form_field.js'
// 整個模組匯入：單元測試常把 leaveFieldService 換成只有一兩個函式的替身，具名匯入會讓整個簽核路由載入失敗
import * as leaveFieldModule from './leaveFieldService.js'
import { computeLeaveRequestHours } from './leaveRequestDays.js'
import { hasFieldValue } from '../utils/fieldCandidates.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'
import { resolveLeaveFieldsForRequest } from '../utils/leaveFieldResolution.js'
import { toTaipeiParts } from '../utils/taipeiTime.js'

// 一般表單摘要最多列幾個欄位、每個值最多幾個字
export const SUMMARY_MAX_ITEMS = 3
export const SUMMARY_MAX_VALUE_LENGTH = 40
// 適合放在一行摘要裡的欄位型別（檔案、簽名、人員／部門／機構編號不放）
const SUMMARY_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'select', 'checkbox', 'date', 'datetime', 'time'])

const idOf = (value) => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object' && value._id !== undefined && value._id !== null) return String(value._id)
  return String(value)
}

const pad = (value) => String(value).padStart(2, '0')

const extractOptions = (field) => (typeof leaveFieldModule.extractOptions === 'function'
  ? leaveFieldModule.extractOptions(field)
  : [])
const buildLeaveFieldBase = (form, fields) => (typeof leaveFieldModule.buildLeaveFieldBase === 'function'
  ? leaveFieldModule.buildLeaveFieldBase(form, fields)
  : {})

function clip(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  return clean.length > SUMMARY_MAX_VALUE_LENGTH ? `${clean.slice(0, SUMMARY_MAX_VALUE_LENGTH)}…` : clean
}

/* 台灣時間的日期（2026/11/12）或日期時間（2026/11/12 09:00）；讀不懂的值原樣顯示 */
function formatDateValue(value, { dateOnly }) {
  const parts = toTaipeiParts(value)
  if (!parts) return clip(value)
  const date = parts.dateKey.replace(/-/g, '/')
  return dateOnly ? date : `${date} ${pad(parts.hour)}:${pad(parts.minute)}`
}

/* 選項欄位：存的是選項值，顯示選項名稱（連結字典的欄位存的就是字典項目名稱，找不到對應時原樣顯示） */
function optionLabels(field, value) {
  const options = extractOptions(field)
  const labelOf = (raw) => {
    const picked = raw && typeof raw === 'object' ? (raw.label ?? raw.name ?? raw.value) : raw
    if (!hasFieldValue(picked)) return ''
    return String(options.find(option => option.value === String(picked))?.label ?? picked)
  }
  return (Array.isArray(value) ? value : [value]).map(labelOf).filter(Boolean).join('、')
}

/* 一個欄位的值寫成顯示用的文字；不適合放進摘要（或沒有填）回傳空字串 */
export function formatSummaryValue(field, value) {
  if (!field || !hasFieldValue(value)) return ''
  // 單一勾選（是否跨日等）存的是 true/false，不在選項清單裡：顯示 是／否，不要顯示 true / false
  if (typeof value === 'boolean') return value ? '是' : '否'
  switch (field.type_1) {
    case 'date': return formatDateValue(value, { dateOnly: true })
    case 'datetime': return formatDateValue(value, { dateOnly: false })
    case 'select':
    case 'checkbox': return clip(optionLabels(field, value))
    case 'number': return typeof value === 'object' ? '' : clip(value)
    case 'text':
    case 'textarea':
    case 'time': return typeof value === 'object' ? '' : clip(value)
    default: return ''
  }
}

/* 開始／結束欄位的原始值（ISO 或日期字串）：畫面要自己排版起訖時可以用；沒有填回傳 null */
function rawDateValue(value) {
  if (!hasFieldValue(value)) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

/**
 * 一張單的摘要。form：表單（要有 semanticType / name 才判斷得出是不是請假單）；fields：那張表單的全部欄位（含停用）。
 * 回傳 null（沒有表單、沒有欄位或沒有任何可顯示的答案）或：
 * {
 *   kind: 'leave' | 'fields',
 *   items: [{ label, value }],          // 顯示用文字，依序排好；請假單是 假別／開始／結束／時數，其他表單是前幾個有填的欄位
 *   leaveType, hours,                   // 只有請假單：假別名稱、請假時數（小時；算不出來是 null）
 *   start, end, dateOnly,               // 認得出開始、結束欄位時：原始值與「是不是只有日期」
 * }
 */
export function buildRequestSummary({ form, formData, fields } = {}) {
  const data = formData && typeof formData === 'object' && !Array.isArray(formData) ? formData : null
  const list = Array.isArray(fields) ? fields : []
  if (!form || !data || !list.length) return null

  const byId = new Map(list.map(field => [String(field._id), field]))
  const leaveFields = resolveLeaveFieldsForRequest(buildLeaveFieldBase(form, list), data)
  const startField = byId.get(String(leaveFields.startId))
  const endField = byId.get(String(leaveFields.endId))
  const start = startField ? rawDateValue(data[leaveFields.startId]) : null
  const end = endField ? rawDateValue(data[leaveFields.endId]) : null
  const range = start !== null || end !== null
    ? { start, end, dateOnly: [startField, endField].filter(Boolean).every(field => field.type_1 === 'date') }
    : {}

  if (isLeaveFormTemplate(form)) {
    const typeField = byId.get(String(leaveFields.typeId))
    const leaveType = typeField ? optionLabels(typeField, data[leaveFields.typeId]) : ''
    const computed = computeLeaveRequestHours({ formData: data, leaveFields })
    // 沒填時數、也推算不出來時 computeLeaveRequestHours 會回預設的 8 小時：那不是這張單的資料，摘要不顯示
    const hours = computed.source === 'default' || computed.invalidRange ? null : computed.hours
    const items = []
    if (leaveType) items.push({ label: '假別', value: clip(leaveType) })
    if (start !== null) items.push({ label: startField.label, value: formatSummaryValue(startField, data[leaveFields.startId]) || clip(start) })
    if (end !== null) items.push({ label: endField.label, value: formatSummaryValue(endField, data[leaveFields.endId]) || clip(end) })
    if (hours !== null) items.push({ label: '時數', value: `${hours} 小時` })
    if (items.length) return { kind: 'leave', leaveType: leaveType || null, hours, ...range, items }
  }

  const items = []
  const ordered = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const field of ordered) {
    if (items.length >= SUMMARY_MAX_ITEMS) break
    if (!SUMMARY_FIELD_TYPES.has(field.type_1)) continue
    const value = formatSummaryValue(field, data[String(field._id)])
    if (value) items.push({ label: field.label, value })
  }
  return items.length ? { kind: 'fields', ...range, items } : null
}

/**
 * 替清單的每一列加上 summary（直接寫在列上）。rows：已經 populate 表單的清單列（form 是 { _id, name, semanticType… }）。
 * readFormData：從列取出 form_data（預設 row.form_data）。沒有任何一列有答案時不查資料庫。
 */
export async function attachRequestSummaries(rows, { readFormData = (row) => row?.form_data } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const hasAnswers = (row) => {
    const data = readFormData(row)
    return Boolean(row?.form && typeof row.form === 'object' && row.form._id && data && typeof data === 'object' && Object.keys(data).length)
  }
  const formIds = [...new Set(list.filter(hasAnswers).map(row => idOf(row.form)))]
  const fieldsByForm = new Map()
  // 摘要只是方便閱讀：欄位讀不到或某一列組不出來時那一列 summary 為 null，清單本身照常回傳
  if (formIds.length) {
    try {
      const query = FormField.find({ form: { $in: formIds } })
      const fields = query && typeof query.lean === 'function' ? await query.lean() : await query
      for (const field of Array.isArray(fields) ? fields : []) {
        const key = idOf(field.form)
        if (!fieldsByForm.has(key)) fieldsByForm.set(key, [])
        fieldsByForm.get(key).push(field)
      }
    } catch (error) {
      console.error(`[approval] List summary fields lookup failed: ${error?.name || 'Error'}`)
    }
  }
  for (const row of list) {
    let summary = null
    if (hasAnswers(row)) {
      try {
        summary = buildRequestSummary({ form: row.form, formData: readFormData(row), fields: fieldsByForm.get(idOf(row.form)) })
      } catch (error) {
        console.error(`[approval] List summary skipped: ${error?.name || 'Error'}`)
      }
    }
    row.summary = summary
  }
  return list
}

export default { attachRequestSummaries, buildRequestSummary, formatSummaryValue }
