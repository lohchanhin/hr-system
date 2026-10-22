import mongoose from 'mongoose';

// 調休存摺的一筆額度（CompensatoryCredit）。國定假日剛好落在員工自己的休息日／例假時（輪班人員依班表、行政人員依週末或公司休息日），
// 員工得到一筆調休（預設 8 小時），預設「保存」，由員工自己決定什麼時候用（發起調休簽核）；人資也可以手動給予或指定日期。
// 和舊的補假義務（HolidayCompensation，一個國定假日只能排一個補假日）不同：額度有時數、可以分好幾次用（4 + 4 小時）、
// 也有不是國定假日的來源（人資手動給予、轉入既有補休時數），所以另外一個集合，舊集合原封不動保留（回復舊版程式時仍可使用）。
// 資料永不刪除：條件不成立時只作廢（void），已使用的額度條件消失時只標記（conflict）請人資確認，不會自動收回。
export const COMPENSATORY_CREDIT_SOURCE_TYPES = ['holiday_rest', 'manual', 'legacy_balance'];
// holiday_rest 的原因：輪班人員班表的休息日／例假；行政人員的週六、週日、公司休息日；人資手動補登的國定假日
export const COMPENSATORY_CREDIT_REASONS = [
  'rest_day', 'regular_rest', 'office_saturday', 'office_sunday', 'office_rest_day', 'manual_holiday', 'manual', 'legacy',
];
// available 還有剩餘時數（可能已用一部分）、used 用完、void 作廢；「已過期」依假別規則的期限即時判斷，不另存狀態
export const COMPENSATORY_CREDIT_STATUSES = ['available', 'used', 'void'];
export const COMPENSATORY_CREDIT_VOID_REASONS = ['covered_by_roster', 'roster_changed', 'holiday_removed', 'not_applicable', 'manual'];
// 使用方式：leave_request 員工的調休簽核核准；hr_assigned 人資指定日期（HR 指定）；adjustment 人資扣除調整（沒有日期）
export const COMPENSATORY_USAGE_KINDS = ['leave_request', 'hr_assigned', 'adjustment'];
export const COMPENSATORY_CONFLICT_REASONS = ['trigger_gone', 'holiday_removed', 'date_not_workday'];

const usageDaySchema = new mongoose.Schema({
  date: { type: String, required: true }, // 台灣日期 YYYY-MM-DD
  hours: { type: Number, required: true },
}, { _id: false });

const usageSchema = new mongoose.Schema({
  kind: { type: String, enum: COMPENSATORY_USAGE_KINDS, required: true },
  // 這筆額度在這次使用扣了幾小時（一張簽核單可能跨好幾筆額度，依到期日、取得日先後扣）
  hours: { type: Number, required: true, min: 0 },
  approvalRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
  // 這次使用涵蓋的日子與各日時數（整張單的分布，跨好幾筆額度時每一筆都記同一份）
  days: { type: [usageDaySchema], default: [] },
  // 整天調休的日子：當天對這位員工具國定假日性質（holidayResolver），當天上班以國定假日出勤計
  fullDayDates: { type: [String], default: [] },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  at: { type: Date, default: Date.now },
});

const compensatoryCreditSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  sourceType: { type: String, enum: COMPENSATORY_CREDIT_SOURCE_TYPES, required: true },
  // 唯一鍵（同一位員工）：holiday_rest:YYYY-MM-DD（同一個國定假日只有一筆）、manual:<id>、legacy_balance
  sourceKey: { type: String, required: true, trim: true, maxlength: 80 },
  reason: { type: String, enum: COMPENSATORY_CREDIT_REASONS, required: true },
  // 國定假日的原始日期（UTC 午夜，公司挪移前的日期）；不是國定假日來源時為 null
  holidayDate: { type: Date, default: null },
  holidayName: { type: String, trim: true, maxlength: 100, default: '' },
  calendarDay: { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday', default: null },
  // 取得日（UTC 午夜）：國定假日來源是國定假日當天，其他是給予的日子；扣用順序與期限都從這天算
  earnedDate: { type: Date, required: true },
  hours: { type: Number, required: true, min: 0 },
  usedHours: { type: Number, default: 0, min: 0 },
  usages: { type: [usageSchema], default: [] },
  status: { type: String, enum: COMPENSATORY_CREDIT_STATUSES, default: 'available' },
  // 建議調休日（行政人員是公務機關補假日，其他是國定假日之後第一個上班日），僅供參考
  suggestedDate: { type: Date, default: null },
  voidReason: { type: String, enum: COMPENSATORY_CREDIT_VOID_REASONS, default: undefined },
  voidedAt: { type: Date, default: null },
  // 已使用的額度，但取得條件已不成立（例如班表把例假改成上班）：不自動收回，標記請人資確認
  conflict: { type: Boolean, default: false },
  conflictReason: { type: String, enum: COMPENSATORY_CONFLICT_REASONS, default: undefined },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  // 系統自動建立時為 null
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  // 由舊的補假義務轉入（HolidayCompensation 的 _id）
  migratedFrom: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });

compensatoryCreditSchema.index({ employee: 1, sourceKey: 1 }, { unique: true });
compensatoryCreditSchema.index({ employee: 1, status: 1, earnedDate: 1 });
compensatoryCreditSchema.index({ employee: 1, holidayDate: 1 });
compensatoryCreditSchema.index({ employee: 1, 'usages.fullDayDates': 1 });
compensatoryCreditSchema.index({ 'usages.approvalRequest': 1 });

export default mongoose.model('CompensatoryCredit', compensatoryCreditSchema);
