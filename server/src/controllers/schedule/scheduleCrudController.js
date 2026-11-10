import ShiftSchedule from '../../models/ShiftSchedule.js';
import { loadApprovedLeaveIntervals } from '../../services/approvedLeaveCalendarService.js';
import {
  SCHEDULE_EMPLOYEE_SELECT,
  toEntityId,
  getAllowedScheduleEmployeeIds,
  getEditableScheduleEmployeeIds,
  assertShiftsAllowedForScope,
  respondShiftNotAllowed,
  attachShiftInfo,
  buildRosterLeaveChecks,
  hasLeaveConflict,
  loadShiftLookup,
  resetScheduleProgress,
  hasScheduleDiff,
  normalizeOptionalId,
  respondLaborRuleError,
  buildScheduleConflictDetails,
  buildMonthRange,
  normalizeScheduleMemoDate,
} from './scheduleShared.js';
import { dateKeyToUtcMidnight, toTaipeiDateKey } from '../../utils/taipeiTime.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// GET /api/schedules 一次最多查多長的日期範圍
const MAX_LIST_RANGE_DAYS = 366;

/**
 * GET /api/schedules 的日期條件：month=YYYY-MM，或 start／end（YYYY-MM-DD，含頭尾）。
 * 回傳 { range: { start, end } | null }，格式不對回傳 { error }。
 */
function parseScheduleListRange(query = {}) {
  const { month, start, end } = query;
  if (month !== undefined && month !== '') {
    try {
      return { range: buildMonthRange(typeof month === 'string' ? month : '') };
    } catch {
      return { error: '月份格式不正確（YYYY-MM）' };
    }
  }
  if ((start === undefined || start === '') && (end === undefined || end === '')) return { range: null };
  const startDate = normalizeScheduleMemoDate(start || end);
  const endDate = normalizeScheduleMemoDate(end || start);
  if (!startDate || !endDate) return { error: '日期格式不正確（YYYY-MM-DD）' };
  if (endDate < startDate) return { error: '結束日期不可早於開始日期' };
  if ((endDate.getTime() - startDate.getTime()) / MS_PER_DAY >= MAX_LIST_RANGE_DAYS) {
    return { error: `日期範圍最多 ${MAX_LIST_RANGE_DAYS} 天` };
  }
  return { range: { start: startDate, end: new Date(endDate.getTime() + MS_PER_DAY) } };
}

// 管理員不帶日期條件時的預設範圍：台灣現在的月份與前後各一個月
function defaultAdminListRange(now = new Date()) {
  const monthStart = dateKeyToUtcMidnight(`${(toTaipeiDateKey(now) || now.toISOString().slice(0, 10)).slice(0, 7)}-01`);
  const start = new Date(monthStart);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(monthStart);
  end.setUTCMonth(end.getUTCMonth() + 2);
  return { start, end };
}

// 兩個請求同時寫同一位員工同一天（連點、兩位排班人員同時排）：後到的撞到 (employee, date) 唯一索引。
// 回覆和「已有排班」相同的衝突訊息（畫面會請使用者重新整理）；以前把資料庫的 E11000 原文（含資料庫與集合名稱）直接回給畫面
async function respondDuplicateSchedule(res, err, { employee, date, shiftId }) {
  if (err?.code !== 11000) return false;
  let existing = null;
  try {
    existing = await ShiftSchedule.findOne({ employee, date });
  } catch {
    existing = null;
  }
  res.status(400).json({
    error: 'employee conflict',
    conflict: buildScheduleConflictDetails({ employee, date, shiftId, existing }),
  });
  return true;
}

export async function createSchedulesBatch(req, res) {
  try {
    const { schedules } = req.body;
    if (!Array.isArray(schedules)) {
      return res.status(400).json({ error: '班表資料格式不正確' });
    }
    const scheduleMap = new Map();
    for (const raw of schedules) {
      if (!raw?.employee || !raw?.date || !raw?.shiftId) {
        return res.status(400).json({ error: '班表資料不完整：每一筆都要有員工、日期與班別' });
      }
      const dt = new Date(raw.date);
      if (Number.isNaN(dt?.getTime?.())) {
        return res.status(400).json({ error: '班表的日期格式不正確' });
      }
      dt.setUTCHours(0, 0, 0, 0);
      const key = `${raw.employee}-${dt.getTime()}`;
      scheduleMap.set(key, {
        employee: raw.employee,
        date: dt,
        shiftId: raw.shiftId,
        department: normalizeOptionalId(raw.department),
        subDepartment: normalizeOptionalId(raw.subDepartment),
      });
    }

    const uniqueSchedules = Array.from(scheduleMap.values());
    if (!uniqueSchedules.length) return res.status(201).json([]);

    const employeeIds = Array.from(new Set(uniqueSchedules.map((item) => toEntityId(item.employee))));
    const timestamps = uniqueSchedules.map((item) => item.date.getTime());
    const rangeStart = new Date(Math.min(...timestamps));
    const rangeEnd = new Date(Math.max(...timestamps) + 86400000);
    // 請假只讀一次（每個請假表單一個查詢），每一格再用自己的班別判斷：
    // 只請幾小時的假不擋，核准的整天請假或涵蓋整個班次的請假才擋上班班別；
    // 不用上班的班別（休/例/國/請假）手動排班時只擋整天都在請假中的日子（原本的行為）
    const [leaveIntervals, existingRows, shiftLookup] = await Promise.all([
      loadApprovedLeaveIntervals({ employeeIds, start: rangeStart, end: rangeEnd }),
      ShiftSchedule.find({
        employee: { $in: employeeIds },
        date: { $gte: rangeStart, $lt: rangeEnd },
      }).lean(),
      loadShiftLookup(),
    ]);

    const scheduleKey = (employee, date) => (
      `${toEntityId(employee)}:${new Date(date).toISOString().slice(0, 10)}`
    );
    const leaveCheckOf = buildRosterLeaveChecks(leaveIntervals);
    const conflictingLeave = uniqueSchedules.find((entry) => (
      leaveCheckOf(entry.employee).blocks(
        entry.date.toISOString().slice(0, 10),
        shiftLookup.get(toEntityId(entry.shiftId)) || null,
        { strictNonWork: true },
      )
    ));
    if (conflictingLeave) {
      return res.status(400).json({ error: 'leave conflict' });
    }

    const existingByKey = new Map((existingRows || []).map((row) => [
      scheduleKey(row.employee, row.date),
      row,
    ]));
    // 小單位的「使用班別」：只檢查這次真的換了班別的格子（既有的班表不因後來改了設定而不能再存）
    await assertShiftsAllowedForScope(req, uniqueSchedules
      .filter((sched) => {
        const existing = existingByKey.get(scheduleKey(sched.employee, sched.date));
        return !existing || toEntityId(existing.shiftId) !== toEntityId(sched.shiftId);
      })
      .map((sched) => ({
        employee: sched.employee,
        shiftId: sched.shiftId,
        subDepartment: sched.subDepartment ?? existingByKey.get(scheduleKey(sched.employee, sched.date))?.subDepartment,
      })));
    const operations = uniqueSchedules.map((sched) => {
      const existing = existingByKey.get(scheduleKey(sched.employee, sched.date));
      const nextData = {
        employee: sched.employee,
        date: sched.date,
        shiftId: sched.shiftId,
        department: sched.department ?? existing?.department,
        subDepartment: sched.subDepartment ?? existing?.subDepartment,
      };
      const changed = !existing || hasScheduleDiff(existing, nextData);
      return {
        updateOne: {
          filter: { employee: sched.employee, date: sched.date },
          update: {
            $set: {
              ...nextData,
              ...(changed ? {
                state: 'draft',
                publishedAt: null,
                employeeResponse: 'pending',
                responseNote: '',
                responseAt: null,
                needsReconfirm: true,
              } : {}),
            },
          },
          upsert: true,
        },
      };
    });

    await ShiftSchedule.bulkWrite(operations, { ordered: false });
    const writtenRows = await ShiftSchedule.find({
      employee: { $in: employeeIds },
      date: { $gte: rangeStart, $lt: rangeEnd },
    }).lean();
    const writtenByKey = new Map((writtenRows || []).map((row) => [
      scheduleKey(row.employee, row.date),
      row,
    ]));
    res.status(201).json(uniqueSchedules
      .map((item) => writtenByKey.get(scheduleKey(item.employee, item.date)))
      .filter(Boolean));
  } catch (err) {
    if (respondShiftNotAllowed(res, err)) return;
    if (respondLaborRuleError(res, err)) return;
    res.status(400).json({ error: err.message });
  }
}

export async function listSchedules(req, res) {
  try {
    const allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
    if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const query = allowedEmployeeIds === null ? {} : { employee: { $in: allowedEmployeeIds } };
    // 可以指定月份或日期範圍。管理員看得到所有人的班表：不帶條件時只回最近三個月（以前把整個資料表一次回傳）；
    // 其他人不帶條件照舊是自己看得到的範圍
    const parsed = parseScheduleListRange(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const range = parsed.range || (allowedEmployeeIds === null ? defaultAdminListRange() : null);
    if (range) query.date = { $gte: range.start, $lt: range.end };
    const raw = await ShiftSchedule.find(query)
      .populate({ path: 'employee', select: SCHEDULE_EMPLOYEE_SELECT })
      .lean();
    const schedules = await attachShiftInfo(raw);
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSchedule(req, res) {
  try {
    const { employee, date, shiftId, department, subDepartment } = req.body;
    const dt = new Date(date);
    const normalizedDepartment = normalizeOptionalId(department);
    const normalizedSubDepartment = normalizeOptionalId(subDepartment);

    const existing = await ShiftSchedule.findOne({ employee, date: dt });
    if (existing) {
      const conflict = buildScheduleConflictDetails({ employee, date: dt, shiftId, existing });
      if (
        (normalizedDepartment || normalizedSubDepartment) &&
        (existing.department?.toString() !== normalizedDepartment ||
          existing.subDepartment?.toString() !== normalizedSubDepartment)
      ) {
        return res.status(400).json({ error: 'department overlap', conflict });
      }
      return res.status(400).json({ error: 'employee conflict', conflict });
    }

    // 找不到班別（班別設定裡沒有這個 ID）就維持最嚴格的整天判斷
    const requestedShift = (await loadShiftLookup()).get(toEntityId(shiftId)) || null;
    if (await hasLeaveConflict(employee, dt, requestedShift, { strictNonWork: true })) {
      return res.status(400).json({ error: 'leave conflict' });
    }
    await assertShiftsAllowedForScope(req, [{ employee, shiftId, subDepartment: normalizedSubDepartment }]);

    const schedule = await ShiftSchedule.create({
      employee,
      date: dt,
      shiftId,
      department: normalizedDepartment,
      subDepartment: normalizedSubDepartment,
      needsReconfirm: true,
    });
    res.status(201).json(schedule);
  } catch (err) {
    if (respondShiftNotAllowed(res, err)) return;
    if (respondLaborRuleError(res, err)) return;
    if (await respondDuplicateSchedule(res, err, {
      employee: req.body?.employee,
      date: new Date(req.body?.date),
      shiftId: req.body?.shiftId,
    })) return;
    res.status(400).json({ error: err.message });
  }
}

export async function getSchedule(req, res) {
  try {
    const allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
    if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const schedule = await ShiftSchedule.findById(req.params.id)
      .populate({ path: 'employee', select: SCHEDULE_EMPLOYEE_SELECT });
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    if (allowedEmployeeIds !== null && !allowedEmployeeIds.includes(toEntityId(schedule.employee))) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateSchedule(req, res) {
  try {
    const { employee, date, shiftId, department, subDepartment } = req.body;
    const schedule = await ShiftSchedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });

    const newEmployee = employee || schedule.employee;
    const newDate = date ? new Date(date) : schedule.date;
    const normalizedDepartment = normalizeOptionalId(department);
    const normalizedSubDepartment = normalizeOptionalId(subDepartment);

    const conflict = await ShiftSchedule.findOne({
      employee: newEmployee,
      date: newDate,
      _id: { $ne: schedule._id },
    });
    if (conflict) {
      const conflictDetails = buildScheduleConflictDetails({
        employee: newEmployee,
        date: newDate,
        shiftId: shiftId !== undefined ? shiftId : schedule.shiftId,
        existing: conflict,
      });
      if (
        (normalizedDepartment || normalizedSubDepartment) &&
        (conflict.department?.toString() !== normalizedDepartment ||
          conflict.subDepartment?.toString() !== normalizedSubDepartment)
      ) {
        return res.status(400).json({ error: 'department overlap', conflict: conflictDetails });
      }
      return res.status(400).json({ error: 'employee conflict', conflict: conflictDetails });
    }

    const nextShiftId = shiftId !== undefined ? shiftId : schedule.shiftId;
    const nextShift = (await loadShiftLookup()).get(toEntityId(nextShiftId)) || null;
    if (await hasLeaveConflict(newEmployee, newDate, nextShift, { strictNonWork: true })) {
      return res.status(400).json({ error: 'leave conflict' });
    }

    const nextData = {
      employee: newEmployee,
      date: newDate,
      shiftId: shiftId !== undefined ? shiftId : schedule.shiftId,
      department: normalizedDepartment ?? schedule.department,
      subDepartment: normalizedSubDepartment ?? schedule.subDepartment,
    };
    const shouldReset = hasScheduleDiff(schedule, nextData);
    if (shouldReset) {
      await assertShiftsAllowedForScope(req, [{
        employee: nextData.employee,
        shiftId: nextData.shiftId,
        subDepartment: nextData.subDepartment,
      }]);
    }
    schedule.employee = nextData.employee;
    schedule.date = nextData.date;
    schedule.shiftId = nextData.shiftId;
    schedule.department = nextData.department;
    schedule.subDepartment = nextData.subDepartment;
    if (shouldReset) {
      resetScheduleProgress(schedule);
    }
    const saved = await schedule.save();
    res.json(saved);
  } catch (err) {
    if (respondShiftNotAllowed(res, err)) return;
    if (respondLaborRuleError(res, err)) return;
    if (err?.code === 11000) {
      // 改日期／員工時剛好有人在那一格新增了班表
      res.status(400).json({ error: 'employee conflict' });
      return;
    }
    res.status(400).json({ error: err.message });
  }
}
export async function deleteSchedule(req, res) {
  try {
    const schedule = await ShiftSchedule.findByIdAndDelete(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteOldSchedules(req, res) {
  try {
    const { before } = req.query;
    if (!before) return res.status(400).json({ error: 'before required' });
    const cutoff = new Date(before);
    const result = await ShiftSchedule.deleteMany({ date: { $lt: cutoff } });
    res.json({ deleted: result.deletedCount ?? 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteSchedulesBatch(req, res) {
  try {
    const ids = Array.from(new Set(
      (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    ));
    if (!ids.length) return res.status(400).json({ error: '請選擇要刪除的班表' });
    if (ids.length > 5000) return res.status(400).json({ error: '一次最多刪除 5000 筆班表，請分次刪除' });

    const allowedEmployeeIds = await getEditableScheduleEmployeeIds(req);
    if (allowedEmployeeIds !== null && !allowedEmployeeIds.length) {
      return res.status(403).json({ error: '您沒有排班權限，無法刪除班表', code: 'FORBIDDEN' });
    }
    const scheduleQuery = ShiftSchedule.find({ _id: { $in: ids } }).select('_id employee');
    const schedules = scheduleQuery && typeof scheduleQuery.lean === 'function'
      ? await scheduleQuery.lean()
      : await scheduleQuery;
    const allowedSet = allowedEmployeeIds === null ? null : new Set(allowedEmployeeIds.map(String));
    if (allowedSet && (schedules || []).some((schedule) => !allowedSet.has(toEntityId(schedule.employee)))) {
      return res.status(403).json({ error: '選取的班表裡有不在您排班範圍內的員工，無法刪除', code: 'FORBIDDEN' });
    }

    const foundIds = (schedules || []).map((schedule) => toEntityId(schedule._id)).filter(Boolean);
    if (!foundIds.length) return res.json({ deleted: 0, ids: [] });
    const result = await ShiftSchedule.deleteMany({ _id: { $in: foundIds } });
    return res.json({ deleted: result.deletedCount ?? foundIds.length, ids: foundIds });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
