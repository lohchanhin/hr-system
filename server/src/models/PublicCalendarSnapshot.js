import mongoose from 'mongoose';

// 下載過的一份政府辦公日曆表（原始每日資料 + 分類結果）。同一年度、同來源、同內容（sha256）只存一次。
// 之後比對差異、套用到公司行事曆、判斷「有新版本」都以這裡為準，排班與薪資計算時不會再連網路。
const rowSchema = new mongoose.Schema({
  date: String,
  weekday: Number,
  isOff: Boolean,
  remark: String,
}, { _id: false });

const entrySchema = new mongoose.Schema({
  date: String,
  kind: String,
  name: String,
  statutoryKey: String,
  compensatesDate: String, // 'YYYY-MM-DD' 或 null
  compensatesName: String,
  linkMethod: String,
  synthetic: Boolean,
  derived: String,
  needsReview: Boolean,
  remark: String,
}, { _id: false });

const publicCalendarSnapshotSchema = new mongoose.Schema({
  year: { type: Number, required: true },
  source: { type: String, enum: ['dgpa', 'ruyut'], required: true },
  resourceDescription: { type: String, default: '' },
  url: { type: String, default: '' },
  // 下載網址中 'dgpa/files/YYYYMM/' 的上傳月份
  uploadFolder: { type: String, default: '' },
  sha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
  encoding: { type: String, enum: ['utf-8-bom', 'utf-8', 'big5', 'json'] },
  fetchedAt: Date,
  metadataModifiedDate: { type: String, default: '' },
  rowCount: Number,
  rows: { type: [rowSchema], default: [] },
  entries: { type: [entrySchema], default: [] },
  warnings: { type: [String], default: [] },
  counts: {
    statutory: Number,
    gov_makeup_off: Number,
    gov_bridge_off: Number,
    gov_makeup_workday: Number,
  },
  recommended: { type: Boolean, default: false },
  status: { type: String, enum: ['candidate', 'applied', 'superseded', 'rejected'], default: 'candidate' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });

publicCalendarSnapshotSchema.index({ year: 1, source: 1, sha256: 1 }, { unique: true });
publicCalendarSnapshotSchema.index({ year: 1, status: 1 });

export default mongoose.model('PublicCalendarSnapshot', publicCalendarSnapshotSchema);
