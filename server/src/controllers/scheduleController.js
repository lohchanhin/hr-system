import ShiftSchedule from '../models/ShiftSchedule.js';
import Employee from '../models/Employee.js';
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';
import AttendanceSetting from '../models/AttendanceSetting.js';

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

let leaveFieldCache = null;
async function getLeaveFieldIds() {
  if (leaveFieldCache) return leaveFieldCache;
  const form = await FormTemplate.findOne({ name: '請假' });
  if (!form) return {};
  const fields = await FormField.find({ form: form._id });
  const startField = fields.find(f => f.label === '開始日期');
  const endField = fields.find(f => f.label === '結束日期');
  const typeField = fields.find(f => f.label === '假別');
  leaveFieldCache = {
    formId: form._id.toString(),
    startId: startField?._id.toString(),
    endId: endField?._id.toString(),
    typeId: typeField?._id.toString(),
  };
  return leaveFieldCache;
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
    const { month, employee, supervisor } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const query = { date: { $gte: start, $lt: end } };

    if (supervisor) {
      const emps = await Employee.find({ supervisor }).select('_id');
      const ids = emps.map((e) => e._id.toString());
      query.employee = { $in: ids };
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
    const { month, employee, supervisor } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    let ids = [];
    if (supervisor) {
      const emps = await Employee.find({ supervisor }).select('_id');
      ids = emps.map((e) => e._id.toString());
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

export async function createSchedulesBatch(req, res) {
  try {
    const { schedules } = req.body;
    if (!Array.isArray(schedules)) {
      return res.status(400).json({ error: 'schedules must be array' });
    }
    const docs = [];
    for (const s of schedules) {
      const dt = new Date(s.date);
      const existing = await ShiftSchedule.findOne({ employee: s.employee, date: dt });
      if (existing) {
        if (
          (s.department || s.subDepartment) &&
          (existing.department?.toString() !== s.department?.toString() ||
            existing.subDepartment?.toString() !== s.subDepartment?.toString())
        ) {
          return res.status(400).json({ error: 'department overlap' });
        }
        return res.status(400).json({ error: 'employee conflict' });
      }
      if (await hasLeaveConflict(s.employee, dt)) {
        return res.status(400).json({ error: 'leave conflict' });
      }
      docs.push({
        employee: s.employee,
        date: dt,
        shiftId: s.shiftId,
        department: s.department,
        subDepartment: s.subDepartment,
      });
    }
    const inserted = await ShiftSchedule.insertMany(docs, { ordered: false });
    res.status(201).json(inserted);
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
    const raw = await ShiftSchedule.find().populate('employee').lean();
    const schedules = await attachShiftInfo(raw);
    const format = req.query.format === 'excel' ? 'excel' : 'pdf';

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
      res.setHeader('Content-Disposition', 'attachment; filename="schedules.xlsx"');
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
      res.setHeader('Content-Disposition', 'attachment; filename="schedules.pdf"');
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
