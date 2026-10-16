import mongoose from 'mongoose';

// 國定假日休假紀錄的「處理方式」：員工某個國定假日沒有休到時，HR 登記後續怎麼處理。
// 休假紀錄本身（當日休、移休到哪天、沒休）一律由班表（ShiftSchedule 的「國」）即時推算，不存在這裡；
// 這個集合只存人工決定，一個員工的一個國定假日最多一筆。
export const HOLIDAY_RESOLUTION_KINDS = ['compensatory_leave', 'paid', 'rested_later', 'waived'];

const holidayRestResolutionSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  // 假日行事曆上的「原始日期」（UTC 午夜）：公司挪移國定假日時有效日期會變，原始日期不會，所以用它當鍵
  holidayDate: { type: Date, required: true },
  holidayName: { type: String, trim: true, maxlength: 100, default: '' },
  // 假日所在月份 YYYY-MM，方便按月查詢
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  kind: { type: String, enum: HOLIDAY_RESOLUTION_KINDS, required: true },
  // 只有 kind = compensatory_leave（補休）才有：補休時數
  compensatoryHours: { type: Number, min: 0, max: 24 },
  // 只有 kind = rested_later（已另行補休）才有：實際補休的日期
  restedDate: { type: Date },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });

holidayRestResolutionSchema.index({ employee: 1, holidayDate: 1 }, { unique: true });
holidayRestResolutionSchema.index({ month: 1 });

export default mongoose.model('HolidayRestResolution', holidayRestResolutionSchema);
