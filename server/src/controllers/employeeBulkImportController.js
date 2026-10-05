import ExcelJS from 'exceljs'
import mongoose from 'mongoose'
import { Readable } from 'stream'
import Employee from '../models/Employee.js'
import Organization from '../models/Organization.js'
import Department from '../models/Department.js'
import SubDepartment from '../models/SubDepartment.js'
import { buildEmployeeDoc, buildEmployeePatch } from './employeeController.js'

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
  salaryItems: 'salaryItems',
  'annualLeave.totalDays': 'annualLeave_totalDays',
  'annualLeave.usedDays': 'annualLeave_usedDays',
  'annualLeave.accumulatedLeave': 'annualLeave_accumulatedLeave',
  'annualLeave.compensatoryHours': 'annualLeave_compensatoryHours',
  'annualLeave.expiryDate': 'annualLeave_expiryDate',
  laborInsuredSalary: 'laborInsuredSalary',
  pensionInsuredSalary: 'pensionInsuredSalary',
  healthInsuredSalary: 'healthInsuredSalary',
  dependentCount: 'dependentCount'
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
  'reDismissDate',
  'annualLeave.expiryDate'
])
const NUMBER_FIELDS = new Set([
  'probationDays',
  'dependents',
  'salaryAmount',
  'laborPensionSelf',
  'employeeAdvance',
  'graduationYear',
  'dischargeYear',
  'annualLeave.totalDays',
  'annualLeave.usedDays',
  'annualLeave.accumulatedLeave',
  'annualLeave.compensatoryHours',
  'laborInsuredSalary',
  'pensionInsuredSalary',
  'healthInsuredSalary',
  'dependentCount'
])
const CSV_ARRAY_FIELDS = new Set(['languages', 'identityCategory', 'salaryItems'])

// 這幾個欄位是後來才加進範本的：舊版檔案沒有也不該讓整批匯入失敗。
const OPTIONAL_COLUMN_KEYS = new Set([
  'annualLeave.totalDays',
  'annualLeave.usedDays',
  'annualLeave.accumulatedLeave',
  'annualLeave.compensatoryHours',
  'annualLeave.expiryDate',
  'laborInsuredSalary',
  'pensionInsuredSalary',
  'healthInsuredSalary',
  'dependentCount'
])

// 客戶實際拿到的 Excel，第 1 列是英文欄位名，但後加的欄位只有第 2 列的中文說明。
// 第 1 列找不到對應欄位時，改用第 2 列的中文名稱比對，客戶不必自己改表頭。
const HEADER_LABEL_FALLBACKS = Object.freeze({
  annualLeave_totalDays: ['年度特休總天數'],
  annualLeave_usedDays: ['已使用天數'],
  annualLeave_accumulatedLeave: ['積假'],
  annualLeave_expiryDate: ['請假期限'],
  annualLeave_compensatoryHours: ['補休時數'],
  laborInsuredSalary: ['勞保投保薪資'],
  pensionInsuredSalary: ['勞退投保薪資'],
  healthInsuredSalary: ['健保投保薪資'],
  dependentCount: ['眷口數']
})

const NUMBER_FIELD_LABELS = Object.freeze({
  'annualLeave.totalDays': '年度特休總天數',
  'annualLeave.usedDays': '已使用天數',
  'annualLeave.accumulatedLeave': '積假',
  'annualLeave.compensatoryHours': '補休時數',
  laborInsuredSalary: '勞保投保薪資',
  pensionInsuredSalary: '勞退投保薪資',
  healthInsuredSalary: '健保投保薪資',
  dependentCount: '眷口數',
  salaryAmount: '薪資金額',
  laborPensionSelf: '自提勞退',
  employeeAdvance: '員工墊付金額'
})

// 「3國」這種數字後面帶單位/備註的欄位，取前面的數字，並在結果提醒使用者確認。
const NUMBER_WITH_SUFFIX_FIELDS = new Set(['annualLeave.accumulatedLeave'])

// 更新既有員工時，不會被檔案內容覆蓋的欄位（帳號、權限、登入識別）。
const UPDATE_EXCLUDED_KEYS = new Set(['role', 'username', 'password', 'email', 'employeeNo'])

const REFERENCE_KEYS = ['organization', 'department', 'subDepartment', 'supervisor']

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
  },
  supervisor: {
    Model: Employee,
    aliasFields: ['name', 'employeeId', 'employeeNo'],
    select: '_id name employeeId employeeNo'
  }
}

const REFERENCE_LABELS = {
  organization: '機構',
  department: '部門',
  subDepartment: '子部門',
  supervisor: '主管'
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
    subDepartment: new Map(),
    supervisor: new Map()
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

function buildSubDepartmentAliasLookup(docs, departmentId, context = {}) {
  if (!departmentId) {
    return null
  }

  const filtered = Array.isArray(docs)
    ? docs.filter(doc => doc?.department?.toString?.() === departmentId)
    : []

  return {
    aliasMap: buildReferenceAliasMap(filtered, REFERENCE_CONFIGS.subDepartment.aliasFields),
    options: buildReferenceOptions('subDepartment', filtered, context)
  }
}

function buildSubDepartmentResolutionKey(normalizedValue, departmentId) {
  return departmentId ? `${normalizedValue}::${departmentId}` : normalizedValue
}

function toIdString(id) {
  return typeof id === 'string'
    ? id
    : (id && typeof id.toString === 'function')
      ? id.toString()
      : ''
}

function buildReferenceOptions(type, docs, context = {}) {
  if (!Array.isArray(docs)) return []
  const organizationMap = context.organizationMap || new Map()
  const departmentMap = context.departmentMap || new Map()
  if (type === 'organization') {
    return docs.map(doc => ({
      id: toIdString(doc?._id),
      name: doc?.name ?? '',
      unitName: doc?.unitName ?? '',
      systemCode: doc?.systemCode ?? '',
      orgCode: doc?.orgCode ?? ''
    }))
  }
  if (type === 'department') {
    return docs.map(doc => ({
      id: toIdString(doc?._id),
      name: doc?.name ?? '',
      code: doc?.code ?? '',
      organization: (() => {
        const orgId = toIdString(doc?.organization)
        return orgId
      })(),
      organizationName: (() => {
        const orgId = toIdString(doc?.organization)
        return organizationMap.get(orgId)?.name ?? ''
      })(),
      organizationUnitName: (() => {
        const orgId = toIdString(doc?.organization)
        return organizationMap.get(orgId)?.unitName ?? ''
      })(),
      organizationCode: (() => {
        const orgId = toIdString(doc?.organization)
        return organizationMap.get(orgId)?.orgCode ?? ''
      })()
    }))
  }
  if (type === 'subDepartment') {
    return docs.map(doc => ({
      id: toIdString(doc?._id),
      name: doc?.name ?? '',
      code: doc?.code ?? '',
      department: (() => {
        const deptId = toIdString(doc?.department)
        return deptId
      })(),
      departmentName: (() => {
        const deptId = toIdString(doc?.department)
        return departmentMap.get(deptId)?.name ?? ''
      })(),
      departmentCode: (() => {
        const deptId = toIdString(doc?.department)
        return departmentMap.get(deptId)?.code ?? ''
      })(),
      organization: (() => {
        const deptId = toIdString(doc?.department)
        return departmentMap.get(deptId)?.organization ?? ''
      })(),
      organizationName: (() => {
        const deptId = toIdString(doc?.department)
        const orgId = departmentMap.get(deptId)?.organization
        return orgId ? organizationMap.get(orgId)?.name ?? '' : ''
      })(),
      organizationUnitName: (() => {
        const deptId = toIdString(doc?.department)
        const orgId = departmentMap.get(deptId)?.organization
        return orgId ? organizationMap.get(orgId)?.unitName ?? '' : ''
      })(),
      organizationCode: (() => {
        const deptId = toIdString(doc?.department)
        const orgId = departmentMap.get(deptId)?.organization
        return orgId ? organizationMap.get(orgId)?.orgCode ?? '' : ''
      })()
    }))
  }
  if (type === 'supervisor') {
    return docs.map(doc => ({
      id: doc?._id?.toString?.() ?? '',
      name: doc?.name ?? '',
      employeeId: doc?.employeeId ?? doc?.employeeNo ?? ''
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

// 民國年日期，例如 091/12/01、60/10/1、115年9月1日。年份 3 位數以內才視為民國年，
// 4 位數仍走西元年。不先處理的話 `new Date('091/12/01')` 會被當成西元 91 年。
const ROC_DATE_REGEX = /^(\d{1,3})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?$/

function parseRocDate(text) {
  const match = ROC_DATE_REGEX.exec(text)
  if (!match) return undefined
  const year = Number(match[1]) + 1911
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined
  }
  return date
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
    if (ROC_DATE_REGEX.test(trimmed)) return parseRocDate(trimmed)
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

function toNumberValue(value, { allowSuffix = false } = {}) {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value
  const text = String(value).trim().replace(/,/g, '')
  if (!text) return undefined
  const num = Number(text)
  if (!Number.isNaN(num)) return num
  if (allowSuffix) {
    const match = /^(-?\d+(?:\.\d+)?)\s*\D+$/.exec(text)
    if (match) return Number(match[1])
  }
  return undefined
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
  if (typeof row.employeeNo === 'string' && row.employeeNo.trim()) {
    return row.employeeNo.trim()
  }
  if (typeof row.email === 'string' && row.email.includes('@')) {
    return row.email.split('@')[0].trim()
  }
  if (typeof row.username === 'string' && row.username.trim()) {
    return row.username.trim()
  }
  return ''
}

// 範本的「自提勞退 (%)」填的是比例（0.06 = 6%），但系統的 laborPensionSelf 是每月扣款金額，
// 薪資計算時直接加進扣款合計。0~1 之間的值視為比例，依勞退投保薪資換算成金額，
// 找不到可換算的基準時寧可略過，也不要把 0.06 元當成扣款寫進去。
function convertPensionSelfRate(normalized, rowNumber, warnings) {
  const rate = normalized.laborPensionSelf
  if (typeof rate !== 'number' || !(rate > 0 && rate <= 1)) return
  const base = [
    normalized.pensionInsuredSalary,
    normalized.laborInsuredSalary,
    normalized.salaryAmount
  ].find(value => typeof value === 'number' && value > 0)
  if (!base) {
    delete normalized.laborPensionSelf
    warnings.push(`第 ${rowNumber} 列「自提勞退」${rate} 視為比例，但沒有可換算的投保薪資或薪資金額，已略過`)
    return
  }
  const amount = Math.round(base * rate)
  normalized.laborPensionSelf = amount
  warnings.push(
    `第 ${rowNumber} 列「自提勞退」${rate} 視為 ${Math.round(rate * 10000) / 100}%，以 ${base} 換算為每月 ${amount} 元`
  )
}

function isBlankImportValue(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

// 更新既有員工時，只帶檔案裡「有填」的欄位：空白儲存格代表「沒資料」，不能把系統裡的值洗掉。
function pruneBlankValues(source) {
  const result = {}
  Object.entries(source).forEach(([key, value]) => {
    if (isBlankImportValue(value)) return
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const nested = pruneBlankValues(value)
      if (Object.keys(nested).length) result[key] = nested
      return
    }
    result[key] = value
  })
  return result
}

function buildUpdateBody(normalized) {
  const body = {}
  Object.entries(normalized).forEach(([key, value]) => {
    if (UPDATE_EXCLUDED_KEYS.has(key)) return
    body[key] = value
  })
  return pruneBlankValues(body)
}

const DEFAULT_CREDENTIAL_RULE = Object.freeze({
  username: '帳號優先使用員工編號，缺少時依序以 Email 帳號前綴或手動輸入帳號填入',
  password: '預設密碼為身分證號（idNumber），缺少時將中止匯入'
})

function createPreview(row) {
  return {
    action: row.action ?? 'created',
    employeeNo: row.employeeNo ?? '',
    name: row.name ?? '',
    department: row.department ?? '',
    role: row.role ?? '',
    email: row.email ?? '',
    username: row.username ?? '',
    initialPassword: row.initialPassword ?? ''
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
  const updateExisting = options?.updateExisting === true || options?.updateExisting === 'true'

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
  const labelMap = new Map()
  if (hasChineseHeaderHints(secondRow)) {
    headerRowsToSkip.add(2)
    secondRow.eachCell((cell, colNumber) => {
      const value = toPlainCellValue(cell)
      if (typeof value === 'string' && value.trim() && !labelMap.has(value.trim())) {
        labelMap.set(value.trim(), colNumber)
      }
    })
  }

  const resolveColumn = header => {
    const name = header.trim()
    const direct = headerMap.get(name)
    if (direct) return direct
    const labels = HEADER_LABEL_FALLBACKS[name]
    if (labels) {
      for (const label of labels) {
        const col = labelMap.get(label)
        if (col) return col
      }
    }
    return undefined
  }

  const missingColumns = Object.entries(columnMappings)
    .filter(([, header]) => typeof header === 'string' && header.trim())
    .filter(([key, header]) => !resolveColumn(header) && !OPTIONAL_COLUMN_KEYS.has(key))
    .map(([key, header]) => `${key} (${header})`)

  if (missingColumns.length) {
    res.status(400).json({
      message: '匯入檔案缺少必要欄位',
      errors: missingColumns.map(col => `找不到對應欄位：${col}`)
    })
    return
  }

  const parsedRows = []
  const warnings = []
  // actualRowCount 只算「有內容的列數」，中間有空白列時會比最後一列的編號小，
  // 拿來當迴圈上限會把檔案尾端的資料整段漏掉，所以改用 rowCount（最後一列的編號）。
  const maxRow = Math.max(worksheet.rowCount || 0, worksheet.actualRowCount || 0)
  for (let index = 2; index <= maxRow; index += 1) {
    if (headerRowsToSkip.has(index)) continue
    const row = worksheet.getRow(index)
    if (!row || row.cellCount === 0) continue

    const original = {}
    const normalized = {}
    let hasData = false

    Object.entries(columnMappings).forEach(([key, header]) => {
      if (typeof header !== 'string' || !header.trim()) return
      const col = resolveColumn(header)
      if (!col) return
      const cellValue = toPlainCellValue(row.getCell(col))
      if (cellValue !== '' && cellValue !== null && cellValue !== undefined) {
        hasData = true
      }
      setPathValue(original, key, cellValue)

      const baseKey = key.split('.')[0]
      // 大多數欄位以 baseKey（第一段）判斷型別即可，但像 annualLeave 這種同一個
      // 群組底下混合數字（totalDays 等）與日期（expiryDate）子欄位的情況，
      // baseKey 無法區分，因此優先比對完整的 key（例如 'annualLeave.expiryDate'）。
      const matchesType = (set) => set.has(key) || set.has(baseKey)

      if (matchesType(BOOLEAN_FIELDS)) {
        const boolValue = toBoolean(cellValue)
        if (typeof boolValue === 'boolean') {
          setPathValue(normalized, key, boolValue)
        }
        return
      }

      if (matchesType(DATE_FIELDS)) {
        const dateValue = toDateValue(cellValue)
        if (dateValue) {
          setPathValue(normalized, key, dateValue)
        } else if (typeof cellValue === 'string' && cellValue.trim()) {
          setPathValue(normalized, key, cellValue.trim())
        }
        return
      }

      if (matchesType(NUMBER_FIELDS)) {
        const allowSuffix = NUMBER_WITH_SUFFIX_FIELDS.has(key)
        const numberValue = toNumberValue(cellValue, { allowSuffix })
        if (numberValue !== undefined) {
          setPathValue(normalized, key, numberValue)
          if (allowSuffix && typeof cellValue === 'string' && String(numberValue) !== cellValue.trim()) {
            warnings.push(
              `第 ${index} 列「${NUMBER_FIELD_LABELS[key] || key}」的值「${cellValue}」已取數字 ${numberValue}，請確認`
            )
          }
        } else if (typeof cellValue === 'string' && cellValue.trim()) {
          warnings.push(
            `第 ${index} 列「${NUMBER_FIELD_LABELS[key] || key}」的值「${cellValue}」不是數字，已略過`
          )
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
    convertPensionSelfRate(normalized, index, warnings)

    parsedRows.push({
      rowNumber: index,
      original,
      normalized,
      errors: [],
      // 先配好 _id，讓同一份檔案裡的員工可以互相指定為主管（主管本人可能也在這次匯入的檔案內）。
      newId: new mongoose.Types.ObjectId(),
      existing: null
    })
  }

  if (!parsedRows.length) {
    res.status(400).json({ message: '匯入檔案沒有資料', errors: [] })
    return
  }

  const rowByNumber = new Map(parsedRows.map(row => [row.rowNumber, row]))
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

  const referenceTypeSet = new Set(requiredReferenceTypes)
  if (referenceTypeSet.has('department') || referenceTypeSet.has('subDepartment')) {
    referenceTypeSet.add('organization')
  }
  if (referenceTypeSet.has('subDepartment')) {
    referenceTypeSet.add('department')
  }

  const fetchOrder = ['organization', 'department', 'subDepartment', 'supervisor']
    .filter(type => referenceTypeSet.has(type))

  const organizationMap = new Map()
  const departmentMap = new Map()

  const referenceLookups = {}
  for (const type of fetchOrder) {
    const config = REFERENCE_CONFIGS[type]
    try {
      const docs = await config.Model.find({}, config.select).lean()
      if (type === 'organization') {
        docs.forEach(doc => {
          const id = toIdString(doc?._id)
          if (id) organizationMap.set(id, doc)
        })
      }
      if (type === 'department') {
        docs.forEach(doc => {
          const id = toIdString(doc?._id)
          if (!id) return
          const organizationId = toIdString(doc?.organization)
          departmentMap.set(id, { ...doc, organization: organizationId })
        })
      }
      const aliasMap = buildReferenceAliasMap(docs, config.aliasFields)
      if (type === 'supervisor') {
        // 主管常常也在同一份檔案裡（還沒建立，資料庫查不到）。
        // 資料庫已有的人優先，沒有的才用這次檔案裡預先配好 _id 的員工。
        parsedRows.forEach(row => {
          const employeeNo = row.normalized.employeeNo
          const key = normalizeReferenceKey(employeeNo)
          if (!key || aliasMap.has(key)) return
          aliasMap.set(key, { _id: row.newId, name: row.normalized.name, employeeId: String(employeeNo) })
        })
      }
      referenceLookups[type] = {
        docs,
        aliasMap,
        options: buildReferenceOptions(type, docs, { organizationMap, departmentMap })
      }
    } catch (error) {
      const label = REFERENCE_LABELS[type] || type
      res.status(500).json({ message: `查詢${label}資料失敗`, error: error.message })
      return
    }
  }
  const referenceOptionContext = { organizationMap, departmentMap }

  const resolutionMaps = {
    organization: new Map(),
    department: new Map(),
    subDepartment: new Map(),
    supervisor: new Map()
  }
  const missingReferences = {}
  const invalidMappings = []
  const invalidMessageSet = new Set()

  REFERENCE_KEYS.forEach(type => {
    const usageMap = referenceUsage[type]
    if (!usageMap.size && !mappingMaps[type].size && !ignoreSets[type].size) return
    const lookup = referenceLookups[type] || { aliasMap: new Map(), options: [] }
    const pendingMap = new Map()
    const optionMap = new Map()

    const getDepartmentIdForRow = row => {
      const normalizedDepartment = normalizeReferenceKey(getPathValue(row?.original, 'department'))
      if (!normalizedDepartment) return null
      const departmentResolution = resolutionMaps.department.get(normalizedDepartment)
      if (!departmentResolution) return null
      if (departmentResolution.status === 'ignored') return null
      return typeof departmentResolution.resolved === 'string' && departmentResolution.resolved
        ? departmentResolution.resolved
        : null
    }

    if (type === 'subDepartment') {
      usageMap.forEach(entry => {
        const normalizedValue = entry.normalizedValue
        if (!normalizedValue) return

        entry.rows.forEach(rowNumber => {
          const row = rowByNumber.get(rowNumber)
          if (!row) return
          const departmentId = getDepartmentIdForRow(row)
          const departmentLookup = buildSubDepartmentAliasLookup(lookup.docs, departmentId)
          const departmentAliasMap = departmentLookup?.aliasMap
          const hasDepartmentAlias = departmentAliasMap && departmentAliasMap.size > 0
          const options =
            (departmentLookup?.options?.length ? departmentLookup.options : lookup.options) || []
          const resolveSubDepartment = targetValue => {
            const normalizedTarget = normalizeReferenceKey(targetValue)
            if (!normalizedTarget) return null
            if (hasDepartmentAlias) {
              const doc = departmentAliasMap.get(normalizedTarget)
              if (doc) return doc
            }
            return lookup.aliasMap.get(normalizedTarget)
          }
          const resolutionKey = buildSubDepartmentResolutionKey(normalizedValue, departmentId)

          if (options.length) {
            options.forEach(option => {
              if (option?.id && !optionMap.has(option.id)) {
                optionMap.set(option.id, option)
              }
            })
          }

          if (ignoreSets[type].has(normalizedValue)) {
            resolutionMaps[type].set(resolutionKey, { status: 'ignored', resolved: null })
            return
          }

          if (mappingMaps[type].has(normalizedValue)) {
            const target = mappingMaps[type].get(normalizedValue)
            if (target === null) {
              resolutionMaps[type].set(resolutionKey, { status: 'ignored', resolved: null })
              return
            }
            const targetDoc = resolveSubDepartment(target)
            if (!targetDoc) {
              const message = `valueMappings.${type} 中的「${entry.value}」沒有對應到有效項目`
              if (!invalidMessageSet.has(message)) {
                invalidMessageSet.add(message)
                invalidMappings.push(message)
              }
              resolutionMaps[type].set(resolutionKey, { status: 'invalid' })
            } else {
              resolutionMaps[type].set(resolutionKey, {
                status: 'mapped',
                resolved: targetDoc._id?.toString?.() ?? ''
              })
            }
            return
          }

          const autoDoc = resolveSubDepartment(normalizedValue)
          if (autoDoc) {
            resolutionMaps[type].set(resolutionKey, {
              status: 'auto',
              resolved: autoDoc._id?.toString?.() ?? ''
            })
          } else {
            const existing = pendingMap.get(resolutionKey)
            if (existing) {
              existing.rows.push(rowNumber)
            } else {
              pendingMap.set(resolutionKey, {
                value: entry.value,
                normalizedValue: entry.normalizedValue,
                rows: [rowNumber]
              })
            }
            resolutionMaps[type].set(resolutionKey, { status: 'missing' })
          }
        })
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

      if (pendingMap.size) {
        missingReferences[type] = {
          values: Array.from(pendingMap.values()).map(pending => ({
            ...pending,
            rows: pending.rows.sort((a, b) => a - b)
          })),
          options: Array.from(optionMap.values())
        }
      }

      return
    }

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
      message: '匯入資料存在未對應的組織、部門或主管資訊，請完成對應後重新提交',
      missingReferences,
      errors: []
    })
    return
  }

  parsedRows.forEach(row => {
    REFERENCE_KEYS.forEach(key => {
      const normalizedValue = normalizeReferenceKey(getPathValue(row.original, key))
      if (!normalizedValue) return
      if (key === 'supervisor' && normalizedValue === normalizeReferenceKey(row.normalized.employeeNo)) {
        // 「主管員工 ID」填成自己（多半是標示「我是這個單位的主管帳號」），
        // 若照存會變成自己簽自己，請假流程也會卡住，所以不設定直屬主管。
        delete row.normalized.supervisor
        warnings.push(`第 ${row.rowNumber} 列的主管員工 ID 與本人相同，已不設定直屬主管`)
        return
      }
      let resolutionKey = normalizedValue
      if (key === 'subDepartment') {
        const normalizedDepartment = normalizeReferenceKey(getPathValue(row.original, 'department'))
        const departmentResolution = resolutionMaps.department.get(normalizedDepartment)
        const departmentId = departmentResolution && departmentResolution.status !== 'ignored'
          ? departmentResolution.resolved
          : null
        resolutionKey = buildSubDepartmentResolutionKey(normalizedValue, departmentId)
      }
      const resolution = resolutionMaps[key].get(resolutionKey)
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

  // 這份檔案裡被別人填成「主管員工 ID」的員工編號。主管帳號常常是跟著同一份檔案一起匯入，
  // 如果都以預設權限（員工）建立，之後在員工資料的直屬主管下拉選單會找不到他們。
  const referencedSupervisorKeys = new Set()
  parsedRows.forEach(row => {
    const key = normalizeReferenceKey(getPathValue(row.original, 'supervisor'))
    if (key && key !== normalizeReferenceKey(row.normalized.employeeNo)) {
      referencedSupervisorKeys.add(key)
    }
  })

  parsedRows.forEach(row => {
    if (!row.normalized.role) {
      const promote = defaultRole === 'employee' &&
        referencedSupervisorKeys.has(normalizeReferenceKey(row.normalized.employeeNo))
      row.normalized.role = promote ? 'supervisor' : defaultRole
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

    if (!row.normalized.idNumber || String(row.normalized.idNumber).trim() === '') {
      row.errors.push('缺少身分證號')
    }

    if (!row.normalized.name || String(row.normalized.name).trim() === '') {
      row.errors.push('缺少姓名')
    }

    if (!VALID_ROLES.includes(row.normalized.role)) {
      row.errors.push('權限設定不正確')
    }
  })

  parsedRows.forEach(row => {
    const username = deriveUsername(row.normalized)
    if (username) {
      row.normalized.username = username
    } else {
      row.errors.push('缺少帳號或 Email')
    }
  })

  let existingEmails = []
  if (emailCandidates.size) {
    try {
      const emailList = Array.from(emailCandidates)
      existingEmails = await Employee.find({ email: { $in: emailList } }, 'email employeeId')
    } catch (error) {
      res.status(500).json({ message: '檢查既有 Email 失敗', error: error.message })
      return
    }
  }

  const employeeNoList = Array.from(new Set(
    parsedRows
      .map(row => String(row.normalized.employeeNo ?? '').trim())
      .filter(Boolean)
  ))
  let existingByNo = []
  if (employeeNoList.length) {
    try {
      const found = await Employee.find(
        { employeeId: { $in: employeeNoList } },
        '_id employeeId email emergencyContacts salaryItems'
      )
      existingByNo = (found || []).map(doc => (typeof doc?.toObject === 'function' ? doc.toObject() : doc))
    } catch (error) {
      res.status(500).json({ message: '檢查既有員工編號失敗', error: error.message })
      return
    }
  }

  const existingEmailMap = new Map(
    (existingEmails || []).map(doc => [normalizeEmail(doc.email), doc])
  )
  const existingNoMap = new Map(
    (existingByNo || [])
      .map(doc => [String(doc?.employeeId ?? doc?.employeeNo ?? '').trim(), doc])
      .filter(([no]) => no)
  )
  const idOf = doc => (doc?._id === undefined || doc?._id === null ? '' : String(doc._id))

  parsedRows.forEach(row => {
    const email = normalizeEmail(row.normalized.email ?? row.original.email)
    const employeeNo = String(row.normalized.employeeNo ?? '').trim()
    const byEmail = email ? existingEmailMap.get(email) : undefined
    const byNo = employeeNo ? existingNoMap.get(employeeNo) : undefined

    if (!updateExisting) {
      if (byEmail) row.errors.push('Email 已存在（若要更新既有員工的資料，請勾選「更新已存在的員工資料」）')
      else if (byNo) row.errors.push('員工編號已存在（若要更新既有員工的資料，請勾選「更新已存在的員工資料」）')
      return
    }

    if (byNo && byEmail && idOf(byNo) && idOf(byEmail) && idOf(byNo) !== idOf(byEmail)) {
      row.errors.push('Email 已被另一位員工使用，無法更新')
      return
    }
    // 以員工編號為主要依據；系統裡的員工編號對不上時，才退而用 Email 比對。
    const matched = byNo || byEmail
    if (matched) {
      row.existing = {
        _id: matched._id,
        employeeId: matched.employeeId,
        emergencyContacts: matched.emergencyContacts,
        salaryItems: matched.salaryItems
      }
    }
  })

  const errorRows = parsedRows.filter(row => row.errors.length)
  if (errorRows.length) {
    const firstErrorRow = errorRows[0]
    const MAX_REPORTED_ERRORS = 20
    const reportedRows = errorRows.slice(0, MAX_REPORTED_ERRORS)
    const errors = reportedRows.map(row => formatRowError(row.rowNumber, row.errors))
    if (errorRows.length > reportedRows.length) {
      errors.push(`其餘 ${errorRows.length - reportedRows.length} 列也有問題，請先修正以上錯誤後重試`)
    }
    res.status(400).json({
      message: `第 ${firstErrorRow.rowNumber} 列資料有誤，已停止匯入`,
      errors,
      rowNumber: firstErrorRow.rowNumber
    })
    return
  }

  const preparedRows = []
  const updateRows = []
  for (const row of parsedRows) {
    if (row.existing) {
      const updateBody = buildUpdateBody(row.normalized)
      const patch = buildEmployeePatch(updateBody, row.existing)
      if (Array.isArray(patch.$set.emergencyContacts)) {
        patch.$set.emergencyContacts = patch.$set.emergencyContacts.filter(Boolean)
      }
      const update = {}
      if (Object.keys(patch.$set).length) update.$set = patch.$set
      if (Object.keys(patch.$unset).length) update.$unset = patch.$unset
      updateRows.push({
        rowNumber: row.rowNumber,
        id: row.existing._id,
        update,
        fallbackBody: row.normalized
      })
      continue
    }

    const password = resetPassword || String(row.normalized.idNumber).trim()
    const body = {
      ...row.normalized,
      email: row.normalized.email,
      username: row.normalized.username
    }

    const employeeDoc = buildEmployeeDoc(body)
    employeeDoc.password = password
    employeeDoc._id = row.newId

    try {
      const modelInstance = new Employee(employeeDoc)
      await modelInstance.validate()
      preparedRows.push({
        doc: modelInstance.toObject(),
        rowNumber: row.rowNumber,
        initialPassword: password,
        fallbackBody: body
      })
    } catch (validationError) {
      const formattedError = formatRowError(row.rowNumber, validationError.message)
      res.status(400).json({
        message: `第 ${row.rowNumber} 列資料寫入失敗，已停止匯入`,
        errors: [formattedError],
        rowNumber: row.rowNumber
      })
      return
    }
  }

  const createdIds = []
  let session = null
  let usingTransaction = false
  let transactionUnavailable = false

  try {
    if (typeof Employee.startSession === 'function') {
      session = await Employee.startSession()
      if (session && typeof session.startTransaction === 'function') {
        await session.startTransaction()
        usingTransaction = true
      } else {
        session = null
        transactionUnavailable = true
      }
    } else {
      transactionUnavailable = true
    }

    const insertOptions = {
      ordered: true,
      runValidators: false
    }
    if (usingTransaction && session) {
      insertOptions.session = session
    }

    const createdDocs = preparedRows.length
      ? await Employee.insertMany(preparedRows.map(row => row.doc), insertOptions)
      : []
    createdIds.push(...createdDocs.map(doc => doc?._id).filter(Boolean))
    const preview = createdDocs.map((created, index) => {
      const prepared = preparedRows[index]
      return createPreview({
        action: 'created',
        employeeNo: created.employeeId || created.employeeNo || prepared.fallbackBody.employeeNo,
        name: created.name,
        department: created.department || prepared.fallbackBody.department,
        role: created.role || prepared.fallbackBody.role,
        email: created.email,
        username: created.username || prepared.fallbackBody.username,
        initialPassword: prepared.initialPassword
      })
    })

    // 先新增、後更新：新增比較可能因為資料問題失敗，失敗時既有員工的資料還沒被動到。
    let currentUpdate = null
    try {
      for (const item of updateRows) {
        currentUpdate = item
        if (!item.update.$set && !item.update.$unset) {
          currentUpdate = null
          continue
        }
        await Employee.updateOne(
          { _id: item.id },
          item.update,
          usingTransaction && session ? { session } : undefined
        )
        currentUpdate = null
      }
    } catch (updateError) {
      updateError.failedUpdateRow = currentUpdate?.rowNumber
      throw updateError
    }
    updateRows.forEach(item => {
      preview.push(createPreview({
        action: 'updated',
        employeeNo: item.fallbackBody.employeeNo,
        name: item.fallbackBody.name,
        department: item.fallbackBody.department,
        role: '',
        email: item.fallbackBody.email,
        username: item.fallbackBody.username,
        initialPassword: ''
      }))
    })

    if (usingTransaction && session && typeof session.commitTransaction === 'function') {
      await session.commitTransaction()
    }

    res.status(200).json({
      successCount: preparedRows.length + updateRows.length,
      createdCount: preparedRows.length,
      updatedCount: updateRows.length,
      failureCount: 0,
      preview,
      warnings,
      errors: [],
      credentialRule: DEFAULT_CREDENTIAL_RULE
    })
  } catch (error) {
    if (usingTransaction && session && typeof session.abortTransaction === 'function') {
      await session.abortTransaction()
    }

    if (!usingTransaction) {
      if (Array.isArray(error?.insertedDocs)) {
        createdIds.push(...error.insertedDocs.map(doc => doc._id).filter(Boolean))
      }
      const resultInsertedIds = error?.result?.result?.insertedIds
      if (resultInsertedIds && typeof resultInsertedIds === 'object') {
        createdIds.push(...Object.values(resultInsertedIds).filter(Boolean))
      }
      if (createdIds.length) {
        await Employee.deleteMany({ _id: { $in: createdIds } })
      }
    }

    const failureIndex = Array.isArray(error?.insertedDocs) ? error.insertedDocs.length : null
    const failedRowNumber = typeof error?.failedUpdateRow === 'number'
      ? error.failedUpdateRow
      : typeof failureIndex === 'number' && preparedRows[failureIndex]
        ? preparedRows[failureIndex].rowNumber
        : null

    const formattedError = failedRowNumber
      ? formatRowError(failedRowNumber, error.message)
      : error.message

    const transactionWarning = transactionUnavailable
      ? '；環境不支援交易，無法保證全有全無'
      : ''
    const message = failedRowNumber
      ? `第 ${failedRowNumber} 列資料寫入失敗，已停止匯入${transactionWarning}`
      : transactionUnavailable
        ? '環境不支援交易，無法保證全有全無'
        : '匯入資料寫入失敗'

    res.status(400).json({
      message,
      errors: [formattedError],
      rowNumber: failedRowNumber || undefined
    })
  } finally {
    if (session && typeof session.endSession === 'function') {
      await session.endSession()
    }
  }
}

export default bulkImportEmployees
