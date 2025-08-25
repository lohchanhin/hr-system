// backend/controllers/employeeController.js
import Employee from '../models/Employee.js'   // ← 對齊你新的 model 檔名
import User from '../models/User.js'

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
const firstOr = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr[0] : fallback)

// 專用於 enum 欄位的值檢查
function sanitizeEnum(value, allowed) {
  if (value === '' || value === null || value === undefined) return undefined
  return allowed.includes(value) ? value : undefined
}

const MARITAL_STATUSES = ['已婚', '未婚', '離婚', '喪偶']
const EMPLOYMENT_STATUSES = ['正職員工', '試用期員工', '離職員工', '留職停薪']
const BLOOD_TYPES = ['A', 'B', 'O', 'AB', 'HR']

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
  return list.map((x = {}) => ({
    name: x.name ?? '',
    number: x.number ?? '',
    startDate: toDate(x.startDate ?? x.issueDate),
    endDate: toDate(x.endDate ?? x.expiryDate),
    // 前端 el-upload 習慣 fileList；model 以 alias 對應到 files
    fileList: Array.isArray(x.fileList) ? x.fileList : (x.file ? [x.file] : []),
    file: x.file ?? undefined, // 相容舊資料
  }))
}
function normalizeTrainings(list) {
  if (!Array.isArray(list)) return undefined
  return list.map((x = {}) => ({
    course: x.course ?? x.name ?? '',
    courseNo: x.courseNo ?? x.code ?? '',
    date: toDate(x.date),
    fileList: Array.isArray(x.fileList) ? x.fileList : (x.file ? [x.file] : []),
    category: x.category ?? '',
    score: toNum(x.score),
    file: x.file ?? undefined, // 相容舊資料
  }))
}

/* 依前端欄位建 Employee doc（建立用：盡量完整帶入） */
function buildEmployeeDoc(body = {}) {
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
    department: body.department,
    subDepartment: body.subDepartment,
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
      status: body.graduationStatus,
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
    salaryItems: toArray(body.salaryItems) ?? [],
  }
}

/* 產生 $set / $unset 用於部份更新（不會覆蓋未提供欄位） */
function buildEmployeePatch(body = {}, existing = null) {
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
  put('department', body.department)
  put('subDepartment', body.subDepartment)
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
  if (isDefined(body.graduationStatus)) put('education.status', body.graduationStatus)
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
  if (isDefined(body.salaryItems)) put('salaryItems', toArray(body.salaryItems) ?? [])

  return { $set, $unset }
}

/* ─────────────────────────────── Controllers ─────────────────────────────── */

/** GET /api/employees?q=...&supervisor=...&organization=...&department=...&status=...&role=... */
export async function listEmployees(req, res) {
  try {
    const { q, supervisor, organization, department, subDepartment, status, role } = req.query
    const filter = {}

    if (supervisor) filter.supervisor = supervisor
    if (organization) filter.organization = organization
    if (department) filter.department = department
    if (subDepartment) filter.subDepartment = subDepartment
    if (status) filter.status = status
    if (role) filter.role = role
    if (q) {
      const rx = new RegExp(q, 'i')
      filter.$or = [
        { name: rx },
        { employeeId: rx },
        { email: rx },
        { department: rx },
        { title: rx },
      ]
    }

    const employees = await Employee.find(filter)
      .populate('supervisor', 'name employeeId')
      .sort({ createdAt: -1 })

    res.json(employees)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

export async function listEmployeeOptions(req, res) {
  try {
    const employees = await Employee.find({}, 'name')
    const options = employees.map((e) => ({ id: e._id, name: e.name }))
    res.json(options)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

/** POST /api/employees */
export async function createEmployee(req, res) {
  try {
    const body = req.body ?? {}
    const {
      name, email, role, username, password,
      organization, department, subDepartment, title,
    } = body

    // 基本檢核（延用你原有邏輯）
    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (!email) return res.status(400).json({ error: 'Email is required' })
    if (!username) return res.status(400).json({ error: 'Username is required' })
    if (!password) return res.status(400).json({ error: 'Password is required' })
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' })
    if (role !== undefined) {
      const validRoles = ['employee', 'supervisor', 'admin']
      if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' })
    }

    // 準備 Employee doc
    const employeeDoc = buildEmployeeDoc(body)

    const employee = await Employee.create(employeeDoc)

    // 主管欄位（空字串已在 build 處理）
    const sup = employee.supervisor ?? undefined

    // 建立 User（沿用你原本行為；User 的密碼雜湊交由 User model 處理）
    await User.create({
      username,
      password,
      role: role ?? 'employee',
      organization,
      department,
      subDepartment,
      employee: employee._id,
      supervisor: sup,
    })

    res.status(201).json(employee)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/** GET /api/employees/:id */
export async function getEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('supervisor', 'name employeeId')
    if (!employee) return res.status(404).json({ error: 'Not found' })
    res.json(employee)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/** PUT /api/employees/:id */
export async function updateEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id)
    if (!employee) return res.status(404).json({ error: 'Not found' })

    const body = req.body ?? {}

    // 若有驗證需求，沿用你原本的 email/role 檢核
    if (isDefined(body.email)) {
      if (!body.email) return res.status(400).json({ error: 'Email is required' })
      const emailRegex = /^\S+@\S+\.\S+$/
      if (!emailRegex.test(body.email)) return res.status(400).json({ error: 'Invalid email' })
    }
    if (isDefined(body.role)) {
      const validRoles = ['employee', 'supervisor', 'admin']
      if (!validRoles.includes(body.role)) return res.status(400).json({ error: 'Invalid role' })
    }

    // 建立 $set/$unset patch
    const { $set, $unset } = buildEmployeePatch(body, employee)

    // 套用更新
    if (Object.keys($unset).length) {
      await Employee.updateOne({ _id: employee._id }, { $unset })
    }
    if (Object.keys($set).length) {
      await Employee.updateOne({ _id: employee._id }, { $set })
    }

    // 取回最新
    const updated = await Employee.findById(employee._id)

    // 同步 User 的屬性
    const userUpdate = {}
    if (isDefined(body.username)) userUpdate.username = body.username
    if (isDefined(body.password)) userUpdate.password = body.password // 交由 User model 做 hash
    if (isDefined(body.role)) userUpdate.role = body.role
    if (isDefined(body.organization)) userUpdate.organization = body.organization
    if (isDefined(body.department)) userUpdate.department = body.department
    if (isDefined(body.subDepartment)) userUpdate.subDepartment = body.subDepartment
    if (isDefined(body.supervisor)) {
      if (body.supervisor === '') userUpdate.supervisor = undefined
      else userUpdate.supervisor = body.supervisor
    }
    if (Object.keys(userUpdate).length) {
      await User.findOneAndUpdate({ employee: employee._id }, userUpdate, { new: true })
    }

    res.json(updated)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}

/** DELETE /api/employees/:id */
export async function deleteEmployee(req, res) {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id)
    if (!employee) return res.status(404).json({ error: 'Not found' })

    // 同步刪除綁定的 User
    await User.findOneAndDelete({ employee: employee._id })

    res.json({ success: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}
