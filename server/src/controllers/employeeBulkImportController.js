import ExcelJS from 'exceljs'
import crypto from 'crypto'
import Employee from '../models/Employee.js'
import { buildEmployeeDoc } from './employeeController.js'

const REQUIRED_MAPPING_KEYS = ['employeeNo', 'name', 'email']
const VALID_ROLES = ['employee', 'supervisor', 'admin']

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
  'graduationYear'
])

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

  let columnMappings
  try {
    columnMappings = JSON.parse(req.body?.mappings || '{}')
  } catch (error) {
    res.status(400).json({ message: '欄位對應格式錯誤', errors: ['mappings JSON 解析失敗'] })
    return
  }

  if (!columnMappings || typeof columnMappings !== 'object') {
    res.status(400).json({ message: '欄位對應格式錯誤', errors: ['欄位對應缺失'] })
    return
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
      await workbook.csv.read(req.file.buffer)
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
      original[key] = cellValue

      if (BOOLEAN_FIELDS.has(key)) {
        const boolValue = toBoolean(cellValue)
        if (typeof boolValue === 'boolean') {
          normalized[key] = boolValue
        }
        return
      }

      if (DATE_FIELDS.has(key)) {
        const dateValue = toDateValue(cellValue)
        if (dateValue) {
          normalized[key] = dateValue
        } else if (typeof cellValue === 'string' && cellValue.trim()) {
          normalized[key] = cellValue.trim()
        }
        return
      }

      if (NUMBER_FIELDS.has(key)) {
        const numberValue = toNumberValue(cellValue)
        if (numberValue !== undefined) {
          normalized[key] = numberValue
        }
        return
      }

      if (typeof cellValue === 'string') {
        normalized[key] = cellValue.trim()
      } else {
        normalized[key] = cellValue
      }

      if (key === 'employeeNo' && normalized[key] !== undefined && normalized[key] !== null) {
        normalized[key] = String(normalized[key]).trim()
      }
      if (key === 'role' && typeof normalized[key] === 'string') {
        normalized[key] = normalized[key].trim().toLowerCase()
      }
    })

    if (!hasData) continue

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
