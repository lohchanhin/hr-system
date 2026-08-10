import mongoose from 'mongoose';

const attendanceSettingSchema = new mongoose.Schema({
  shifts: [
    {
      name: String,
      code: String,
      semanticType: {
        type: String,
        enum: ['work', 'rest_day', 'regular_rest', 'holiday', 'leave'],
        default: 'work',
      },
      startTime: String,
      endTime: String,
      breakTime: String,
      breakMinutes: Number,
      breakDuration: { type: Number, default: 0 },
      breakWindows: [
        {
          start: String,
          end: String,
          label: String,
        },
      ],
      allowMultiBreak: Boolean,
      crossDay: Boolean,
      remark: String,
      color: {
        type: String,
        trim: true,
      },
      bgColor: {
        type: String,
        trim: true,
      },
      // Night shift allowance settings (fixed allowance only)
      isNightShift: { type: Boolean, default: false }, // Whether this is a night shift
      hasAllowance: { type: Boolean, default: false }, // Whether allowance is enabled
      fixedAllowanceAmount: { type: Number, default: 0 }, // Fixed allowance amount per night shift
    }
  ],
  abnormalRules: {
    lateGrace: Number,
    earlyLeaveGrace: Number,
    missingThreshold: Number,
    autoNotify: Boolean,
    // 遲到早退扣款設定
    lateDeductionEnabled: { type: Boolean, default: false }, // 啟用遲到扣款
    lateDeductionAmount: { type: Number, default: 0 }, // 每次遲到扣款金額
    earlyLeaveDeductionEnabled: { type: Boolean, default: false }, // 啟用早退扣款
    earlyLeaveDeductionAmount: { type: Number, default: 0 }, // 每次早退扣款金額
  },
  breakOutRules: {
    enableBreakPunch: Boolean,
    breakInterval: Number,
    outingNeedApprove: Boolean
  },
  globalBreakSetting: {
    enableGlobalBreak: { type: Boolean, default: false },
    breakMinutes: { type: Number, default: 60 },
    allowMultiBreak: { type: Boolean, default: false },
  },
  overtimeRules: {
    weekdayThreshold: Number,
    holidayRate: Number,
    toCompRate: Number
  },
  laborRules: {
    workTimeRegime: {
      type: String,
      enum: ['standard', 'two_week', 'four_week', 'eight_week'],
      default: 'standard',
    },
    workTimeRegimeApprovalReference: { type: String, trim: true, maxlength: 200, default: '' },
    minShiftRestMinutes: { type: Number, default: 660, min: 480, max: 1440 },
    restIntervalExceptionEnabled: { type: Boolean, default: false },
    restIntervalExceptionMinutes: { type: Number, default: 480, min: 480, max: 660 },
    restIntervalApprovalReference: { type: String, trim: true, maxlength: 200, default: '' },
    extendedOvertimeEnabled: { type: Boolean, default: false },
    monthlyOvertimeHours: { type: Number, default: 46, min: 1, max: 54 },
    threeMonthOvertimeHours: { type: Number, default: 138, min: 1, max: 138 },
    overtimeApprovalReference: { type: String, trim: true, maxlength: 200, default: '' },
    strictCompanyWeeklyRest: { type: Boolean, default: true },
  },
  actionBuffers: {
    clockIn: {
      earlyMinutes: { type: Number, default: 60 },
      lateMinutes: { type: Number, default: 240 },
    },
    clockOut: {
      earlyMinutes: { type: Number, default: 240 },
      lateMinutes: { type: Number, default: 120 },
    },
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
