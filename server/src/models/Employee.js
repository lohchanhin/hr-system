// backend/models/employee.js
import mongoose from 'mongoose'
import crypto from 'crypto'

const { Schema } = mongoose

function hashPassword(plain) {
  if (!plain) return undefined
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

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
    category: { type: [String], default: [] },
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
    email: { type: String, unique: true, sparse: true, index: true, required: true },
    mobile: { type: String, alias: 'phone' }, // 前端 phone = mobile
    landline: String,
    householdAddress: String, // 戶籍地
    contactAddress: String, // 聯絡地
    lineId: String,

    /* 組織/部門/職稱（C01~C04） */
    organization: String, // 以字串存 _id（若要 population 再改 ObjectId+ref）
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    subDepartment: { type: Schema.Types.ObjectId, ref: 'SubDepartment', default: null }, // C02-1
    supervisor: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    title: String, // C03
    practiceTitle: String, // C04

    // 兼職/打卡
    partTime: { type: Boolean, default: false, alias: 'isPartTime' },
    needClockIn: { type: Boolean, default: true, alias: 'isClocking' },
    
    // 排班設定（主管可選擇是否參與排班）
    requiresScheduling: { type: Boolean, default: true }, // 是否需要排班

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
    salaryItemAmounts: { type: Object, default: {} },

    /* 每月薪資調整項目（動態設定於個人資料） */
    monthlySalaryAdjustments: {
      // 扣款項目
      healthInsuranceFee: { type: Number, default: 0 }, // 健保費自付額
      debtGarnishment: { type: Number, default: 0 }, // 債權扣押
      otherDeductions: { type: Number, default: 0 }, // 其他扣款
      
      // 獎金/津貼項目
      performanceBonus: { type: Number, default: 0 }, // 人力績效獎金
      otherBonuses: { type: Number, default: 0 }, // 其他獎金
      
      // 說明備註
      notes: String, // 調整說明
    },

    /* 勞保設定 */
    laborInsuranceLevel: { type: Number, default: 0 }, // 勞保等級 (1-28)
    autoDeduction: { type: Boolean, default: true }, // 自動扣費
    autoOvertimeCalc: { type: Boolean, default: false }, // 自動加班計算
    lateDeductionEnabled: { type: Boolean, default: false }, // 遲到扣款啟用
    lateDeductionAmount: { type: Number, default: 0 }, // 遲到扣款金額

    /* 特休管理 */
    annualLeave: {
      totalDays: { type: Number, default: 0 }, // 年度特休總天數（可設定）
      usedDays: { type: Number, default: 0 }, // 已使用的特休天數
      year: { type: Number, default: () => new Date().getFullYear() }, // 年度標記
      expiryDate: { type: Date }, // 請假期限
      accumulatedLeave: { type: Number, default: 0 }, // 積假
      notes: { type: String, default: '' }, // 備註
    },
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
    this.passwordHash = hashPassword(plain)
  })

// 特休剩餘天數虛擬欄位
employeeSchema.virtual('annualLeave.remainingDays').get(function () {
  if (!this.annualLeave) return 0
  return (this.annualLeave.totalDays || 0) - (this.annualLeave.usedDays || 0)
})

employeeSchema.methods.verifyPassword = function (plain) {
  if (!this.passwordHash) return false
  const [salt, hash] = this.passwordHash.split(':')
  const check = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex')
  return hash === check
}

employeeSchema.methods.setPassword = function (plain) {
  const hashed = hashPassword(plain)
  if (hashed) {
    this.passwordHash = hashed
  }
}

// 特休相關方法
employeeSchema.methods.canDeductAnnualLeave = function (days) {
  if (!this.annualLeave) return false
  const remaining = (this.annualLeave.totalDays || 0) - (this.annualLeave.usedDays || 0)
  return remaining >= days
}

employeeSchema.methods.deductAnnualLeave = function (days) {
  if (!this.annualLeave) {
    this.annualLeave = { totalDays: 0, usedDays: 0, year: new Date().getFullYear() }
  }
  this.annualLeave.usedDays = (this.annualLeave.usedDays || 0) + days
  return this.save()
}

employeeSchema.methods.resetAnnualLeave = function (totalDays, year) {
  this.annualLeave = {
    totalDays: totalDays || 0,
    usedDays: 0,
    year: year || new Date().getFullYear()
  }
  return this.save()
}

/* -------------------------------- indexes ------------------------------- */

employeeSchema.index({ employeeId: 1 }, { sparse: true })
employeeSchema.index({ name: 1 })
employeeSchema.index({ organization: 1, department: 1 })
employeeSchema.index({ role: 1 })
employeeSchema.index({ status: 1 })

/* -------------------------------- export -------------------------------- */

export default mongoose.model('Employee', employeeSchema)
