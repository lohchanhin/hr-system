import mongoose from 'mongoose';

// 個人調移：把某位員工的一個國定假日和一個工作日對調。依勞動部解釋須經員工本人同意（工會或勞資會議同意不能取代），
// 所以每筆都要有本人的同意紀錄。調移後原國定假日成為一般工作日、調移日具國定假日性質。紀錄只撤銷、不刪除。
export const HOLIDAY_SWAP_STATUSES = ['active', 'revoked'];
export const CONSENT_METHODS = ['signature', 'written_form', 'electronic'];

const MAX_SWAP_DISTANCE_MS = 366 * 24 * 60 * 60 * 1000;

const consentSchema = new mongoose.Schema({
  method: { type: String, enum: CONSENT_METHODS, required: true },
  consentedAt: { type: Date, required: true },
  // 同意文件編號或存放位置
  evidenceRef: { type: String, trim: true, maxlength: 200, required: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
}, { _id: false });

const holidaySwapSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  // 原國定假日（UTC 午夜）
  originalDate: { type: Date, required: true },
  originalName: { type: String, trim: true, maxlength: 100, default: '' },
  // 調移到的日子（UTC 午夜）
  targetDate: { type: Date, required: true },
  status: { type: String, enum: HOLIDAY_SWAP_STATUSES, default: 'active' },
  consent: { type: consentSchema, required: true },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true });

holidaySwapSchema.pre('validate', function enforceSwapRules(next) {
  const original = this.originalDate instanceof Date ? this.originalDate.getTime() : NaN;
  const target = this.targetDate instanceof Date ? this.targetDate.getTime() : NaN;
  if (Number.isFinite(original) && Number.isFinite(target)) {
    if (original === target) {
      this.invalidate('targetDate', 'targetDate must differ from originalDate');
    } else if (Math.abs(target - original) > MAX_SWAP_DISTANCE_MS) {
      this.invalidate('targetDate', 'holiday swaps must stay within 366 days');
    }
  }
  const evidenceRef = typeof this.consent?.evidenceRef === 'string' ? this.consent.evidenceRef.trim() : '';
  if (!evidenceRef) {
    this.invalidate('consent.evidenceRef', 'consent evidence is required');
  }
  next();
});

holidaySwapSchema.index(
  { employee: 1, originalDate: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
holidaySwapSchema.index({ employee: 1, targetDate: 1 });
holidaySwapSchema.index({ status: 1, targetDate: 1 });

export default mongoose.model('HolidaySwap', holidaySwapSchema);
