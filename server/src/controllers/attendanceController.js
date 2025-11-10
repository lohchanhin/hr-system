import AttendanceRecord from '../models/AttendanceRecord.js';
import Employee from '../models/Employee.js';
import AttendanceManagementSetting from '../models/AttendanceManagementSetting.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import {
  buildScheduleDate,
  computeActionWindow,
  computeShiftSpan,
  formatWindow,
  getLocalDateParts,
  getTimezone,
  isWithinWindow,
  createDateFromParts,
} from '../utils/timeWindow.js';

function toStringId(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return undefined;
}

function isSameDepartment(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b;
}

export async function listRecords(req, res) {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const query = {};

    if (role === 'employee') {
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
      query.employee = req.query.employee;
    }

    const records = await AttendanceRecord.find(query)
      .sort({ timestamp: -1 })
      .populate('employee');
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRecord(req, res) {
  try {
    const { employee, action, timestamp, remark } = req.body;
    if (!employee || !action) {
      return res.status(400).json({ error: 'employee and action are required' });
    }

    const punchTime = (() => {
      if (!timestamp) return new Date();
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? null : date;
    })();

    if (!punchTime) {
      return res.status(400).json({ error: 'invalid timestamp' });
    }

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

      const candidateDates = [todayScheduleDate, previousScheduleDate].filter(Boolean);

      const schedules = candidateDates.length
        ? await ShiftSchedule.find({ employee, date: { $in: candidateDates } }).lean()
        : [];

      if (!schedules.length) {
        return res.status(400).json({ error: '今日未設定班表，請洽管理員' });
      }

      const attendanceSetting = await AttendanceSetting.findOne().lean();
      const shiftMap = new Map();
      attendanceSetting?.shifts?.forEach((shift) => {
        if (!shift?._id) return;
        shiftMap.set(shift._id.toString(), shift);
      });

      const contexts = schedules
        .map((schedule) => {
          let shiftId;
          if (schedule.shiftId && typeof schedule.shiftId === 'object' && typeof schedule.shiftId.toString === 'function') {
            shiftId = schedule.shiftId.toString();
          } else if (schedule.shiftId || schedule.shiftId === 0) {
            shiftId = String(schedule.shiftId);
          }
          const shift = shiftId ? shiftMap.get(shiftId) : null;
          if (!shift) return null;
          const span = computeShiftSpan(schedule.date, shift, timeZone);
          if (!span) return null;
          const scheduleDateMs = new Date(schedule.date).getTime();
          return {
            schedule,
            shift,
            shiftStart: span.start,
            shiftEnd: span.end,
            scheduleDateMs,
          };
        })
        .filter(Boolean);

      if (!contexts.length) {
        return res.status(400).json({ error: '班別設定缺少時間資訊，請聯絡管理員' });
      }

      const todayKey = todayScheduleDate?.getTime();
      const previousKey = previousScheduleDate?.getTime();

      const nowMs = punchTime.getTime();
      const activeContext = contexts.find((ctx) => nowMs >= ctx.shiftStart.getTime() && nowMs <= ctx.shiftEnd.getTime());
      const todayContext = contexts.find((ctx) => todayKey !== undefined && ctx.scheduleDateMs === todayKey);
      const previousContext = contexts.find((ctx) => previousKey !== undefined && ctx.scheduleDateMs === previousKey);
      const selectedContext = activeContext || todayContext || previousContext || contexts[0];

      const actionWindow = computeActionWindow(action, selectedContext.shiftStart, selectedContext.shiftEnd);
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
    }

    const record = new AttendanceRecord({ employee, action, timestamp: punchTime, remark });
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
