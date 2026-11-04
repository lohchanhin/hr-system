import mongoose from 'mongoose';

const subDepartmentSchema = new mongoose.Schema({
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  // 小單位代碼（員工批次匯入用代碼或名稱對應小單位）
  code: { type: String, trim: true, maxlength: 60 },
  // 小單位名稱
  name: { type: String, required: true, trim: true, maxlength: 120 },
  // 以下 unitName 到 scheduleSetting 是舊欄位：沒有任何功能讀取（報表、薪資、保險、匯出入、排班、簽核都不用），
  // 小單位設定畫面已不顯示也不送出（客戶 2026/11 要求拿掉沒有功能的欄位，避免混淆）；
  // 欄位與資料保留，API 仍接受，沒送的欄位不會被清掉。說明見 docs/scheduler-access.md
  // 單位名稱
  unitName: { type: String, trim: true, maxlength: 120 },
  // 機構代碼
  institutionCode: { type: String, trim: true, maxlength: 60 },
  // 統一編號
  uniformNumber: {
    type: String,
    trim: true,
    validate: {
      validator: value => !value || /^\d{8}$/.test(value),
      message: '統一編號需為 8 碼數字'
    }
  },
  // 勞保證號
  laborInsuranceNumber: {
    type: String,
    trim: true,
    maxlength: 20,
    validate: {
      validator: value => !value || /^[0-9A-Za-z-]+$/.test(value),
      message: '勞保證號格式不正確'
    }
  },
  // 健保編號
  healthInsuranceNumber: {
    type: String,
    trim: true,
    maxlength: 20,
    validate: {
      validator: value => !value || /^[0-9A-Za-z-]+$/.test(value),
      message: '健保編號格式不正確'
    }
  },
  // 稅籍編號
  taxRegistrationNumber: {
    type: String,
    trim: true,
    maxlength: 30,
    validate: {
      validator: value => !value || /^[0-9A-Za-z-]+$/.test(value),
      message: '稅籍編號格式不正確'
    }
  },
  // 位置
  location: { type: String, trim: true, maxlength: 200 },
  // 連絡電話
  phone: {
    type: String,
    trim: true,
    maxlength: 30,
    validate: {
      validator: value => !value || /^[0-9+\-()\s]+$/.test(value),
      message: '連絡電話格式不正確'
    }
  },
  // 負責人
  responsiblePerson: { type: String, trim: true, maxlength: 120 },
  // 部門主管（文字，只是記錄；簽核找的是員工資料的直屬主管 Employee.supervisor）
  manager: { type: String, trim: true, maxlength: 120 },
  // 人力需求數
  headcount: { type: Number, min: 0 },
  // 班表拉選（單一預設班別，API 以 shiftId 收送）：排班頁、匯入都不使用，排班可用的班別看下方的 allowedShiftIds
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  scheduleSetting: { type: String, trim: true },
  // 排班人員：可以排這個小單位班表的員工（任何角色都可以，不受組織架構限制）；
  // 簽核仍看員工資料的直屬主管。舊資料沒有這個欄位，讀到時視為沒有指定
  schedulers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }], default: [] },
  // 使用班別：這個小單位排班時可用的上班班別（班別設定 AttendanceSetting.shifts 的 _id 字串）；空陣列代表全部班別。
  // 不用上班的班別（休息日、例假、國定假日、請假）不論有沒有選都可以用（scheduleAccessService.isShiftAllowedByRules）
  allowedShiftIds: { type: [{ type: String, trim: true }], default: [] }
}, { timestamps: true });

export default mongoose.model('SubDepartment', subDepartmentSchema);
