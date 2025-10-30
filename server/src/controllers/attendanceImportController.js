import ExcelJS from 'exceljs'
import { Readable } from 'stream'
import mongoose from 'mongoose'
import AttendanceRecord from '../models/AttendanceRecord.js'
import Employee from '../models/Employee.js'

const DEFAULT_COLUMN_MAPPINGS = Object.freeze({
  userId: 'USERID',
  timestamp: 'CHECKTIME',
  type: 'CHECKTYPE',
  remark: 'REMARK'
})

const REQUIRED_MAPPING_KEYS = ['userId', 'timestamp', 'type']

const TYPE_MAPPINGS = {
  I: 'clockIn',
  O: 'clockOut'
}

const SUPPORTED_ACTIONS = new Set(['clockIn', 'clockOut', 'outing', 'breakIn'])

const DEFAULT_TIMEZONE = 'Asia/Taipei'

function parseJsonField(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

function toPlainCellValue(cell) {
  if (!cell) return ''
  if (cell.text !== undefined) return String(cell.text).trim()
  if (cell.value === null || cell.value === undefined) return ''
  if (cell.value instanceof Date) return cell.value
  if (typeof cell.value === 'object' && cell.value.result !== undefined) {
    return typeof cell.value.result === 'string'
      ? cell.value.result.trim()
      : cell.value.result
  }
  if (typeof cell.value === 'string') return cell.value.trim()
  return cell.value
}

function excelSerialToDate(serial) {
  if (typeof serial !== 'number') return null
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const millis = Math.round(serial * 24 * 60 * 60 * 1000)
  if (Number.isNaN(millis)) return null
  return new Date(excelEpoch.getTime() + millis)
}

function normalizeIdentifier(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  return String(value).trim()
}

function createDateFromParts(parts, timeZone) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts
  if (!year || !month || !day) return null
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const baseDate = new Date(naiveUtc)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const partsResult = formatter.formatToParts(baseDate).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  const tzUtc = Date.UTC(
    Number(partsResult.year),
    Number(partsResult.month) - 1,
    Number(partsResult.day),
    Number(partsResult.hour),
    Number(partsResult.minute),
    Number(partsResult.second)
  )
  const offset = tzUtc - baseDate.getTime()
  return new Date(naiveUtc - offset)
}

function parseDateTimeString(value, timeZone) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text)
  if (hasTimezone) {
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const isoCandidate = text.replace(' ', 'T')
  const parsedIso = new Date(isoCandidate)
  if (!Number.isNaN(parsedIso.getTime())) {
    const parts = {
      year: parsedIso.getUTCFullYear(),
      month: parsedIso.getUTCMonth() + 1,
      day: parsedIso.getUTCDate(),
      hour: parsedIso.getUTCHours(),
      minute: parsedIso.getUTCMinutes(),
      second: parsedIso.getUTCSeconds()
    }
    return createDateFromParts(parts, timeZone)
  }

  const standardMatch = text.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (standardMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = standardMatch
    return createDateFromParts(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second)
      },
      timeZone
    )
  }

  const usMatch = text.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (usMatch) {
    const [, month, day, year, hour = '0', minute = '0', second = '0'] = usMatch
    return createDateFromParts(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second)
      },
      timeZone
    )
  }

  return null
}

function parseTimestamp(value, timeZone) {
  if (!value && value !== 0) return null
  if (value instanceof Date) {
    const parts = {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    }
    return createDateFromParts(parts, timeZone)
  }
  if (typeof value === 'number') {
    const asDate = excelSerialToDate(value)
    if (asDate) return parseTimestamp(asDate, timeZone)
    const epochDate = new Date(value)
    return Number.isNaN(epochDate.getTime()) ? null : epochDate
  }
  if (typeof value === 'string') {
    const direct = parseDateTimeString(value, timeZone)
    if (direct) return direct
  }
  return null
}

function normalizeAction(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    if (text === '1') return 'clockIn'
    if (text === '0') return 'clockOut'
    const upper = text.toUpperCase()
    if (TYPE_MAPPINGS[upper]) return TYPE_MAPPINGS[upper]
    if (SUPPORTED_ACTIONS.has(text)) return text
    if (SUPPORTED_ACTIONS.has(upper.charAt(0).toLowerCase() + upper.slice(1))) {
      return upper.charAt(0).toLowerCase() + upper.slice(1)
    }
    if (SUPPORTED_ACTIONS.has(upper.toLowerCase())) return upper.toLowerCase()
  }
  if (typeof value === 'number') {
    if (value === 1) return 'clockIn'
    if (value === 0) return 'clockOut'
  }
  return ''
}

function collectCandidate(identifier, hints, sets) {
  if (!identifier) return
  const text = identifier.trim()
  if (!text) return
  const { employeeIds, emails, objectIds } = sets
  if (hints === 'email' || text.includes('@')) {
    emails.add(text.toLowerCase())
  }
  if (hints === '_id') {
    if (mongoose.Types.ObjectId.isValid(text)) objectIds.add(text)
    return
  }
  if (mongoose.Types.ObjectId.isValid(text)) {
    objectIds.add(text)
  }
  if (hints === 'employeeId') {
    employeeIds.add(text)
    return
  }
  employeeIds.add(text)
}

function resolveMappedEmployee(mapping, maps) {
  if (!mapping) return null
  if (typeof mapping === 'string') {
    const key = mapping.trim()
    if (!key) return null
    return (
      maps.byObjectId.get(key) ||
      maps.byEmployeeId.get(key) ||
      maps.byEmail.get(key.toLowerCase()) ||
      null
    )
  }
  if (typeof mapping !== 'object') return null
  if (mapping.action === 'ignore') return 'ignore'
  if (typeof mapping._id === 'string') {
    const target = mapping._id.trim()
    if (target) return maps.byObjectId.get(target) || null
  }
  if (typeof mapping.id === 'string') {
    const target = mapping.id.trim()
    if (target) return maps.byObjectId.get(target) || null
  }
  if (typeof mapping.employeeId === 'string') {
    const target = mapping.employeeId.trim()
    if (target) return maps.byEmployeeId.get(target) || null
  }
  if (typeof mapping.email === 'string') {
    const target = mapping.email.trim().toLowerCase()
    if (target) return maps.byEmail.get(target) || null
  }
  if (typeof mapping.value === 'string') {
    return resolveMappedEmployee(mapping.value, maps)
  }
  return null
}

function buildEmployeeMaps(employees = []) {
  const byEmployeeId = new Map()
  const byEmail = new Map()
  const byObjectId = new Map()

  employees.forEach(employee => {
    const id = String(employee._id)
    byObjectId.set(id, employee)
    if (employee.employeeId) {
      byEmployeeId.set(String(employee.employeeId).trim(), employee)
    }
    if (employee.email) {
      byEmail.set(String(employee.email).trim().toLowerCase(), employee)
    }
  })

  return { byEmployeeId, byEmail, byObjectId }
}

export async function importAttendanceRecords(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ message: '僅限管理者匯入考勤資料' })
    return
  }

  if (!req.file || !req.file.buffer) {
    res.status(400).json({ message: '缺少上傳檔案' })
    return
  }

  const mappingsPayload = parseJsonField(req.body?.mappings, DEFAULT_COLUMN_MAPPINGS)
  const mappings = { ...DEFAULT_COLUMN_MAPPINGS, ...(mappingsPayload || {}) }

  const missingMappingKeys = REQUIRED_MAPPING_KEYS.filter(key => {
    const header = mappings[key]
    return typeof header !== 'string' || !header.trim()
  })
  if (missingMappingKeys.length) {
    res.status(400).json({
      message: '欄位對應缺少必要欄位',
      errors: missingMappingKeys.map(key => `缺少欄位對應：${key}`)
    })
    return
  }

  const optionPayload = parseJsonField(req.body?.options, {})
  const dryRun = Boolean(optionPayload?.dryRun)
  const requestedTimezone = typeof optionPayload?.timezone === 'string' && optionPayload.timezone.trim()
    ? optionPayload.timezone.trim()
    : DEFAULT_TIMEZONE

  let timezone = DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: requestedTimezone })
    timezone = requestedTimezone
  } catch (error) {
    timezone = DEFAULT_TIMEZONE
  }

  const userMappingPayload = parseJsonField(req.body?.userMappings, {}) || {}
  const ignoreList = parseJsonField(req.body?.ignoreUsers, []) || []
  const ignoreSet = new Set(
    Array.isArray(ignoreList)
      ? ignoreList.map(value => normalizeIdentifier(value)).filter(Boolean)
      : []
  )

  const workbook = new ExcelJS.Workbook()
  let worksheet
  try {
    if (req.file.mimetype === 'text/csv' || req.file.originalname?.toLowerCase().endsWith('.csv')) {
      let csvSource
      try {
        const csvContent = req.file.buffer.toString('utf8')
        csvSource = Readable.from(csvContent)
      } catch (error) {
        res.status(400).json({ message: 'CSV 轉換失敗', errors: [error.message] })
        return
      }
      await workbook.csv.read(csvSource)
    } else {
      await workbook.xlsx.load(req.file.buffer)
    }
    worksheet = workbook.worksheets[0]
  } catch (error) {
    res.status(400).json({ message: '無法讀取匯入檔案', errors: [error.message] })
    return
  }

  if (!worksheet) {
    res.status(400).json({ message: '匯入檔案沒有工作表', errors: [] })
    return
  }

  const headerRow = worksheet.getRow(1)
  const headerMap = new Map()
  headerRow.eachCell((cell, colNumber) => {
    const value = toPlainCellValue(cell)
    if (typeof value === 'string' && value.trim()) {
      const key = value.trim()
      headerMap.set(key, colNumber)
      headerMap.set(key.toUpperCase(), colNumber)
    }
  })

  const missingColumns = REQUIRED_MAPPING_KEYS
    .map(key => ({ key, header: mappings[key] }))
    .filter(({ header }) => typeof header === 'string' && header.trim())
    .filter(({ header }) => {
      const upper = header.trim().toUpperCase()
      return !headerMap.has(header.trim()) && !headerMap.has(upper)
    })
    .map(({ key, header }) => `${key} (${header})`)

  if (missingColumns.length) {
    res.status(400).json({
      message: '匯入檔案缺少必要欄位',
      errors: missingColumns.map(name => `找不到欄位：${name}`)
    })
    return
  }

  const rows = []
  const identifiers = new Set()
  const headerKeys = Object.entries(mappings)
  const maxRow = worksheet.actualRowCount || worksheet.rowCount
  for (let rowNumber = 2; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    if (!row || row.cellCount === 0) continue

    const extracted = {}
    headerKeys.forEach(([key, header]) => {
      if (typeof header !== 'string' || !header.trim()) return
      const mapKey = headerMap.has(header) ? header : header.toUpperCase()
      const col = headerMap.get(mapKey)
      if (!col) return
      extracted[key] = toPlainCellValue(row.getCell(col))
    })

    const userIdRaw = extracted.userId
    const timestampRaw = extracted.timestamp
    const typeRaw = extracted.type
    const remarkRaw = extracted.remark

    const identifier = normalizeIdentifier(userIdRaw)
    const action = normalizeAction(typeRaw)
    const timestamp = parseTimestamp(timestampRaw, timezone)

    const previewRow = {
      rowNumber,
      userId: identifier,
      rawUserId: userIdRaw,
      action,
      rawAction: typeRaw,
      timestamp: timestamp ? timestamp.toISOString() : null,
      rawTimestamp: timestampRaw,
      remark: remarkRaw ?? ''
    }

    const errors = []
    if (!identifier) {
      errors.push('缺少 USERID')
    }
    if (!timestamp) {
      errors.push('無法解析 CHECKTIME')
    }
    if (!action) {
      errors.push('無法判斷 CHECKTYPE')
    }

    previewRow.errors = errors
    rows.push(previewRow)

    if (identifier) {
      identifiers.add(identifier)
    }
  }

  if (!rows.length) {
    res.status(400).json({ message: '匯入檔案沒有資料', errors: [] })
    return
  }

  const mappingEntries = new Map()
  Object.entries(userMappingPayload).forEach(([key, value]) => {
    const normalized = normalizeIdentifier(key)
    if (normalized) {
      mappingEntries.set(normalized, value)
    }
  })

  const employeeIdSet = new Set()
  const emailSet = new Set()
  const objectIdSet = new Set()

  identifiers.forEach(identifier => collectCandidate(identifier, null, {
    employeeIds: employeeIdSet,
    emails: emailSet,
    objectIds: objectIdSet
  }))
  mappingEntries.forEach(value => {
    if (!value) return
    if (typeof value === 'string') {
      collectCandidate(value, null, {
        employeeIds: employeeIdSet,
        emails: emailSet,
        objectIds: objectIdSet
      })
      return
    }
    if (typeof value === 'object') {
      if (typeof value._id === 'string') {
        collectCandidate(value._id, '_id', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet
        })
      }
      if (typeof value.id === 'string') {
        collectCandidate(value.id, '_id', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet
        })
      }
      if (typeof value.employeeId === 'string') {
        collectCandidate(value.employeeId, 'employeeId', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet
        })
      }
      if (typeof value.email === 'string') {
        collectCandidate(value.email, 'email', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet
        })
      }
      if (typeof value.value === 'string') {
        collectCandidate(value.value, null, {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet
        })
      }
    }
  })

  const queryConditions = []
  if (employeeIdSet.size) {
    queryConditions.push({ employeeId: { $in: Array.from(employeeIdSet) } })
  }
  if (emailSet.size) {
    queryConditions.push({ email: { $in: Array.from(emailSet) } })
  }
  if (objectIdSet.size) {
    queryConditions.push({ _id: { $in: Array.from(objectIdSet) } })
  }

  let employees = []
  if (queryConditions.length) {
    employees = await Employee.find({ $or: queryConditions })
      .select('_id name email employeeId')
      .lean()
  }
  const employeeMaps = buildEmployeeMaps(employees)

  const missingUserMap = new Map()
  const validRecords = []
  let ignoredCount = 0
  let errorCount = 0

  rows.forEach(previewRow => {
    const identifier = previewRow.userId
    const rowErrors = [...previewRow.errors]
    if (!identifier) {
      errorCount += 1
      previewRow.status = 'error'
      previewRow.employee = null
      return
    }

    if (rowErrors.length) {
      errorCount += 1
      previewRow.status = 'error'
      previewRow.employee = null
      return
    }

    if (ignoreSet.has(identifier)) {
      ignoredCount += 1
      previewRow.status = 'ignored'
      previewRow.employee = null
      return
    }

    const mapping = mappingEntries.get(identifier)
    const mappedEmployee = resolveMappedEmployee(mapping, employeeMaps)

    if (mappedEmployee === 'ignore') {
      ignoredCount += 1
      previewRow.status = 'ignored'
      previewRow.employee = null
      return
    }

    const employee =
      mappedEmployee ||
      employeeMaps.byEmployeeId.get(identifier) ||
      employeeMaps.byEmail.get(identifier.toLowerCase()) ||
      employeeMaps.byObjectId.get(identifier)

    if (!employee) {
      const missingEntry = missingUserMap.get(identifier) || {
        identifier,
        count: 0,
        rows: [],
        samples: []
      }
      missingEntry.count += 1
      missingEntry.rows.push(previewRow.rowNumber)
      if (missingEntry.samples.length < 5) {
        missingEntry.samples.push({
          timestamp: previewRow.timestamp,
          action: previewRow.action,
          remark: previewRow.remark
        })
      }
      missingUserMap.set(identifier, missingEntry)
      previewRow.status = 'missing'
      previewRow.employee = null
      return
    }

    previewRow.status = 'ready'
    previewRow.employee = {
      _id: String(employee._id),
      name: employee.name || '',
      email: employee.email || '',
      employeeId: employee.employeeId || ''
    }

    validRecords.push({
      employee: employee._id,
      action: previewRow.action,
      timestamp: new Date(previewRow.timestamp),
      remark: previewRow.remark ?? ''
    })
  })

  if (!dryRun && validRecords.length) {
    await AttendanceRecord.insertMany(validRecords)
  }

  const missingCount = Array.from(missingUserMap.values()).reduce(
    (total, entry) => total + (entry.count || 0),
    0
  )

  const response = {
    dryRun,
    timezone,
    summary: {
      totalRows: rows.length,
      readyCount: validRecords.length,
      missingCount,
      ignoredCount,
      errorCount,
      importedCount: dryRun ? 0 : validRecords.length
    },
    preview: rows,
    missingUsers: Array.from(missingUserMap.values())
  }

  if (!dryRun && missingUserMap.size) {
    response.message = '部分資料因缺少對應員工未匯入'
  } else if (!dryRun) {
    response.message = '考勤資料匯入完成'
  } else {
    response.message = '預覽成功'
  }

  res.json(response)
}
