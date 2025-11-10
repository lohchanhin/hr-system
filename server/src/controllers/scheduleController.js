import ShiftSchedule from '../models/ShiftSchedule.js';
import Employee from '../models/Employee.js';
import ApprovalRequest from '../models/approval_request.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Department from '../models/Department.js';
import { getLeaveFieldIds } from '../services/leaveFieldService.js';

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

function buildMonthDays(startDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const days = [];
  const pointer = new Date(start);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  while (pointer < end) {
    days.push(pointer.toISOString().slice(0, 10));
    pointer.setDate(pointer.getDate() + 1);
  }
  return days;
}

function buildMonthRange(month) {
  if (!month) throw new Error('month required');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('invalid month format');
  }
  const start = new Date(`${month}-01`);
  if (Number.isNaN(start.getTime())) {
    throw new Error('invalid month');
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

function normalizeScheduleField(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value) {
    if (value._id) return value._id.toString();
    if (value.id) return value.id.toString();
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      return value.toString();
    }
  }
  if (value === null || value === undefined) return '';
  return value.toString();
}

function resetScheduleProgress(doc) {
  doc.state = 'draft';
  doc.publishedAt = null;
  doc.employeeResponse = 'pending';
  doc.responseNote = '';
  doc.responseAt = null;
}

function hasScheduleDiff(existing, nextData) {
  const fields = ['employee', 'date', 'shiftId', 'department', 'subDepartment'];
  return fields.some((field) => {
    const prev = normalizeScheduleField(existing[field]);
    const next = normalizeScheduleField(nextData[field]);
    return prev !== next;
  });
}

async function resolveScopedEmployeeIds(user, { includeSelf = false } = {}) {
  if (!user) throw new Error('unauthorized');
  const { role, id } = user;
  if (['admin'].includes(role)) {
    return null;
  }
  if (role === 'supervisor') {
    const list = await Employee.find({ supervisor: id }).select('_id');
    const ids = list.map((e) => e._id.toString());
    if (includeSelf && id) ids.push(String(id));
    return ids;
  }
  if (role === 'employee' && id) {
    return [String(id)];
  }
  return [];
}

function normalizeId(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'object') {
    if (value._id) return value._id.toString();
    if (value.id) return value.id.toString();
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      return value.toString();
    }
  }
  return String(value);
}

export async function listMonthlySchedules(req, res) {
  try {
    const { month, employee, supervisor, includeSelf: includeSelfRaw } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const query = { date: { $gte: start, $lt: end } };
    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';

    if (supervisor) {
      const role = req.user?.role;
      const allowedRoles = ['supervisor', 'admin'];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const emps = await Employee.find({ supervisor }).select('_id');
      const idSet = new Set(emps.map((e) => e._id.toString()));
      if (includeSelf && supervisor) {
        idSet.add(String(supervisor));
      }
      query.employee = { $in: Array.from(idSet) };
    } else {
      const empId = employee || (req.user?.role === 'employee' ? req.user.id : undefined);
      if (empId) query.employee = empId;
    }

    const raw = await ShiftSchedule.find(query).populate('employee').lean();
    const schedules = await attachShiftInfo(raw);
    res.json(schedules);
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
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

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

    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

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

export async function listScheduleOverview(req, res) {
  try {
    const { month, organization: organizationId, department: departmentId, subDepartment: subDepartmentId } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'invalid month format' });
    }

    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const days = buildMonthDays(start);
    const query = {
      date: { $gte: start, $lt: end },
    };

    if (subDepartmentId) {
      query.subDepartment = subDepartmentId;
    }

    if (departmentId) {
      query.department = departmentId;
    }

    if (organizationId) {
      const deptDocs = await Department.find({ organization: organizationId }).select('_id organization name').lean();
      const allowedIds = deptDocs.map((dept) => dept._id.toString());
      if (!allowedIds.length) {
        return res.json({ month, days, organizations: [] });
      }
      if (!departmentId) {
        query.department = { $in: allowedIds };
      } else if (!allowedIds.includes(String(departmentId))) {
        return res.json({ month, days, organizations: [] });
      }
    }

    const attendanceSetting = await AttendanceSetting.findOne().lean();
    const shiftNameMap = {};
    attendanceSetting?.shifts?.forEach((shift) => {
      if (shift?._id) {
        shiftNameMap[shift._id.toString()] = shift.name || '';
      }
    });

    const rawSchedules = await ShiftSchedule.find(query)
      .populate({
        path: 'department',
        populate: { path: 'organization' },
      })
      .populate('subDepartment')
      .populate({ path: 'employee', select: 'name title department subDepartment' })
      .lean();

    const organizationMap = new Map();

    rawSchedules.forEach((schedule) => {
      const department = schedule.department || null;
      const organization = department?.organization || null;
      const subDepartment = schedule.subDepartment || null;
      const employee = schedule.employee || null;

      const organizationKey = normalizeId(organization?._id) || 'unassigned';
      const departmentKey = normalizeId(department?._id) || 'unassigned';
      const subDepartmentKey = normalizeId(subDepartment?._id) || 'unassigned';
      const employeeKey = normalizeId(employee?._id) || 'unassigned';

      if (!organizationMap.has(organizationKey)) {
        organizationMap.set(organizationKey, {
          id: organizationKey,
          name: organization?.name || '未指定機構',
          departments: new Map(),
        });
      }

      const organizationEntry = organizationMap.get(organizationKey);
      if (!organizationEntry.departments.has(departmentKey)) {
        organizationEntry.departments.set(departmentKey, {
          id: departmentKey,
          name: department?.name || '未指定部門',
          subDepartments: new Map(),
        });
      }

      const departmentEntry = organizationEntry.departments.get(departmentKey);
      if (!departmentEntry.subDepartments.has(subDepartmentKey)) {
        departmentEntry.subDepartments.set(subDepartmentKey, {
          id: subDepartmentKey,
          name: subDepartment?.name || '未指定單位',
          employees: new Map(),
        });
      }

      const subDepartmentEntry = departmentEntry.subDepartments.get(subDepartmentKey);
      if (!subDepartmentEntry.employees.has(employeeKey)) {
        subDepartmentEntry.employees.set(employeeKey, {
          id: employeeKey,
          name: employee?.name || '未指定員工',
          title: employee?.title || '',
          schedules: [],
        });
      }

      const entry = subDepartmentEntry.employees.get(employeeKey);
      const shiftId = normalizeId(schedule.shiftId);
      const scheduleDate = schedule.date instanceof Date
        ? schedule.date.toISOString().slice(0, 10)
        : new Date(schedule.date).toISOString().slice(0, 10);
      entry.schedules.push({
        date: scheduleDate,
        shiftId,
        shiftName: shiftNameMap[shiftId] || schedule.shiftName || '',
      });
    });

    const organizations = Array.from(organizationMap.values())
      .map((org) => ({
        id: org.id,
        name: org.name,
        departments: Array.from(org.departments.values())
          .map((dept) => ({
            id: dept.id,
            name: dept.name,
            subDepartments: Array.from(dept.subDepartments.values())
              .map((sub) => ({
                id: sub.id,
                name: sub.name,
                employees: Array.from(sub.employees.values()).map((emp) => ({
                  id: emp.id,
                  name: emp.name,
                  title: emp.title,
                  schedules: emp.schedules
                    .sort((a, b) => a.date.localeCompare(b.date)),
                }))
                  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' })),
              }))
              .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' })),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }));

    res.json({ month, days, organizations });
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
        const nextData = {
          employee: sched.employee,
          date: sched.date,
          shiftId: sched.shiftId,
          department: sched.department ?? existing.department,
          subDepartment: sched.subDepartment ?? existing.subDepartment,
        };
        const shouldReset = hasScheduleDiff(existing, nextData);
        existing.employee = nextData.employee;
        existing.date = nextData.date;
        existing.shiftId = nextData.shiftId;
        existing.department = nextData.department;
        existing.subDepartment = nextData.subDepartment;
        if (shouldReset) {
          resetScheduleProgress(existing);
        }
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

function buildPublishQuery({ start, end }, { department, subDepartment }) {
  const query = {
    date: { $gte: start, $lt: end },
    state: { $ne: 'finalized' },
  };
  if (department) query.department = department;
  if (subDepartment) query.subDepartment = subDepartment;
  return query;
}

function summarizeEmployees(docs) {
  const map = new Map();
  docs.forEach((doc) => {
    const emp = doc.employee || {};
    const id = emp?._id?.toString?.() || doc.employee?.toString?.();
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: emp.name || '',
        response: doc.employeeResponse || 'pending',
        state: doc.state || 'draft',
      });
    }
  });
  return Array.from(map.values());
}

export async function publishSchedules(req, res) {
  try {
    const { month, department, subDepartment, includeSelf } = req.body || {};
    let range;
    try {
      range = buildMonthRange(month);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let scopedIds;
    try {
      scopedIds = await resolveScopedEmployeeIds(req.user, { includeSelf });
    } catch (err) {
      return res.status(401).json({ error: err.message || 'unauthorized' });
    }

    const query = buildPublishQuery(range, { department, subDepartment });
    if (Array.isArray(scopedIds)) {
      if (!scopedIds.length) {
        return res.status(404).json({ error: 'no employees in scope' });
      }
      query.employee = { $in: scopedIds };
    }

    const docs = await ShiftSchedule.find(query).populate('employee').lean();
    if (!docs.length) {
      return res.status(404).json({ error: 'no schedules found' });
    }

    const now = new Date();
    const ids = docs.map((doc) => doc._id);
    await ShiftSchedule.updateMany({ _id: { $in: ids } }, {
      $set: {
        state: 'pending_confirmation',
        publishedAt: now,
        employeeResponse: 'pending',
        responseNote: '',
        responseAt: null,
      },
    });

    const employees = summarizeEmployees(docs).map((entry) => ({
      ...entry,
      response: 'pending',
      state: 'pending_confirmation',
    }));

    res.json({
      updated: ids.length,
      employees,
      publishedAt: now.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function finalizeSchedules(req, res) {
  try {
    const { month, department, subDepartment, includeSelf } = req.body || {};
    let range;
    try {
      range = buildMonthRange(month);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let scopedIds;
    try {
      scopedIds = await resolveScopedEmployeeIds(req.user, { includeSelf });
    } catch (err) {
      return res.status(401).json({ error: err.message || 'unauthorized' });
    }

    const query = {
      ...buildPublishQuery(range, { department, subDepartment }),
    };
    query.state = { $in: ['pending_confirmation', 'changes_requested'] };
    if (Array.isArray(scopedIds)) {
      if (!scopedIds.length) {
        return res.status(404).json({ error: 'no employees in scope' });
      }
      query.employee = { $in: scopedIds };
    }

    const docs = await ShiftSchedule.find(query).populate('employee').lean();
    if (!docs.length) {
      return res.status(404).json({ error: 'no schedules found' });
    }

    const pendingMap = new Map();
    const disputedMap = new Map();
    const register = (collection, doc) => {
      const emp = doc.employee || {};
      const id = emp?._id?.toString?.() || doc.employee?.toString?.();
      if (!id) return;
      if (!collection.has(id)) {
        collection.set(id, {
          id,
          name: emp.name || '',
          response: doc.employeeResponse,
          latestNote: doc.responseNote || '',
          schedules: [],
        });
      }
      const entry = collection.get(id);
      entry.schedules.push({
        scheduleId: doc._id?.toString?.() || String(doc._id),
        date: doc.date instanceof Date ? doc.date.toISOString() : new Date(doc.date).toISOString(),
        state: doc.state,
        response: doc.employeeResponse,
        note: doc.responseNote || '',
      });
    };

    docs.forEach((doc) => {
      if (doc.employeeResponse === 'confirmed') return;
      if (doc.employeeResponse === 'disputed' || doc.state === 'changes_requested') {
        register(disputedMap, doc);
      } else {
        register(pendingMap, doc);
      }
    });

    if (pendingMap.size || disputedMap.size) {
      return res.status(409).json({
        error: 'unconfirmed employees',
        pendingEmployees: Array.from(pendingMap.values()),
        disputedEmployees: Array.from(disputedMap.values()),
      });
    }

    const pendingDocs = docs.filter((doc) => doc.state === 'pending_confirmation');
    if (!pendingDocs.length) {
      return res.status(400).json({ error: 'no pending schedules to finalize' });
    }

    const ids = pendingDocs.map((doc) => doc._id);
    await ShiftSchedule.updateMany({ _id: { $in: ids } }, {
      $set: { state: 'finalized' },
    });

    res.json({ finalized: ids.length });
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

    const nextData = {
      employee: newEmployee,
      date: newDate,
      shiftId: shiftId !== undefined ? shiftId : schedule.shiftId,
      department: department !== undefined ? department : schedule.department,
      subDepartment: subDepartment !== undefined ? subDepartment : schedule.subDepartment,
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
    res.status(400).json({ error: err.message });
  }
}

function normalizeResponsePayload(response) {
  const value = String(response || '').trim().toLowerCase();
  if (!value) return '';
  return value;
}

function sanitizeNote(note) {
  if (typeof note !== 'string') return '';
  const trimmed = note.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 1000);
}

export async function respondToSchedule(req, res) {
  try {
    const { id } = req.params;
    const { response, note } = req.body || {};
    const schedule = await ShiftSchedule.findById(id).populate('employee');
    if (!schedule) return res.status(404).json({ error: 'Not found' });

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const employeeId = schedule.employee?._id?.toString?.() || schedule.employee?.toString?.();
    if (!employeeId || employeeId !== String(userId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (schedule.state === 'finalized') {
      return res.status(400).json({ error: 'schedule finalized' });
    }
    if (schedule.state !== 'pending_confirmation') {
      return res.status(400).json({ error: 'schedule not awaiting confirmation' });
    }

    const normalized = normalizeResponsePayload(response);
    const noteValue = sanitizeNote(note);
    const now = new Date();

    if (['confirm', 'confirmed', 'approve', 'approved', 'accept', 'accepted', 'ok', 'okay', 'yes'].includes(normalized)) {
      schedule.employeeResponse = 'confirmed';
      schedule.state = 'pending_confirmation';
      schedule.responseNote = '';
      schedule.responseAt = now;
    } else if (['dispute', 'disputed', 'reject', 'rejected', 'no', 'object', 'objection', 'issue'].includes(normalized)) {
      if (!noteValue) {
        return res.status(400).json({ error: 'objection note required' });
      }
      schedule.employeeResponse = 'disputed';
      schedule.state = 'changes_requested';
      schedule.responseNote = noteValue;
      schedule.responseAt = now;
    } else {
      return res.status(400).json({ error: 'invalid response' });
    }

    const saved = await schedule.save();
    await saved.populate('employee');
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
