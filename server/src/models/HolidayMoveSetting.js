import mongoose from 'mongoose';

// 全公司統一的國定假日調移（例如經勞資會議同意把某個國定假日改到另一天放）：可以跨月，但一律要有協議文號與同意日期。
// 個別員工的調移需本人同意，記在 HolidaySwap，不在這裡。
const MAX_MOVE_DISTANCE_MS = 366 * 24 * 60 * 60 * 1000;

const holidayMoveSettingSchema = new mongoose.Schema(
  {
    enableHolidayMove: { type: Boolean, default: false },
    // 保留欄位相容舊資料；調移一律需要協議資料，所以預設為 true
    needSignature: { type: Boolean, default: true },
    needMakeup: { type: Boolean, default: false },
    sourceDate: { type: Date, default: null },
    targetDate: { type: Date, default: null },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    agreementReference: { type: String, trim: true, maxlength: 200, default: '' },
    agreementDate: { type: Date, default: null },
    makeupConfirmed: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

function normalizeUtcDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

holidayMoveSettingSchema.pre('validate', function validateMove(next) {
  const hasSource = this.sourceDate != null;
  const hasTarget = this.targetDate != null;
  if (hasSource !== hasTarget) {
    return next(new Error('sourceDate and targetDate must be provided together'));
  }
  if (!hasSource) return next();

  // 調移國定假日一律需要勞資會議（或工會）同意的協議文號與日期
  if (!String(this.agreementReference ?? '').trim() || !this.agreementDate) {
    return next(new Error('labor agreement reference and date are required'));
  }
  if (this.needMakeup && !this.makeupConfirmed) {
    return next(new Error('makeup holiday must be explicitly confirmed'));
  }

  const source = normalizeUtcDate(this.sourceDate);
  const target = normalizeUtcDate(this.targetDate);
  if (!source || !target) {
    return next(new Error('sourceDate and targetDate must be valid dates'));
  }
  if (!this.enableHolidayMove) {
    return next(new Error('dated holiday moves must be enabled'));
  }
  if (source.getTime() === target.getTime()) {
    return next(new Error('targetDate must differ from sourceDate'));
  }
  // 可以跨月（例如 2027-02-28 週日的和平紀念日移到 3/2），但不能超過一年
  if (Math.abs(target.getTime() - source.getTime()) > MAX_MOVE_DISTANCE_MS) {
    return next(new Error('national holiday moves must stay within 366 days'));
  }
  this.sourceDate = source;
  this.targetDate = target;
  return next();
});

holidayMoveSettingSchema.index(
  { sourceDate: 1 },
  { unique: true, partialFilterExpression: { sourceDate: { $type: 'date' } } },
);
holidayMoveSettingSchema.index({ targetDate: 1 });
holidayMoveSettingSchema.index({ agreementDate: 1 });

export default mongoose.model('HolidayMoveSetting', holidayMoveSettingSchema);
