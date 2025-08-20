import mongoose from 'mongoose';

const holidayMoveSettingSchema = new mongoose.Schema(
  {
    enableHolidayMove: { type: Boolean, default: false },
    needSignature: { type: Boolean, default: false },
    needMakeup: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('HolidayMoveSetting', holidayMoveSettingSchema);
