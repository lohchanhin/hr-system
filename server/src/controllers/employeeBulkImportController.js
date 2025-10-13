import ExcelJS from 'exceljs'
import crypto from 'crypto'
import { Readable } from 'stream'
import Employee from '../models/Employee.js'
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

const EMAIL_REGEX = /^\S+@\S+\.\S+$/

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

  let columnMappings = { ...DEFAULT_COLUMN_MAPPINGS }
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
  try {
    options = req.body?.options ? JSON.parse(req.body.options) : {}
  } catch (error) {
    res.status(400).json({ message: '匯入選項格式錯誤', errors: ['options JSON 解析失敗'] })
    return
  }

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
