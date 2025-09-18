import Report from '../models/Report.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceRecord from '../models/AttendanceRecord.js';

export async function listReports(req, res) {
  try {
    const reports = await Report.find();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createReport(req, res) {
  try {
    const report = new Report(req.body);
    await report.save();
    res.status(201).json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getReport(req, res) {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateReport(req, res) {
  try {
    const report = await Report.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteReport(req, res) {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

function normalizeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return normalizeId(value._id);
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function normalizeDateKey(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export async function exportDepartmentAttendance(req, res) {
  try {
    const { month, department } = req.query;
    if (!month || !department) {
      return res.status(400).json({ error: 'month and department required' });
    }

    const start = new Date(`${month}-01`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: 'invalid month' });
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const role = req.user?.role;
    const actorId = req.user?.id;

    let employees = [];
    if (role === 'supervisor') {
      if (!actorId) return res.status(403).json({ error: 'Forbidden' });
      employees = await Employee.find({ department, supervisor: actorId });
      if (!employees.length) {
        const exists = await Employee.exists({ department });
        if (exists) return res.status(403).json({ error: 'Forbidden' });
        return res.status(404).json({ error: 'No data' });
      }
    } else {
      employees = await Employee.find({ department });
      if (!employees.length) {
        return res.status(404).json({ error: 'No data' });
      }
    }

    const employeeIds = employees.map((emp) => normalizeId(emp._id)).filter(Boolean);

    const schedules = await ShiftSchedule.find({
      employee: { $in: employeeIds },
      date: { $gte: start, $lt: end },
    });

    const attendanceRecords = await AttendanceRecord.find({
      employee: { $in: employeeIds },
      action: 'clockIn',
      timestamp: { $gte: start, $lt: end },
    });

    const recordMap = new Map();
    const results = employees.map((emp) => {
      const id = normalizeId(emp._id);
      const record = {
        employee: id,
        name: emp.name,
        scheduled: 0,
        attended: 0,
        absent: 0,
      };
      recordMap.set(id, record);
      return record;
    });

    schedules.forEach((schedule) => {
      const id = normalizeId(schedule.employee);
      const record = recordMap.get(id);
      if (record) {
        record.scheduled += 1;
      }
    });

    const attendanceKeys = new Set();
    attendanceRecords.forEach((attendance) => {
      const id = normalizeId(attendance.employee);
      const dateKey = normalizeDateKey(attendance.timestamp);
      if (!id || !dateKey) return;
      const combined = `${id}-${dateKey}`;
      if (!attendanceKeys.has(combined)) {
        attendanceKeys.add(combined);
        const record = recordMap.get(id);
        if (record) record.attended += 1;
      }
    });

    results.forEach((record) => {
      record.absent = Math.max(record.scheduled - record.attended, 0);
    });

    const summary = results.reduce(
      (acc, record) => {
        acc.scheduled += record.scheduled;
        acc.attended += record.attended;
        acc.absent += record.absent;
        return acc;
      },
      { scheduled: 0, attended: 0, absent: 0 }
    );

    res.json({
      month,
      department,
      summary,
      records: results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
