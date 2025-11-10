import ShiftSchedule from '../models/ShiftSchedule.js';
import Employee from '../models/Employee.js';
import ApprovalRequest from '../models/approval_request.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import { getLeaveFieldIds } from '../services/leaveFieldService.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function getMonthRange(month) {
  if (!MONTH_PATTERN.test(month)) return null;
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

function toObjectIdString(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'object') {
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const str = value.toString();
      if (str && !str.startsWith('[object')) return str;
    }
    if (value?._id) return String(value._id);
    if (value?.id) return String(value.id);
    if (value?.value) return String(value.value);
  }
  return String(value);
}

function resetScheduleConfirmation(schedule) {
  if (!schedule) return;
  schedule.state = 'draft';
  schedule.employeeResponse = 'pending';
  schedule.responseNote = '';
  schedule.responseAt = null;
  schedule.publishedAt = null;
}

function collectEmployeeStatuses(rawSchedules) {
  const map = new Map();
  rawSchedules.forEach((schedule) => {
    const rawEmployee = schedule.employee;
    let employeeId = '';
    if (rawEmployee && typeof rawEmployee === 'object' && !Array.isArray(rawEmployee)) {
      if (rawEmployee?._id) employeeId = toObjectIdString(rawEmployee._id);
      if (!employeeId && rawEmployee?.id) employeeId = toObjectIdString(rawEmployee.id);
    } else if (rawEmployee) {
      employeeId = toObjectIdString(rawEmployee);
    }
    if (!employeeId || employeeId === '[object Object]') return;
    const employee = (rawEmployee && typeof rawEmployee === 'object' && !Array.isArray(rawEmployee)) ? rawEmployee : null;
    const entry = map.get(employeeId) || {
      employeeId,
      name: employee?.name || employee?.fullName || employee?.displayName || '',
      department: toObjectIdString(employee?.department) || toObjectIdString(schedule.department) || '',
      subDepartment: toObjectIdString(employee?.subDepartment) || toObjectIdString(schedule.subDepartment) || '',
      responses: new Set(),
      notes: [],
      latestResponseAt: null,
    };
    if (!entry.name && (employee?.name || employee?.fullName || employee?.displayName)) {
      entry.name = employee?.name || employee?.fullName || employee?.displayName || '';
    }
    if (!entry.department) {
      const dept = toObjectIdString(employee?.department) || toObjectIdString(schedule.department);
      if (dept && dept !== '[object Object]') entry.department = dept;
    }
    if (!entry.subDepartment) {
      const subDept = toObjectIdString(employee?.subDepartment) || toObjectIdString(schedule.subDepartment);
      if (subDept && subDept !== '[object Object]') entry.subDepartment = subDept;
    }
    const response = schedule.employeeResponse || 'pending';
    entry.responses.add(response);
    if (response === 'disputed' && schedule.responseNote) {
      entry.notes.push(schedule.responseNote);
    }
    if (schedule.responseAt) {
      const responseDate = new Date(schedule.responseAt);
      if (!Number.isNaN(responseDate) && (!entry.latestResponseAt || responseDate > entry.latestResponseAt)) {
        entry.latestResponseAt = responseDate;
      }
    }
    map.set(employeeId, entry);
  });

  return Array.from(map.values()).map((entry) => {
    let status = 'pending';
    if (entry.responses.has('disputed')) status = 'disputed';
    else if (entry.responses.size === 1 && entry.responses.has('confirmed')) status = 'confirmed';
    return {
      employeeId: entry.employeeId,
      name: entry.name,
      department: entry.department,
      subDepartment: entry.subDepartment,
      status,
      notes: entry.notes,
      lastResponseAt: entry.latestResponseAt,
    };
  });
}

function deriveMonthMeta(rawSchedules) {
  if (!rawSchedules.length) {
    return {
      state: 'draft',
      publishedAt: null,
      pendingEmployees: [],
      disputedEmployees: [],
      employeeStatuses: [],
    };
  }

  let latestPublished = null;
  const states = new Set();
  rawSchedules.forEach((schedule) => {
    if (schedule.state) states.add(schedule.state);
    if (schedule.publishedAt) {
      const published = new Date(schedule.publishedAt);
      if (!Number.isNaN(published) && (!latestPublished || published > latestPublished)) {
        latestPublished = published;
      }
    }
  });

  let state = 'draft';
  if (states.has('pending_confirmation')) state = 'pending_confirmation';
  if (states.size && states.has('finalized') && !states.has('pending_confirmation')) state = 'finalized';

  const employeeStatuses = collectEmployeeStatuses(rawSchedules);
  const pendingEmployees = employeeStatuses.filter((entry) => entry.status !== 'confirmed');
  const disputedEmployees = employeeStatuses.filter((entry) => entry.status === 'disputed');

  return {
    state,
    publishedAt: latestPublished,
    pendingEmployees,
    disputedEmployees,
    employeeStatuses,
  };
}

function formatDate(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

async function attachShiftInfo(schedules) {
  const setting = await AttendanceSetting.findOne().lean();
  const map = {};
  setting?.shifts?.forEach((s) => {
    map[s._id.toString()] = s.name;
  });
  return schedules.map((s) => ({
    ...s,
    date: formatDate(s.date),
    shiftName: map[s.shiftId?.toString()] || '',
  }));
}

async function hasLeaveConflict(employeeId, date) {
  const { formId, startId, endId } = await getLeaveFieldIds();
  if (!formId || !startId || !endId) return false;
  const query = {
    form: formId,
    applicant_employee: employeeId,
    status: 'approved',
  };
  query[`form_data.${startId}`] = { $lte: date };
  query[`form_data.${endId}`] = { $gte: date };
  const approval = await ApprovalRequest.findOne(query);
  return !!approval;
}

export async function listMonthlySchedules(req, res) {
  try {
    const { month, employee, supervisor, includeSelf: includeSelfRaw } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const range = getMonthRange(month);
    if (!range) return res.status(400).json({ error: 'invalid month' });
    const { start, end } = range;
    const query = { date: { $gte: range.start, $lt: range.end } };
    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';

    if (supervisor) {
      const normalizedSupervisor = String(supervisor);
      const role = req.user?.role;
      const requesterId = req.user?.id || req.user?.employeeId;
      const allowedRoles = ['supervisor', 'admin'];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (role === 'supervisor' && requesterId && String(requesterId) !== normalizedSupervisor) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const emps = await Employee.find({ supervisor: normalizedSupervisor }).select('_id');
      const idSet = new Set(emps.map((e) => e._id.toString()));
      if (includeSelf && normalizedSupervisor) {
        idSet.add(normalizedSupervisor);
      }
      query.employee = { $in: Array.from(idSet) };
    } else {
      const empId = employee || (req.user?.role === 'employee' ? (req.user?.employeeId || req.user?.id) : undefined);
      if (empId) query.employee = empId;
    }

    const raw = await ShiftSchedule.find(query).populate('employee').lean();
    const schedules = await attachShiftInfo(raw);
    const meta = deriveMonthMeta(raw);
    res.json({
      month,
      schedules,
      meta,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function listLeaveApprovals(req, res) {
  try {
    const {
      month,
      employee,
      supervisor,
      includeSelf: includeSelfRaw,
      department: departmentRaw,
      subDepartment: subDepartmentRaw,
    } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const range = getMonthRange(month);
    if (!range) return res.status(400).json({ error: 'invalid month' });
    const { start, end } = range;

    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';
    const department = departmentRaw ? String(departmentRaw) : '';
    const subDepartment = subDepartmentRaw ? String(subDepartmentRaw) : '';
    let ids = [];
    if (supervisor) {
      const emps = await Employee.find({ supervisor }).select('_id');
      const idSet = new Set(emps.map((e) => e._id.toString()));
      if (includeSelf && supervisor) {
        idSet.add(String(supervisor));
      }
      ids = Array.from(idSet);
    } else if (employee) {
      ids = [employee];
    }

    const empFilter = ids.length ? { $in: ids } : undefined;

    const approvalQuery = { createdAt: { $gte: start, $lt: end } };
    if (empFilter) approvalQuery.applicant_employee = empFilter;
    const approvals = await ApprovalRequest.find(approvalQuery)
      .populate('applicant_employee')
      .populate({ path: 'form', select: 'name category' });

    const normalizeId = (value) => {
      if (!value && value !== 0) return '';
      if (typeof value === 'object') {
        if (value?._id) return String(value._id);
        if (value?.id) return String(value.id);
      }
      return String(value);
    };

    const filteredApprovals = approvals.filter((approval) => {
      const matchesDepartment = (() => {
        if (!department) return true;
        const applicantDept = normalizeId(approval.applicant_department);
        if (applicantDept && applicantDept === department) return true;
        const employeeDept = normalizeId(approval.applicant_employee?.department);
        return employeeDept === department;
      })();
      if (!matchesDepartment) return false;
      if (!subDepartment) return true;
      const employeeSub = normalizeId(approval.applicant_employee?.subDepartment);
      return employeeSub === subDepartment;
    });

    const { formId, startId, endId, typeId } = await getLeaveFieldIds();
    const leaves = filteredApprovals
      .filter(a => a.form && String(a.form._id) === formId && a.status === 'approved')
      .map(a => ({
        employee: a.applicant_employee,
        leaveType: a.form_data?.[typeId],
        startDate: a.form_data?.[startId],
        endDate: a.form_data?.[endId],
        status: a.status,
      }));

    res.json({ leaves, approvals: filteredApprovals });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function listSupervisorSummary(req, res) {
  try {
    const { month, includeSelf: includeSelfRaw } = req.query;
    const supervisor = req.user?.id;
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!supervisor) return res.status(400).json({ error: 'supervisor required' });
    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';

    const range = getMonthRange(month);
    if (!range) return res.status(400).json({ error: 'invalid month' });
    const { start, end } = range;

    const employees = await Employee.find({ supervisor })
      .select('_id name')
      .lean();
    const summaryMap = {};
    const ids = [];
    employees.forEach((e) => {
      const key = e._id.toString();
      ids.push(key);
      summaryMap[key] = {
        employee: key,
        name: e.name,
        shiftCount: 0,
        leaveCount: 0,
        absenceCount: 0,
      };
    });

    if (includeSelf) {
      const self = await Employee.findById(supervisor).select('_id name').lean();
      if (self?._id) {
        const key = self._id.toString();
        if (!summaryMap[key]) {
          ids.push(key);
          summaryMap[key] = {
            employee: key,
            name: self.name,
            shiftCount: 0,
            leaveCount: 0,
            absenceCount: 0,
          };
        }
      }
    }

    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) return res.json([]);

    const setting = await AttendanceSetting.findOne().lean();
    const shiftMap = {};
    setting?.shifts?.forEach((s) => {
      shiftMap[s._id.toString()] = s.name;
    });

    const schedules = await ShiftSchedule.find({
      employee: { $in: uniqueIds },
      date: { $gte: start, $lt: end },
    }).lean();

    const leaveDaysMap = new Map();
    const { formId, startId, endId } = await getLeaveFieldIds();
    if (formId && startId && endId && uniqueIds.length) {
      const leaveQuery = {
        form: formId,
        status: 'approved',
        applicant_employee: { $in: uniqueIds },
      };
      leaveQuery[`form_data.${startId}`] = { $lte: end };
      leaveQuery[`form_data.${endId}`] = { $gte: start };
      const approvals = await ApprovalRequest.find(leaveQuery).lean();
      approvals.forEach((approval) => {
        const rawEmp = approval.applicant_employee;
        const empId = rawEmp?._id?.toString?.() || rawEmp?.toString?.();
        if (!empId) return;
        const rawStart = approval.form_data?.[startId];
        const rawEnd = approval.form_data?.[endId];
        const startDate = rawStart ? new Date(rawStart) : null;
        const endDate = rawEnd ? new Date(rawEnd) : null;
        if (!startDate || !endDate || Number.isNaN(startDate) || Number.isNaN(endDate)) return;
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        const monthStart = new Date(start);
        const monthEnd = new Date(end);
        monthStart.setHours(0, 0, 0, 0);
        monthEnd.setHours(0, 0, 0, 0);
        const leaveStart = startDate < monthStart ? monthStart : new Date(startDate);
        const leaveEnd = endDate >= monthEnd ? new Date(monthEnd.getTime() - 86400000) : new Date(endDate);
        if (leaveEnd < leaveStart) return;
        let pointer = new Date(leaveStart);
        const bucket = leaveDaysMap.get(empId) || new Set();
        while (pointer <= leaveEnd) {
          const key = pointer.toISOString().slice(0, 10);
          bucket.add(key);
          pointer = new Date(pointer.getTime() + 86400000);
        }
        leaveDaysMap.set(empId, bucket);
      });
      leaveDaysMap.forEach((set, empId) => {
        if (summaryMap[empId]) {
          summaryMap[empId].leaveCount = set.size;
        }
      });
    }

    schedules.forEach((s) => {
      const empId = s.employee?._id?.toString?.() || s.employee?.toString?.();
      if (!empId) return;
      const sum = summaryMap[empId];
      if (!sum) return;
      const dayKey = s.date ? new Date(s.date).toISOString().slice(0, 10) : '';
      if (dayKey && leaveDaysMap.get(empId)?.has(dayKey)) {
        return;
      }
      const name = shiftMap[s.shiftId?.toString()] || '';
      if (name.includes('缺')) sum.absenceCount += 1;
      else sum.shiftCount += 1;
    });

    res.json(Object.values(summaryMap));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function publishMonthlySchedules(req, res) {
  try {
    const { month, department, subDepartment } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!department) return res.status(400).json({ error: 'department required' });
    const range = getMonthRange(month);
    if (!range) return res.status(400).json({ error: 'invalid month' });

    const role = req.user?.role;
    const actorId = req.user?.id || req.user?.employeeId;
    if (!['admin', 'supervisor'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const query = {
      date: { $gte: range.start, $lt: range.end },
      department,
    };
    if (subDepartment) query.subDepartment = subDepartment;

    if (role === 'supervisor' && actorId) {
      const reports = await Employee.find({ supervisor: actorId }).select('_id');
      const allowed = reports.map((emp) => emp._id.toString());
      const actorIdStr = String(actorId);
      if (!allowed.includes(actorIdStr)) allowed.push(actorIdStr);
      query.employee = { $in: allowed };
    }

    const total = await ShiftSchedule.countDocuments(query);
    if (!total) return res.status(404).json({ error: 'no schedules found' });

    const result = await ShiftSchedule.updateMany(query, {
      $set: {
        state: 'pending_confirmation',
        employeeResponse: 'pending',
        responseNote: '',
        responseAt: null,
        publishedAt: null,
      },
    });

    const refreshed = await ShiftSchedule.find(query).populate('employee').lean();
    const meta = deriveMonthMeta(refreshed);

    res.json({
      updated: result.modifiedCount ?? result.nModified ?? 0,
      total,
      month,
      meta,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function finalizeMonthlySchedules(req, res) {
  try {
    const { month, department, subDepartment } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!department) return res.status(400).json({ error: 'department required' });
    const range = getMonthRange(month);
    if (!range) return res.status(400).json({ error: 'invalid month' });

    const role = req.user?.role;
    const actorId = req.user?.id || req.user?.employeeId;
    if (!['admin', 'supervisor'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const query = {
      date: { $gte: range.start, $lt: range.end },
      department,
    };
    if (subDepartment) query.subDepartment = subDepartment;

    if (role === 'supervisor' && actorId) {
      const reports = await Employee.find({ supervisor: actorId }).select('_id');
      const allowed = reports.map((emp) => emp._id.toString());
      const actorIdStr = String(actorId);
      if (!allowed.includes(actorIdStr)) allowed.push(actorIdStr);
      query.employee = { $in: allowed };
    }

    const raw = await ShiftSchedule.find(query).populate('employee').lean();
    if (!raw.length) return res.status(404).json({ error: 'no schedules found' });

    const metaBefore = deriveMonthMeta(raw);
    if (metaBefore.pendingEmployees.length) {
      return res.status(400).json({
        error: 'pending confirmations',
        pendingEmployees: metaBefore.pendingEmployees,
        disputedEmployees: metaBefore.disputedEmployees,
      });
    }

    const now = new Date();
    const result = await ShiftSchedule.updateMany(query, {
      $set: { state: 'finalized', publishedAt: now },
    });

    const refreshed = await ShiftSchedule.find(query).populate('employee').lean();
    const meta = deriveMonthMeta(refreshed);

    res.json({
      updated: result.modifiedCount ?? result.nModified ?? 0,
      total: raw.length,
      month,
      meta,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function respondMonthlySchedule(req, res) {
  try {
    const { month, response, note } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });
    const normalizedResponse = response === 'confirmed' ? 'confirmed' : response === 'disputed' ? 'disputed' : null;
    if (!normalizedResponse) return res.status(400).json({ error: 'invalid response' });

    const range = getMonthRange(month);
    if (!range) return res.status(400).json({ error: 'invalid month' });

    const employeeId = req.user?.employeeId || req.user?.id;
    if (!employeeId) return res.status(403).json({ error: 'forbidden' });

    const baseQuery = {
      employee: employeeId,
      date: { $gte: range.start, $lt: range.end },
    };

    const available = await ShiftSchedule.find(baseQuery).lean();
    if (!available.length) {
      return res.status(404).json({ error: 'no schedules found' });
    }

    const pending = available.filter((s) => s.state === 'pending_confirmation');
    if (!pending.length) {
      return res.status(400).json({ error: 'no pending schedules' });
    }

    if (available.some((s) => s.state === 'finalized')) {
      return res.status(400).json({ error: 'schedules already finalized' });
    }

    const sanitizedNote = normalizedResponse === 'disputed' && typeof note === 'string'
      ? note.trim().slice(0, 500)
      : '';
    const now = new Date();

    const updateResult = await ShiftSchedule.updateMany(
      { ...baseQuery, state: 'pending_confirmation' },
      {
        $set: {
          employeeResponse: normalizedResponse,
          responseNote: sanitizedNote,
          responseAt: now,
        },
      },
    );

    if ((updateResult.matchedCount ?? updateResult.n) === 0) {
      return res.status(400).json({ error: 'no pending schedules' });
    }

    const refreshed = await ShiftSchedule.find(baseQuery).populate('employee').lean();
    const schedules = await attachShiftInfo(refreshed);
    const meta = deriveMonthMeta(refreshed);
    const selfStatus = meta.employeeStatuses.find((entry) => entry.employeeId === toObjectIdString(employeeId));

    res.json({
      month,
      response: normalizedResponse,
      note: sanitizedNote,
      responseAt: now,
      status: selfStatus?.status || normalizedResponse,
      schedules,
      meta,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

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
      dt.setHours(0, 0, 0, 0);
      const key = `${raw.employee}-${dt.getTime()}`;
      scheduleMap.set(key, {
        employee: raw.employee,
        date: dt,
        shiftId: raw.shiftId,
        department: raw.department,
        subDepartment: raw.subDepartment,
      });
    }

    const uniqueSchedules = Array.from(scheduleMap.values());

    for (const entry of uniqueSchedules) {
      if (await hasLeaveConflict(entry.employee, entry.date)) {
        return res.status(400).json({ error: 'leave conflict' });
      }
    }

    const updated = [];
    const toInsert = [];

    for (const sched of uniqueSchedules) {
      const existing = await ShiftSchedule.findOne({ employee: sched.employee, date: sched.date });
      if (existing) {
        existing.employee = sched.employee;
        existing.date = sched.date;
        existing.shiftId = sched.shiftId;
        existing.department = sched.department ?? existing.department;
        existing.subDepartment = sched.subDepartment ?? existing.subDepartment;
        resetScheduleConfirmation(existing);
        const saved = await existing.save();
        updated.push(typeof saved?.toObject === 'function' ? saved.toObject() : saved);
      } else {
        toInsert.push({
          employee: sched.employee,
          date: sched.date,
          shiftId: sched.shiftId,
          department: sched.department,
          subDepartment: sched.subDepartment,
        });
      }
    }

    let inserted = [];
    if (toInsert.length) {
      const docs = await ShiftSchedule.insertMany(toInsert, { ordered: false });
      inserted = docs.map((doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : doc));
    }

    res.status(201).json([...inserted, ...updated]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function listSchedules(req, res) {
  try {
    const raw = await ShiftSchedule.find().populate('employee').lean();
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

    const existing = await ShiftSchedule.findOne({ employee, date: dt });
    if (existing) {
      if (
        (department || subDepartment) &&
        (existing.department?.toString() !== department?.toString() ||
          existing.subDepartment?.toString() !== subDepartment?.toString())
      ) {
        return res.status(400).json({ error: 'department overlap' });
      }
      return res.status(400).json({ error: 'employee conflict' });
    }

    if (await hasLeaveConflict(employee, dt)) {
      return res.status(400).json({ error: 'leave conflict' });
    }

    const schedule = await ShiftSchedule.create({
      employee,
      date: dt,
      shiftId,
      department,
      subDepartment
    });
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getSchedule(req, res) {
  try {
    const schedule = await ShiftSchedule.findById(req.params.id).populate('employee');
    if (!schedule) return res.status(404).json({ error: 'Not found' });
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

    const conflict = await ShiftSchedule.findOne({
      employee: newEmployee,
      date: newDate,
      _id: { $ne: schedule._id },
    });
    if (conflict) {
      if (
        (department || subDepartment) &&
        (conflict.department?.toString() !== department?.toString() ||
          conflict.subDepartment?.toString() !== subDepartment?.toString())
      ) {
        return res.status(400).json({ error: 'department overlap' });
      }
      return res.status(400).json({ error: 'employee conflict' });
    }

    if (await hasLeaveConflict(newEmployee, newDate)) {
      return res.status(400).json({ error: 'leave conflict' });
    }

    schedule.employee = newEmployee;
    schedule.date = newDate;
    if (shiftId !== undefined) schedule.shiftId = shiftId;
    if (department !== undefined) schedule.department = department;
    if (subDepartment !== undefined) schedule.subDepartment = subDepartment;
    resetScheduleConfirmation(schedule);
    const saved = await schedule.save();
    res.json(saved);
  } catch (err) {
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

export async function exportSchedules(req, res) {
  try {
    const { month, department, subDepartment, format: formatParam } = req.query;
    if (!month || !department) {
      return res.status(400).json({ error: 'month and department required' });
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'invalid month format' });
    }

    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const query = {
      date: { $gte: start, $lt: end },
      department,
    };
    if (subDepartment) query.subDepartment = subDepartment;

    const raw = await ShiftSchedule.find(query).populate('employee').lean();
    const schedules = await attachShiftInfo(raw);
    const format = formatParam === 'excel' ? 'excel' : 'pdf';

    const sanitizeSegment = (value) => {
      const cleaned = String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '');
      return cleaned || 'all';
    };

    const sanitizedMonth = month.replace(/\D/g, '') || 'all';
    const filenameParts = ['schedules', sanitizedMonth, sanitizeSegment(department)];
    if (subDepartment) {
      filenameParts.push(sanitizeSegment(subDepartment));
    }
    const extension = format === 'excel' ? 'xlsx' : 'pdf';
    const filename = `${filenameParts.join('-')}.${extension}`;

    if (format === 'excel') {
      let ExcelJS;
      try {
        ExcelJS = (await import('exceljs')).default;
      } catch (err) {
        return res.status(500).json({ error: 'exceljs module not installed' });
      }
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Schedules');
      ws.columns = [
        { header: 'Employee', key: 'employee' },
        { header: 'Date', key: 'date' },
        { header: 'Shift ID', key: 'shiftId' },
        { header: 'Shift Name', key: 'shiftName' }
      ];
      schedules.forEach((s) => {
        ws.addRow({
          employee: s.employee?.name ?? '',
          date: s.date,
          shiftId: s.shiftId,
          shiftName: s.shiftName
        });
      });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const buffer = await workbook.xlsx.writeBuffer();
      return res.send(buffer);
    } else {
      let PDFDocument;
      try {
        PDFDocument = (await import('pdfkit')).default;
      } catch (err) {
        return res.status(500).json({ error: 'pdfkit module not installed' });
      }
      const doc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      doc.fontSize(16).text('Schedules', { align: 'center' });
      doc.moveDown();
      schedules.forEach((s) => {
        doc.fontSize(12).text(
          `${s.employee?.name ?? ''}\t${s.date}\t${s.shiftId}\t${s.shiftName}`
        );
      });
      doc.pipe(res);
      doc.end();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
