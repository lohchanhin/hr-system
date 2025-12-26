import ExcelJS from 'exceljs'
import readline from 'node:readline'
import { Readable } from 'stream'
import { TextDecoder } from 'util'
import mongoose from 'mongoose'
import AttendanceRecord from '../models/AttendanceRecord.js'
import Employee from '../models/Employee.js'

const DEFAULT_COLUMN_MAPPINGS = Object.freeze({
  userId: 'USERID',
  timestamp: 'CHECKTIME',
  type: 'CHECKTYPE',
  remark: 'REMARK',
  name: 'NAME'
})

const REQUIRED_MAPPING_KEYS = ['userId', 'timestamp', 'type']

const TYPE_MAPPINGS = {
  I: 'clockIn',
  O: 'clockOut',
  '上班簽到': 'clockIn',
  '下班簽退': 'clockOut',
  '上班': 'clockIn',
  '下班': 'clockOut'
}

const SUPPORTED_ACTIONS = new Set(['clockIn', 'clockOut', 'outing', 'breakIn'])

const DEFAULT_TIMEZONE = 'Asia/Taipei'

const PREVIEW_SAMPLE_LIMIT = 50
const INSERT_BATCH_SIZE = 500

const ENCODING_UTF8 = 'utf8'
const ENCODING_UTF8_BOM = 'utf8-bom'
const ENCODING_UTF16LE = 'utf16le'
const ENCODING_UTF16BE = 'utf16be'

class MissingColumnError extends Error {
  constructor(columns) {
    super('匯入檔案缺少必要欄位')
    this.name = 'MissingColumnError'
    this.columns = columns
  }
}

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

function detectBufferEncoding(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) {
    return ENCODING_UTF8
  }

  const first = buffer[0]
  const second = buffer[1]

  if (first === 0xff && second === 0xfe) {
    return ENCODING_UTF16LE
  }
  if (first === 0xfe && second === 0xff) {
    return ENCODING_UTF16BE
  }
  if (buffer.length >= 3 && first === 0xef && second === 0xbb && buffer[2] === 0xbf) {
    return ENCODING_UTF8_BOM
  }

  return ENCODING_UTF8
}

function createUploadStreamFactory(buffer, { isCsv }) {
  if (!isCsv) {
    return () => Readable.from(buffer)
  }

  const encoding = detectBufferEncoding(buffer)

  if (encoding === ENCODING_UTF16LE || encoding === ENCODING_UTF16BE) {
    const decoder = new TextDecoder(encoding === ENCODING_UTF16LE ? 'utf-16le' : 'utf-16be')
    let text = decoder.decode(buffer)
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1)
    }
    const normalized = text
    return () => Readable.from([normalized])
  }

  let payload = buffer
  if (encoding === ENCODING_UTF8_BOM) {
    payload = buffer.slice(3)
  }

  return () => {
    const stream = Readable.from([payload])
    stream.setEncoding('utf8')
    return stream
  }
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

function processHourWithAmPm(hour, ampmIndicator) {
  let hourNumber = Number(hour)
  if (Number.isNaN(hourNumber)) {
    return null
  }
  if (ampmIndicator === 'AM' && hourNumber === 12) {
    hourNumber = 0
  } else if (ampmIndicator === 'PM' && hourNumber !== 12) {
    hourNumber += 12
  }
  return hourNumber
}

function createDateResult(year, month, day, hour, minute, second, timeZone) {
  return {
    value: createDateFromParts(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour,
        minute: Number(minute),
        second: second ? Number(second) : 0
      },
      timeZone
    ),
    error: null
  }
}

function parseDateTimeString(value, timeZone) {
  if (typeof value !== 'string') {
    return { value: null, error: 'CHECKTIME 不是字串' }
  }
  const text = value.trim()
  if (!text) {
    return { value: null, error: 'CHECKTIME 為空字串' }
  }

  const textWithoutT = text.replace('T', ' ')

  const ampmMatch = textWithoutT.match(
    /^(?<year>\d{4})[-/](?<month>\d{1,2})[-/](?<day>\d{1,2})\s*(?:(?<prefix>上午|下午)\s*)?(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?\s*(?<suffix>上午|下午|AM|PM)?$/i
  )
  if (ampmMatch?.groups) {
    const { year, month, day, hour, minute, second, prefix, suffix } = ampmMatch.groups
    const indicator = prefix ?? suffix
    let normalizedIndicator = null
    if (indicator) {
      if (indicator === '上午') normalizedIndicator = 'AM'
      else if (indicator === '下午') normalizedIndicator = 'PM'
      else normalizedIndicator = indicator.toUpperCase()
    }

    const hourNumber = processHourWithAmPm(hour, normalizedIndicator)
    if (hourNumber === null) {
      return { value: null, error: 'CHECKTIME 時間數值無效' }
    }

    return createDateResult(year, month, day, hourNumber, minute, second, timeZone)
  }

  // Flexible pattern to handle corrupted AM/PM indicators (e.g., "下��" instead of "下午")
  // This pattern captures any non-digit characters between date and time
  const flexibleMatch = textWithoutT.match(
    /^(?<year>\d{4})[-/](?<month>\d{1,2})[-/](?<day>\d{1,2})\s+(?<indicator>[^\d\s:]+)?\s*(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/
  )
  if (flexibleMatch?.groups) {
    const { year, month, day, hour, minute, second, indicator } = flexibleMatch.groups
    let normalizedIndicator = null
    
    if (indicator) {
      const indicatorUpper = indicator.toUpperCase()
      // Check for valid AM/PM indicators
      if (indicator === '上午' || indicatorUpper === 'AM') {
        normalizedIndicator = 'AM'
      } else if (indicator === '下午' || indicatorUpper === 'PM') {
        normalizedIndicator = 'PM'
      } else if (indicator.includes('上') || (indicator.includes('午') && !indicator.includes('下'))) {
        // Corrupted "上午" (morning) - detects "上" or "午" without "下"
        normalizedIndicator = 'AM'
      } else if (indicator.includes('下')) {
        // Corrupted "下午" (afternoon/evening) - detects "下"
        normalizedIndicator = 'PM'
      } else if (indicatorUpper.startsWith('A')) {
        normalizedIndicator = 'AM'
      } else if (indicatorUpper.startsWith('P')) {
        normalizedIndicator = 'PM'
      }
    }

    const hourNumber = processHourWithAmPm(hour, normalizedIndicator)
    if (hourNumber === null) {
      return { value: null, error: 'CHECKTIME 時間數值無效' }
    }

    return createDateResult(year, month, day, hourNumber, minute, second, timeZone)
  }

  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text)
  if (hasTimezone) {
    const parsed = new Date(text)
    if (Number.isNaN(parsed.getTime())) {
      return { value: null, error: 'CHECKTIME 含時區但格式不正確' }
    }
    return { value: parsed, error: null }
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
    return {
      value: createDateFromParts(parts, timeZone),
      error: null
    }
  }

  const standardMatch = text.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (standardMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = standardMatch
    return {
      value: createDateFromParts(
        {
          year: Number(year),
          month: Number(month),
          day: Number(day),
          hour: Number(hour),
          minute: Number(minute),
          second: Number(second)
        },
        timeZone
      ),
      error: null
    }
  }

  const usMatch = text.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (usMatch) {
    const [, month, day, year, hour = '0', minute = '0', second = '0'] = usMatch
    return {
      value: createDateFromParts(
        {
          year: Number(year),
          month: Number(month),
          day: Number(day),
          hour: Number(hour),
          minute: Number(minute),
          second: Number(second)
        },
        timeZone
      ),
      error: null
    }
  }

  return { value: null, error: 'CHECKTIME 格式不支援' }
}

export function parseTimestamp(value, timeZone) {
  if (value === null || value === undefined) {
    return { value: null, error: 'CHECKTIME 缺少值' }
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { value: null, error: 'CHECKTIME Date 物件無效' }
    }
    const parts = {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    }
    const converted = createDateFromParts(parts, timeZone)
    if (!converted) {
      return { value: null, error: 'CHECKTIME 無法轉換為指定時區' }
    }
    return { value: converted, error: null }
  }
  if (typeof value === 'number') {
    const asDate = excelSerialToDate(value)
    if (asDate) {
      return parseTimestamp(asDate, timeZone)
    }
    const epochDate = new Date(value)
    if (Number.isNaN(epochDate.getTime())) {
      return { value: null, error: 'Excel serial 無效且不是有效的時間戳' }
    }
    return { value: epochDate, error: null }
  }
  if (typeof value === 'string') {
    const numericLike = value.trim()
    if (/^[+-]?\d+(?:\.\d+)?$/.test(numericLike)) {
      const numericValue = Number(numericLike)
      if (!Number.isNaN(numericValue)) {
        return parseTimestamp(numericValue, timeZone)
      }
    }
    const direct = parseDateTimeString(value, timeZone)
    if (direct.value) {
      return direct
    }
    return { value: null, error: direct.error }
  }
  return { value: null, error: 'CHECKTIME 類型不支援' }
}
function normalizeAction(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    if (text === '1') return 'clockIn'
    if (text === '0') return 'clockOut'
    // Check for Chinese text mappings first
    if (TYPE_MAPPINGS[text]) return TYPE_MAPPINGS[text]
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
  const { employeeIds, emails, objectIds, names } = sets
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
  if (hints === 'name') {
    names.add(text)
    return
  }
  employeeIds.add(text)
}

function resolveEmployeeByCompositeKey(identifier, name, employeeMaps) {
  // First try composite key (employeeId + name)
  if (identifier && name) {
    const compositeKey = `${identifier}|${name}`
    const employee = employeeMaps.byCompositeKey.get(compositeKey)
    if (employee) return employee
  }
  
  // If composite key fails, try identifier alone
  if (identifier) {
    const byId = employeeMaps.byEmployeeId.get(identifier) ||
                 employeeMaps.byEmail.get(identifier.toLowerCase()) ||
                 employeeMaps.byObjectId.get(identifier)
    if (byId) return byId
  }
  
  // If name is provided and identifier lookup failed, try name alone but only if there's exactly one match
  if (name) {
    const nameMatches = employeeMaps.byName.get(name)
    if (nameMatches && nameMatches.length === 1) {
      return nameMatches[0]
    }
  }
  
  return null
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
  const byName = new Map()
  const byCompositeKey = new Map()

  employees.forEach(employee => {
    const id = String(employee._id)
    byObjectId.set(id, employee)
    if (employee.employeeId) {
      const empId = String(employee.employeeId).trim()
      byEmployeeId.set(empId, employee)
      // Create composite key: employeeId + name
      if (employee.name) {
        const compositeKey = `${empId}|${String(employee.name).trim()}`
        byCompositeKey.set(compositeKey, employee)
      }
    }
    if (employee.email) {
      byEmail.set(String(employee.email).trim().toLowerCase(), employee)
    }
    if (employee.name) {
      const name = String(employee.name).trim()
      // Store all employees with the same name in an array
      if (!byName.has(name)) {
        byName.set(name, [])
      }
      byName.get(name).push(employee)
    }
  })

  return { byEmployeeId, byEmail, byObjectId, byName, byCompositeKey }
}

function registerHeader(headerMap, header, colNumber) {
  if (header === null || header === undefined) return
  const text = String(header).trim()
  if (!text) return
  headerMap.set(text, colNumber)
  headerMap.set(text.toUpperCase(), colNumber)
}

function buildHeaderMapFromRow(row) {
  const headerMap = new Map()
  row.eachCell((cell, colNumber) => {
    const value = toPlainCellValue(cell)
    if (value !== undefined && value !== null) {
      registerHeader(headerMap, value, colNumber)
    }
  })
  return headerMap
}

function buildHeaderMapFromValues(values = []) {
  const headerMap = new Map()
  values.forEach((value, index) => {
    if (value !== undefined && value !== null) {
      registerHeader(headerMap, value, index + 1)
    }
  })
  return headerMap
}

function findMissingColumns(headerMap, mappings) {
  return REQUIRED_MAPPING_KEYS
    .map(key => ({ key, header: mappings[key] }))
    .filter(({ header }) => typeof header === 'string' && header.trim())
    .filter(({ header }) => {
      const original = header.trim()
      const upper = original.toUpperCase()
      return !headerMap.has(original) && !headerMap.has(upper)
    })
    .map(({ key, header }) => `${key} (${header})`)
}

function getColumnIndex(headerMap, header) {
  if (typeof header !== 'string') return null
  const trimmed = header.trim()
  if (!trimmed) return null
  if (headerMap.has(trimmed)) return headerMap.get(trimmed)
  const upper = trimmed.toUpperCase()
  if (headerMap.has(upper)) return headerMap.get(upper)
  return null
}

function isMeaningfulValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (value instanceof Date) return true
  return true
}

function buildRowRecord({
  rowNumber,
  headerMap,
  headerPairs,
  timezone,
  getValue
}) {
  const extracted = {}
  let hasValue = false
  headerPairs.forEach(([key, header]) => {
    if (typeof header !== 'string' || !header.trim()) return
    const col = getColumnIndex(headerMap, header)
    if (!col) return
    const value = getValue(col)
    extracted[key] = value
    if (!hasValue && isMeaningfulValue(value)) {
      hasValue = true
    }
  })

  if (!hasValue) {
    return null
  }

  const userIdRaw = extracted.userId
  const nameRaw = extracted.name
  const timestampRaw = extracted.timestamp
  const typeRaw = extracted.type
  const remarkRaw = extracted.remark

  const identifier = normalizeIdentifier(userIdRaw)
  const name = normalizeIdentifier(nameRaw)
  const action = normalizeAction(typeRaw)
  const timestampResult = parseTimestamp(timestampRaw, timezone)

  return {
    rowNumber,
    identifier,
    name,
    rawUserId: userIdRaw,
    rawName: nameRaw,
    action,
    rawAction: typeRaw,
    timestamp: timestampResult.value,
    timestampError: timestampResult.error,
    rawTimestamp: timestampRaw,
    remark: remarkRaw ?? ''
  }
}

function parseCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result.map(value => (typeof value === 'string' ? value.trim() : value))
}

async function iterateXlsxRecords({ createStream, headerPairs, mappings, timezone, onRow }) {
  const stream = createStream()
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit'
  })

  let processedWorksheet = false
  for await (const worksheetReader of workbookReader) {
    if (processedWorksheet) break
    processedWorksheet = true

    let headerMap = null
    for await (const row of worksheetReader) {
      if (!headerMap) {
        headerMap = buildHeaderMapFromRow(row)
        const missingColumns = findMissingColumns(headerMap, mappings)
        if (missingColumns.length) {
          throw new MissingColumnError(missingColumns)
        }
        continue
      }

      const getValue = col => toPlainCellValue(row.getCell(col))
      const record = buildRowRecord({
        rowNumber: row.number,
        headerMap,
        headerPairs,
        timezone,
        getValue
      })
      if (!record) continue
      // eslint-disable-next-line no-await-in-loop
      await onRow(record)
    }
  }
}

async function iterateCsvRecords({ createStream, headerPairs, mappings, timezone, onRow }) {
  const stream = createStream()
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity })

  let headerMap = null
  let rowNumber = 0
  for await (const line of reader) {
    rowNumber += 1
    if (!headerMap) {
      const headers = parseCsvLine(line)
      headerMap = buildHeaderMapFromValues(headers)
      const missingColumns = findMissingColumns(headerMap, mappings)
      if (missingColumns.length) {
        throw new MissingColumnError(missingColumns)
      }
      continue
    }

    if (!line || !line.trim()) {
      continue
    }

    const values = parseCsvLine(line)
    const getValue = col => {
      const value = values[col - 1]
      if (value === undefined || value === null) return ''
      return typeof value === 'string' ? value : String(value)
    }
    const record = buildRowRecord({
      rowNumber,
      headerMap,
      headerPairs,
      timezone,
      getValue
    })
    if (!record) continue
    // eslint-disable-next-line no-await-in-loop
    await onRow(record)
  }
}

async function iterateRecords({
  createStream,
  isCsv,
  headerPairs,
  mappings,
  timezone,
  onRow
}) {
  if (isCsv) {
    await iterateCsvRecords({ createStream, headerPairs, mappings, timezone, onRow })
    return
  }
  await iterateXlsxRecords({ createStream, headerPairs, mappings, timezone, onRow })
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

  const headerPairs = Object.entries(mappings)
  const isCsv =
    req.file.mimetype === 'text/csv' || req.file.originalname?.toLowerCase().endsWith('.csv')

  const streamFactory = createUploadStreamFactory(req.file.buffer, { isCsv })

  const identifiers = new Set()
  const names = new Set()
  let totalRowsFirstPass = 0
  try {
    await iterateRecords({
      createStream: streamFactory,
      isCsv,
      headerPairs,
      mappings,
      timezone,
      onRow: record => {
        totalRowsFirstPass += 1
        if (record.identifier) {
          identifiers.add(record.identifier)
        }
        if (record.name) {
          names.add(record.name)
        }
      }
    })
  } catch (error) {
    if (error instanceof MissingColumnError) {
      res.status(400).json({
        message: '匯入檔案缺少必要欄位',
        errors: error.columns.map(name => `找不到欄位：${name}`)
      })
      return
    }
    res.status(400).json({ message: '無法讀取匯入檔案', errors: [error.message] })
    return
  }

  if (!totalRowsFirstPass) {
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
  const nameSet = new Set()

  identifiers.forEach(identifier =>
    collectCandidate(identifier, null, {
      employeeIds: employeeIdSet,
      emails: emailSet,
      objectIds: objectIdSet,
      names: nameSet
    })
  )
  names.forEach(name =>
    collectCandidate(name, 'name', {
      employeeIds: employeeIdSet,
      emails: emailSet,
      objectIds: objectIdSet,
      names: nameSet
    })
  )
  mappingEntries.forEach(value => {
    if (!value) return
    if (typeof value === 'string') {
      collectCandidate(value, null, {
        employeeIds: employeeIdSet,
        emails: emailSet,
        objectIds: objectIdSet,
        names: nameSet
      })
      return
    }
    if (typeof value === 'object') {
      if (typeof value._id === 'string') {
        collectCandidate(value._id, '_id', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet,
          names: nameSet
        })
      }
      if (typeof value.id === 'string') {
        collectCandidate(value.id, '_id', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet,
          names: nameSet
        })
      }
      if (typeof value.employeeId === 'string') {
        collectCandidate(value.employeeId, 'employeeId', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet,
          names: nameSet
        })
      }
      if (typeof value.email === 'string') {
        collectCandidate(value.email, 'email', {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet,
          names: nameSet
        })
      }
      if (typeof value.value === 'string') {
        collectCandidate(value.value, null, {
          employeeIds: employeeIdSet,
          emails: emailSet,
          objectIds: objectIdSet,
          names: nameSet
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
  if (nameSet.size) {
    queryConditions.push({ name: { $in: Array.from(nameSet) } })
  }

  let employees = []
  if (queryConditions.length) {
    employees = await Employee.find({ $or: queryConditions })
      .select('_id name email employeeId')
      .lean()
  }
  const employeeMaps = buildEmployeeMaps(employees)

  const missingUserMap = new Map()
  const previewSamples = []
  const uniqueUsers = new Set()
  let readyCount = 0
  let missingCount = 0
  let ignoredCount = 0
  let errorCount = 0
  let importedCount = 0
  let totalRows = 0
  const batchRecords = []

  const flushBatch = async () => {
    if (!batchRecords.length) return
    const toInsert = batchRecords.splice(0, batchRecords.length)
    await AttendanceRecord.insertMany(toInsert)
    importedCount += toInsert.length
  }

  const processRow = async record => {
    totalRows += 1
    if (record.identifier) uniqueUsers.add(record.identifier)

    const timestampIso =
      record.timestamp instanceof Date ? record.timestamp.toISOString() : null

    const sampleEntry = {
      rowNumber: record.rowNumber,
      userId: record.identifier,
      rawUserId: record.rawUserId,
      action: record.action,
      rawAction: record.rawAction,
      timestamp: timestampIso,
      rawTimestamp: record.rawTimestamp,
      remark: record.remark,
      timestampError: record.timestampError ?? null
    }

    const errors = []
    if (!record.identifier) {
      errors.push('缺少 USERID')
    }
    if (!record.timestamp) {
      errors.push(
        record.timestampError
          ? `無法解析 CHECKTIME：${record.timestampError}`
          : '無法解析 CHECKTIME'
      )
    }
    if (!record.action) {
      errors.push('無法判斷 CHECKTYPE')
    }

    if (errors.length) {
      errorCount += 1
      sampleEntry.errors = errors
      sampleEntry.status = 'error'
      console.error('attendance-import: validation failed', {
        rowNumber: record.rowNumber,
        userId: record.identifier || null,
        rawUserId: record.rawUserId ?? null,
        rawAction: record.rawAction ?? null,
        rawTimestamp: record.rawTimestamp ?? null,
        timestampError: record.timestampError ?? null,
        errors
      })
    } else if (ignoreSet.has(record.identifier)) {
      ignoredCount += 1
      sampleEntry.errors = []
      sampleEntry.status = 'ignored'
    } else {
      const mapping = mappingEntries.get(record.identifier)
      const mappedEmployee = resolveMappedEmployee(mapping, employeeMaps)

      if (mappedEmployee === 'ignore') {
        ignoredCount += 1
        sampleEntry.errors = []
        sampleEntry.status = 'ignored'
      } else {
        const employee =
          mappedEmployee ||
          resolveEmployeeByCompositeKey(record.identifier, record.name, employeeMaps)

        if (!employee) {
          missingCount += 1
          sampleEntry.errors = []
          sampleEntry.status = 'missing'
          const missingEntry = missingUserMap.get(record.identifier) || {
            identifier: record.identifier,
            count: 0,
            rows: [],
            samples: []
          }
          missingEntry.count += 1
          missingEntry.rows.push(record.rowNumber)
          if (missingEntry.samples.length < 5) {
            missingEntry.samples.push({
              timestamp: sampleEntry.timestamp,
              action: sampleEntry.action,
              remark: sampleEntry.remark
            })
          }
          missingUserMap.set(record.identifier, missingEntry)
          console.warn('attendance-import: employee not found', {
            rowNumber: record.rowNumber,
            userId: record.identifier,
            rawUserId: record.rawUserId ?? null,
            rawAction: record.rawAction ?? null,
            rawTimestamp: record.rawTimestamp ?? null,
            reason: '找不到對應員工'
          })
        } else {
          readyCount += 1
          sampleEntry.errors = []
          sampleEntry.status = 'ready'
          sampleEntry.employee = {
            _id: String(employee._id),
            name: employee.name || '',
            email: employee.email || '',
            employeeId: employee.employeeId || ''
          }

          if (!dryRun) {
            batchRecords.push({
              employee: employee._id,
              action: record.action,
              timestamp: record.timestamp,
              remark: record.remark ?? ''
            })
            if (batchRecords.length >= INSERT_BATCH_SIZE) {
              await flushBatch()
            }
          }
        }
      }
    }

    if (previewSamples.length < PREVIEW_SAMPLE_LIMIT) {
      previewSamples.push(sampleEntry)
    }
  }

  try {
    await iterateRecords({
      createStream: streamFactory,
      isCsv,
      headerPairs,
      mappings,
      timezone,
      onRow: processRow
    })
  } catch (error) {
    if (error instanceof MissingColumnError) {
      res.status(400).json({
        message: '匯入檔案缺少必要欄位',
        errors: error.columns.map(name => `找不到欄位：${name}`)
      })
      return
    }
    res.status(400).json({ message: '無法讀取匯入檔案', errors: [error.message] })
    return
  }

  if (!totalRows) {
    res.status(400).json({ message: '匯入檔案沒有資料', errors: [] })
    return
  }

  if (!dryRun) {
    await flushBatch()
  }

  const summary = {
    totalRows,
    readyCount,
    missingCount,
    ignoredCount,
    errorCount,
    uniqueUserCount: uniqueUsers.size,
    importedCount: dryRun ? 0 : importedCount
  }

  const response = {
    dryRun,
    timezone,
    summary,
    preview: previewSamples,
    missingUsers: Array.from(missingUserMap.values())
  }

  if (!dryRun) {
    const failureReasons = []
    if (errorCount) {
      failureReasons.push(`${errorCount} 筆資料驗證失敗`)
    }
    if (missingCount) {
      failureReasons.push(`${missingCount} 筆資料缺少對應員工`)
    }
    if (ignoredCount && !readyCount) {
      failureReasons.push(`${ignoredCount} 筆資料被設定為忽略`)
    }
    if (!failureReasons.length && !readyCount) {
      failureReasons.push('沒有任何可匯入的資料')
    }

    if (summary.importedCount === 0) {
      const baseMessage = errorCount > 0 ? '匯入失敗' : '所有資料均未匯入'
      const detail = failureReasons.join('、')
      response.message = detail ? `${baseMessage}：${detail}` : baseMessage
      if (failureReasons.length) {
        response.failureReasons = failureReasons
      }
      const statusCode = errorCount > 0 || readyCount === 0 ? 400 : 200
      res.status(statusCode).json(response)
      return
    }
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
