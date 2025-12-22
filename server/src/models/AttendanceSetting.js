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
      // 夜班津貼設定
      isNightShift: { type: Boolean, default: false }, // 是否為夜班
      hasAllowance: { type: Boolean, default: false }, // 是否有津貼
      allowanceType: { type: String, enum: ['multiplier', 'fixed'], default: 'multiplier' }, // 津貼類型：倍率或固定金額
      allowanceMultiplier: { type: Number, default: 0 }, // 津貼倍數（當 allowanceType 為 'multiplier' 時使用）
      fixedAllowanceAmount: { type: Number, default: 0 }, // 固定津貼金額（當 allowanceType 為 'fixed' 時使用）
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
