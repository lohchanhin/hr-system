const REFERENCE_KEYS = ['organization', 'department', 'subDepartment']

function normalizeReferenceKey(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (typeof value.value === 'string') return value.value.trim()
    if (typeof value.raw === 'string') return value.raw.trim()
    if (typeof value.name === 'string') return value.name.trim()
  }
  return String(value)
}

function parseJsonField(rawValue, fieldName, res, defaultValue = undefined) {
  if (rawValue === undefined) return { ok: true, value: defaultValue }
  try {
    const parsed = JSON.parse(rawValue)
    return { ok: true, value: parsed }
  } catch (error) {
    res.status(400).json({
      message: `${fieldName} 格式錯誤`,
      errors: [`${fieldName} JSON 解析失敗`]
    })
    return { ok: false }
  }
}

function ensurePlainObject(value, fieldName, res, defaultValue = {}) {
  if (value === undefined) return { ok: true, value: defaultValue }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    res.status(400).json({
      message: `${fieldName} 格式錯誤`,
      errors: [`${fieldName} 必須為物件`]
    })
    return { ok: false }
  }
  return { ok: true, value }
}

function ensureReferenceMappingsStructure(value, res) {
  const normalized = {}
  for (const key of REFERENCE_KEYS) {
    const section = value?.[key]
    if (section === undefined) {
      normalized[key] = {}
      continue
    }
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      res.status(400).json({
        message: 'valueMappings 格式錯誤',
        errors: [`valueMappings.${key} 必須為物件`]
      })
      return { ok: false }
    }
    const record = {}
    for (const [raw, target] of Object.entries(section)) {
      const normalizedKey = normalizeReferenceKey(raw)
      if (!normalizedKey) continue
      if (target === null) {
        record[normalizedKey] = null
        continue
      }
      if (typeof target !== 'string' || !target.trim()) {
        res.status(400).json({
          message: 'valueMappings 格式錯誤',
          errors: [`valueMappings.${key} 的值必須為字串或 null`]
        })
        return { ok: false }
      }
      record[normalizedKey] = target.trim()
    }
    normalized[key] = record
  }
  return { ok: true, value: normalized }
}

function ensureIgnoreStructure(value, res) {
  const normalized = {}
  for (const key of REFERENCE_KEYS) {
    const section = value?.[key]
    if (section === undefined) {
      normalized[key] = []
      continue
    }
    if (!Array.isArray(section)) {
      res.status(400).json({
        message: 'ignore 格式錯誤',
        errors: [`ignore.${key} 必須為陣列`]
      })
      return { ok: false }
    }
    const entries = section
      .map(item => normalizeReferenceKey(item))
      .filter(entry => entry)
    normalized[key] = Array.from(new Set(entries))
  }
  return { ok: true, value: normalized }
}

export default function validateBulkImportPayload(req, res, next) {
  const { ok: mappingsParsed, value: parsedMappings } = parseJsonField(
    req.body?.mappings,
    'mappings',
    res,
    undefined
  )
  if (!mappingsParsed) return

  const { ok: optionsParsed, value: parsedOptions } = parseJsonField(
    req.body?.options,
    'options',
    res,
    {}
  )
  if (!optionsParsed) return

  const { ok: valueMappingsParsed, value: rawValueMappings } = parseJsonField(
    req.body?.valueMappings,
    'valueMappings',
    res,
    {}
  )
  if (!valueMappingsParsed) return

  const { ok: ignoreParsed, value: rawIgnore } = parseJsonField(
    req.body?.ignore,
    'ignore',
    res,
    {}
  )
  if (!ignoreParsed) return

  if (parsedMappings !== undefined) {
    const { ok, value } = ensurePlainObject(parsedMappings, 'mappings', res)
    if (!ok) return
    req.bulkImportPayload = req.bulkImportPayload || {}
    req.bulkImportPayload.mappings = value
  }

  const { ok: valueMappingShapeOk, value: normalizedValueMappings } = ensureReferenceMappingsStructure(
    rawValueMappings,
    res
  )
  if (!valueMappingShapeOk) return

  const { ok: ignoreShapeOk, value: normalizedIgnore } = ensureIgnoreStructure(rawIgnore, res)
  if (!ignoreShapeOk) return

  req.bulkImportPayload = req.bulkImportPayload || {}
  req.bulkImportPayload.options = parsedOptions && typeof parsedOptions === 'object' ? parsedOptions : {}
  req.bulkImportPayload.valueMappings = normalizedValueMappings
  req.bulkImportPayload.ignore = normalizedIgnore
  next()
}
