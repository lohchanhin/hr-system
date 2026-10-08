function toTrimmedString(value) {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number') {
    return String(value).trim()
  }
  return ''
}

function pickFirstString(...values) {
  for (const value of values) {
    const str = toTrimmedString(value)
    if (str) {
      return str
    }
  }
  return ''
}

export function normalizeCustomFieldOptions(options) {
  if (options == null) {
    return undefined
  }

  if (Array.isArray(options)) {
    return options.map(option => {
      if (typeof option === 'string' || typeof option === 'number') {
        return toTrimmedString(option) || ''
      }
      if (option && typeof option === 'object') {
        const name = pickFirstString(option.name, option.label, option.text)
        const code = pickFirstString(option.code, option.value, option.key, option.id)
        if (name || code) {
          return { ...option, name: name || code, code: code || name }
        }
        return { ...option }
      }
      return option
    })
  }

  if (typeof options === 'string') {
    const trimmed = options.trim()
    if (!trimmed) {
      return undefined
    }
    try {
      return normalizeCustomFieldOptions(JSON.parse(trimmed))
    } catch (error) {
      const segments = trimmed
        .split(/[\n,]/)
        .map(segment => segment.trim())
        .filter(Boolean)
      return segments.length ? segments : undefined
    }
  }

  if (options && typeof options === 'object') {
    return { ...options }
  }

  return options
}

export function optionsToEditableList(options) {
  const normalized = normalizeCustomFieldOptions(options)
  if (!Array.isArray(normalized)) {
    return []
  }

  return normalized.map(option => {
    if (typeof option === 'string') {
      return { name: option, code: '' }
    }
    if (typeof option === 'number') {
      const value = String(option)
      return { name: value, code: '' }
    }
    if (option && typeof option === 'object') {
      const name = pickFirstString(option.name, option.label, option.text, option.value)
      const code = pickFirstString(option.code, option.value, option.key, option.id)
      return { name, code }
    }
    return { name: '', code: '' }
  })
}

export function editableListToOptions(optionList) {
  if (!Array.isArray(optionList)) {
    return undefined
  }

  const normalizedList = optionList
    .map(option => ({
      name: toTrimmedString(option?.name),
      code: toTrimmedString(option?.code)
    }))
    .filter(option => option.name || option.code)

  if (!normalizedList.length) {
    return undefined
  }

  const hasCode = normalizedList.some(option => Boolean(option.code))
  if (!hasCode) {
    return normalizedList.map(option => option.name || option.code).filter(Boolean)
  }

  return normalizedList.map(option => {
    const name = option.name || option.code
    const code = option.code || option.name
    return { name, code }
  })
}

export function stringifyCustomFieldOptions(options) {
  const normalized = normalizeCustomFieldOptions(options)
  if (normalized == null) {
    return ''
  }

  if (Array.isArray(normalized)) {
    const simpleValues = normalized.every(option => typeof option === 'string' || typeof option === 'number')
    if (simpleValues) {
      return normalized.map(option => String(option)).join('\n')
    }
  }

  if (typeof normalized === 'string') {
    return normalized
  }

  try {
    return JSON.stringify(normalized)
  } catch (error) {
    return ''
  }
}

export function parseCustomFieldOptionsInput(input) {
  if (typeof input !== 'string') {
    return undefined
  }

  return normalizeCustomFieldOptions(input)
}

/* ---- 字典項目（其他控制設定 → 字典項目）連結相關 ---- */

// 只有下拉 / 複選欄位可以連結字典
const DICTIONARY_LINKABLE_TYPES = ['select', 'checkbox']

export function isDictionaryLinkableType(type) {
  return DICTIONARY_LINKABLE_TYPES.includes(type)
}

// 自訂欄位是否為「字典類」（選項放在字典項目，欄位本身沒有 options）
export function isDictionaryCustomField(field) {
  return field?.category === 'dictionary'
}

// 取得表單欄位連結的字典代碼：伺服器回傳 dictionaryKey（或 optionsSource 為 dictionary）即視為已連結
export function getFieldDictionaryKey(field) {
  if (!field || typeof field !== 'object') {
    return ''
  }
  const dictionaryKey = toTrimmedString(field.dictionaryKey)
  if (dictionaryKey) {
    return dictionaryKey
  }
  if (field.optionsSource === 'dictionary') {
    return toTrimmedString(field.field_key)
  }
  return ''
}

// 將字典項目（字串或 { name, code } 物件）整理成 [{ name, code }]，略過空白並依名稱去重
export function normalizeDictionaryItems(items) {
  if (!Array.isArray(items)) {
    return []
  }

  const seen = new Set()
  const result = []
  items.forEach(item => {
    let name = ''
    let code = ''
    if (typeof item === 'string' || typeof item === 'number') {
      name = toTrimmedString(item)
      code = name
    } else if (item && typeof item === 'object') {
      name = pickFirstString(item.name, item.label, item.text)
      code = pickFirstString(item.code, item.value, item.key, item.id)
    }
    name = name || code
    code = code || name
    if (!name || seen.has(name)) {
      return
    }
    seen.add(name)
    result.push({ name, code })
  })
  return result
}

// 字典項目名稱清單（連結欄位的選項值就是名稱，例如「特休假」）
export function dictionaryItemNames(items) {
  return normalizeDictionaryItems(items).map(item => item.name)
}

// GET /api/other-control-settings/item-settings 可能回傳 { itemSettings: {...} } 或直接回傳字典物件
export function normalizeItemSettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }

  const source = payload.itemSettings && typeof payload.itemSettings === 'object' && !Array.isArray(payload.itemSettings)
    ? payload.itemSettings
    : payload
  const result = {}
  Object.keys(source).forEach(key => {
    if (Array.isArray(source[key])) {
      result[key] = normalizeDictionaryItems(source[key])
    }
  })
  return result
}
