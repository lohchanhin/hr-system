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
    const { abnormalRules, breakOutRules, overtimeRules, laborRules, globalBreakSetting, actionBuffers } = req.body || {};

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
        return res.status(400).json({ error: 'rest interval exception requires an approval reference' });
      }
      if (nextLaborRules.workTimeRegime !== 'standard' && !String(nextLaborRules.workTimeRegimeApprovalReference || '').trim()) {
        return res.status(400).json({ error: 'flexible work-time regime requires an approval reference' });
      }
      if (nextLaborRules.extendedOvertimeEnabled && !String(nextLaborRules.overtimeApprovalReference || '').trim()) {
        return res.status(400).json({ error: 'extended overtime requires an approval reference' });
      }
      if (nextLaborRules.strictCompanyWeeklyRest === false) {
        return res.status(400).json({
          error: 'company policy requires one regular rest day and one rest day every week',
        });
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
    res.status(500).json({ error: err.message });
  }
}

export const __testUtils = {
  DEFAULT_SETTING,
  buildDefaultSetting,
  mergeRuleSection,
  normalize,
};
