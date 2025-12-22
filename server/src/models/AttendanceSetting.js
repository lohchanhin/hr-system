import mongoose from 'mongoose';

const attendanceSettingSchema = new mongoose.Schema({
  shifts: [
    {
      name: String,
      code: String,
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
      // Night shift allowance settings
      isNightShift: { type: Boolean, default: false }, // Whether this is a night shift
      hasAllowance: { type: Boolean, default: false }, // Whether allowance is enabled
      allowanceType: { type: String, enum: ['multiplier', 'fixed'], default: 'multiplier' }, // Allowance type: multiplier or fixed amount
      allowanceMultiplier: { type: Number, default: 0 }, // Allowance multiplier (used when allowanceType is 'multiplier')
      fixedAllowanceAmount: { type: Number, default: 0 }, // Fixed allowance amount (used when allowanceType is 'fixed')
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
