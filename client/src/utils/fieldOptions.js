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
