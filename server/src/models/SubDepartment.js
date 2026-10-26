import mongoose from 'mongoose';

const subDepartmentSchema = new mongoose.Schema({
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  // 小單位代碼
  code: { type: String, trim: true, maxlength: 60 },
  // 小單位名稱
  name: { type: String, required: true, trim: true, maxlength: 120 },
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
  // 部門主管
  manager: { type: String, trim: true, maxlength: 120 },
  headcount: { type: Number, min: 0 },
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  scheduleSetting: { type: String, trim: true },
  // 排班人員：可以排這個小單位班表的員工（任何角色都可以，不受組織架構限制）；
  // 主管欄位仍只作為簽核使用。舊資料沒有這個欄位，讀到時視為沒有指定
  schedulers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }], default: [] },
  // 使用班別：這個小單位排班時可用的班別（班別設定 AttendanceSetting.shifts 的 _id 字串）；空陣列代表全部班別
  allowedShiftIds: { type: [{ type: String, trim: true }], default: [] }
}, { timestamps: true });

export default mongoose.model('SubDepartment', subDepartmentSchema);
