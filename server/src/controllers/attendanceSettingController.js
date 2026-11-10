import AttendanceSetting from '../models/AttendanceSetting.js';
import { DEFAULT_ACTION_BUFFERS, normalizeActionBuffers } from '../utils/timeWindow.js';

const DEFAULT_SETTING = Object.freeze({
  abnormalRules: {
    lateGrace: 5,
    earlyLeaveGrace: 5,
    missingThreshold: 30,
    autoNotify: true,
  },
  breakOutRules: {
    enableBreakPunch: true,
    breakInterval: 60,
    outingNeedApprove: false,
  },
  globalBreakSetting: {
    enableGlobalBreak: false,
    breakMinutes: 60,
    allowMultiBreak: false,
  },
  overtimeRules: {
    weekdayThreshold: 30,
    holidayRate: 2,
    toCompRate: 1.5,
  },
  laborRules: {
    workTimeRegime: 'standard',
    workTimeRegimeApprovalReference: '',
    minShiftRestMinutes: 660,
    restIntervalExceptionEnabled: false,
    restIntervalExceptionMinutes: 480,
    restIntervalApprovalReference: '',
    extendedOvertimeEnabled: false,
    monthlyOvertimeHours: 46,
    threeMonthOvertimeHours: 138,
    overtimeApprovalReference: '',
    strictCompanyWeeklyRest: true,
  },
  actionBuffers: DEFAULT_ACTION_BUFFERS,
  management: {
    enableImport: false,
    importFormat: '',
    importMapping: '',
    allowMakeUpClock: true,
    makeUpDays: 3,
    makeUpNeedApprove: true,
    supervisorCrossDept: false,
    hrAllDept: true,
    employeeHistoryMonths: 6,
    nonExtWorkAlert: false,
    overtimeNoClockNotify: true,
    notifyTargets: ['員工', '主管'],
  },
});

function buildDefaultSetting() {
  return {
    abnormalRules: { ...DEFAULT_SETTING.abnormalRules },
    breakOutRules: { ...DEFAULT_SETTING.breakOutRules },
    globalBreakSetting: { ...DEFAULT_SETTING.globalBreakSetting },
    overtimeRules: { ...DEFAULT_SETTING.overtimeRules },
    laborRules: { ...DEFAULT_SETTING.laborRules },
    actionBuffers: normalizeActionBuffers(DEFAULT_SETTING.actionBuffers),
    management: { ...DEFAULT_SETTING.management },
  };
}

function normalize(setting) {
  if (!setting) return buildDefaultSetting();
  const plain = typeof setting.toObject === 'function' ? setting.toObject() : setting;
  const {
    shifts: _unusedShifts,
    abnormalRules,
    breakOutRules,
    globalBreakSetting,
    overtimeRules,
    laborRules,
    actionBuffers,
    management,
    ...others
  } = plain;
  return {
    ...others,
    abnormalRules: {
      ...DEFAULT_SETTING.abnormalRules,
      ...(abnormalRules || {}),
    },
    breakOutRules: {
      ...DEFAULT_SETTING.breakOutRules,
      ...(breakOutRules || {}),
    },
    globalBreakSetting: {
      ...DEFAULT_SETTING.globalBreakSetting,
      ...(globalBreakSetting || {}),
    },
    overtimeRules: {
      ...DEFAULT_SETTING.overtimeRules,
      ...(overtimeRules || {}),
    },
    laborRules: {
      ...DEFAULT_SETTING.laborRules,
      ...(laborRules || {}),
    },
    actionBuffers: normalizeActionBuffers(actionBuffers || DEFAULT_SETTING.actionBuffers),
    management: {
      ...DEFAULT_SETTING.management,
      ...(management || {}),
    },
  };
}

async function ensureAttendanceSetting() {
  let setting = await AttendanceSetting.findOne();
  if (!setting) {
    setting = await AttendanceSetting.create({
      ...buildDefaultSetting(),
      shifts: [],
    });
  }
  return setting;
}

export async function getAttendanceSetting(req, res) {
  try {
    const setting = await ensureAttendanceSetting();
    res.json(normalize(setting));
  } catch (err) {
    console.error(`Attendance setting read failed: ${err?.name || 'Error'}`);
    res.status(500).json({ error: '出勤設定讀取失敗，請稍後再試' });
  }
}

// 遲到／早退扣款（薪資依「次數 × 每次金額」扣款，attendanceDeductionService）：有送的欄位要是正確的型別。
// 以前不檢查：負數金額照存（變成每遲到一次多發錢）、"abc" 讓 Mongoose 丟 CastError 回 500 英文訊息、"yes" 被轉成 true
const DEDUCTION_AMOUNT_MAX = 100000;
const DEDUCTION_FIELDS = [
  { key: 'lateDeductionEnabled', label: '遲到扣款的「啟用」', type: 'boolean' },
  { key: 'earlyLeaveDeductionEnabled', label: '早退扣款的「啟用」', type: 'boolean' },
  { key: 'lateDeductionAmount', label: '遲到每次扣款金額', type: 'amount' },
  { key: 'earlyLeaveDeductionAmount', label: '早退每次扣款金額', type: 'amount' },
];

/* 回傳第一個不正確的扣款欄位 { error, code, field }，都正確回傳 null */
function findInvalidDeduction(abnormalRules) {
  if (!abnormalRules || typeof abnormalRules !== 'object') return null;
  for (const { key, label, type } of DEDUCTION_FIELDS) {
    if (!Object.hasOwn(abnormalRules, key)) continue;
    const value = abnormalRules[key];
    const valid = type === 'boolean'
      ? typeof value === 'boolean'
      : Number.isInteger(value) && value >= 0 && value <= DEDUCTION_AMOUNT_MAX;
    if (!valid) {
      return {
        error: type === 'boolean'
          ? `${label}只能是 true 或 false`
          : `${label}必須是 0 到 ${DEDUCTION_AMOUNT_MAX} 的整數`,
        code: 'INVALID_DEDUCTION_SETTING',
        field: `abnormalRules.${key}`,
      };
    }
  }
  return null;
}

function mergeRuleSection(current, incoming, defaults) {
  const base = current && typeof current.toObject === 'function' ? current.toObject() : current;
  return {
    ...defaults,
    ...(base || {}),
    ...(incoming || {}),
  };
}

export async function updateAttendanceSetting(req, res) {
  try {
    const setting = await ensureAttendanceSetting();
    const { abnormalRules, breakOutRules, overtimeRules, laborRules, globalBreakSetting, actionBuffers } = req.body || {};

    if (abnormalRules) {
      const invalidDeduction = findInvalidDeduction(abnormalRules);
      if (invalidDeduction) return res.status(400).json(invalidDeduction);
      setting.abnormalRules = mergeRuleSection(
        setting.abnormalRules,
        abnormalRules,
        DEFAULT_SETTING.abnormalRules
      );
    }

    if (breakOutRules) {
      setting.breakOutRules = mergeRuleSection(
        setting.breakOutRules,
        breakOutRules,
        DEFAULT_SETTING.breakOutRules
      );
    }

    if (globalBreakSetting) {
      setting.globalBreakSetting = mergeRuleSection(
        setting.globalBreakSetting,
        globalBreakSetting,
        DEFAULT_SETTING.globalBreakSetting
      );
    }

    if (overtimeRules) {
      setting.overtimeRules = mergeRuleSection(
        setting.overtimeRules,
        overtimeRules,
        DEFAULT_SETTING.overtimeRules
      );
    }

    if (laborRules) {
      const nextLaborRules = mergeRuleSection(
        setting.laborRules,
        laborRules,
        DEFAULT_SETTING.laborRules
      );
      if (nextLaborRules.restIntervalExceptionEnabled && !String(nextLaborRules.restIntervalApprovalReference || '').trim()) {
        return res.status(400).json({ error: '啟用 11 小時間隔例外必須填寫例外核准文件編號', code: 'REST_INTERVAL_APPROVAL_REQUIRED' });
      }
      if (nextLaborRules.workTimeRegime !== 'standard' && !String(nextLaborRules.workTimeRegimeApprovalReference || '').trim()) {
        return res.status(400).json({ error: '採用變形工時必須填寫核准文件編號', code: 'WORK_TIME_REGIME_APPROVAL_REQUIRED' });
      }
      if (nextLaborRules.extendedOvertimeEnabled && !String(nextLaborRules.overtimeApprovalReference || '').trim()) {
        return res.status(400).json({ error: '延長每月加班上限必須填寫核准文件編號', code: 'EXTENDED_OVERTIME_APPROVAL_REQUIRED' });
      }
      if (nextLaborRules.strictCompanyWeeklyRest === false) {
        return res.status(400).json({ error: '公司規定每週一例一休，不能關閉', code: 'WEEKLY_REST_REQUIRED' });
      }
      nextLaborRules.strictCompanyWeeklyRest = true;
      setting.laborRules = nextLaborRules;
    }

    if (req.body && Object.hasOwn(req.body, 'actionBuffers')) {
      setting.actionBuffers = normalizeActionBuffers(actionBuffers || DEFAULT_SETTING.actionBuffers);
    }

    if (req.body && req.body.management) {
      setting.management = mergeRuleSection(
        setting.management,
        req.body.management,
        DEFAULT_SETTING.management
      );
    }

    await setting.save();
    res.json(normalize(setting));
  } catch (err) {
    // 其他欄位型別不對（Mongoose 轉不過去）：以前回 500 與英文的 Cast 訊息
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      return res.status(400).json({ error: '出勤設定的欄位格式不正確，請確認數字與開關後再儲存', code: 'INVALID_ATTENDANCE_SETTING' });
    }
    if (err?.name === 'VersionError') {
      return res.status(409).json({ error: '出勤設定剛被其他人修改，請重新整理後再試', code: 'CONFLICT' });
    }
    console.error(`Attendance setting update failed: ${err?.name || 'Error'}`);
    res.status(500).json({ error: '出勤設定儲存失敗，請稍後再試' });
  }
}

export const __testUtils = {
  DEFAULT_SETTING,
  buildDefaultSetting,
  mergeRuleSection,
  normalize,
};
