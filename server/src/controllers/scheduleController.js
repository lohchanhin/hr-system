import ShiftSchedule from '../models/ShiftSchedule.js';
import Employee from '../models/Employee.js';
import ApprovalRequest from '../models/approval_request.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
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
    const { month, employee, supervisor, includeSelf: includeSelfRaw } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';
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
      .populate('form');

    const { formId, startId, endId, typeId } = await getLeaveFieldIds();
    const leaves = approvals
      .filter(a => a.form && String(a.form._id) === formId && a.status === 'approved')
      .map(a => ({
        employee: a.applicant_employee,
        leaveType: a.form_data?.[typeId],
        startDate: a.form_data?.[startId],
        endDate: a.form_data?.[endId],
        status: a.status,
      }));

    res.json({ leaves, approvals });
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
