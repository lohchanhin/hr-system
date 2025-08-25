import mongoose from 'mongoose';

const attendanceSettingSchema = new mongoose.Schema({
  shifts: [
    {
      name: String,
      code: String,
      startTime: String,
      endTime: String,
      breakTime: String,
      crossDay: Boolean,
      remark: String
    }
  ],
  abnormalRules: {
    lateGrace: Number,
    earlyLeaveGrace: Number,
    missingThreshold: Number,
    autoNotify: Boolean
  },
  breakOutRules: {
    enableBreakPunch: Boolean,
    breakInterval: Number,
    outingNeedApprove: Boolean
  },
  overtimeRules: {
    weekdayThreshold: Number,
    holidayRate: Number,
    toCompRate: Number
  }
});

export default mongoose.model('AttendanceSetting', attendanceSettingSchema);
