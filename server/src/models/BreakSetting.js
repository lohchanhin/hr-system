import mongoose from 'mongoose';

const { Schema } = mongoose;

const breakSettingSchema = new Schema(
  {
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    subDepartment: { type: Schema.Types.ObjectId, ref: 'SubDepartment' },
    enableGlobalBreak: { type: Boolean, default: false },
    breakMinutes: { type: Number, default: 60 },
    allowMultiBreak: { type: Boolean, default: false }
  },
  { timestamps: true }
);

breakSettingSchema.pre('validate', function (next) {
  const hasDepartment = Boolean(this.department);
  const hasSubDepartment = Boolean(this.subDepartment);

  if (!hasDepartment && !hasSubDepartment) {
    next(new Error('BreakSetting 必須指定部門或小單位')); // 驗證：至少需有一個範圍
    return;
  }

  if (hasDepartment && hasSubDepartment) {
    next(new Error('BreakSetting 不能同時指定部門與小單位'));
    return;
  }

  next();
});

breakSettingSchema.index({ department: 1 }, { unique: true, sparse: true });
breakSettingSchema.index({ subDepartment: 1 }, { unique: true, sparse: true });

export default mongoose.model('BreakSetting', breakSettingSchema);
