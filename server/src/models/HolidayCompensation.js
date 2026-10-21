import mongoose from 'mongoose';

// 國定假日「補假」義務：某個國定假日剛好落在員工自己的休息日／例假（輪班人員依班表、行政人員依週末或公司休息日），
// 依勞基法施行細則第 23-1 條應另給補假，補假日期由勞雇雙方協商。一個員工的一個國定假日最多一筆，資料永不刪除。
export const HOLIDAY_COMPENSATION_STATUSES = ['open', 'assigned', 'void'];
export const HOLIDAY_COMPENSATION_ORIGINS = ['roster_rest_day', 'office_weekend', 'manual'];
export const HOLIDAY_COMPENSATION_VOID_REASONS = ['covered_by_roster', 'roster_changed', 'holiday_removed', 'not_applicable', 'manual'];

const holidayCompensationSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  // 國定假日的「原始日期」（UTC 午夜，公司挪移前的日期）：和 HolidayRestResolution 一樣用它當穩定的鍵
  holidayDate: { type: Date, required: true },
  holidayName: { type: String, trim: true, maxlength: 100, default: '' },
  calendarDay: { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday', default: null },
  // roster_rest_day：輪班人員班表排休／例；office_weekend：行政人員週末或公司休息日；manual：人資手動新增
  origin: { type: String, enum: HOLIDAY_COMPENSATION_ORIGINS, required: true },
  dayKindAtDetection: { type: String, enum: ['rest_day', 'regular_rest', 'office_rest_day', 'manual'], default: 'manual' },
  status: { type: String, enum: HOLIDAY_COMPENSATION_STATUSES, default: 'open' },
  // 系統建議的補假日（國定假日之後第一個上班日），僅供參考
  suggestedDate: { type: Date, default: null },
  // 實際排定的補假日（只有 status = assigned 才有）
  assignedDate: { type: Date, default: null },
  agreementNote: { type: String, trim: true, maxlength: 500, default: '' }, // 勞雇協商紀錄（施行細則 §23-1 補假期日由勞雇雙方協商）
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  assignedAt: { type: Date, default: null },
  // 已排定補假，但觸發條件已不成立（例如班表改了）：不會自動作廢，只標記請人資確認
  conflict: { type: Boolean, default: false },
  voidReason: { type: String, enum: HOLIDAY_COMPENSATION_VOID_REASONS, default: undefined },
  voidedAt: { type: Date, default: null },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  // 系統自動建立時為 null
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });

holidayCompensationSchema.pre('validate', function enforceAssignedDate(next) {
  if (this.status === 'assigned') {
    if (!this.assignedDate) {
      this.invalidate('assignedDate', 'assignedDate is required when the compensation is assigned');
    }
  } else if (this.assignedDate) {
    this.assignedDate = null;
  }
  next();
});

holidayCompensationSchema.index({ employee: 1, holidayDate: 1 }, { unique: true });
holidayCompensationSchema.index({ status: 1, holidayDate: 1 });
holidayCompensationSchema.index({ employee: 1, assignedDate: 1 });

export default mongoose.model('HolidayCompensation', holidayCompensationSchema);
