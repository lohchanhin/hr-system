import mongoose from 'mongoose';

const breakSettingSchema = new mongoose.Schema(
  {
    enableGlobalBreak: { type: Boolean, default: false },
    breakMinutes: { type: Number, default: 60 },
    allowMultiBreak: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('BreakSetting', breakSettingSchema);
