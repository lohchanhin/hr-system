import mongoose from 'mongoose';

// 薪資政策（後台「薪資設定」可調整的計算規則）：整個系統只有一份文件（key: 'default'）。
// 欄位一律沒有預設值：沒存的欄位就是「用預設值」（預設值在 services/payrollPolicyService.js），
// 舊資料庫沒有這份文件也一樣，不需要搬資料。
const overtimeRateFields = {
  weekdayFirst2: Number,
  weekdayAfter2: Number,
  restDayFirst2: Number,
  restDayHours3To8: Number,
  restDayHours9To12: Number,
  holidayWithin8: Number,
  holidayAfter8First2: Number,
  holidayAfter10: Number,
};

const payrollPolicySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  proration: {
    method: { type: String }, // 月中到職、離職的月薪比例：days30 / calendarDays / none
  },
  overtime: {
    rates: overtimeRateFields, // 加班費倍率
    newEmployeeAutoCalc: { type: Boolean }, // 新增員工時「自動計算加班費」的預設值
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });

export default mongoose.model('PayrollPolicy', payrollPolicySchema);
