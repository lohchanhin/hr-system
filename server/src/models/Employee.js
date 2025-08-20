// backend/models/employee.js
import mongoose from 'mongoose'
import crypto from 'crypto'

const { Schema } = mongoose

/* ----------------------------- sub-schemas ----------------------------- */

const experienceSchema = new Schema(
  {
    // 前端送 unit；舊資料用 organization
    unit: { type: String, alias: 'organization' },
    title: String,
    start: Date,
    end: Date,
  },
  { _id: false }
)

const licenseSchema = new Schema(
  {
    name: String,
    number: String,
    // 前端：startDate/endDate；舊欄位：issueDate/expiryDate
    startDate: { type: Date, alias: 'issueDate' },
    endDate: { type: Date, alias: 'expiryDate' },
    // 前端 el-upload 常用 fileList（多檔）；舊欄位 file（單檔）
    files: { type: [String], default: [], alias: 'fileList' },
    file: String,
  },
  { _id: false }
)

const trainingSchema = new Schema(
  {
    // 前端：course / courseNo；舊欄位：name / code
    course: { type: String, alias: 'name' },
    courseNo: { type: String, alias: 'code' },
    date: Date,
    // 多檔
    files: { type: [String], default: [], alias: 'fileList' },
    category: String,
    score: Number,
  },
  { _id: false }
)

const contactSchema = new Schema(
  {
    name: String,
    relation: String, // C09 稱謂
    phone1: String,
    phone2: String,
  },
  { _id: false }
)

/* -------------------------------- schema -------------------------------- */

const employeeSchema = new Schema(
  {
    /* 帳號/權限（如有獨立 Auth 可忽略 username/passwordHash） */
    username: { type: String, unique: true, sparse: true, index: true },
    passwordHash: { type: String, select: false }, // 使用 virtual: password 設定
    role: {
      type: String,
      enum: ['employee', 'supervisor', 'admin'],
      default: 'employee',
    },
    permissionGrade: String, // 權限/職等（不可控定義可由後台維護）

    /* 簽核/標籤 */
    signRole: String, // 角色
    signTags: { type: [String], default: [] }, // 標籤（tag）
    signLevel: String, // 層級

    /* 基本資料 */
    employeeId: { type: String, alias: 'employeeNo', index: true }, // 舊欄位名保留
    name: { type: String, required: true },
    photo: String,
    // 前端可送 'M'/'F'/'O'；若你要中文可改 enum: ['男','女','其他']
    gender: { type: String, enum: ['M', 'F', 'O'], default: 'M' },
    idNumber: String,
    birthDate: { type: Date, alias: 'birthday' },
    birthPlace: String,
    bloodType: { type: String, enum: ['A', 'B', 'O', 'AB', 'HR'] },
    languages: { type: [String], default: [] }, // C05
    disabilityLevel: String, // C06
    identityCategory: { type: [String], default: [] }, // C07 多選
    maritalStatus: { type: String, enum: ['已婚', '未婚', '離婚', '喪偶'] },
    dependents: { type: Number, default: 0 }, // 扣繳

    /* 聯絡方式 */
    email: { type: String, unique: true, sparse: true, index: true },
    mobile: { type: String, alias: 'phone' }, // 前端 phone = mobile
    landline: String,
    householdAddress: String, // 戶籍地
    contactAddress: String, // 聯絡地
    lineId: String,

    /* 組織/部門/職稱（C01~C04） */
    organization: String, // 以字串存 _id（若要 population 再改 ObjectId+ref）
    department: String,
    subDepartment: String, // C02-1
    supervisor: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    title: String, // C03
    practiceTitle: String, // C04

    // 兼職/打卡
    partTime: { type: Boolean, default: false, alias: 'isPartTime' },
    needClockIn: { type: Boolean, default: true, alias: 'isClocking' },

    /* 人員狀態與試用 */
    status: {
      type: String,
      enum: ['正職員工', '試用期員工', '離職員工', '留職停薪'],
      default: '正職員工',
      alias: 'employmentStatus',
    },
    probationDays: { type: Number, default: 0 },

    /* 身體檢查 */
    medicalCheck: {
      height: Number,
      weight: Number,
      bloodType: { type: String, enum: ['A', 'B', 'O', 'AB', 'HR'] },
    },

    /* 學歷（C08） */
    education: {
      level: String, // 教育程度
      school: String,
      major: String,
      status: String, // 畢業/肄業
      graduationYear: Number,
    },

    /* 役別 */
    militaryService: {
      serviceType: { type: String, alias: 'type' }, // 類別（志願役/義務役）
      branch: String, // 軍種
      rank: String, // 軍階
      dischargeYear: Number, // 退伍年
    },

    /* 緊急聯絡人（陣列），並提供 emergency1/2 虛擬欄位對應 */
    emergencyContacts: { type: [contactSchema], default: [] },

    /* 關鍵字 */
    keywords: String,

    /* 經歷 / 證照 / 訓練 */
    experiences: { type: [experienceSchema], default: [] },
    licenses: { type: [licenseSchema], default: [] },
    trainings: { type: [trainingSchema], default: [] },

    /* 任職日期群組（與前端欄位 alias 對齊） */
    appointment: {
      hireDate: Date, // 到職日期
      startDate: { type: Date, alias: 'appointDate' }, // 起聘日期
      resignationDate: Date, // 離職日期
      dismissalDate: Date, // 解聘日期
      rehireStartDate: { type: Date, alias: 'reAppointDate' }, // 再任起聘
      rehireEndDate: { type: Date, alias: 'reDismissDate' }, // 再任解聘
      remark: String, // 備註
    },

    /* 薪資（新加入） */
    salaryType: String, // 月薪/日薪/時薪
    salaryAmount: { type: Number, default: 0 },
    laborPensionSelf: { type: Number, default: 0 },
    employeeAdvance: { type: Number, default: 0 },
    salaryAccountA: {
      bank: String,
      acct: String,
    },
    salaryAccountB: {
      bank: String,
      acct: String,
    },
    salaryItems: { type: [String], default: [] }, // 多選
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.passwordHash
        delete ret.__v
        return ret
      },
    },
    toObject: { virtuals: true },
  }
)

/* ------------------------------ virtuals ------------------------------ */

// 前端會送 emergency1 / emergency2，這裡把它轉成陣列 emergencyContacts[0..1]
employeeSchema.virtual('emergency1')
  .get(function () {
    return Array.isArray(this.emergencyContacts) ? this.emergencyContacts[0] : undefined
  })
  .set(function (v) {
    if (!this.emergencyContacts) this.emergencyContacts = []
    this.emergencyContacts[0] = v
  })

employeeSchema.virtual('emergency2')
  .get(function () {
    return Array.isArray(this.emergencyContacts) ? this.emergencyContacts[1] : undefined
  })
  .set(function (v) {
    if (!this.emergencyContacts) this.emergencyContacts = []
    this.emergencyContacts[1] = v
  })

// 設定 password 虛擬欄位：自動以 PBKDF2 產生 salt:hash 寫入 passwordHash
employeeSchema
  .virtual('password')
  .set(function (plain) {
    if (!plain) return
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex')
    this.passwordHash = `${salt}:${hash}`
  })

employeeSchema.methods.verifyPassword = function (plain) {
  if (!this.passwordHash) return false
  const [salt, hash] = this.passwordHash.split(':')
  const check = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex')
  return hash === check
}

/* -------------------------------- indexes ------------------------------- */

employeeSchema.index({ employeeId: 1 }, { sparse: true })
employeeSchema.index({ name: 1 })
employeeSchema.index({ organization: 1, department: 1 })
employeeSchema.index({ role: 1 })
employeeSchema.index({ status: 1 })

/* -------------------------------- export -------------------------------- */

export default mongoose.model('Employee', employeeSchema)
