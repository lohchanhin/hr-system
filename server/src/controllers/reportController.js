import Report from '../models/Report.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import ApprovalRequest from '../models/approval_request.js';
import { getLeaveFieldIds } from '../services/leaveFieldService.js';
import { exportTabularReport } from '../services/reportExportHelper.js';

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
  if (value === undefined || value === null) return '';

  const visited = new Set();
  let current = value;
  let depth = 0;
  const MAX_DEPTH = 50;

  while (current !== undefined && current !== null && depth < MAX_DEPTH) {
    const type = typeof current;

    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
      return String(current);
    }

    if (type === 'object') {
      if (visited.has(current)) break;
      visited.add(current);

      if (typeof current.toHexString === 'function') {
        const hex = current.toHexString();
        if (hex) return String(hex);
      }

      if (typeof current.toString === 'function' && current.toString !== Object.prototype.toString) {
        const str = current.toString();
        if (typeof str === 'string' && str && str !== '[object Object]') {
          return str;
        }
      }

      if ('_id' in current) {
        const next = current._id;
        if (next !== current && next !== undefined && next !== null) {
          current = next;
          depth += 1;
          continue;
        }
      }

      if (typeof current.valueOf === 'function') {
        const valueOf = current.valueOf();
        if (valueOf !== current) {
          current = valueOf;
          depth += 1;
          continue;
        }
      }

      break;
    }

    if (type === 'function') {
      if (visited.has(current)) break;
      visited.add(current);
      current = current();
      depth += 1;
      continue;
    }

    return String(current);
  }

  if (depth >= MAX_DEPTH) return '';

  if (current === undefined || current === null) return '';

  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean' || typeof current === 'bigint') {
    return String(current);
  }

  if (typeof current.toString === 'function') {
    const fallback = current.toString();
    if (typeof fallback === 'string' && fallback !== '[object Object]') {
      return fallback;
    }
  }

  return String(current);
}

function normalizeDateKey(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatYMD(dateLike) {
  if (!dateLike) return '';
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function calculateInclusiveDays(start, end) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || !endDate) return 0;
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return 0;
  if (endTime < startTime) return 0;
  const diff = endTime - startTime;
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function createTypeMap(options = []) {
  const map = new Map();
  options.forEach((opt) => {
    if (!opt) return;
    const value = opt.value ?? opt.code ?? opt.id ?? opt.key;
    const label = opt.label ?? opt.name ?? opt.title ?? opt.text ?? opt.display ?? value;
    if (value !== undefined && value !== null) {
      const strValue = String(value);
      map.set(strValue, label !== undefined && label !== null ? String(label) : strValue);
    }
    if (label !== undefined && label !== null) {
      const labelStr = String(label);
      if (!map.has(labelStr)) map.set(labelStr, labelStr);
    }
  });
  return map;
}

function humanizeLeaveType(raw, typeMap) {
  if (raw === undefined || raw === null) return { label: '', code: '' };
  if (typeof raw === 'object') {
    const codeCandidate =
      raw.code ?? raw.value ?? raw.id ?? raw._id ?? (typeof raw.toString === 'function' ? raw.toString() : '');
    const code = codeCandidate ? String(codeCandidate) : '';
    const labelCandidate = raw.label ?? raw.name ?? raw.title ?? (code ? typeMap.get(code) : undefined);
    const label = labelCandidate ? String(labelCandidate) : code;
    return { label, code: code || label };
  }
  const code = String(raw);
  const label =
    typeMap.get(code) ??
    typeMap.get(code.toUpperCase?.() ?? code) ??
    typeMap.get(code.toLowerCase?.() ?? code) ??
    code;
  return { label: String(label), code };
}

export async function exportDepartmentAttendance(req, res) {
  try {
    const { month, department, format: rawFormat } = req.query;
    if (!month || !department) {
      return res.status(400).json({ error: 'month and department required' });
    }

    const start = new Date(`${month}-01`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: 'invalid month' });
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const format = typeof rawFormat === 'string' ? rawFormat.toLowerCase() : 'json';

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

    if (format === 'excel' || format === 'pdf') {
      const rows = results.map((record) => ({
        employee: record.name,
        scheduled: record.scheduled,
        attended: record.attended,
        absent: record.absent,
      }));
      await exportTabularReport(res, {
        format,
        fileName: `attendance-${department}-${month}`,
        sheetName: 'Attendance',
        title: `${month} ${department} 出勤統計`,
        columns: [
          { header: '員工姓名', key: 'employee', width: 24 },
          { header: '排班天數', key: 'scheduled', width: 14 },
          { header: '實際出勤', key: 'attended', width: 14 },
          { header: '缺勤天數', key: 'absent', width: 14 },
        ],
        rows,
        summaryRows: [
          { label: '排班總計', value: summary.scheduled },
          { label: '出勤總計', value: summary.attended },
          { label: '缺勤總計', value: summary.absent },
        ],
      });
      return;
    }

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

export async function exportDepartmentLeave(req, res) {
  try {
    const { month, department, format: rawFormat } = req.query;
    if (!month || !department) {
      return res.status(400).json({ error: 'month and department required' });
    }

    const role = req.user?.role;
    if (!['admin', 'supervisor'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const start = new Date(`${month}-01`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: 'invalid month' });
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const format = typeof rawFormat === 'string' ? rawFormat.toLowerCase() : 'json';

    const { formId, startId, endId, typeId, typeOptions } = await getLeaveFieldIds();
    if (!formId || !startId || !endId) {
      return res.status(400).json({ error: 'leave form not configured' });
    }

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
    if (!employeeIds.length) {
      return res.status(404).json({ error: 'No data' });
    }

    const approvals = await ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
      createdAt: { $gte: start, $lt: end },
    })
      .populate('applicant_employee', 'name')
      .lean();

    if (!approvals.length) {
      return res.status(404).json({ error: 'No data' });
    }

    const typeMap = createTypeMap(typeOptions);
    const records = approvals.map((approval) => {
      const startValue = startId ? approval.form_data?.[startId] : undefined;
      const endValue = endId ? approval.form_data?.[endId] : undefined;
      const typeValue = typeId ? approval.form_data?.[typeId] : undefined;
      const { label: leaveType, code: leaveCode } = humanizeLeaveType(typeValue, typeMap);
      const days = calculateInclusiveDays(startValue, endValue);
      return {
        approvalId: normalizeId(approval._id),
        employee: normalizeId(approval.applicant_employee?._id ?? approval.applicant_employee),
        name: approval.applicant_employee?.name ?? '',
        leaveType,
        leaveCode,
        startDate: formatYMD(startValue),
        endDate: formatYMD(endValue),
        days,
      };
    });

    const typeSummaryMap = new Map();
    let totalDays = 0;
    records.forEach((record) => {
      totalDays += Number.isFinite(record.days) ? record.days : 0;
      const key = record.leaveCode || record.leaveType || '';
      const existing = typeSummaryMap.get(key) || {
        leaveType: record.leaveType || record.leaveCode || '',
        leaveCode: record.leaveCode || '',
        count: 0,
        days: 0,
      };
      existing.count += 1;
      existing.days += Number.isFinite(record.days) ? record.days : 0;
      if (!existing.leaveType && record.leaveType) existing.leaveType = record.leaveType;
      if (!existing.leaveCode && record.leaveCode) existing.leaveCode = record.leaveCode;
      typeSummaryMap.set(key, existing);
    });

    const summary = {
      totalLeaves: records.length,
      totalDays,
      byType: Array.from(typeSummaryMap.values()),
    };

    if (format === 'excel' || format === 'pdf') {
      const rows = records.map((record) => ({
        employee: record.name,
        leaveType: record.leaveType || record.leaveCode,
        leaveCode: record.leaveCode,
        startDate: record.startDate,
        endDate: record.endDate,
        days: record.days,
      }));
      const summaryRows = [
        { label: '總請假件數', value: summary.totalLeaves },
        { label: '總請假天數', value: summary.totalDays },
        ...summary.byType.map((item) => ({
          label: `${item.leaveType || item.leaveCode} 件數`,
          value: `${item.count} 筆 / ${item.days} 天`,
        })),
      ];
      await exportTabularReport(res, {
        format,
        fileName: `leave-${department}-${month}`,
        sheetName: 'Department Leave',
        title: `${month} ${department} 請假統計`,
        columns: [
          { header: '員工姓名', key: 'employee', width: 24 },
          { header: '假別', key: 'leaveType', width: 18 },
          { header: '假別代碼', key: 'leaveCode', width: 16 },
          { header: '開始日期', key: 'startDate', width: 16 },
          { header: '結束日期', key: 'endDate', width: 16 },
          { header: '天數', key: 'days', width: 10 },
        ],
        rows,
        summaryRows,
      });
      return;
    }

    res.json({
      month,
      department,
      summary,
      records,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
