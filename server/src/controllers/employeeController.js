// backend/controllers/employeeController.js
import Employee from '../models/Employee.js'   // ← 對齊你新的 model 檔名
import ShiftSchedule from '../models/ShiftSchedule.js'
import ApprovalRequest from '../models/approval_request.js'
import dayjs from 'dayjs'
import mongoose from 'mongoose'
import { getAllLeaveFieldInfos } from '../services/leaveFieldService.js'
import {
  deleteEmployeePhoto,
  isManagedEmployeePhotoPath,
  readEmployeePhoto,
} from '../services/employeePhotoStorage.js'

/* ───────────────────────────── 小工具：型別轉換 ───────────────────────────── */
const isDefined = (v) => v !== undefined
const toDate = (v) => {
  if (v === '' || v === null || v === undefined) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}
const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}
const toArray = (v) => {
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v
  if (v === '' || v === null) return []
  return [v]
}
const toStr = (v) => (v === '' || v === null || v === undefined ? '' : String(v))
const firstOr = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr[0] : fallback)

const normalizeSalaryItemAmounts = (map = {}, salaryItems = []) => {
  const selected = (Array.isArray(salaryItems) ? salaryItems : [salaryItems])
    .map(toStr)
    .filter(Boolean)
  const source = map && typeof map === 'object' ? map : {}
  return selected.reduce((acc, key) => {
    const num = toNum(source[key])
    acc[key] = num ?? 0
    return acc
  }, {})
}

// 專用於 enum 欄位的值檢查
function sanitizeEnum(value, allowed) {
  if (value === '' || value === null || value === undefined) return undefined
  return allowed.includes(value) ? value : undefined
}

function extractUploadUrl(item) {
  if (!item) return undefined
  if (typeof item === 'string') return item
  if (typeof item === 'object') {
    if (item.url) return item.url
    const response = item.response
    if (typeof response === 'string') return response
    if (response && typeof response === 'object') {
      if (response.url) return response.url
      if (response.data && typeof response.data === 'object' && response.data.url) {
        return response.data.url
      }
    }
  }
  return undefined
}

function normalizeUploadList(list) {
  if (!Array.isArray(list)) {
    const single = extractUploadUrl(list)
    return single ? [single] : []
  }
  return list.map(extractUploadUrl).filter((url) => typeof url === 'string' && url)
}

const MARITAL_STATUSES = ['已婚', '未婚', '離婚', '喪偶']
const EMPLOYMENT_STATUSES = ['正職員工', '試用期員工', '離職員工', '留職停薪']
const BLOOD_TYPES = ['A', 'B', 'O', 'AB', 'HR']
const GRADUATION_STATUSES = ['畢業', '肄業']

/* 把前端送來的 experiences/licenses/trainings 正規化成模型想要的形狀 */
function normalizeExperiences(list) {
  if (!Array.isArray(list)) return undefined
  return list.map((x = {}) => ({
    unit: x.unit ?? x.organization ?? '',
    title: x.title ?? '',
    start: toDate(x.start),
    end: toDate(x.end),
  }))
}
function normalizeLicenses(list) {
  if (!Array.isArray(list)) return undefined
  return list.map((x = {}) => {
    const fileList = normalizeUploadList(x.fileList ?? x.files ?? (x.file ? [x.file] : []))
    return {
      name: x.name ?? '',
      number: x.number ?? '',
      startDate: toDate(x.startDate ?? x.issueDate),
      endDate: toDate(x.endDate ?? x.expiryDate),
      // 前端 el-upload 習慣 fileList；model 以 alias 對應到 files
      fileList,
      file: extractUploadUrl(x.file) ?? firstOr(fileList, undefined), // 相容舊資料
    }
  })
}
function normalizeTrainings(list) {
  if (!Array.isArray(list)) return undefined
  return list.map((x = {}) => {
    const fileList = normalizeUploadList(x.fileList ?? x.files ?? (x.file ? [x.file] : []))
    return {
      course: x.course ?? x.name ?? '',
      courseNo: x.courseNo ?? x.code ?? '',
      date: toDate(x.date),
      fileList,
      category: toArray(x.category ?? x.categories) ?? [],
      score: toNum(x.score),
      file: extractUploadUrl(x.file) ?? firstOr(fileList, undefined), // 相容舊資料
    }
  })
}

/* 依前端欄位建 Employee doc（建立用：盡量完整帶入） */
export function buildEmployeeDoc(body = {}) {
  const supervisor = body.supervisor === '' ? undefined : body.supervisor

  // 聯絡人陣列：前端可能傳 emergency1 / emergency2
  const emergencyContacts = []
  if (body.emergency1 && (body.emergency1.name || body.emergency1.relation || body.emergency1.phone1 || body.emergency1.phone2)) {
    emergencyContacts[0] = {
      name: body.emergency1.name ?? '',
      relation: body.emergency1.relation ?? '',
      phone1: body.emergency1.phone1 ?? '',
      phone2: body.emergency1.phone2 ?? '',
    }
  }
  if (body.emergency2 && (body.emergency2.name || body.emergency2.relation || body.emergency2.phone1 || body.emergency2.phone2)) {
    emergencyContacts[1] = {
      name: body.emergency2.name ?? '',
      relation: body.emergency2.relation ?? '',
      phone1: body.emergency2.phone1 ?? '',
      phone2: body.emergency2.phone2 ?? '',
    }
  }
  // 若直接傳 emergencyContacts 也接受
  if (Array.isArray(body.emergencyContacts) && body.emergencyContacts.length) {
    // 以 explicit array 為主
    emergencyContacts.length = 0
    body.emergencyContacts.forEach((c) => emergencyContacts.push({
      name: c?.name ?? '',
      relation: c?.relation ?? '',
      phone1: c?.phone1 ?? '',
      phone2: c?.phone2 ?? '',
    }))
  }

  const salaryItems = toArray(body.salaryItems) ?? []

  return {
    /* 帳號/權限/簽核 */
    username: body.username,
    permissionGrade: body.permissionGrade,
    role: body.role,                     // employee/supervisor/admin
    signRole: body.signRole,
    signTags: toArray(body.signTags) ?? [],
    signLevel: body.signLevel,

    /* 基本資料 */
    employeeNo: body.employeeNo ?? body.employeeId, // alias → employeeId
    name: body.name,
    photo: body.photo ?? firstOr(body.photoList, undefined),
    gender: body.gender,                 // 'M' | 'F' | 'O'
    idNumber: body.idNumber,
    birthday: toDate(body.birthday),
    birthplace: body.birthplace,
    bloodType: sanitizeEnum(body.bloodType, BLOOD_TYPES),           // A/B/O/AB/HR
    languages: toArray(body.languages) ?? [],
    disabilityLevel: body.disabilityLevel,
    identityCategory: toArray(body.identityCategory) ?? [], // C07 多選
    maritalStatus: sanitizeEnum(body.maritalStatus, MARITAL_STATUSES),
    dependents: toNum(body.dependents) ?? 0,

    /* 聯絡方式 */
    email: body.email,
    phone: body.phone,                   // alias → mobile
    landline: body.landline,
    householdAddress: body.householdAddress,
    contactAddress: body.contactAddress,
    lineId: body.lineId,

    /* 組織/部門/職稱 */
    organization: body.organization,
    department: body.department === '' ? undefined : body.department,
    subDepartment: body.subDepartment === '' ? undefined : body.subDepartment,
    supervisor,
    title: body.title,
    practiceTitle: body.practiceTitle,
    isPartTime: Boolean(body.isPartTime),
    isClocking: Boolean(body.isClocking),

    /* 人員狀態與試用 */
    employmentStatus: sanitizeEnum(body.employmentStatus, EMPLOYMENT_STATUSES),        // alias → status
    probationDays: toNum(body.probationDays) ?? 0,

    /* 體檢 */
    medicalCheck: {
      height: toNum(body.height),
      weight: toNum(body.weight),
      bloodType: sanitizeEnum(body.medicalBloodType, BLOOD_TYPES),
    },

    /* 學歷(C08) */
    education: {
      level: body.educationLevel,
      school: body.schoolName,
      major: body.major,
      status: sanitizeEnum(body.graduationStatus, GRADUATION_STATUSES),
      graduationYear: toNum(body.graduationYear),
    },

    /* 役別 */
    militaryService: {
      serviceType: body.serviceType,
      branch: body.militaryBranch,
      rank: body.militaryRank,
      dischargeYear: toNum(body.dischargeYear),
    },

    /* 聯絡人 */
    emergencyContacts,

    /* 關鍵字 */
    keywords: body.keywords,

    /* 經歷 / 證照 / 訓練 */
    experiences: normalizeExperiences(body.experiences) ?? [],
    licenses: normalizeLicenses(body.licenses) ?? [],
    trainings: normalizeTrainings(body.trainings) ?? [],

    /* 任職日期群（各欄位 alias 於 model 負責） */
    appointment: {
      hireDate: toDate(body.hireDate),
      appointDate: toDate(body.appointDate),            // alias → startDate
      resignationDate: toDate(body.resignDate),
      dismissalDate: toDate(body.dismissDate),
      reAppointDate: toDate(body.reAppointDate),        // alias → rehireStartDate
      reDismissDate: toDate(body.reDismissDate),        // alias → rehireEndDate
      remark: body.employmentNote,
    },

    /* 薪資 */
    salaryType: body.salaryType,
    salaryAmount: toNum(body.salaryAmount) ?? 0,
    laborPensionSelf: toNum(body.laborPensionSelf) ?? 0,
    employeeAdvance: toNum(body.employeeAdvance) ?? 0,
    salaryAccountA: {
      bank: body?.salaryAccountA?.bank ?? '',
      acct: body?.salaryAccountA?.acct ?? '',
    },
    salaryAccountB: {
      bank: body?.salaryAccountB?.bank ?? '',
      acct: body?.salaryAccountB?.acct ?? '',
    },
    salaryItems,
    salaryItemAmounts: normalizeSalaryItemAmounts(body.salaryItemAmounts, salaryItems),
    monthlySalaryAdjustments: {
      healthInsuranceFee: toNum(body?.monthlySalaryAdjustments?.healthInsuranceFee) ?? 0,
      debtGarnishment: toNum(body?.monthlySalaryAdjustments?.debtGarnishment) ?? 0,
      otherDeductions: toNum(body?.monthlySalaryAdjustments?.otherDeductions) ?? 0,
      performanceBonus: toNum(body?.monthlySalaryAdjustments?.performanceBonus) ?? 0,
      otherBonuses: toNum(body?.monthlySalaryAdjustments?.otherBonuses) ?? 0,
      notes: body?.monthlySalaryAdjustments?.notes ?? '',
    },

    /* 勞健保投保資訊 */
    laborInsuredSalary: toNum(body.laborInsuredSalary) ?? 0,
    pensionInsuredSalary: toNum(body.pensionInsuredSalary) ?? 0,
    healthInsuredSalary: toNum(body.healthInsuredSalary) ?? 0,
    dependentCount: toNum(body.dependentCount) ?? 0,

    /* 特休管理 (Annual Leave) */
    annualLeave: {
      totalDays: toNum(body?.annualLeave?.totalDays) ?? 0,
      usedDays: toNum(body?.annualLeave?.usedDays) ?? 0,
      year: toNum(body?.annualLeave?.year) ?? new Date().getFullYear(),
      expiryDate: toDate(body?.annualLeave?.expiryDate),
      accumulatedLeave: toNum(body?.annualLeave?.accumulatedLeave) ?? 0,
      compensatoryHours: toNum(body?.annualLeave?.compensatoryHours) ?? 0,
      notes: body?.annualLeave?.notes ?? '',
    },
  }
}

/* 產生 $set / $unset 用於部份更新（不會覆蓋未提供欄位） */
export function buildEmployeePatch(body = {}, existing = null) {
  const $set = {}
  const $unset = {}

  const put = (k, v) => { if (isDefined(v)) $set[k] = v }
  const un = (k) => { $unset[k] = 1 }

  // supervisor 特例：空字串 → unset
  if (isDefined(body.supervisor)) {
    if (body.supervisor === '') un('supervisor')
    else put('supervisor', body.supervisor)
  }

  // 帳號/權限/簽核
  put('username', body.username)
  if (isDefined(body.accountEnabled)) put('accountEnabled', Boolean(body.accountEnabled))
  put('permissionGrade', body.permissionGrade)
  put('role', body.role)
  put('signRole', body.signRole)
  if (isDefined(body.signTags)) put('signTags', toArray(body.signTags) ?? [])
  put('signLevel', body.signLevel)

  // 基本資料
  put('employeeId', body.employeeNo ?? body.employeeId)
  put('name', body.name)
  put('photo', body.photo ?? firstOr(body.photoList, undefined))
  put('gender', body.gender)
  put('idNumber', body.idNumber)
  if (isDefined(body.birthday)) put('birthDate', toDate(body.birthday))
  put('birthPlace', body.birthplace)
  put('bloodType', sanitizeEnum(body.bloodType, BLOOD_TYPES))
  if (isDefined(body.languages)) put('languages', toArray(body.languages) ?? [])
  put('disabilityLevel', body.disabilityLevel)
  if (isDefined(body.identityCategory)) put('identityCategory', toArray(body.identityCategory) ?? [])
  put('maritalStatus', sanitizeEnum(body.maritalStatus, MARITAL_STATUSES))
  if (isDefined(body.dependents)) put('dependents', toNum(body.dependents))

  // 聯絡
  put('email', body.email)
  put('mobile', body.phone) // alias
  put('landline', body.landline)
  put('householdAddress', body.householdAddress)
  put('contactAddress', body.contactAddress)
  put('lineId', body.lineId)

  // 組織/職稱
  put('organization', body.organization)
  if (isDefined(body.department)) {
    if (body.department === '') un('department')
    else put('department', body.department)
  }
  if (isDefined(body.subDepartment)) {
    if (body.subDepartment === '') un('subDepartment')
    else put('subDepartment', body.subDepartment)
  }
  put('title', body.title)
  put('practiceTitle', body.practiceTitle)
  if (isDefined(body.isPartTime)) put('partTime', Boolean(body.isPartTime))
  if (isDefined(body.isClocking)) put('needClockIn', Boolean(body.isClocking))

  // 狀態/試用
  put('status', sanitizeEnum(body.employmentStatus ?? body.status, EMPLOYMENT_STATUSES))
  if (isDefined(body.probationDays)) put('probationDays', toNum(body.probationDays))

  // 體檢
  if (isDefined(body.height)) put('medicalCheck.height', toNum(body.height))
  if (isDefined(body.weight)) put('medicalCheck.weight', toNum(body.weight))
  put('medicalCheck.bloodType', sanitizeEnum(body.medicalBloodType, BLOOD_TYPES))

  // 學歷
  if (isDefined(body.educationLevel)) put('education.level', body.educationLevel)
  if (isDefined(body.schoolName)) put('education.school', body.schoolName)
  if (isDefined(body.major)) put('education.major', body.major)
  if (isDefined(body.graduationStatus)) {
    if (body.graduationStatus === '' || body.graduationStatus === null) {
      un('education.status')
    } else {
      const sanitizedStatus = sanitizeEnum(body.graduationStatus, GRADUATION_STATUSES)
      if (isDefined(sanitizedStatus)) put('education.status', sanitizedStatus)
    }
  }
  if (isDefined(body.graduationYear)) put('education.graduationYear', toNum(body.graduationYear))

  // 役別
  if (isDefined(body.serviceType)) put('militaryService.serviceType', body.serviceType)
  if (isDefined(body.militaryBranch)) put('militaryService.branch', body.militaryBranch)
  if (isDefined(body.militaryRank)) put('militaryService.rank', body.militaryRank)
  if (isDefined(body.dischargeYear)) put('militaryService.dischargeYear', toNum(body.dischargeYear))

  // 聯絡人：若傳 emergencyContacts/1/2 任一，就重建整個陣列
  if (
    isDefined(body.emergencyContacts) ||
    isDefined(body.emergency1) ||
    isDefined(body.emergency2)
  ) {
    const ec = Array.isArray(existing?.emergencyContacts)
      ? existing.emergencyContacts.map((x) => ({ ...x }))
      : []

    if (Array.isArray(body.emergencyContacts)) {
      $set.emergencyContacts = body.emergencyContacts.map((c) => ({
        name: c?.name ?? '',
        relation: c?.relation ?? '',
        phone1: c?.phone1 ?? '',
        phone2: c?.phone2 ?? '',
      }))
    } else {
      if (isDefined(body.emergency1)) {
        ec[0] = {
          name: body.emergency1?.name ?? '',
          relation: body.emergency1?.relation ?? '',
          phone1: body.emergency1?.phone1 ?? '',
          phone2: body.emergency1?.phone2 ?? '',
        }
      }
      if (isDefined(body.emergency2)) {
        ec[1] = {
          name: body.emergency2?.name ?? '',
          relation: body.emergency2?.relation ?? '',
          phone1: body.emergency2?.phone1 ?? '',
          phone2: body.emergency2?.phone2 ?? '',
        }
      }
      $set.emergencyContacts = ec
    }
  }

  // 關鍵字
  if (isDefined(body.keywords)) put('keywords', body.keywords)

  // 經歷/證照/訓練：前端通常整包送
  if (isDefined(body.experiences)) put('experiences', normalizeExperiences(body.experiences) ?? [])
  if (isDefined(body.licenses)) put('licenses', normalizeLicenses(body.licenses) ?? [])
  if (isDefined(body.trainings)) put('trainings', normalizeTrainings(body.trainings) ?? [])

  // 任職日期群
  if (isDefined(body.hireDate)) put('appointment.hireDate', toDate(body.hireDate))
  if (isDefined(body.appointDate)) put('appointment.startDate', toDate(body.appointDate))
  if (isDefined(body.resignDate)) put('appointment.resignationDate', toDate(body.resignDate))
  if (isDefined(body.dismissDate)) put('appointment.dismissalDate', toDate(body.dismissDate))
  if (isDefined(body.reAppointDate)) put('appointment.rehireStartDate', toDate(body.reAppointDate))
  if (isDefined(body.reDismissDate)) put('appointment.rehireEndDate', toDate(body.reDismissDate))
  if (isDefined(body.employmentNote)) put('appointment.remark', body.employmentNote)

  // 薪資
  if (isDefined(body.salaryType)) put('salaryType', body.salaryType)
  if (isDefined(body.salaryAmount)) put('salaryAmount', toNum(body.salaryAmount))
  if (isDefined(body.laborPensionSelf)) put('laborPensionSelf', toNum(body.laborPensionSelf))
  if (isDefined(body.employeeAdvance)) put('employeeAdvance', toNum(body.employeeAdvance))
  if (isDefined(body.salaryAccountA?.bank)) put('salaryAccountA.bank', body.salaryAccountA.bank)
  if (isDefined(body.salaryAccountA?.acct)) put('salaryAccountA.acct', body.salaryAccountA.acct)
  if (isDefined(body.salaryAccountB?.bank)) put('salaryAccountB.bank', body.salaryAccountB.bank)
  if (isDefined(body.salaryAccountB?.acct)) put('salaryAccountB.acct', body.salaryAccountB.acct)
  if (isDefined(body.salaryItems)) {
    const salaryItems = toArray(body.salaryItems) ?? []
    put('salaryItems', salaryItems)
    put('salaryItemAmounts', normalizeSalaryItemAmounts(body.salaryItemAmounts, salaryItems))
  } else if (isDefined(body.salaryItemAmounts)) {
    const existingItems = existing?.salaryItems ?? []
    put('salaryItemAmounts', normalizeSalaryItemAmounts(body.salaryItemAmounts, existingItems))
  }
  if (isDefined(body.monthlySalaryAdjustments)) {
    const m = body.monthlySalaryAdjustments || {}
    put('monthlySalaryAdjustments.healthInsuranceFee', toNum(m.healthInsuranceFee) ?? 0)
    put('monthlySalaryAdjustments.debtGarnishment', toNum(m.debtGarnishment) ?? 0)
    put('monthlySalaryAdjustments.otherDeductions', toNum(m.otherDeductions) ?? 0)
    put('monthlySalaryAdjustments.performanceBonus', toNum(m.performanceBonus) ?? 0)
    put('monthlySalaryAdjustments.otherBonuses', toNum(m.otherBonuses) ?? 0)
    if (isDefined(m.notes)) put('monthlySalaryAdjustments.notes', m.notes ?? '')
  }

  // 特休管理 (Annual Leave)
  if (isDefined(body.annualLeave)) {
    const al = body.annualLeave || {}
    if (isDefined(al.totalDays)) put('annualLeave.totalDays', toNum(al.totalDays) ?? 0)
    if (isDefined(al.usedDays)) put('annualLeave.usedDays', toNum(al.usedDays) ?? 0)
    if (isDefined(al.year)) put('annualLeave.year', toNum(al.year))
    if (isDefined(al.expiryDate)) put('annualLeave.expiryDate', toDate(al.expiryDate))
    if (isDefined(al.accumulatedLeave)) put('annualLeave.accumulatedLeave', toNum(al.accumulatedLeave) ?? 0)
    if (isDefined(al.compensatoryHours)) put('annualLeave.compensatoryHours', toNum(al.compensatoryHours) ?? 0)
    if (isDefined(al.notes)) put('annualLeave.notes', al.notes ?? '')
  }

  // 勞健保投保資訊
  if (isDefined(body.laborInsuredSalary)) put('laborInsuredSalary', toNum(body.laborInsuredSalary))
  if (isDefined(body.pensionInsuredSalary)) put('pensionInsuredSalary', toNum(body.pensionInsuredSalary))
  if (isDefined(body.healthInsuredSalary)) put('healthInsuredSalary', toNum(body.healthInsuredSalary))
  if (isDefined(body.dependentCount)) put('dependentCount', toNum(body.dependentCount))

  return { $set, $unset }
}

/* ─────────────────────────────── Controllers ─────────────────────────────── */

const SCHEDULE_VIEW_SELECT = '_id name employeeId photo title practiceTitle department subDepartment annualLeave supervisor role status requiresScheduling partTime'
const SUPERVISOR_VIEW_SELECT = '_id name employeeId photo title practiceTitle department subDepartment annualLeave supervisor role status requiresScheduling partTime organization appointment.hireDate'
const ADMIN_LIST_SELECT = '_id name employeeId username email mobile photo title practiceTitle department subDepartment organization supervisor role status annualLeave requiresScheduling partTime accountEnabled createdAt'
const EMPLOYEE_LIST_PAGE_SIZE = 20
const EMPLOYEE_LIST_MAX_PAGE_SIZE = 100
const EMPLOYEE_SEARCH_MAX_LENGTH = 100
const ACTIVE_EMPLOYMENT_STATUSES = ['正職員工', '試用期員工']

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parsePositiveInteger = (value, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

const readSearchTerm = (value) => {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length <= EMPLOYEE_SEARCH_MAX_LENGTH ? normalized : null
}

const toEntityId = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) {
    return toEntityId(value._id)
  }
  return typeof value.toString === 'function' ? value.toString() : String(value)
}

async function canReadEmployeeResource(req, employeeId) {
  const actorId = toEntityId(req.user?.id)
  const targetId = toEntityId(employeeId)
  if (!actorId || !targetId) return false
  if (req.user?.role === 'admin' || actorId === targetId) return true
  if (req.user?.role !== 'supervisor') return false
  return Boolean(await Employee.exists({ _id: targetId, supervisor: actorId }))
}

async function deleteEmployeePhotoIfUnreferenced(photoPath, excludedEmployeeId) {
  if (!isManagedEmployeePhotoPath(photoPath)) return
  const filter = { photo: photoPath }
  if (excludedEmployeeId) filter._id = { $ne: excludedEmployeeId }
  if (await Employee.exists(filter)) return
  await deleteEmployeePhoto(photoPath)
}

async function cleanupUnpersistedPhoto(req) {
  if (req.uploadedPhotoPath) await deleteEmployeePhoto(req.uploadedPhotoPath)
}

async function rejectWithPhotoCleanup(req, res, status, payload) {
  await cleanupUnpersistedPhoto(req).catch(() => {})
  return res.status(status).json(payload)
}

const resolveRemainingAnnualLeaveDays = (annualLeave = {}) => {
  const remaining = toNum(annualLeave?.remainingDays)
  if (remaining !== undefined) return Math.max(0, remaining)
  const totalDays = toNum(annualLeave?.totalDays) ?? 0
  const usedDays = toNum(annualLeave?.usedDays) ?? 0
  return Math.max(0, totalDays - usedDays)
}

/** GET /api/employees?q=...&supervisor=...&organization=...&department=...&subDepartment=...&status=...&role=...&view=schedule */
export async function listEmployees(req, res) {
  try {
    const {
      q,
      supervisor,
      organization,
      department,
      subDepartment,
      status,
      role,
      view,
      page: pageRaw,
      pageSize: pageSizeRaw,
      month,
      search: searchRaw,
      jobType: jobTypeRaw,
      includeSelf,
    } = req.query
    const actorId = toEntityId(req.user?.id)
    const actorRole = req.user?.role
    if (!actorId) return res.status(401).json({ error: 'Invalid user' })
    const isScheduleView = view === 'schedule'
    const shouldIncludeSelf = includeSelf === true || includeSelf === 'true'
    const filter = {}
    const search = readSearchTerm(searchRaw ?? q)
    const jobType = readSearchTerm(jobTypeRaw)
    if (search === null || jobType === null) {
      return res.status(400).json({ error: 'Invalid search query' })
    }
    if (
      organization &&
      (typeof organization !== 'string' || organization.length > EMPLOYEE_SEARCH_MAX_LENGTH)
    ) {
      return res.status(400).json({ error: 'Invalid organization filter' })
    }

    const objectIdFilters = {
      ...(actorRole === 'admin' ? { supervisor } : {}),
      department,
      subDepartment,
    }
    const invalidObjectIdFilter = Object.entries(objectIdFilters)
      .find(([, value]) => value && !mongoose.isValidObjectId(value))
    if (invalidObjectIdFilter) {
      return res.status(400).json({ error: `Invalid ${invalidObjectIdFilter[0]} filter` })
    }
    if (role && role !== 'all' && !['employee', 'supervisor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role filter' })
    }
    if (status && view !== 'schedule' && !EMPLOYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' })
    }

    if (supervisor && actorRole === 'admin') filter.supervisor = supervisor
    if (organization) filter.organization = organization
    if (department) filter.department = department
    if (subDepartment) filter.subDepartment = subDepartment
    if (status && view !== 'schedule') filter.status = status
    if (role && role !== 'all') filter.role = role
    const andFilters = []
    if (actorRole === 'employee') {
      filter._id = actorId
    } else if (actorRole === 'supervisor') {
      andFilters.push(
        isScheduleView && !shouldIncludeSelf
          ? { supervisor: actorId }
          : { $or: [{ _id: actorId }, { supervisor: actorId }] }
      )
    }
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i')
      andFilters.push({
        $or: [
          { name: rx },
          { employeeId: rx },
          { email: rx },
          { title: rx },
        ]
      })
    }
    if (jobType) {
      const rx = new RegExp(escapeRegex(jobType), 'i')
      andFilters.push({
        $or: [
          { practiceTitle: rx },
          { title: rx },
          { jobType: rx },
        ]
      })
    }
    if (andFilters.length === 1) {
      Object.assign(filter, andFilters[0])
    } else if (andFilters.length > 1) {
      filter.$and = andFilters
    }

    const page = parsePositiveInteger(pageRaw, 1)
    const pageSize = parsePositiveInteger(
      pageSizeRaw,
      isScheduleView ? 50 : EMPLOYEE_LIST_PAGE_SIZE,
      isScheduleView ? 200 : EMPLOYEE_LIST_MAX_PAGE_SIZE
    )
    let query = Employee.find(filter)

    if (isScheduleView) {
      query = query.select(SCHEDULE_VIEW_SELECT)
    } else if (actorRole === 'supervisor') {
      query = query
        .select(SUPERVISOR_VIEW_SELECT)
        .populate('supervisor', 'name employeeId')
    } else {
      query = query
        .select(ADMIN_LIST_SELECT)
        .populate('supervisor', 'name employeeId')
    }

    if (!isScheduleView) {
      const [total, active] = await Promise.all([
        Employee.countDocuments(filter),
        Employee.countDocuments({
          $and: [filter, { status: { $in: ACTIVE_EMPLOYMENT_STATUSES } }],
        }),
      ])
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const safePage = Math.min(page, totalPages)
      const employees = await query
        .sort({ name: 1, employeeId: 1, _id: 1 })
        .skip((safePage - 1) * pageSize)
        .limit(pageSize)
        .lean()

      return res.json({
        employees,
        pagination: {
          total,
          page: safePage,
          pageSize,
          totalPages,
        },
        summary: { active },
      })
    }

    const employees = await query
      .sort({ name: 1, employeeId: 1, _id: 1 })
      .lean()

    let scheduleEmployees = employees.map((employee) => ({
      ...employee,
      annualLeave: {
        remainingDays: resolveRemainingAnnualLeaveDays(employee.annualLeave),
      },
    }))

    if (status && status !== 'all') {
      if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ error: 'month required for status filter' })
      }
      const monthStart = dayjs(`${month}-01`).startOf('day')
      const monthEnd = monthStart.add(1, 'month')
      const employeeIds = scheduleEmployees.map(item => item._id?.toString?.() || String(item._id))
      const statusMap = new Map(
        employeeIds.map(id => [id, { shiftDays: new Set(), leaveDays: new Set() }])
      )

      const schedules = await ShiftSchedule.find({
        employee: { $in: employeeIds },
        date: { $gte: monthStart.toDate(), $lt: monthEnd.toDate() },
      })
        .select('employee date shiftId')
        .lean()

      schedules.forEach((doc) => {
        const empId = doc.employee?.toString?.() || ''
        const entry = statusMap.get(empId)
        if (!entry) return
        if (!doc.shiftId) return
        const dayKey = dayjs(doc.date).format('YYYY-MM-DD')
        entry.shiftDays.add(dayKey)
      })

      // 預設的「請假」與自建的請假表單並存時，每張請假表單各查一次
      const leaveForms = employeeIds.length ? await getAllLeaveFieldInfos({ withTypeOptions: false }) : []
      for (const { formId, startId, endId } of leaveForms) {
        if (!formId || !startId || !endId) continue
        const leaveQuery = {
          form: formId,
          status: 'approved',
          applicant_employee: { $in: employeeIds },
        }
        leaveQuery[`form_data.${startId}`] = { $lt: monthEnd.format('YYYY-MM-DD') }
        leaveQuery[`form_data.${endId}`] = { $gte: monthStart.format('YYYY-MM-DD') }
        const approvals = await ApprovalRequest.find(leaveQuery)
          .select(`applicant_employee form_data.${startId} form_data.${endId}`)
          .lean()
        approvals.forEach((approval) => {
          const empId = approval.applicant_employee?.toString?.() || ''
          const entry = statusMap.get(empId)
          if (!entry) return
          const approvalStart = dayjs(approval.form_data?.[startId])
          const approvalEnd = dayjs(approval.form_data?.[endId])
          const monthLastDay = monthEnd.subtract(1, 'day')
          const start = approvalStart.isAfter(monthStart) ? approvalStart : monthStart
          const end = approvalEnd.isBefore(monthLastDay) ? approvalEnd : monthLastDay
          if (!start.isValid() || !end.isValid() || end.isBefore(start)) return
          let pointer = start.startOf('day')
          while (!pointer.isAfter(end, 'day')) {
            entry.leaveDays.add(pointer.format('YYYY-MM-DD'))
            pointer = pointer.add(1, 'day')
          }
        })
      }

      const daysInMonth = monthStart.daysInMonth()
      scheduleEmployees = scheduleEmployees.filter((employee) => {
        const empId = employee._id?.toString?.() || String(employee._id)
        const entry = statusMap.get(empId) || { shiftDays: new Set(), leaveDays: new Set() }
        const hasLeave = entry.leaveDays.size > 0
        const filledDays = new Set([...entry.shiftDays, ...entry.leaveDays]).size
        const currentStatus = hasLeave ? 'onLeave' : (filledDays < daysInMonth ? 'unscheduled' : 'scheduled')
        return currentStatus === status
      })
    }

    const total = scheduleEmployees.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, totalPages)
    const pagedEmployees = scheduleEmployees.slice((safePage - 1) * pageSize, safePage * pageSize)

    if (pageRaw !== undefined || pageSizeRaw !== undefined || status || searchRaw || jobTypeRaw) {
      return res.json({
        employees: pagedEmployees,
        pagination: {
          total,
          page: safePage,
          pageSize,
          totalPages,
        },
      })
    }

    return res.json(pagedEmployees)
  } catch (err) {
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid employee query' })
    }
    console.error('Failed to list employees', { error: err?.name ?? 'Error' })
    return res.status(500).json({ error: 'Failed to list employees' })
  }
}

export async function listEmployeesSchedule(req, res) {
  const scheduleReq = {
    ...req,
    query: {
      ...req.query,
      view: 'schedule',
    },
  }
  return listEmployees(scheduleReq, res)
}

export async function listEmployeeOptions(req, res) {
  try {
    const isAdmin = req.user?.role === 'admin'
    const projection = isAdmin
      ? 'name username signRole signTags signLevel organization department role'
      : 'name'
    let employeeQuery = Employee.find(
      { username: { $exists: true, $ne: '' } },
      projection
    )
    if (isAdmin) employeeQuery = employeeQuery.populate('department', 'name')
    const employees = await employeeQuery.lean()
    const options = employees.map((e) => {
      const id = e._id?.toString?.() ?? e.id
      if (!isAdmin) {
        return {
          id,
          name: e.name,
          displayName: e.name,
        }
      }
      const dept = e.department && typeof e.department === 'object'
        ? { id: e.department._id?.toString?.() ?? e.department.id ?? e.department, name: e.department.name ?? '' }
        : null
      const signTags = Array.isArray(e.signTags) ? e.signTags.filter(Boolean) : []
      return {
        id,
        name: e.name,
        username: e.username,
        signRole: e.signRole ?? '',
        signLevel: e.signLevel ?? '',
        signTags,
        organization: e.organization ?? '',
        department: dept,
        role: e.role ?? '',
        displayName: e.username ? `${e.name}（${e.username}）` : e.name,
      }
    })
    res.json(options)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export async function listAttendanceImportEmployeeOptions(req, res) {
  try {
    const employees = await Employee.find(
      {},
      '_id name email employeeId status'
    )
      .sort({ name: 1, employeeId: 1, _id: 1 })
      .limit(5000)
      .lean()
    return res.json(employees)
  } catch (err) {
    console.error('Failed to list attendance import options', { error: err?.name ?? 'Error' })
    return res.status(500).json({ error: 'Failed to list employee options' })
  }
}

/** POST /api/employees */
export async function createEmployee(req, res) {
  let photoPersisted = false
  try {
    const body = req.body ?? {}
    const {
      name, email, role, username, password,
    } = body

    const employeeNo = body.employeeNo ?? body.employeeId

    if (!name) return rejectWithPhotoCleanup(req, res, 400, { error: 'Name is required' })
    if (!email) return rejectWithPhotoCleanup(req, res, 400, { error: 'Email is required' })
    if (!employeeNo || String(employeeNo).trim() === '') {
      return rejectWithPhotoCleanup(req, res, 400, { error: 'Employee number is required' })
    }
    if (!username) return rejectWithPhotoCleanup(req, res, 400, { error: 'Username is required' })
    if (!password) return rejectWithPhotoCleanup(req, res, 400, { error: 'Password is required' })
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(email)) return rejectWithPhotoCleanup(req, res, 400, { error: 'Invalid email' })
    if (role !== undefined) {
      const validRoles = ['employee', 'supervisor', 'admin']
      if (!validRoles.includes(role)) return rejectWithPhotoCleanup(req, res, 400, { error: 'Invalid role' })
    }
    if (body.photo && !req.uploadedPhotoPath) {
      return rejectWithPhotoCleanup(req, res, 400, { error: '新員工照片必須直接上傳' })
    }

    const employeeDoc = buildEmployeeDoc(body)
    employeeDoc.password = password

    const employee = await Employee.create(employeeDoc)
    photoPersisted = true

    res.status(201).json(employee)
  } catch (err) {
    if (!photoPersisted) await cleanupUnpersistedPhoto(req).catch(() => {})
    res.status(400).json({ error: err.message })
  }
}

/** GET /api/employees/:id */
export async function getEmployee(req, res) {
  try {
    const actorId = toEntityId(req.user?.id)
    const targetId = toEntityId(req.params.id)
    const actorRole = req.user?.role
    if (!actorId) return res.status(401).json({ error: 'Invalid user' })
    if (actorRole === 'employee' && targetId !== actorId) {
      return res.status(404).json({ error: 'Not found' })
    }

    const limitedSupervisorView = actorRole === 'supervisor' && targetId !== actorId
    if (!mongoose.isValidObjectId(targetId)) {
      return res.status(400).json({ error: 'Invalid employee id' })
    }

    let employeeQuery = Employee.findById(targetId)
    if (limitedSupervisorView) employeeQuery = employeeQuery.select(SUPERVISOR_VIEW_SELECT)

    const employee = await employeeQuery.populate([
      { path: 'supervisor', select: 'name employeeId' },
      { path: 'department', select: 'name organization' },
      { path: 'subDepartment', select: 'name' },
    ])
    if (!employee) return res.status(404).json({ error: 'Not found' })
    if (limitedSupervisorView && toEntityId(employee.supervisor) !== actorId) {
      return res.status(404).json({ error: 'Not found' })
    }

    const normalizeReference = (entity, fallbackName = '') => {
      if (!entity) return entity
      const isObject = typeof entity === 'object'

      const toIdString = (value) => {
        if (value === null || value === undefined) return ''
        if (typeof value === 'string') return value
        if (typeof value === 'number') return String(value)
        if (typeof value === 'object') {
          if (typeof value.toString === 'function') {
            const str = value.toString()
            return str && str !== '[object Object]' ? str : ''
          }
          return ''
        }
        return ''
      }

      const rawId = isObject
        ? entity._id ?? entity.id ?? entity.value ?? entity
        : entity
      const idString = toIdString(rawId)

      if (isObject && 'name' in entity && entity.name !== undefined) {
        return {
          ...entity,
          _id: idString || entity._id,
        }
      }

      return {
        _id: idString,
        name: isObject && entity?.name ? entity.name : fallbackName,
      }
    }

    const result = typeof employee.toObject === 'function'
      ? employee.toObject({ virtuals: true })
      : employee

    if (result?.department) {
      const fallbackName =
        (typeof result.department === 'object' && result.department?.name) ||
        result.departmentName ||
        ''
      result.department = normalizeReference(result.department, fallbackName)
    }

    if (result?.subDepartment) {
      const fallbackName =
        (typeof result.subDepartment === 'object' && result.subDepartment?.name) ||
        result.subDepartmentName ||
        ''
      result.subDepartment = normalizeReference(result.subDepartment, fallbackName)
    }

    res.json(result)
  } catch (err) {
    if (err?.name !== 'CastError') {
      console.error('Failed to get employee', { error: err?.name ?? 'Error' })
    }
    res.status(400).json({ error: 'Invalid employee id' })
  }
}

/** GET /api/employees/:id/photo */
export async function getEmployeePhoto(req, res) {
  try {
    if (!await canReadEmployeeResource(req, req.params.id)) {
      return res.status(404).json({ error: 'Not found' })
    }

    const employee = await Employee.findById(req.params.id).select('photo')
    if (!employee?.photo) return res.status(404).json({ error: 'Not found' })

    const photo = await readEmployeePhoto(employee.photo)
    if (!photo) return res.status(404).json({ error: 'Not found' })

    res.set({
      'Cache-Control': 'private, max-age=300',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': photo.mimeType,
      'X-Content-Type-Options': 'nosniff',
    })
    return res.send(photo.buffer)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

/** PUT /api/employees/:id */
export async function updateEmployee(req, res) {
  let photoPersisted = false
  try {
    const employee = await Employee.findById(req.params.id)
    if (!employee) {
      await cleanupUnpersistedPhoto(req).catch(() => {})
      return res.status(404).json({ error: 'Not found' })
    }

    const body = req.body ?? {}
    const previousPhoto = employee.photo
    if (
      isDefined(body.photo) && body.photo && body.photo !== previousPhoto &&
      !req.uploadedPhotoPath
    ) {
      return res.status(400).json({ error: '員工照片必須直接上傳' })
    }

    // 若有驗證需求，沿用你原本的 email/role 檢核
    if (isDefined(body.email)) {
      if (!body.email) return rejectWithPhotoCleanup(req, res, 400, { error: 'Email is required' })
      const emailRegex = /^\S+@\S+\.\S+$/
      if (!emailRegex.test(body.email)) return rejectWithPhotoCleanup(req, res, 400, { error: 'Invalid email' })
    }
    if (isDefined(body.role)) {
      const validRoles = ['employee', 'supervisor', 'admin']
      if (!validRoles.includes(body.role)) return rejectWithPhotoCleanup(req, res, 400, { error: 'Invalid role' })
    }
    if (isDefined(body.accountEnabled) && typeof body.accountEnabled !== 'boolean') {
      return rejectWithPhotoCleanup(req, res, 400, { error: 'Invalid account state' })
    }

    // 建立 $set/$unset patch
    const { $set, $unset } = buildEmployeePatch(body, employee)

    const nextRole = $set.role ?? employee.role
    const nextStatus = $set.status ?? employee.status
    const nextAccountEnabled = $set.accountEnabled ?? employee.accountEnabled
    const removesAdminAccess =
      employee.role === 'admin' &&
      (
        nextRole !== 'admin' ||
        nextAccountEnabled === false ||
        ['離職員工', '留職停薪'].includes(nextStatus)
      )
    if (removesAdminAccess) {
      const remainingAdmins = await Employee.countDocuments({
        _id: { $ne: employee._id },
        role: 'admin',
        accountEnabled: { $ne: false },
        status: { $nin: ['離職員工', '留職停薪'] },
      })
      if (remainingAdmins === 0) {
        return rejectWithPhotoCleanup(req, res, 409, { error: 'At least one active administrator is required' })
      }
    }

    // 套用更新
    const update = {}
    if (Object.keys($set).length) update.$set = $set
    if (Object.keys($unset).length) update.$unset = $unset
    const sessionFieldsChanged = ['role', 'status', 'accountEnabled'].some(
      (field) => isDefined($set[field]) && $set[field] !== employee[field]
    )
    if (sessionFieldsChanged) update.$inc = { authVersion: 1 }
    if (Object.keys(update).length) await Employee.updateOne({ _id: employee._id }, update)
    photoPersisted = true

    // 取回最新
    const updated = await Employee.findById(employee._id)

    if (isDefined(body.password)) {
      updated.password = body.password
      await updated.save()
    }

    if (isDefined(body.photo) && previousPhoto && previousPhoto !== updated.photo) {
      await deleteEmployeePhotoIfUnreferenced(previousPhoto, employee._id)
    }

    res.json(updated)
  } catch (err) {
    if (!photoPersisted) await cleanupUnpersistedPhoto(req).catch(() => {})
    res.status(400).json({ error: err.message })
  }
}

/** DELETE /api/employees/:id */
export async function deleteEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id)
    if (!employee) return res.status(404).json({ error: 'Not found' })

    // Prevent deletion of admin accounts
    if (employee.role === 'admin') {
      return res.status(403).json({ error: '管理員帳戶不可刪除' })
    }

    const previousPhoto = employee.photo
    await employee.deleteOne()
    if (previousPhoto) {
      await deleteEmployeePhotoIfUnreferenced(previousPhoto, employee._id)
    }
    res.json({ success: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

const BULK_DELETE_MAX_IDS = 200
const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/
const BULK_DELETE_SKIP_MESSAGES = {
  admin: '管理員帳戶不可刪除',
  self: '不能刪除自己的帳號',
  not_found: '找不到該員工（可能已被刪除）',
  changed: '資料狀態已變更，未刪除',
}

/** 把請求的 ids 驗證並去重；回傳 { ids } 或 { error } */
function parseBulkDeleteIds(rawIds) {
  if (!Array.isArray(rawIds)) return { error: '請提供要刪除的員工清單' }
  if (rawIds.length === 0) return { error: '請至少選擇一位員工' }
  if (rawIds.length > BULK_DELETE_MAX_IDS) {
    return { error: `單次最多可刪除 ${BULK_DELETE_MAX_IDS} 位員工` }
  }
  // 只接受 24 位十六進位字串：物件（例如 {"$ne":null}）一律拒絕，避免 NoSQL operator injection
  const invalid = rawIds.some((id) => typeof id !== 'string' || !OBJECT_ID_HEX_PATTERN.test(id))
  if (invalid) return { error: '員工編號格式不正確' }
  return { ids: [...new Set(rawIds.map((id) => id.toLowerCase()))] }
}

/** POST /api/employees/bulk-delete */
export async function bulkDeleteEmployees(req, res) {
  try {
    const parsed = parseBulkDeleteIds(req.body?.ids)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const { ids } = parsed
    const actorId = toEntityId(req.user?.id)

    const found = await Employee.find({ _id: { $in: ids } })
      .select('_id name employeeId role photo')
    const docById = new Map((found ?? []).map((doc) => [toEntityId(doc._id).toLowerCase(), doc]))

    const toSummary = (id, doc) => ({
      _id: id,
      name: doc?.name ?? '',
      employeeNo: doc?.employeeId ?? '',
    })
    const skipped = []
    const skip = (id, doc, reason) => skipped.push({
      ...toSummary(id, doc),
      reason,
      message: BULK_DELETE_SKIP_MESSAGES[reason],
    })

    // 分類：找不到 / 自己 / 管理員 → 略過，其餘列為可刪除
    const deletable = []
    ids.forEach((id) => {
      const doc = docById.get(id)
      if (!doc) return skip(id, doc, 'not_found')
      if (actorId && id === actorId.toLowerCase()) return skip(id, doc, 'self')
      if (doc.role === 'admin') return skip(id, doc, 'admin')
      deletable.push({ id, doc })
    })

    const deleted = []
    const warnings = []
    let unassignedSubordinates = 0

    if (deletable.length) {
      const deletableIds = deletable.map((item) => item.id)
      // 刪除條件再次排除 admin（縱深防禦，避免分類後角色被改成 admin）
      const deleteResult = await Employee.deleteMany({ _id: { $in: deletableIds }, role: { $ne: 'admin' } })

      // 從這裡開始資料已經被刪除：後續任何一步失敗都不能讓整個請求回報失敗，
      // 否則使用者會以為沒刪成功，而且重試時會因為「找不到」而跳過善後。
      // 不信任 deleteMany 的數量，重新查詢哪些仍然存在。
      try {
        const survivors = await Employee.find({ _id: { $in: deletableIds } }).select('_id')
        const survivorIds = new Set((survivors ?? []).map((doc) => toEntityId(doc._id).toLowerCase()))
        deletable.forEach(({ id, doc }) => {
          if (survivorIds.has(id)) skip(id, doc, 'changed')
          else deleted.push({ id, doc })
        })
      } catch (verifyErr) {
        console.error('Bulk delete: failed to verify deletion', { error: verifyErr?.name ?? 'Error' })
        deletable.forEach((item) => deleted.push(item))
        warnings.push('無法確認刪除結果，請重新整理員工列表檢查')
      }
      if (typeof deleteResult?.deletedCount === 'number' && deleteResult.deletedCount < deleted.length) {
        warnings.push('部分員工在這次操作前已被刪除，實際刪除的人數可能少於清單')
      }

      // 留下可追溯的紀錄：只記操作者與被刪除的 _id，不含個資
      console.info('Bulk delete employees', {
        actorId,
        requested: ids.length,
        deleted: deleted.length,
        deletedIds: deleted.map((item) => item.id),
      })

      // 照片清理失敗不影響整體結果；歷史資料（出勤/薪資/排班/簽核）與單筆刪除一樣不連動刪除
      for (const { id, doc } of deleted) {
        if (!doc.photo) continue
        try {
          await deleteEmployeePhotoIfUnreferenced(doc.photo, id)
        } catch (photoErr) {
          console.error('Failed to clean up employee photo', { error: photoErr?.name ?? 'Error' })
        }
      }
    }

    // 直屬主管指向「已不存在的人」的員工：清除主管欄位。同時處理這次找不到的 id，
    // 這樣上次刪除到一半失敗之後重試，也能把當時沒做完的善後補上。
    const goneIds = [
      ...deleted.map((item) => item.id),
      ...skipped.filter((item) => item.reason === 'not_found').map((item) => item._id),
    ]
    if (goneIds.length) {
      try {
        const result = await Employee.updateMany(
          { supervisor: { $in: goneIds } },
          { $unset: { supervisor: 1 } }
        )
        unassignedSubordinates = Number(result?.modifiedCount) || 0
      } catch (unsetErr) {
        console.error('Bulk delete: failed to clear supervisor references', { error: unsetErr?.name ?? 'Error' })
        warnings.push('部分員工的直屬主管設定未能清除，請檢查原本隸屬已刪除主管的員工')
      }
    }

    res.json({
      requested: ids.length,
      deletedCount: deleted.length,
      deleted: deleted.map(({ id, doc }) => toSummary(id, doc)),
      skipped,
      unassignedSubordinates,
      warnings,
    })
  } catch (err) {
    // 到這裡通常是刪除之前就失敗；不把資料庫的內部錯誤訊息回給前端
    console.error('Bulk delete employees failed', { error: err?.name ?? 'Error' })
    res.status(500).json({ error: '批量刪除失敗，請重新整理員工列表確認結果後再試' })
  }
}

/** POST /api/employees/set-supervisors */
export async function setSupervisors(req, res) {
  try {
    const { assignments } = req.body ?? {}
    if (!Array.isArray(assignments)) return res.status(400).json({ error: 'Invalid assignments' })

    for (const { employee, supervisor } of assignments) {
      await Employee.updateOne({ _id: employee }, { supervisor })
    }

    res.json({ success: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/* ─────────────────────────────── 特休管理 API ─────────────────────────────── */

import {
  getAnnualLeaveBalance,
  getAnnualLeaveHistory,
  setAnnualLeaveQuota,
  validateAnnualLeaveRequest
} from '../services/annualLeaveService.js'

/** GET /api/employees/:id/annual-leave - 查詢員工特休餘額 */
export async function getEmployeeAnnualLeave(req, res) {
  try {
    if (!await canReadEmployeeResource(req, req.params.id)) {
      return res.status(404).json({ error: 'Not found' })
    }
    const balance = await getAnnualLeaveBalance(req.params.id)
    res.json(balance)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/** GET /api/employees/:id/annual-leave/history - 查詢員工特休使用記錄 */
export async function getEmployeeAnnualLeaveHistory(req, res) {
  try {
    if (!await canReadEmployeeResource(req, req.params.id)) {
      return res.status(404).json({ error: 'Not found' })
    }
    const year = req.query.year ? parseInt(req.query.year) : null
    const history = await getAnnualLeaveHistory(req.params.id, year)
    res.json(history)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/** PATCH /api/employees/:id/annual-leave - 設定員工特休天數（管理員）*/
export async function setEmployeeAnnualLeave(req, res) {
  try {
    const { totalDays, year } = req.body
    if (totalDays === undefined || totalDays < 0) {
      return res.status(400).json({ error: 'Invalid totalDays' })
    }

    const employee = await setAnnualLeaveQuota(req.params.id, totalDays, year)
    res.json({
      success: true,
      annualLeave: employee.annualLeave
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/** POST /api/employees/:id/annual-leave/validate - 驗證特休申請 */
export async function validateEmployeeAnnualLeave(req, res) {
  try {
    const { days } = req.body
    if (!days || days <= 0) {
      return res.status(400).json({ error: 'Invalid days' })
    }

    const result = await validateAnnualLeaveRequest(req.params.id, days)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}
