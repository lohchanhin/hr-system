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
      remark: String,
      color: {
        type: String,
        trim: true,
      },
      bgColor: {
        type: String,
        trim: true,
      }
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
  },
  management: {
    enableImport: { type: Boolean, default: false },
    importFormat: String,
    importMapping: String,
    allowMakeUpClock: { type: Boolean, default: true },
    makeUpDays: Number,
    makeUpNeedApprove: { type: Boolean, default: true },
    supervisorCrossDept: { type: Boolean, default: false },
    hrAllDept: { type: Boolean, default: true },
    employeeHistoryMonths: Number,
    nonExtWorkAlert: { type: Boolean, default: false },
    overtimeNoClockNotify: { type: Boolean, default: true },
    notifyTargets: [String]
  }
});

export default mongoose.model('AttendanceSetting', attendanceSettingSchema);
