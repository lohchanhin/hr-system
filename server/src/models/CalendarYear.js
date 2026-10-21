import mongoose from 'mongoose';

// 公司行事曆的年度狀態：每年一筆。沒有文件的年度視為「尚未建立」（none）。
// 草稿（draft）由政府辦公日曆表或舊資料轉換產生，人資檢查後「核定」（approved）才算正式；
// 核定後再修改任何一天、套用新版或改設定都會回到草稿，需要重新核定。
const calendarYearSchema = new mongoose.Schema({
  year: { type: Number, required: true, min: 2017, max: 2100, unique: true },
  state: { type: String, enum: ['draft', 'approved'], default: 'draft' },
  // 由舊版假日資料轉換而來、還沒核定過
  migrated: { type: Boolean, default: false },
  source: {
    kind: { type: String, enum: ['dgpa', 'ruyut', 'manual', 'migrated'] },
    snapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'PublicCalendarSnapshot', default: null },
    sha256: { type: String, default: '' },
    resourceDescription: { type: String, default: '' },
    importedAt: Date,
  },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  approvedSha256: { type: String, default: '' },
  approvalNote: { type: String, maxlength: 500, default: '' },
  previousApprovedAt: { type: Date, default: null },
  // 依政府調整放假／補行上班（勞基法第 30 條第 3 項 8 週彈性工時）：只影響行政人員，必須有工會或勞資會議同意
  followGovernmentAdjustments: { type: Boolean, default: false },
  adjustmentAgreement: {
    reference: { type: String, trim: true, maxlength: 200, default: '' },
    date: { type: Date, default: null },
    note: { type: String, maxlength: 500, default: '' },
  },
  // 政府資料有新版本、等待人資檢視差異的快照
  pendingSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'PublicCalendarSnapshot', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });

calendarYearSchema.pre('validate', function requireAdjustmentAgreement(next) {
  if (this.followGovernmentAdjustments) {
    const reference = String(this.adjustmentAgreement?.reference ?? '').trim();
    const date = this.adjustmentAgreement?.date;
    if (!reference || !date || Number.isNaN(new Date(date).getTime())) {
      return next(new Error('labor agreement reference and date are required to follow government adjustments'));
    }
  }
  return next();
});

export default mongoose.model('CalendarYear', calendarYearSchema);
