import ShiftSchedule from '../../models/ShiftSchedule.js';
import { loadApprovedLeaveIntervals } from '../../services/approvedLeaveCalendarService.js';
import {
  SCHEDULE_EMPLOYEE_SELECT,
  toEntityId,
  getAllowedScheduleEmployeeIds,
  attachShiftInfo,
  buildRosterLeaveChecks,
  hasLeaveConflict,
  loadShiftLookup,
  resetScheduleProgress,
  hasScheduleDiff,
  normalizeOptionalId,
  respondLaborRuleError,
  buildScheduleConflictDetails,
} from './scheduleShared.js';

export async function createSchedulesBatch(req, res) {
  try {
    const { schedules } = req.body;
    if (!Array.isArray(schedules)) {
      return res.status(400).json({ error: 'schedules must be array' });
    }
    const scheduleMap = new Map();
    for (const raw of schedules) {
      if (!raw?.employee || !raw?.date || !raw?.shiftId) {
        return res.status(400).json({ error: 'invalid schedule payload' });
      }
      const dt = new Date(raw.date);
      if (Number.isNaN(dt?.getTime?.())) {
        return res.status(400).json({ error: 'invalid date' });
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
    if (respondLaborRuleError(res, err)) return;
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
    if (respondLaborRuleError(res, err)) return;
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
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    if (ids.length > 5000) return res.status(400).json({ error: 'too many schedules' });

    const allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
    if (allowedEmployeeIds !== null && !allowedEmployeeIds.length) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const scheduleQuery = ShiftSchedule.find({ _id: { $in: ids } }).select('_id employee');
    const schedules = scheduleQuery && typeof scheduleQuery.lean === 'function'
      ? await scheduleQuery.lean()
      : await scheduleQuery;
    const allowedSet = allowedEmployeeIds === null ? null : new Set(allowedEmployeeIds.map(String));
    if (allowedSet && (schedules || []).some((schedule) => !allowedSet.has(toEntityId(schedule.employee)))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const foundIds = (schedules || []).map((schedule) => toEntityId(schedule._id)).filter(Boolean);
    if (!foundIds.length) return res.json({ deleted: 0, ids: [] });
    const result = await ShiftSchedule.deleteMany({ _id: { $in: foundIds } });
    return res.json({ deleted: result.deletedCount ?? foundIds.length, ids: foundIds });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
