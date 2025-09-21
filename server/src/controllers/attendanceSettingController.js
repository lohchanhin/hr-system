import AttendanceSetting from '../models/AttendanceSetting.js';

const DEFAULT_SETTING = Object.freeze({
  shifts: [],
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
  overtimeRules: {
    weekdayThreshold: 30,
    holidayRate: 2,
    toCompRate: 1.5,
  },
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
    shifts: [...DEFAULT_SETTING.shifts],
    abnormalRules: { ...DEFAULT_SETTING.abnormalRules },
    breakOutRules: { ...DEFAULT_SETTING.breakOutRules },
    overtimeRules: { ...DEFAULT_SETTING.overtimeRules },
    management: { ...DEFAULT_SETTING.management },
  };
}

function normalize(setting) {
  if (!setting) return buildDefaultSetting();
  const plain = typeof setting.toObject === 'function' ? setting.toObject() : setting;
  return {
    ...plain,
    shifts: plain.shifts ?? [],
    abnormalRules: {
      ...DEFAULT_SETTING.abnormalRules,
      ...(plain.abnormalRules || {}),
    },
    breakOutRules: {
      ...DEFAULT_SETTING.breakOutRules,
      ...(plain.breakOutRules || {}),
    },
    overtimeRules: {
      ...DEFAULT_SETTING.overtimeRules,
      ...(plain.overtimeRules || {}),
    },
    management: {
      ...DEFAULT_SETTING.management,
      ...(plain.management || {}),
    },
  };
}

async function ensureAttendanceSetting() {
  let setting = await AttendanceSetting.findOne();
  if (!setting) {
    setting = await AttendanceSetting.create(buildDefaultSetting());
  }
  return setting;
}

export async function getAttendanceSetting(req, res) {
  try {
    const setting = await ensureAttendanceSetting();
    res.json(normalize(setting));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { abnormalRules, breakOutRules, overtimeRules, shifts } = req.body || {};

    if (abnormalRules) {
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

    if (overtimeRules) {
      setting.overtimeRules = mergeRuleSection(
        setting.overtimeRules,
        overtimeRules,
        DEFAULT_SETTING.overtimeRules
      );
    }

    if (Array.isArray(shifts)) {
      setting.shifts = shifts;
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
    res.status(500).json({ error: err.message });
  }
}

export const __testUtils = {
  DEFAULT_SETTING,
  buildDefaultSetting,
  mergeRuleSection,
  normalize,
};
