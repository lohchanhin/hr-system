// 簽核單 form_data 的送入檢查與整理（建立、重新送出共用，純函式）。
// 目標：只留下表單範本定義的欄位、型別正確、大小有限，避免任意 key 被薪資／報表程式讀去當成天數或金額。
// 對舊資料友善：不要求前端改變送法（欄位 id 為 key；日期選擇器送 ISO 字串；附件送上傳回傳的物件）。
import { getDictionaryKeyCandidate } from './formFieldOptionsService.js'

export const MAX_FORM_DATA_BYTES = 100 * 1024
const MAX_TEXT_LENGTH = 2000
const MAX_TEXTAREA_LENGTH = 5000
const MAX_SIGNATURE_LENGTH = 60000
const MAX_ID_LENGTH = 200
const MAX_ARRAY_ITEMS = 100
const MAX_FILES_PER_FIELD = 10
const MAX_ABS_NUMBER = 1e9
export const APPROVAL_ATTACHMENT_URL_PATTERN = /^\/upload\/approvals\/([A-Za-z0-9][A-Za-z0-9._-]*)$/

const TIME_ONLY_PATTERN = /^\d{1,2}:\d{2}(:\d{2})?$/

export class FormDataError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'FormDataError'
    this.status = 400
    this.code = 'INVALID_FORM_DATA'
    this.extra = extra
  }
}

function fieldLabel(field) {
  return String(field?.label || field?._id || '').trim() || '未命名欄位'
}

function invalid(field, reason) {
  return new FormDataError(`欄位「${fieldLabel(field)}」${reason}`, { fieldId: String(field?._id || '') })
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

// 選項是「固定的字串清單」才檢查選取值；連結字典（選項即時變動）或物件選項不檢查
function staticStringOptions(field) {
  if (getDictionaryKeyCandidate(field)) return null
  const options = field?.options
  if (!Array.isArray(options) || options.length === 0) return null
  if (!options.every(option => typeof option === 'string')) return null
  return new Set(options)
}

function scalarText(item) {
  if (item === undefined || item === null) return ''
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (typeof item === 'object' && !Array.isArray(item)) {
    const picked = item.value ?? item.label ?? item.name ?? item.code
    return picked === undefined || picked === null ? '' : String(picked)
  }
  return ''
}

function sanitizeText(field, value, maxLength) {
  if (isBlank(value)) return typeof value === 'string' ? value : ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') throw invalid(field, '必須是文字')
  if (value.length > maxLength) throw invalid(field, `內容過長（上限 ${maxLength} 字）`)
  return value
}

function sanitizeNumber(field, value) {
  if (isBlank(value)) return ''
  if (typeof value !== 'number' && typeof value !== 'string') throw invalid(field, '必須是數字')
  const number = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isFinite(number) || Math.abs(number) > MAX_ABS_NUMBER) throw invalid(field, '必須是合理的數字')
  return number
}

function sanitizeDate(field, value, { timeOnly = false } = {}) {
  if (isBlank(value)) return ''
  if (typeof value !== 'string') throw invalid(field, '日期格式不正確')
  const text = value.trim()
  if (timeOnly && TIME_ONLY_PATTERN.test(text)) return text
  if (Number.isNaN(new Date(text).getTime())) throw invalid(field, '日期格式不正確')
  return value
}

function sanitizeSelect(field, value) {
  if (isBlank(value)) return typeof value === 'string' ? value : ''
  const allowed = staticStringOptions(field)
  const items = Array.isArray(value) ? value : [value]
  if (items.length > MAX_ARRAY_ITEMS) throw invalid(field, '選取項目過多')
  for (const item of items) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      // 舊資料可能是 { label, value }
      if (scalarText(item).length > MAX_TEXT_LENGTH) throw invalid(field, '內容過長')
    } else if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      throw invalid(field, '格式不正確')
    }
    const text = scalarText(item)
    if (text.length > MAX_TEXT_LENGTH) throw invalid(field, '內容過長')
    if (allowed && text !== '' && !allowed.has(text)) throw invalid(field, '的選項不正確')
  }
  return value
}

function sanitizeCheckbox(field, value) {
  if (isBlank(value)) return []
  const items = Array.isArray(value) ? value : [value]
  if (items.length > MAX_ARRAY_ITEMS) throw invalid(field, '選取項目過多')
  const allowed = staticStringOptions(field)
  const result = []
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      throw invalid(field, '格式不正確')
    }
    const text = String(item)
    if (text.length > MAX_TEXT_LENGTH) throw invalid(field, '內容過長')
    if (allowed && !allowed.has(text)) throw invalid(field, '的選項不正確')
    result.push(item)
  }
  return result
}

function sanitizeReference(field, value) {
  if (isBlank(value)) return typeof value === 'string' ? value : ''
  if (typeof value !== 'string' && typeof value !== 'number') throw invalid(field, '格式不正確')
  const text = String(value)
  if (text.length > MAX_ID_LENGTH) throw invalid(field, '內容過長')
  return value
}

function sanitizeFiles(field, value) {
  if (isBlank(value)) return []
  const items = Array.isArray(value) ? value : [value]
  if (items.length > MAX_FILES_PER_FIELD) throw invalid(field, `附件最多 ${MAX_FILES_PER_FIELD} 個`)
  return items.map((item) => {
    const url = item && typeof item === 'object' ? (item.url ?? item.path) : undefined
    if (typeof url !== 'string' || !APPROVAL_ATTACHMENT_URL_PATTERN.test(url.trim())) {
      throw invalid(field, '的附件無效，請重新上傳')
    }
    // 檔名、大小、類型之後以上傳紀錄為準（bindApprovalAttachments），這裡只保留網址
    return { name: typeof item.name === 'string' ? item.name.slice(0, 200) : '', url: url.trim() }
  })
}

function sanitizeFieldValue(field, value) {
  switch (field.type_1) {
    case 'text': return sanitizeText(field, value, MAX_TEXT_LENGTH)
    case 'textarea': return sanitizeText(field, value, MAX_TEXTAREA_LENGTH)
    case 'number': return sanitizeNumber(field, value)
    case 'date':
    case 'datetime': return sanitizeDate(field, value)
    case 'time': return sanitizeDate(field, value, { timeOnly: true })
    case 'select': return sanitizeSelect(field, value)
    case 'checkbox': return sanitizeCheckbox(field, value)
    case 'file': return sanitizeFiles(field, value)
    case 'signature': return sanitizeText(field, value, MAX_SIGNATURE_LENGTH)
    case 'user':
    case 'department':
    case 'org': return sanitizeReference(field, value)
    default: return sanitizeText(field, value, MAX_TEXTAREA_LENGTH)
  }
}

/**
 * 依表單欄位整理送入的 form_data。
 * - 不是一般物件、或序列化後超過 100KB → FormDataError（400）
 * - 不屬於表單欄位的 key 直接丟棄；以「欄位標籤」當 key 的舊式送法會對應回欄位 id
 * - 各欄位依 type_1 檢查型別
 * 回傳 { data, fileFieldIds }；data 的 key 都是欄位 id。
 */
export function sanitizeApprovalFormData({ fields, formData }) {
  if (formData === undefined || formData === null) return { data: {}, fileFieldIds: [] }
  if (typeof formData !== 'object' || Array.isArray(formData)) {
    throw new FormDataError('表單內容格式不正確')
  }
  let size = 0
  try {
    size = Buffer.byteLength(JSON.stringify(formData), 'utf8')
  } catch {
    throw new FormDataError('表單內容格式不正確')
  }
  if (size > MAX_FORM_DATA_BYTES) {
    throw new FormDataError(`表單內容過大（上限 ${Math.round(MAX_FORM_DATA_BYTES / 1024)}KB）`)
  }

  const fieldById = new Map()
  const fieldByLabel = new Map()
  for (const field of fields || []) {
    const id = String(field._id)
    fieldById.set(id, field)
    const label = String(field.label || '').trim()
    if (label && !fieldByLabel.has(label)) fieldByLabel.set(label, field)
  }

  const raw = new Map()
  for (const [key, value] of Object.entries(formData)) {
    if (fieldById.has(key)) {
      raw.set(key, value)
    }
  }
  for (const [key, value] of Object.entries(formData)) {
    if (fieldById.has(key)) continue
    const field = fieldByLabel.get(key.trim())
    if (field && !raw.has(String(field._id))) raw.set(String(field._id), value)
  }

  const data = {}
  const fileFieldIds = []
  for (const [id, value] of raw.entries()) {
    const field = fieldById.get(id)
    data[id] = sanitizeFieldValue(field, value)
    if (field.type_1 === 'file') fileFieldIds.push(id)
  }
  return { data, fileFieldIds }
}

/** 從整理後的 form_data 取出所有簽核附件檔名（附件欄位內的網址） */
export function collectAttachmentFilenames(data, fileFieldIds) {
  const names = []
  for (const id of fileFieldIds || []) {
    for (const item of Array.isArray(data?.[id]) ? data[id] : []) {
      const match = APPROVAL_ATTACHMENT_URL_PATTERN.exec(String(item?.url || ''))
      if (match) names.push(match[1])
    }
  }
  return [...new Set(names)]
}

export default { MAX_FORM_DATA_BYTES, FormDataError, sanitizeApprovalFormData, collectAttachmentFilenames }
