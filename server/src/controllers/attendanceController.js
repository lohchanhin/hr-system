import AttendanceRecord from '../models/AttendanceRecord.js';
import Employee from '../models/Employee.js';
import AttendanceManagementSetting from '../models/AttendanceManagementSetting.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import { isNonWorkShift, resolveShiftSemanticType } from '../services/shiftSemanticService.js';
import {
  buildScheduleDate,
  computeActionWindow,
  computeShiftSpan,
  formatWindow,
  getLocalDateParts,
  getTimezone,
  isWithinWindow,
  createDateFromParts,
  normalizeActionBuffers,
} from '../utils/timeWindow.js';

function toStringId(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return undefined;
}

const NON_WORK_DAY_LABELS = {
  rest_day: '休息日',
  holiday: '國定假日',
  leave: '請假日',
};

// 當天排的是不用上班的班別（休息日 / 例假 / 國定假日 / 請假）時，不開放打卡，回覆明確的原因
function buildNonWorkDayError(shift) {
  const semanticType = resolveShiftSemanticType(shift);
  if (semanticType === 'regular_rest') {
    return {
      error: '例假不得打卡或加班',
      rule: 'regular-rest-attendance',
    };
  }
  return {
    error: `今日為${NON_WORK_DAY_LABELS[semanticType] || '休假日'}，不需打卡`,
    rule: 'non-work-day-attendance',
  };
}

// 同一班同一個動作已經打過卡（連點兩次、重新整理後再按一次）
function buildDuplicatePunchError(action) {
  return action === 'clockOut'
    ? '這一班已經完成下班簽退，不需要重複打卡'
    : '這一班已經完成上班簽到，不需要重複打卡';
}

function isSameDepartment(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b;
}

// 打卡記錄附上的員工欄位：只給辨識用的欄位。以前整份員工資料（薪資、帳號、身分證字號…）都跟著每一筆打卡回傳，
// 主管查部門的打卡記錄時看得到同事的薪資
const ATTENDANCE_EMPLOYEE_SELECT = 'name employeeId department subDepartment';
// 沒有指定日期範圍時最多回傳的筆數（由新到舊）；指定 limit 時上限 5000
const DEFAULT_LIST_LIMIT = 1000;
const MAX_LIST_LIMIT = 5000;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

// 'YYYY-MM-DD'（考勤時區，預設台灣時間）當天 00:00 的時間點；'today' 是伺服器現在的台灣日期。格式不對回傳 null
function resolveLocalDayStart(value, timeZone) {
  const text = String(value ?? '').trim();
  if (text.toLowerCase() === 'today') {
    const parts = getLocalDateParts(new Date(Date.now()), timeZone);
    return parts ? createDateFromParts(parts, timeZone) : null;
  }
  const match = DATE_KEY_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return createDateFromParts({ year, month, day }, timeZone);
}

/**
 * 打卡記錄的日期條件（以考勤時區的日期判斷，不是 UTC 日期）：
 *   date=YYYY-MM-DD｜today：只要那一天；start／end=YYYY-MM-DD｜today：起訖日（含頭尾，可以只給一邊）。
 * 回傳 { range }（沒有指定時 range 為 null）或 { error }。
 */
function resolveListRange(queryParams) {
  const timeZone = getTimezone();
  const dateRaw = firstQueryValue(queryParams.date);
  const startRaw = dateRaw || firstQueryValue(queryParams.start);
  const endRaw = dateRaw || firstQueryValue(queryParams.end);
  if (!startRaw && !endRaw) return { range: null };
  const range = {};
  if (startRaw) {
    const start = resolveLocalDayStart(startRaw, timeZone);
    if (!start) return { error: '日期格式不正確，請使用 YYYY-MM-DD' };
    range.$gte = start;
  }
  if (endRaw) {
    const endDay = resolveLocalDayStart(endRaw, timeZone);
    if (!endDay) return { error: '日期格式不正確，請使用 YYYY-MM-DD' };
    // 結束日的隔天 00:00（不含）
    const nextParts = getLocalDateParts(new Date(endDay.getTime() + 36 * 60 * 60 * 1000), timeZone);
    range.$lt = createDateFromParts(nextParts, timeZone);
  }
  if (range.$gte && range.$lt && range.$lt <= range.$gte) {
    return { error: '結束日期不可早於開始日期' };
  }
  return { range };
}

/**
 * 打卡記錄（由新到舊）。
 * - 員工只看得到自己的；主管不帶條件時是部門與直屬部屬的記錄（不含自己）、管理員是所有人的記錄。
 * - scope=self：只要登入者自己的記錄（任何角色；個人的「出勤打卡」頁用這個，主管、管理員才不會看到別人的打卡）。
 * - employee=<員工 _id>：指定員工（主管只能查部門內或直屬部屬）。
 * - date／start／end：日期範圍（考勤時區的日期，見 resolveListRange）。
 * - limit：最多幾筆（預設 1000，上限 5000），避免一次回傳整個資料庫的打卡記錄。
 */
export async function listRecords(req, res) {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const query = {};
    const selfOnly = String(firstQueryValue(req.query.scope) ?? '').trim().toLowerCase() === 'self';

    const { range, error: rangeError } = resolveListRange(req.query);
    if (rangeError) return res.status(400).json({ error: rangeError });
    const limitRaw = Number.parseInt(firstQueryValue(req.query.limit), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;

    if (selfOnly) {
      if (!userId) return res.status(403).json({ error: 'Forbidden' });
      query.employee = userId;
    } else if (role === 'employee') {
      query.employee = req.user?.id;
    } else if (role === 'supervisor') {
      if (!userId) return res.status(403).json({ error: 'Forbidden' });

      const supervisor = await Employee.findById(userId);
      if (!supervisor) return res.status(403).json({ error: 'Forbidden' });

      const supervisorDeptId = toStringId(supervisor.department);
      const supervisorId = toStringId(supervisor._id);

      let allowCrossDeptCache;
      const ensureCrossDeptAllowed = async () => {
        if (typeof allowCrossDeptCache === 'boolean') return allowCrossDeptCache;
        const setting = await AttendanceManagementSetting.findOne();
        allowCrossDeptCache = Boolean(setting?.supervisorCrossDept);
        return allowCrossDeptCache;
      };

      const rawEmployeeParam = req.query.employee;
      const requestedEmployeeId = Array.isArray(rawEmployeeParam) ? rawEmployeeParam[0] : rawEmployeeParam;

      if (requestedEmployeeId) {
        const target = await Employee.findById(requestedEmployeeId);
        if (!target) return res.status(404).json({ error: 'Employee not found' });

        const targetDeptId = toStringId(target.department);
        const sameDept = isSameDepartment(supervisorDeptId, targetDeptId);
        const inAuthorizedList = toStringId(target.supervisor) === supervisorId;

        if (!sameDept && !inAuthorizedList) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        if (!sameDept) {
          const crossDeptAllowed = await ensureCrossDeptAllowed();
          if (!crossDeptAllowed) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        }

        query.employee = requestedEmployeeId;
      } else {
        const [directReports, setting] = await Promise.all([
          Employee.find({ supervisor: supervisorId }),
          AttendanceManagementSetting.findOne(),
        ]);

        const allowCrossDept = Boolean(setting?.supervisorCrossDept);

        let departmentEmployees = [];
        if (supervisorDeptId) {
          departmentEmployees = await Employee.find({ department: supervisor.department });
        }

        const allowed = new Set();

        directReports.forEach((emp) => {
          const empDeptId = toStringId(emp.department);
          if (allowCrossDept || isSameDepartment(supervisorDeptId, empDeptId)) {
            const id = toStringId(emp._id);
            if (id && id !== supervisorId) allowed.add(id);
          }
        });

        departmentEmployees.forEach((emp) => {
          const id = toStringId(emp._id);
          if (id && id !== supervisorId) allowed.add(id);
        });

        if (!allowed.size) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        query.employee = { $in: [...allowed] };
      }
    } else if (req.query.employee) {
      query.employee = firstQueryValue(req.query.employee);
    }
    if (range) query.timestamp = range;

    const records = await AttendanceRecord.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('employee', ATTENDANCE_EMPLOYEE_SELECT);
    res.json(records);
  } catch (err) {
    // 員工編號不是有效的 _id：是查詢條件的問題，不是伺服器錯誤
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: '員工編號不正確' });
    }
    res.status(500).json({ error: err.message });
  }
}


export async function getPunchWindowSetting(req, res) {
  try {
    const attendanceSetting = await AttendanceSetting.findOne().lean();
    const actionBuffers = normalizeActionBuffers(attendanceSetting?.actionBuffers);
    const lateGrace = Number(attendanceSetting?.abnormalRules?.lateGrace);
    res.json({
      actionBuffers,
      abnormalRules: {
        ...(Number.isFinite(lateGrace) ? { lateGrace } : {}),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRecord(req, res) {
  try {
    const { employee, action, timestamp, remark } = req.body;
    const actorId = toStringId(req.user?.id);
    if (!actorId) {
      return res.status(401).json({ error: 'Invalid user' });
    }
    if (!employee || !action) {
      return res.status(400).json({ error: '缺少打卡的員工或動作' });
    }
    if (toStringId(employee) !== actorId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const targetEmployeeId = actorId;

    if (timestamp != null && Number.isNaN(new Date(timestamp).getTime())) {
      return res.status(400).json({ error: '打卡時間格式不正確' });
    }

    // Attendance events must use the server clock. Client time is display-only.
    const punchTime = new Date(Date.now());
    let punchKey;

    if (action === 'clockIn' || action === 'clockOut') {
      const timeZone = getTimezone();
      const baseParts = getLocalDateParts(punchTime, timeZone);
      if (!baseParts) {
        return res.status(400).json({ error: '無法解析打卡日期' });
      }

      const todayScheduleDate = buildScheduleDate(baseParts);
      const baseMidnight = createDateFromParts(baseParts, timeZone);
      const previousMidnight = baseMidnight ? new Date(baseMidnight.getTime() - 24 * 60 * 60 * 1000) : null;
      const previousParts = previousMidnight ? getLocalDateParts(previousMidnight, timeZone) : null;
      const previousScheduleDate = previousParts ? buildScheduleDate(previousParts) : null;
      // 明天的班表也要讀：00:00 開始的大夜班，前一晚（例如 23:50）就在簽到時段內
      const nextMidnight = baseMidnight ? new Date(baseMidnight.getTime() + 24 * 60 * 60 * 1000) : null;
      const nextParts = nextMidnight ? getLocalDateParts(nextMidnight, timeZone) : null;
      const nextScheduleDate = nextParts ? buildScheduleDate(nextParts) : null;

      const candidateDates = [todayScheduleDate, previousScheduleDate, nextScheduleDate].filter(Boolean);

      const schedules = candidateDates.length
        ? await ShiftSchedule.find({ employee: targetEmployeeId, date: { $in: candidateDates } }).lean()
        : [];

      if (!schedules.length) {
        return res.status(400).json({ error: '今日未設定班表，請洽管理員' });
      }

      const attendanceSetting = await AttendanceSetting.findOne().lean();
      const actionBuffers = normalizeActionBuffers(attendanceSetting?.actionBuffers);
      const shiftMap = new Map();
      attendanceSetting?.shifts?.forEach((shift) => {
        if (!shift?._id) return;
        shiftMap.set(shift._id.toString(), shift);
      });

      const allEntries = schedules
        .map((schedule) => {
          let shiftId;
          if (schedule.shiftId && typeof schedule.shiftId === 'object' && typeof schedule.shiftId.toString === 'function') {
            shiftId = schedule.shiftId.toString();
          } else if (schedule.shiftId || schedule.shiftId === 0) {
            shiftId = String(schedule.shiftId);
          }
          const shift = shiftId ? shiftMap.get(shiftId) : null;
          if (!shift) return null;
          const scheduleDateMs = new Date(schedule.date).getTime();
          // 不用上班的班別沒有上下班時段，不計算打卡視窗
          if (isNonWorkShift(shift)) {
            return { schedule, shift, scheduleDateMs, nonWork: true };
          }
          const span = computeShiftSpan(schedule.date, shift, timeZone);
          if (!span) return null;
          return {
            schedule,
            shift,
            shiftStart: span.start,
            shiftEnd: span.end,
            scheduleDateMs,
            nonWork: false,
          };
        })
        .filter(Boolean);

      const nowMs = punchTime.getTime();
      const windowOf = (ctx) => computeActionWindow(action, ctx.shiftStart, ctx.shiftEnd, actionBuffers);
      const nextKey = nextScheduleDate?.getTime();
      const isTomorrow = (dateMs) => nextKey !== undefined && dateMs === nextKey;
      // 明天的班只在現在已經落在它的打卡時段內時才用（例如 00:00 大夜班前一晚 23:50 的簽到）；
      // 其他情況照原本只看今天與昨天的班表（錯誤訊息也不變）
      const tomorrowContexts = allEntries.filter((ctx) => (
        isTomorrow(ctx.scheduleDateMs) && !ctx.nonWork && isWithinWindow(punchTime, windowOf(ctx))
      ));
      const entries = allEntries.filter((ctx) => !isTomorrow(ctx.scheduleDateMs));

      if (!tomorrowContexts.length) {
        if (schedules.every((schedule) => isTomorrow(new Date(schedule.date).getTime()))) {
          return res.status(400).json({ error: '今日未設定班表，請洽管理員' });
        }
        if (!entries.length) {
          return res.status(400).json({ error: '班別設定缺少時間資訊，請聯絡管理員' });
        }
      }

      const contexts = entries.filter((ctx) => !ctx.nonWork);

      const todayKey = todayScheduleDate?.getTime();
      const previousKey = previousScheduleDate?.getTime();

      const activeContext = contexts.find((ctx) => nowMs >= ctx.shiftStart.getTime() && nowMs <= ctx.shiftEnd.getTime());
      const todayContext = contexts.find((ctx) => todayKey !== undefined && ctx.scheduleDateMs === todayKey);
      const previousContext = contexts.find((ctx) => previousKey !== undefined && ctx.scheduleDateMs === previousKey);
      const todayNonWork = entries.find((ctx) => ctx.nonWork && todayKey !== undefined && ctx.scheduleDateMs === todayKey);

      let selectedContext = activeContext || todayContext;
      if (!selectedContext && previousContext) {
        // 今天排休時，前一天跨日班的下班打卡仍然放行；其餘情況一律以「今天休假」回覆
        const previousWindow = computeActionWindow(
          action,
          previousContext.shiftStart,
          previousContext.shiftEnd,
          actionBuffers,
        );
        if (!todayNonWork || isWithinWindow(punchTime, previousWindow)) {
          selectedContext = previousContext;
        }
      }
      // 選到的班現在不能做這個動作、另一個班（明天 00:00 的大夜班、昨天的跨日班、今天的班）的打卡時段卻包含現在：改用那一班。
      // 好幾個班都包含現在時，取時間最接近的（簽到比上班時間、簽退比下班時間）
      if (!selectedContext || !isWithinWindow(punchTime, windowOf(selectedContext))) {
        const nominalOf = (ctx) => (action === 'clockIn' ? ctx.shiftStart : ctx.shiftEnd).getTime();
        const inWindow = [...contexts, ...tomorrowContexts]
          .filter((ctx) => isWithinWindow(punchTime, windowOf(ctx)))
          .reduce((best, ctx) => (
            !best || Math.abs(nowMs - nominalOf(ctx)) < Math.abs(nowMs - nominalOf(best)) ? ctx : best
          ), null);
        if (inWindow) selectedContext = inWindow;
      }
      if (!selectedContext) {
        if (todayNonWork) {
          return res.status(400).json(buildNonWorkDayError(todayNonWork.shift));
        }
        if (!contexts.length) {
          // 只剩前一天的休假排班，今天本身沒有班表
          return res.status(400).json({ error: '今日未設定班表，請洽管理員' });
        }
        selectedContext = contexts[0];
      }

      const actionWindow = computeActionWindow(
        action,
        selectedContext.shiftStart,
        selectedContext.shiftEnd,
        actionBuffers,
      );
      if (!actionWindow) {
        return res.status(400).json({ error: '班別尚未設定簽到簽退時間' });
      }

      if (!isWithinWindow(punchTime, actionWindow)) {
        const label = action === 'clockIn' ? '上班簽到' : '下班簽退';
        const windowText = formatWindow(actionWindow, timeZone);
        const before = nowMs < actionWindow.start.getTime();
        const after = nowMs > actionWindow.end.getTime();
        const hint = windowText
          ? `${windowText.start} ~ ${windowText.end}`
          : `${actionWindow.start.toISOString()} ~ ${actionWindow.end.toISOString()}`;
        const reason = before
          ? `${label}尚未開放，允許時段為 ${hint}`
          : after
            ? `${label}時段已結束，允許時段為 ${hint}`
            : `${label}僅允許於 ${hint} 進行`;
        return res.status(400).json({
          error: reason,
          allowedWindow: {
            start: actionWindow.start.toISOString(),
            end: actionWindow.end.toISOString(),
          },
          action,
        });
      }

      const scheduleId = toStringId(selectedContext.schedule?._id);
      if (!scheduleId) {
        return res.status(400).json({ error: 'Invalid schedule' });
      }

      punchKey = `${targetEmployeeId}:${scheduleId}:${action}`;
      // 只擋重複的線上打卡（含沒有來源的舊資料）；指紋匯入的打卡不擋線上打卡，兩邊都保留，
      // 計算時簽到取最早、簽退取最晚（services/attendancePunchService.js）
      const duplicate = await AttendanceRecord.exists({
        $or: [
          { punchKey },
          {
            employee: targetEmployeeId,
            action,
            timestamp: { $gte: actionWindow.start, $lte: actionWindow.end },
            source: { $ne: 'import' },
          },
        ],
      });
      if (duplicate) {
        return res.status(409).json({ error: buildDuplicatePunchError(action) });
      }

      // 簽退前要有這一班的簽到：線上或指紋匯入的簽到都算
      if (action === 'clockOut') {
        const clockInWindow = computeActionWindow(
          'clockIn',
          selectedContext.shiftStart,
          selectedContext.shiftEnd,
          actionBuffers,
        );
        const clockInKey = `${targetEmployeeId}:${scheduleId}:clockIn`;
        const hasClockIn = await AttendanceRecord.exists({
          $or: [
            { punchKey: clockInKey },
            {
              employee: targetEmployeeId,
              action: 'clockIn',
              timestamp: {
                $gte: clockInWindow?.start || selectedContext.shiftStart,
                $lte: selectedContext.shiftEnd,
              },
            },
          ],
        });
        if (!hasClockIn) {
          return res.status(409).json({ error: '這一班還沒有上班簽到的記錄，請先完成上班簽到再簽退' });
        }
      }
    }

    const record = new AttendanceRecord({
      employee: targetEmployeeId,
      action,
      timestamp: punchTime,
      remark,
      punchKey,
      source: 'online',
    });
    await record.save();
    const response = typeof record.toObject === 'function' ? record.toObject() : { ...record };
    delete response.punchKey;
    delete response.save;
    res.status(201).json(response);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: buildDuplicatePunchError(req.body?.action) });
    }
    res.status(400).json({ error: err.message });
  }
}
