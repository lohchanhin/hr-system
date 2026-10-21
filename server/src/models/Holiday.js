import mongoose from 'mongoose';
import { HOLIDAY_KINDS } from '../services/holidayCalendarRules.js';

// 公司行事曆的「一天」：國定假日、公務機關補假／調整放假／補行上班、公司休息日／上班日、指定應放假日。
// kind 才是判斷依據（見 services/holidayCalendarRules.js）；type 只是給舊畫面看的顯示字串。
// 匯入（政府辦公日曆表）建立的資料由人資修改或刪除時會標記 hrEdited / archived，重新匯入不會蓋掉。
const holidaySchema = new mongoose.Schema({
  name: { type: String, default: '' },
  date: { type: Date, required: true },
  type: { type: String, default: '國定假日' },
  desc: String,
  description: String,
  source: String,
  // 舊資料在啟動時的資料轉換之前沒有 kind，所以不設為必填；所有寫入的地方都必須給 kind
  kind: { type: String, enum: HOLIDAY_KINDS },
  year: { type: Number },
  statutoryKey: { type: String, default: '' },
  // 只有 gov_makeup_off：補的是哪一天的國定假日（可能在別的月份或年度，例如 2027-12-31 補 2028-01-01）
  compensatesDate: { type: Date, default: null },
  compensatesName: { type: String, default: '' },
  linkMethod: { type: String, enum: ['rule', 'nearest', 'manual', 'none'], default: undefined },
  // public = 來自套用的政府資料；rule = 系統依法補上（例如 2025 年以前的勞動節）；migrated = 舊資料轉換；manual = 人資新增
  origin: { type: String, enum: ['public', 'rule', 'migrated', 'manual'], default: 'manual' },
  publicSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'PublicCalendarSnapshot', default: null },
  // 人資改過或刪除過匯入的資料：重新匯入時不會覆蓋，除非在差異畫面明確選「採用政府資料」
  hrEdited: { type: Boolean, default: false },
  // 已刪除（保留紀錄）。除了管理清單勾選「顯示已刪除」以外，一律排除
  archived: { type: Boolean, default: false },
  needsReview: { type: Boolean, default: false },
  reviewNote: { type: String, default: '', maxlength: 300 },
  // 只有 designated：沒有投票權等不適用的員工
  excludedEmployees: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }], default: [] },
  note: { type: String, default: '', maxlength: 500 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });

holidaySchema.pre('validate', function setYearFromDate(next) {
  const date = this.date instanceof Date ? this.date : (this.date ? new Date(this.date) : null);
  if (date && !Number.isNaN(date.getTime())) this.year = date.getUTCFullYear();
  next();
});

holidaySchema.index({ date: 1 });
// 同一天同一類型只能有一筆有效資料；舊資料（還沒有 archived 欄位）在資料轉換前不在索引內
holidaySchema.index(
  { date: 1, kind: 1 },
  { unique: true, partialFilterExpression: { archived: false }, name: 'holiday_date_kind_active' },
);
holidaySchema.index(
  { compensatesDate: 1 },
  { partialFilterExpression: { compensatesDate: { $type: 'date' } } },
);
holidaySchema.index({ year: 1, kind: 1 });

export default mongoose.model('Holiday', holidaySchema);
