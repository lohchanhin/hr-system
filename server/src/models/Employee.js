import mongoose from 'mongoose';

const experienceSchema = new mongoose.Schema({
  organization: String,
  title: String,
  start: Date,
  end: Date
}, { _id: false });

const licenseSchema = new mongoose.Schema({
  name: String,
  number: String,
  issueDate: Date,
  expiryDate: Date,
  file: String
}, { _id: false });

const trainingSchema = new mongoose.Schema({
  name: String,
  code: String,
  date: Date,
  file: String,
  category: String,
  score: Number
}, { _id: false });

const contactSchema = new mongoose.Schema({
  name: String,
  relation: String,
  phone1: String,
  phone2: String
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  // 基本資料
  employeeId: String,
  name: { type: String, required: true },
  photo: String,
  gender: { type: String, enum: ['男', '女', '其他'] },
  idNumber: String,
  birthDate: Date,
  birthPlace: String,
  bloodType: { type: String, enum: ['A', 'B', 'O', 'AB', 'HR'] },
  languages: [String],
  disabilityLevel: String,
  identityCategory: String,
  maritalStatus: { type: String, enum: ['已婚', '未婚', '離婚', '喪偶'] },
  dependents: { type: Number, default: 0 },

  // 聯絡方式
  phone: String,
  mobile: String,
  email: { type: String, unique: true },
  address: String,
  mailingAddress: String,
  lineId: String,

  // 部門與職稱
  organization: String,
  department: String,
  subDepartment: String,
  title: String,
  practiceTitle: String,
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  role: {
    type: String,
    enum: ['employee', 'supervisor', 'hr', 'admin'],
    default: 'employee'
  },
  partTime: { type: Boolean, default: false },
  needClockIn: { type: Boolean, default: true },

  // 在職狀態
  status: {
    type: String,
    enum: ['在職', '試用', '離職', '停薪'],
    default: '在職'
  },
  probationDays: { type: Number, default: 0 },

  // 身體檢查
  medicalCheck: {
    height: Number,
    weight: Number,
    bloodType: { type: String, enum: ['A', 'B', 'O', 'AB', 'HR'] }
  },

  // 學歷
  education: {
    level: String,
    school: String,
    major: String,
    status: String,
    graduationYear: Number
  },

  // 役別資訊
  militaryService: {
    type: String,
    branch: String,
    rank: String,
    dischargeYear: Number
  },

  emergencyContacts: [contactSchema],

  keywords: String,

  experiences: [experienceSchema],
  licenses: [licenseSchema],
  trainings: [trainingSchema],

  // 聘任 / 任職日期
  appointment: {
    hireDate: Date,
    startDate: Date,
    resignationDate: Date,
    dismissalDate: Date,
    practiceTitle: String,
    rehireStartDate: Date,
    rehireEndDate: Date,
    remark: String
  }

}, { timestamps: true });

export default mongoose.model('Employee', employeeSchema);
