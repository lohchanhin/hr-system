import * as settingsStore from './otherControlSettingsStore.js'

// 表單欄位的選項來源：
// 1. 欄位連結字典（field_key 指向「其他控制設定 → 字典項目」的代碼，如 C12）→ 選項即時取自字典
// 2. 未連結 → 使用欄位自己存的 options
// 連結只對下拉（select）與複選（checkbox）欄位有效。

export const LINKABLE_FIELD_TYPES = ['select', 'checkbox']

// 標籤尾端的字典代碼，例如「假別類別 (C12)」「假別類別（C12）」
const DICTIONARY_CODE_LABEL_PATTERN = /[\(（]\s*(C\d{2})\s*[\)）]\s*$/
// 字典代碼 / 自訂欄位代碼：英數字、底線、連字號，最長 40 字
const FIELD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

export function isLinkableFieldType(type) {
  return LINKABLE_FIELD_TYPES.includes(type)
}

/**
 * 解析 API 傳入的 field_key。
 * 回傳 { valid, provided, value }：
 * - undefined → 未提供，不更動既有設定
 * - null / 空字串 → 提供且清空（存成 ''，代表手動輸入，不再自動連結）
 * - 合法字串 → 提供且有值
 * - 其他 → valid: false
 */
export function normalizeFieldKeyInput(raw) {
  if (raw === undefined) return { valid: true, provided: false, value: undefined }
  if (raw === null) return { valid: true, provided: true, value: '' }
  if (typeof raw !== 'string') return { valid: false, provided: true, value: undefined }
  const trimmed = raw.trim()
  if (!trimmed) return { valid: true, provided: true, value: '' }
  if (!FIELD_KEY_PATTERN.test(trimmed)) return { valid: false, provided: true, value: undefined }
  return { valid: true, provided: true, value: trimmed }
}

/** 標籤尾端的字典代碼（C12 之類），沒有則回傳空字串 */
export function extractDictionaryCodeFromLabel(label) {
  if (typeof label !== 'string') return ''
  const match = label.match(DICTIONARY_CODE_LABEL_PATTERN)
  return match ? match[1] : ''
}

/**
 * 欄位可能連結的字典代碼（還沒確認字典是否存在）；不可能連結回傳空字串。
 * - field_key 有值：就是它
 * - field_key 未設定（舊資料）：標籤尾端的 (Cxx)
 * - field_key 是空字串：管理員明確選了手動輸入，不自動連結
 */
export function getDictionaryKeyCandidate(field) {
  if (!field || !isLinkableFieldType(field.type_1)) return ''
  if (typeof field.field_key === 'string') {
    const explicit = field.field_key.trim()
    if (explicit) return explicit
    // 空字串＝明確手動；僅空白的值也視為手動
    return ''
  }
  return extractDictionaryCodeFromLabel(field.label)
}

/**
 * 字典項目 → 表單選項。value 刻意與 label 同為名稱：請假與特休扣減邏輯比對的是「特休假」這類名稱，
 * 既有的字串選項也是同樣的行為。
 */
export function buildDictionaryOptions(items) {
  const seen = new Set()
  const options = []
  for (const item of Array.isArray(items) ? items : []) {
    const name = typeof item === 'string' ? item : item?.name
    const text = name === undefined || name === null ? '' : String(name).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    options.push({ label: text, value: text })
  }
  return options
}

/* ---------------------- 字典讀取（含單次呼叫內的快取） ---------------------- */

function createDictionaryContext() {
  let keysPromise = null
  const itemsByKey = new Map()
  return {
    // 字典是否存在（即使目前沒有項目）；只有在項目為空時才需要查
    loadKeys() {
      if (!keysPromise) {
        keysPromise = Promise.resolve(settingsStore.getSettings()).then((settings) => {
          const itemSettings = settings && typeof settings.itemSettings === 'object' && settings.itemSettings
            ? settings.itemSettings
            : {}
          return new Set(Object.keys(itemSettings))
        })
      }
      return keysPromise
    },
    loadItems(key) {
      if (!itemsByKey.has(key)) {
        itemsByKey.set(key, Promise.resolve(settingsStore.getDictionaryItems(key)))
      }
      return itemsByKey.get(key)
    },
  }
}

/** 確認字典：{ dictionaryKey, options }；dictionaryKey 為 null 代表沒有連結，options 為空陣列代表字典目前沒有項目 */
async function lookupDictionary(candidate, context) {
  if (!candidate) return { dictionaryKey: null, options: [] }
  const options = buildDictionaryOptions(await context.loadItems(candidate))
  if (options.length) return { dictionaryKey: candidate, options }
  // 字典存在但目前沒有項目：仍算連結（之後補上項目會立即生效），選項先退回欄位自己存的
  const keys = await context.loadKeys()
  return { dictionaryKey: keys.has(candidate) ? candidate : null, options: [] }
}

function toPlainField(field) {
  const plain = field && typeof field.toObject === 'function' ? field.toObject() : field
  return { ...(plain || {}) }
}

async function resolveOne(field, context) {
  const plain = toPlainField(field)
  let dictionaryKey = null
  let options = []

  const candidate = getDictionaryKeyCandidate(plain)
  if (candidate) {
    try {
      ;({ dictionaryKey, options } = await lookupDictionary(candidate, context))
    } catch (error) {
      // 字典讀取失敗不應擋住整張表單，退回欄位自己的選項
      console.warn('[FormFieldOptions] Failed to resolve dictionary options:', error?.message)
      dictionaryKey = null
      options = []
    }
  }

  const resolved = {
    ...plain,
    dictionaryKey,
    optionsSource: options.length ? 'dictionary' : 'own',
  }
  if (options.length) resolved.options = options
  return resolved
}

/**
 * 單一欄位 → 給前端的 JSON：options（連結字典時為即時字典選項）、dictionaryKey、optionsSource。
 * 不會改動資料庫存的 options。
 */
export async function resolveFieldOptions(field) {
  return resolveOne(field, createDictionaryContext())
}

/** 多個欄位共用一次字典讀取 */
export async function resolveFieldsOptions(fields) {
  const context = createDictionaryContext()
  const results = []
  for (const field of Array.isArray(fields) ? fields : []) {
    results.push(await resolveOne(field, context))
  }
  return results
}

/** 欄位連結的字典代碼（含標籤自動連結），沒有連結回傳 null */
export async function detectDictionaryKey(field) {
  const candidate = getDictionaryKeyCandidate(toPlainField(field))
  if (!candidate) return null
  try {
    return (await lookupDictionary(candidate, createDictionaryContext())).dictionaryKey
  } catch (error) {
    console.warn('[FormFieldOptions] Failed to detect dictionary key:', error?.message)
    return null
  }
}
