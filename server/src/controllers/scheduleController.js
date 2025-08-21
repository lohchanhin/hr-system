import ShiftSchedule from '../models/ShiftSchedule.js';
import Employee from '../models/Employee.js';
import LeaveRequest from '../models/LeaveRequest.js';
import ApprovalRequest from '../models/approval_request.js';

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
    } else if (employee) {
      query.employee = employee;
    }

    const schedules = await ShiftSchedule.find(query).populate('employee');
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

    const leaveQuery = { startDate: { $lte: end }, endDate: { $gte: start } };
    if (empFilter) leaveQuery.employee = empFilter;
    const leaves = await LeaveRequest.find(leaveQuery).populate('employee');

    const approvalQuery = { createdAt: { $gte: start, $lt: end } };
    if (empFilter) approvalQuery.applicant_employee = empFilter;
    const approvals = await ApprovalRequest.find(approvalQuery).populate(
      'applicant_employee'
    );

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
      const leave = await LeaveRequest.findOne({
        employee: s.employee,
        startDate: { $lte: dt },
        endDate: { $gte: dt },
        status: 'approved'
      });
      if (leave) return res.status(400).json({ error: 'leave conflict' });
    }
    const inserted = await ShiftSchedule.insertMany(schedules, { ordered: false });
    res.status(201).json(inserted);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function listSchedules(req, res) {
  try {
    const schedules = await ShiftSchedule.find().populate('employee');
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

    const leave = await LeaveRequest.findOne({
      employee,
      startDate: { $lte: dt },
      endDate: { $gte: dt },
      status: 'approved'
    });
    if (leave) return res.status(400).json({ error: 'leave conflict' });

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
    const schedule = await ShiftSchedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
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
    const schedules = await ShiftSchedule.find().populate('employee');
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
        { header: 'Shift ID', key: 'shiftId' }
      ];
      schedules.forEach((s) => {
        ws.addRow({
          employee: s.employee?.name ?? '',
          date: new Date(s.date).toISOString().split('T')[0],
          shiftId: s.shiftId
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
        doc
          .fontSize(12)
          .text(
            `${s.employee?.name ?? ''}\t${new Date(s.date)
              .toISOString()
              .split('T')[0]}\t${s.shiftId}`
          );
      });
      doc.pipe(res);
      doc.end();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
