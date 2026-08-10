import mongoose from 'mongoose';

const holidayMoveSettingSchema = new mongoose.Schema(
  {
    enableHolidayMove: { type: Boolean, default: false },
    needSignature: { type: Boolean, default: false },
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

  if (this.needSignature && (!this.agreementReference || !this.agreementDate)) {
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
  if (
    source.getUTCFullYear() !== target.getUTCFullYear()
    || source.getUTCMonth() !== target.getUTCMonth()
  ) {
    return next(new Error('national holidays may only move within the same month'));
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
