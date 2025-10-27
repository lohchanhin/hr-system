import ExcelJS from 'exceljs'
import crypto from 'crypto'
import { Readable } from 'stream'
import Employee from '../models/Employee.js'
import Organization from '../models/Organization.js'
import Department from '../models/Department.js'
import SubDepartment from '../models/SubDepartment.js'
import { buildEmployeeDoc } from './employeeController.js'

const REQUIRED_MAPPING_KEYS = ['employeeNo', 'name', 'email']
const VALID_ROLES = ['employee', 'supervisor', 'admin']

const DEFAULT_COLUMN_MAPPINGS = Object.freeze({
  employeeNo: 'employeeId',
  name: 'name',
  gender: 'gender',
  idNumber: 'idNumber',
  birthday: 'birthDate',
  birthplace: 'birthPlace',
  bloodType: 'bloodType',
  languages: 'languages',
  disabilityLevel: 'disabilityLevel',
  identityCategory: 'identityCategory',
  maritalStatus: 'maritalStatus',
  dependents: 'dependents',
  email: 'email',
  phone: 'mobile',
  landline: 'landline',
  householdAddress: 'householdAddress',
  contactAddress: 'contactAddress',
  lineId: 'lineId',
  organization: 'organization',
  department: 'department',
  subDepartment: 'subDepartment',
  supervisor: 'supervisor',
  title: 'title',
  practiceTitle: 'practiceTitle',
  employmentStatus: 'status',
  probationDays: 'probationDays',
  isPartTime: 'partTime',
  isClocking: 'needClockIn',
  educationLevel: 'education_level',
  schoolName: 'education_school',
  major: 'education_major',
  graduationStatus: 'education_status',
  graduationYear: 'education_graduationYear',
  serviceType: 'militaryService_type',
  militaryBranch: 'militaryService_branch',
  militaryRank: 'militaryService_rank',
  dischargeYear: 'militaryService_dischargeYear',
  'emergency1.name': 'emergency1_name',
  'emergency1.relation': 'emergency1_relation',
  'emergency1.phone1': 'emergency1_phone1',
  'emergency1.phone2': 'emergency1_phone2',
  'emergency2.name': 'emergency2_name',
  'emergency2.relation': 'emergency2_relation',
  'emergency2.phone1': 'emergency2_phone1',
  'emergency2.phone2': 'emergency2_phone2',
  hireDate: 'hireDate',
  appointDate: 'startDate',
  resignDate: 'resignationDate',
  dismissDate: 'dismissalDate',
  reAppointDate: 'rehireStartDate',
  reDismissDate: 'rehireEndDate',
  employmentNote: 'appointment_remark',
  salaryType: 'salaryType',
  salaryAmount: 'salaryAmount',
  laborPensionSelf: 'laborPensionSelf',
  employeeAdvance: 'employeeAdvance',
  'salaryAccountA.bank': 'salaryAccountA_bank',
  'salaryAccountA.acct': 'salaryAccountA_acct',
  'salaryAccountB.bank': 'salaryAccountB_bank',
  'salaryAccountB.acct': 'salaryAccountB_acct',
  salaryItems: 'salaryItems'
})

const CHINESE_HEADER_HINTS = new Set([
  '員工編號',
  '姓名',
  '電子郵件 (必填唯一)',
  '手機號碼',
  '部門 ID',
  '主管員工 ID',
  '人員狀態 (正職員工/試用期/離職/留職停薪)'
])

const BOOLEAN_FIELDS = new Set(['isPartTime', 'partTime', 'isClocking', 'needClockIn'])
const DATE_FIELDS = new Set([
  'birthday',
  'hireDate',
  'appointDate',
  'resignDate',
  'dismissDate',
  'reAppointDate',
  'reDismissDate'
])
const NUMBER_FIELDS = new Set([
  'probationDays',
  'dependents',
  'salaryAmount',
  'laborPensionSelf',
  'employeeAdvance',
  'graduationYear',
  'dischargeYear'
])
const CSV_ARRAY_FIELDS = new Set(['languages', 'identityCategory', 'salaryItems'])

const REFERENCE_KEYS = ['organization', 'department', 'subDepartment']

const REFERENCE_CONFIGS = {
  organization: {
    Model: Organization,
    aliasFields: ['name', 'unitName', 'systemCode', 'orgCode'],
    select: '_id name unitName systemCode orgCode'
  },
  department: {
    Model: Department,
    aliasFields: ['name', 'code'],
    select: '_id name code organization'
  },
  subDepartment: {
    Model: SubDepartment,
    aliasFields: ['name', 'code'],
    select: '_id name code department'
  }
}

const REFERENCE_LABELS = {
  organization: '機構',
  department: '部門',
  subDepartment: '子部門'
}

const EMAIL_REGEX = /^\S+@\S+\.\S+$/

function normalizeReferenceKey(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim().toLowerCase()
  if (typeof value === 'number') return String(value).trim().toLowerCase()
  if (typeof value === 'object') {
    if (typeof value.value === 'string') return value.value.trim().toLowerCase()
    if (typeof value.raw === 'string') return value.raw.trim().toLowerCase()
    if (typeof value.name === 'string') return value.name.trim().toLowerCase()
    if (value._id) return String(value._id).trim().toLowerCase()
    if (value.id) return String(value.id).trim().toLowerCase()
  }
  return String(value).trim().toLowerCase()
}

function toReferenceDisplay(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (typeof value.value === 'string') return value.value
    if (typeof value.raw === 'string') return value.raw
    if (typeof value.name === 'string') return value.name
    if (typeof value.label === 'string') return value.label
    if (value._id) return String(value._id)
  }
  return String(value)
}

function collectReferenceUsage(rows) {
  const usage = {
    organization: new Map(),
    department: new Map(),
    subDepartment: new Map()
  }

  rows.forEach(row => {
    REFERENCE_KEYS.forEach(key => {
      const rawValue = getPathValue(row.original, key)
      const normalizedValue = normalizeReferenceKey(rawValue)
      if (!normalizedValue) return
      const display = toReferenceDisplay(rawValue)
      const entry = usage[key].get(normalizedValue)
      if (entry) {
        entry.rows.add(row.rowNumber)
      } else {
        usage[key].set(normalizedValue, {
          value: display,
          normalizedValue,
          rows: new Set([row.rowNumber])
        })
      }
    })
  })

  return usage
}

function buildReferenceAliasMap(docs, aliasFields) {
  const map = new Map()
  docs.forEach(doc => {
    const id = doc?._id?.toString?.()
    if (id) {
      map.set(normalizeReferenceKey(id), doc)
    }
    aliasFields.forEach(field => {
      const value = doc?.[field]
      if (typeof value === 'string' && value.trim()) {
        map.set(normalizeReferenceKey(value), doc)
      }
    })
  })
  return map
}

function buildReferenceOptions(type, docs) {
  if (!Array.isArray(docs)) return []
  if (type === 'organization') {
    return docs.map(doc => ({
      id: doc?._id?.toString?.() ?? '',
      name: doc?.name ?? '',
      unitName: doc?.unitName ?? '',
      systemCode: doc?.systemCode ?? '',
      orgCode: doc?.orgCode ?? ''
    }))
  }
  if (type === 'department') {
    return docs.map(doc => ({
      id: doc?._id?.toString?.() ?? '',
      name: doc?.name ?? '',
      code: doc?.code ?? '',
      organization: doc?.organization ? doc.organization.toString() : ''
    }))
  }
  if (type === 'subDepartment') {
    return docs.map(doc => ({
      id: doc?._id?.toString?.() ?? '',
      name: doc?.name ?? '',
      code: doc?.code ?? '',
      department: doc?.department ? doc.department.toString() : ''
    }))
  }
  return []
}

function toReferenceMappingMap(section = {}) {
  const map = new Map()
  Object.entries(section).forEach(([rawKey, target]) => {
    const normalizedKey = normalizeReferenceKey(rawKey)
    if (!normalizedKey) return
    if (target === null) {
      map.set(normalizedKey, null)
    } else if (typeof target === 'string' && target.trim()) {
      map.set(normalizedKey, target.trim())
    }
  })
  return map
}

function toIgnoreSet(list = []) {
  const set = new Set()
  list.forEach(value => {
    const normalized = normalizeReferenceKey(value)
    if (normalized) set.add(normalized)
  })
  return set
}

function parseReferencePayload(rawValueMappings, rawIgnore) {
  const valueMappings = {}
  const ignore = {}

  let parsedMappings = rawValueMappings
  if (typeof rawValueMappings === 'string') {
    try {
      parsedMappings = JSON.parse(rawValueMappings)
    } catch (error) {
      return {
        ok: false,
        message: 'valueMappings 格式錯誤',
        errors: ['valueMappings JSON 解析失敗']
      }
    }
  }

  let parsedIgnore = rawIgnore
  if (typeof rawIgnore === 'string') {
    try {
      parsedIgnore = JSON.parse(rawIgnore)
    } catch (error) {
      return {
        ok: false,
        message: 'ignore 格式錯誤',
        errors: ['ignore JSON 解析失敗']
      }
    }
  }

  if (parsedMappings && typeof parsedMappings !== 'object') {
    return {
      ok: false,
      message: 'valueMappings 格式錯誤',
      errors: ['valueMappings 必須為物件']
    }
  }

  if (parsedIgnore && typeof parsedIgnore !== 'object') {
    return {
      ok: false,
      message: 'ignore 格式錯誤',
      errors: ['ignore 必須為物件']
    }
  }

  REFERENCE_KEYS.forEach(key => {
    const section = parsedMappings?.[key]
    const ignoreSection = parsedIgnore?.[key]

    if (section && (typeof section !== 'object' || Array.isArray(section))) {
      valueMappings[key] = {}
    } else {
      valueMappings[key] = section || {}
    }

    if (ignoreSection && !Array.isArray(ignoreSection)) {
      ignore[key] = []
    } else {
      ignore[key] = Array.isArray(ignoreSection) ? ignoreSection : []
    }
  })

  return { ok: true, valueMappings, ignore }
}

function toPlainCellValue(cell) {
  if (!cell) return ''
  if (cell.text !== undefined) return String(cell.text).trim()
  if (cell.value === null || cell.value === undefined) return ''
  if (cell.value instanceof Date) return cell.value
  if (typeof cell.value === 'object' && cell.value.result !== undefined) {
    return typeof cell.value.result === 'string' ? cell.value.result.trim() : cell.value.result
  }
  if (typeof cell.value === 'string') return cell.value.trim()
  return cell.value
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return undefined
    if (['true', '1', 'yes', 'y', '是', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', '否', 'off'].includes(normalized)) return false
  }
  return undefined
}

function excelSerialToDate(serial) {
  if (typeof serial !== 'number') return null
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const millis = Math.round(serial * 24 * 60 * 60 * 1000)
  if (Number.isNaN(millis)) return null
  return new Date(excelEpoch.getTime() + millis)
}

function toDateValue(value) {
  if (!value && value !== 0) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    const converted = excelSerialToDate(value)
    return converted && !Number.isNaN(converted.getTime()) ? converted : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

function toNumberValue(value) {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return value
  const num = Number(String(value).trim())
  return Number.isNaN(num) ? undefined : num
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function formatRowError(rowNumber, messages) {
  const text = Array.isArray(messages) ? messages.join('、') : messages
  return `第 ${rowNumber} 列：${text}`
}

function setPathValue(target, path, value) {
  if (!path.includes('.')) {
    target[path] = value
    return
  }
  const parts = path.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key]
  }
  current[parts[parts.length - 1]] = value
}

function getPathValue(target, path) {
  if (!target) return undefined
  if (!path.includes('.')) return target[path]
  return path.split('.').reduce((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined
    return acc[key]
  }, target)
}

function hasChineseHeaderHints(row) {
  if (!row) return false
  let matches = 0
  row.eachCell(cell => {
    const value = toPlainCellValue(cell)
    if (typeof value === 'string' && CHINESE_HEADER_HINTS.has(value.trim())) {
      matches += 1
    }
  })
  return matches >= 3
}

function splitToList(value) {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    return value.map(item => (typeof item === 'string' ? item.trim() : item)).filter(item => item !== '' && item !== null && item !== undefined)
  }
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return []
  return trimmed
    .split(/[，,、;；\n]+/)
    .map(item => item.trim())
    .filter(item => item)
}

const STATUS_ALIASES = new Map([
  ['試用期', '試用期員工'],
  ['離職', '離職員工'],
  ['正職', '正職員工']
])

function normalizeRowObject(normalized) {
  if (typeof normalized.gender === 'string') {
    normalized.gender = normalized.gender.trim().toUpperCase()
  }
  if (typeof normalized.bloodType === 'string') {
    normalized.bloodType = normalized.bloodType.trim().toUpperCase()
  }
  if (typeof normalized.employmentStatus === 'string') {
    const trimmed = normalized.employmentStatus.trim()
    const alias = STATUS_ALIASES.get(trimmed) || STATUS_ALIASES.get(trimmed.replace(/員工$/, ''))
    normalized.employmentStatus = alias || trimmed
  }

  CSV_ARRAY_FIELDS.forEach(field => {
    if (field in normalized) {
      const list = splitToList(normalized[field])
      if (Array.isArray(list)) {
        normalized[field] = list
      } else if (list === undefined) {
        delete normalized[field]
      }
    }
  })

  if (normalized.phone && !normalized.mobile) {
    normalized.mobile = normalized.phone
  }

  const trimEmergencyContact = contact => {
    if (!contact || typeof contact !== 'object') return null
    const cleaned = {
      name: typeof contact.name === 'string' ? contact.name.trim() : contact.name,
      relation: typeof contact.relation === 'string' ? contact.relation.trim() : contact.relation,
      phone1: typeof contact.phone1 === 'string' ? contact.phone1.trim() : contact.phone1,
      phone2: typeof contact.phone2 === 'string' ? contact.phone2.trim() : contact.phone2
    }
    const hasContent = Object.values(cleaned).some(value => value !== '' && value !== null && value !== undefined)
    return hasContent ? cleaned : null
  }

  const emergency1 = trimEmergencyContact(normalized.emergency1)
  const emergency2 = trimEmergencyContact(normalized.emergency2)
  if (emergency1) normalized.emergency1 = emergency1
  else delete normalized.emergency1
  if (emergency2) normalized.emergency2 = emergency2
  else delete normalized.emergency2

  return normalized
}

function deriveUsername(row) {
  if (typeof row.username === 'string' && row.username.trim()) {
    return row.username.trim()
  }
  if (typeof row.email === 'string' && row.email.includes('@')) {
    return row.email.split('@')[0].trim()
  }
  if (typeof row.employeeNo === 'string' && row.employeeNo.trim()) {
    return row.employeeNo.trim()
  }
  return ''
}

function generatePassword(length = 12) {
  let password = ''
  while (!password) {
    password = crypto.randomBytes(length).toString('base64').replace(/[^a-zA-Z0-9]/g, '')
    if (password.length > length) {
      password = password.slice(0, length)
    }
  }
  return password
}

function createPreview(row) {
  return {
    employeeNo: row.employeeNo ?? '',
    name: row.name ?? '',
    department: row.department ?? '',
    role: row.role ?? '',
    email: row.email ?? ''
  }
}

export async function bulkImportEmployees(req, res) {
  if (!req.file || !req.file.buffer) {
    res.status(400).json({ message: '缺少上傳檔案' })
    return
  }

  const payload = req.bulkImportPayload && typeof req.bulkImportPayload === 'object'
    ? req.bulkImportPayload
    : null

  let columnMappings
  if (payload?.mappings && typeof payload.mappings === 'object') {
    columnMappings = { ...payload.mappings }
  } else {
    columnMappings = { ...DEFAULT_COLUMN_MAPPINGS }
    if (req.body?.mappings) {
      let parsed
      try {
        parsed = JSON.parse(req.body.mappings)
      } catch (error) {
        res.status(400).json({ message: '欄位對應格式錯誤', errors: ['mappings JSON 解析失敗'] })
        return
      }

      if (!parsed || typeof parsed !== 'object') {
        res.status(400).json({ message: '欄位對應格式錯誤', errors: ['欄位對應缺失'] })
        return
      }
      columnMappings = parsed
    }
  }

  const missingMappings = REQUIRED_MAPPING_KEYS.filter(key => {
    const value = columnMappings[key]
    return typeof value !== 'string' || !value.trim()
  })
  if (missingMappings.length) {
    res.status(400).json({
      message: '欄位對應缺少必要欄位',
      errors: missingMappings.map(key => `缺少對應欄位：${key}`)
    })
    return
  }

  let options = {}
  if (payload?.options && typeof payload.options === 'object' && !Array.isArray(payload.options)) {
    options = payload.options
  } else if (!payload) {
    try {
      options = req.body?.options ? JSON.parse(req.body.options) : {}
    } catch (error) {
      res.status(400).json({ message: '匯入選項格式錯誤', errors: ['options JSON 解析失敗'] })
      return
    }
  }

  let valueMappingSections = payload?.valueMappings
  let ignoreSections = payload?.ignore
  if (!payload) {
    const referenceParseResult = parseReferencePayload(req.body?.valueMappings, req.body?.ignore)
    if (!referenceParseResult.ok) {
      res.status(400).json({ message: referenceParseResult.message, errors: referenceParseResult.errors })
      return
    }
    valueMappingSections = referenceParseResult.valueMappings
    ignoreSections = referenceParseResult.ignore
  }

  valueMappingSections = valueMappingSections && typeof valueMappingSections === 'object'
    ? valueMappingSections
    : {}
  ignoreSections = ignoreSections && typeof ignoreSections === 'object'
    ? ignoreSections
    : {}

  let defaultRole = typeof options?.defaultRole === 'string' && options.defaultRole.trim()
    ? options.defaultRole.trim().toLowerCase()
    : 'employee'
  if (!VALID_ROLES.includes(defaultRole)) {
    defaultRole = 'employee'
  }
  const resetPassword = typeof options?.resetPassword === 'string' && options.resetPassword.trim()
    ? options.resetPassword.trim()
    : null

  const workbook = new ExcelJS.Workbook()
  let worksheet
  try {
    if (req.file.mimetype === 'text/csv' || req.file.originalname?.endsWith('.csv')) {
      let csvSource
      try {
        const csvContent = req.file.buffer.toString('utf8')
        csvSource = Readable.from(csvContent)
      } catch (conversionError) {
        res.status(400).json({
          message: '無法讀取 Excel 檔案',
          errors: [`CSV 串流轉換失敗：${conversionError.message}`]
        })
        return
      }
      await workbook.csv.read(csvSource)
    } else {
      await workbook.xlsx.load(req.file.buffer)
    }
    worksheet = workbook.worksheets[0]
  } catch (error) {
    res.status(400).json({ message: '無法讀取 Excel 檔案', errors: [error.message] })
    return
  }

  if (!worksheet) {
    res.status(400).json({ message: '找不到可用的工作表', errors: [] })
    return
  }

  const headerRow = worksheet.getRow(1)
  const headerMap = new Map()
  headerRow.eachCell((cell, colNumber) => {
    const value = toPlainCellValue(cell)
    if (typeof value === 'string' && value.trim()) {
      headerMap.set(value.trim(), colNumber)
    }
  })

  const headerRowsToSkip = new Set()
  const secondRow = worksheet.getRow(2)
  if (hasChineseHeaderHints(secondRow)) {
    headerRowsToSkip.add(2)
  }

  const missingColumns = Object.entries(columnMappings)
    .filter(([, header]) => typeof header === 'string' && header.trim())
    .filter(([, header]) => !headerMap.has(header.trim()))
    .map(([key, header]) => `${key} (${header})`)

  if (missingColumns.length) {
    res.status(400).json({
      message: '匯入檔案缺少必要欄位',
      errors: missingColumns.map(col => `找不到對應欄位：${col}`)
    })
    return
  }

  const parsedRows = []
  const maxRow = worksheet.actualRowCount || worksheet.rowCount
  for (let index = 2; index <= maxRow; index += 1) {
    if (headerRowsToSkip.has(index)) continue
    const row = worksheet.getRow(index)
    if (!row || row.cellCount === 0) continue

    const original = {}
    const normalized = {}
    let hasData = false

    Object.entries(columnMappings).forEach(([key, header]) => {
      if (typeof header !== 'string' || !header.trim()) return
      const col = headerMap.get(header.trim())
      if (!col) return
      const cellValue = toPlainCellValue(row.getCell(col))
      if (cellValue !== '' && cellValue !== null && cellValue !== undefined) {
        hasData = true
      }
      setPathValue(original, key, cellValue)

      const baseKey = key.split('.')[0]

      if (BOOLEAN_FIELDS.has(baseKey)) {
        const boolValue = toBoolean(cellValue)
        if (typeof boolValue === 'boolean') {
          setPathValue(normalized, key, boolValue)
        }
        return
      }

      if (DATE_FIELDS.has(baseKey)) {
        const dateValue = toDateValue(cellValue)
        if (dateValue) {
          setPathValue(normalized, key, dateValue)
        } else if (typeof cellValue === 'string' && cellValue.trim()) {
          setPathValue(normalized, key, cellValue.trim())
        }
        return
      }

      if (NUMBER_FIELDS.has(baseKey)) {
        const numberValue = toNumberValue(cellValue)
        if (numberValue !== undefined) {
          setPathValue(normalized, key, numberValue)
        }
        return
      }

      if (typeof cellValue === 'string') {
        setPathValue(normalized, key, cellValue.trim())
      } else {
        setPathValue(normalized, key, cellValue)
      }

      if (baseKey === 'employeeNo') {
        const currentValue = getPathValue(normalized, key)
        if (currentValue !== undefined && currentValue !== null) {
          setPathValue(normalized, key, String(currentValue).trim())
        }
      }
      if (baseKey === 'role') {
        const currentRole = getPathValue(normalized, key)
        if (typeof currentRole === 'string') {
          setPathValue(normalized, key, currentRole.trim().toLowerCase())
        }
      }
    })

    if (!hasData) continue

    normalizeRowObject(normalized)

    parsedRows.push({
      rowNumber: index,
      original,
      normalized,
      errors: []
    })
  }

  if (!parsedRows.length) {
    res.status(400).json({ message: '匯入檔案沒有資料', errors: [] })
    return
  }

  const referenceUsage = collectReferenceUsage(parsedRows)
  const mappingMaps = {}
  const ignoreSets = {}
  REFERENCE_KEYS.forEach(key => {
    mappingMaps[key] = toReferenceMappingMap(valueMappingSections?.[key] || {})
    const ignoreList = Array.isArray(ignoreSections?.[key]) ? ignoreSections[key] : []
    ignoreSets[key] = toIgnoreSet(ignoreList)
    // treat mapping 值為 null 與 ignore 一致
    mappingMaps[key].forEach((value, sourceKey) => {
      if (value === null) {
        ignoreSets[key].add(sourceKey)
      }
    })
  })

  const requiredReferenceTypes = REFERENCE_KEYS.filter(type =>
    referenceUsage[type].size > 0 || mappingMaps[type].size > 0
  )

  const referenceLookups = {}
  for (const type of requiredReferenceTypes) {
    const config = REFERENCE_CONFIGS[type]
    try {
      const docs = await config.Model.find({}, config.select).lean()
      referenceLookups[type] = {
        docs,
        aliasMap: buildReferenceAliasMap(docs, config.aliasFields),
        options: buildReferenceOptions(type, docs)
      }
    } catch (error) {
      const label = REFERENCE_LABELS[type] || type
      res.status(500).json({ message: `查詢${label}資料失敗`, error: error.message })
      return
    }
  }

  const resolutionMaps = {
    organization: new Map(),
    department: new Map(),
    subDepartment: new Map()
  }
  const missingReferences = {}
  const invalidMappings = []
  const invalidMessageSet = new Set()

  REFERENCE_KEYS.forEach(type => {
    const usageMap = referenceUsage[type]
    if (!usageMap.size && !mappingMaps[type].size && !ignoreSets[type].size) return
    const lookup = referenceLookups[type] || { aliasMap: new Map(), options: [] }

    usageMap.forEach(entry => {
      const normalizedValue = entry.normalizedValue
      if (!normalizedValue) return

      if (ignoreSets[type].has(normalizedValue)) {
        resolutionMaps[type].set(normalizedValue, { status: 'ignored', resolved: null })
        return
      }

      if (mappingMaps[type].has(normalizedValue)) {
        const target = mappingMaps[type].get(normalizedValue)
        if (target === null) {
          resolutionMaps[type].set(normalizedValue, { status: 'ignored', resolved: null })
          return
        }
        const targetDoc = lookup.aliasMap.get(normalizeReferenceKey(target))
        if (!targetDoc) {
          const message = `valueMappings.${type} 中的「${entry.value}」沒有對應到有效項目`
          if (!invalidMessageSet.has(message)) {
            invalidMessageSet.add(message)
            invalidMappings.push(message)
          }
          resolutionMaps[type].set(normalizedValue, { status: 'invalid' })
        } else {
          resolutionMaps[type].set(normalizedValue, {
            status: 'mapped',
            resolved: targetDoc._id?.toString?.() ?? ''
          })
        }
        return
      }

      const autoDoc = lookup.aliasMap.get(normalizedValue)
      if (autoDoc) {
        resolutionMaps[type].set(normalizedValue, {
          status: 'auto',
          resolved: autoDoc._id?.toString?.() ?? ''
        })
      } else {
        resolutionMaps[type].set(normalizedValue, { status: 'missing' })
      }
    })

    mappingMaps[type].forEach((target, sourceKey) => {
      if (target === null) return
      const targetDoc = lookup.aliasMap.get(normalizeReferenceKey(target))
      if (!targetDoc) {
        const display = usageMap.get(sourceKey)?.value || sourceKey
        const message = `valueMappings.${type} 中的「${display}」沒有對應到有效項目`
        if (!invalidMessageSet.has(message)) {
          invalidMessageSet.add(message)
          invalidMappings.push(message)
        }
      }
    })

    const pending = []
    usageMap.forEach(entry => {
      const resolution = resolutionMaps[type].get(entry.normalizedValue)
      if (!resolution || resolution.status === 'missing') {
        pending.push({
          value: entry.value,
          normalizedValue: entry.normalizedValue,
          rows: Array.from(entry.rows).sort((a, b) => a - b)
        })
      }
    })

    if (pending.length) {
      const lookup = referenceLookups[type] || { options: [] }
      missingReferences[type] = {
        values: pending,
        options: lookup.options || []
      }
    }
  })

  if (invalidMappings.length) {
    res.status(400).json({
      message: 'valueMappings 含有無效對應',
      errors: invalidMappings
    })
    return
  }

  if (Object.keys(missingReferences).length) {
    res.status(409).json({
      message: '匯入資料存在未對應的組織或部門資訊，請完成對應後重新提交',
      missingReferences,
      errors: []
    })
    return
  }

  parsedRows.forEach(row => {
    REFERENCE_KEYS.forEach(key => {
      const normalizedValue = normalizeReferenceKey(getPathValue(row.original, key))
      if (!normalizedValue) return
      const resolution = resolutionMaps[key].get(normalizedValue)
      if (!resolution) return
      if (resolution.status === 'ignored') {
        row.normalized[key] = null
      } else if (typeof resolution.resolved === 'string' && resolution.resolved) {
        row.normalized[key] = resolution.resolved
      }
    })
  })

  const seenEmails = new Set()
  const emailCandidates = new Set()

  parsedRows.forEach(row => {
    if (!row.normalized.role) {
      row.normalized.role = defaultRole
    }

    const email = row.normalized.email ?? row.original.email
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      row.errors.push('缺少 Email')
    } else if (!EMAIL_REGEX.test(normalizedEmail)) {
      row.errors.push('Email 格式不正確')
    } else if (seenEmails.has(normalizedEmail)) {
      row.errors.push('Email 重複')
    } else {
      seenEmails.add(normalizedEmail)
      emailCandidates.add(normalizedEmail)
      row.normalized.email = normalizedEmail
    }

    if (!row.normalized.employeeNo || String(row.normalized.employeeNo).trim() === '') {
      row.errors.push('缺少員工編號')
    }

    if (!row.normalized.name || String(row.normalized.name).trim() === '') {
      row.errors.push('缺少姓名')
    }

    if (!VALID_ROLES.includes(row.normalized.role)) {
      row.errors.push('權限設定不正確')
    }
  })

  let existingEmails = []
  if (emailCandidates.size) {
    try {
      const emailList = Array.from(emailCandidates)
      existingEmails = await Employee.find({ email: { $in: emailList } }, 'email')
    } catch (error) {
      res.status(500).json({ message: '檢查既有 Email 失敗', error: error.message })
      return
    }
  }

  const existingEmailSet = new Set(existingEmails.map(doc => normalizeEmail(doc.email)))
  parsedRows.forEach(row => {
    const email = normalizeEmail(row.normalized.email ?? row.original.email)
    if (email && existingEmailSet.has(email)) {
      row.errors.push('Email 已存在')
    }
  })

  const preview = []
  const errorMessages = []
  let successCount = 0

  for (const row of parsedRows) {
    if (row.errors.length) {
      errorMessages.push(formatRowError(row.rowNumber, row.errors))
      continue
    }

    const username = deriveUsername(row.normalized)
    if (!username) {
      errorMessages.push(formatRowError(row.rowNumber, '缺少帳號或 Email'))
      continue
    }

    const password = resetPassword || generatePassword()
    const body = {
      ...row.normalized,
      email: row.normalized.email,
      username
    }

    const employeeDoc = buildEmployeeDoc(body)
    employeeDoc.password = password

    try {
      const created = await Employee.create(employeeDoc)
      successCount += 1
      preview.push(createPreview({
        employeeNo: created.employeeId || created.employeeNo || body.employeeNo,
        name: created.name,
        department: created.department || body.department,
        role: created.role || body.role,
        email: created.email
      }))
    } catch (error) {
      errorMessages.push(formatRowError(row.rowNumber, error.message))
    }
  }

  const failureCount = parsedRows.length - successCount

  const statusCode = successCount > 0 ? 200 : 400
  res.status(statusCode).json({
    successCount,
    failureCount,
    preview,
    errors: errorMessages
  })
}

export default bulkImportEmployees
