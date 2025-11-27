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

    // 1️⃣ 先抓所有「直屬部屬」
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

    // 2️⃣ includeSelf 只在「排班範圍」使用，
    //    但我們稍後回傳前會把主管自己排除掉
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

    // 3️⃣ 讀取該月所有排班
    const schedules = await ShiftSchedule.find({
      employee: { $in: uniqueIds },
      date: { $gte: start, $lt: end },
    }).lean();

    // 4️⃣ 讀取該月所有請假天數
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
        const leaveEnd =
          endDate >= monthEnd
            ? new Date(monthEnd.getTime() - 86400000)
            : new Date(endDate);

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

      // 把請假天數寫進 summaryMap
      leaveDaysMap.forEach((set, empId) => {
        if (summaryMap[empId]) {
          summaryMap[empId].leaveCount = set.size;
        }
      });
    }

    // 5️⃣ 統計排班／缺勤
    schedules.forEach((s) => {
      const empId = s.employee?._id?.toString?.() || s.employee?.toString?.();
      if (!empId) return;
      const sum = summaryMap[empId];
      if (!sum) return;

      const dayKey = s.date
        ? new Date(s.date).toISOString().slice(0, 10)
        : '';
      if (dayKey && leaveDaysMap.get(empId)?.has(dayKey)) {
        // 該天是請假，就不要再算排班／缺勤
        return;
      }

      const name = shiftMap[s.shiftId?.toString()] || '';
      if (name.includes('缺')) sum.absenceCount += 1;
      else sum.shiftCount += 1;
    });

    // 6️⃣ ❗最後這一步：把「主管本人」從結果移除
    const supervisorIdStr = supervisor ? String(supervisor) : '';
    const payload = Object.values(summaryMap).filter((entry) => {
      if (!supervisorIdStr) return true;
      return String(entry.employee) !== supervisorIdStr;
    });

    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}


async function buildScheduleOverview({ month, organizationId, departmentId, subDepartmentId }) {
  if (!month) throw new Error('month required');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('invalid month format');
  }

  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const days = buildMonthDays(start);
  const query = {
    date: { $gte: start, $lt: end },
  };

  // 篩選條件維持原本邏輯
  if (subDepartmentId) {
    query.subDepartment = subDepartmentId;
  }

  if (departmentId) {
    query.department = departmentId;
  }

  if (organizationId) {
    const deptDocs = await Department.find({ organization: organizationId })
      .select('_id organization name')
      .lean();
    const allowedIds = deptDocs.map((dept) => dept._id.toString());
    if (!allowedIds.length) {
      return { month, days, organizations: [] };
    }
    if (!departmentId) {
      query.department = { $in: allowedIds };
    } else if (!allowedIds.includes(String(departmentId))) {
      return { month, days, organizations: [] };
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

    const orgName = organization?.name || '未指定機構';
    const deptName = department?.name || '未指定部門';

    // ⭐ 關鍵：用「部門 + 小單位名稱」當 key，避免同名小單位拆成多塊
    const subDepartmentName = subDepartment?.name || '未指定單位';
    const subDepartmentKey = `${departmentKey}::${subDepartmentName}`;

    const employeeKey = normalizeId(employee?._id) || 'unassigned';
    const employeeName = employee?.name || '未指定員工';
    const employeeTitle = employee?.title || '';

    if (!organizationMap.has(organizationKey)) {
      organizationMap.set(organizationKey, {
        id: organizationKey,
        name: orgName,
        departments: new Map(),
      });
    }

    const organizationEntry = organizationMap.get(organizationKey);
    if (!organizationEntry.departments.has(departmentKey)) {
      organizationEntry.departments.set(departmentKey, {
        id: departmentKey,
        name: deptName,
        subDepartments: new Map(),
      });
    }

    const departmentEntry = organizationEntry.departments.get(departmentKey);
    if (!departmentEntry.subDepartments.has(subDepartmentKey)) {
      departmentEntry.subDepartments.set(subDepartmentKey, {
        id: subDepartmentKey, // 這是「邏輯 key」，不再是資料庫 _id
        name: subDepartmentName,
        // 純紀錄：這個邏輯小單位底下實際有哪些 subDepartment _id
        sourceSubDepartmentIds: new Set(),
        employees: new Map(),
      });
    }

    const subDepartmentEntry = departmentEntry.subDepartments.get(subDepartmentKey);
    if (subDepartment?._id) {
      subDepartmentEntry.sourceSubDepartmentIds.add(subDepartment._id.toString());
    }

    if (!subDepartmentEntry.employees.has(employeeKey)) {
      subDepartmentEntry.employees.set(employeeKey, {
        id: employeeKey,
        name: employeeName,
        title: employeeTitle,
        schedules: [],
      });
    }

    const entry = subDepartmentEntry.employees.get(employeeKey);
    const shiftId = normalizeId(schedule.shiftId);
    const scheduleDate =
      schedule.date instanceof Date
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
              // 有需要除錯時可以看有哪些真實 subDepartment _id
              sourceSubDepartmentIds: Array.from(sub.sourceSubDepartmentIds || []),
              employees: Array.from(sub.employees.values())
                .map((emp) => ({
                  id: emp.id,
                  name: emp.name,
                  title: emp.title,
                  schedules: emp.schedules.sort((a, b) => a.date.localeCompare(b.date)),
                }))
                .sort((a, b) =>
                  a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }),
                ),
            }))
            .sort((a, b) =>
              a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }),
            ),
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }),
        ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }));

  return { month, days, organizations };
}


export async function listScheduleOverview(req, res) {
  try {
    const { month, organization: organizationId, department: departmentId, subDepartment: subDepartmentId } = req.query;
    const result = await buildScheduleOverview({ month, organizationId, departmentId, subDepartmentId });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function exportScheduleOverview(req, res) {
  try {
    const { month, organization: organizationId, department: departmentId, subDepartment: subDepartmentId, format: formatParam } = req.query;
    const format = String(formatParam || '').toLowerCase();
    if (!['pdf', 'excel'].includes(format)) {
      return res.status(400).json({ error: 'format must be pdf or excel' });
    }

    let overview;
    try {
      overview = await buildScheduleOverview({ month, organizationId, departmentId, subDepartmentId });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const rows = [];
    overview.organizations.forEach((org) => {
      org.departments.forEach((dept) => {
        dept.subDepartments.forEach((sub) => {
          sub.employees.forEach((emp) => {
            emp.schedules.forEach((schedule) => {
              rows.push({
                organization: org.name,
                department: dept.name,
                subDepartment: sub.name,
                employee: emp.name,
                title: emp.title,
                date: schedule.date,
                shift: schedule.shiftName,
              });
            });
          });
        });
      });
    });

    const sanitizeSegment = (value) => {
      const cleaned = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '');
      return cleaned || 'all';
    };

    const filenameParts = [
      'schedule-overview',
      (month || '').replace(/\D/g, '') || 'all',
    ];
    if (organizationId) filenameParts.push(sanitizeSegment(organizationId));
    if (departmentId) filenameParts.push(sanitizeSegment(departmentId));
    if (subDepartmentId) filenameParts.push(sanitizeSegment(subDepartmentId));

    if (format === 'excel') {
      let ExcelJS;
      try {
        ExcelJS = (await import('exceljs')).default;
      } catch (err) {
        return res.status(500).json({ error: 'exceljs module not installed' });
      }
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Overview');
      ws.columns = [
        { header: '組織', key: 'organization' },
        { header: '部門', key: 'department' },
        { header: '單位', key: 'subDepartment' },
        { header: '員工', key: 'employee' },
        { header: '職稱', key: 'title' },
        { header: '日期', key: 'date' },
        { header: '班別', key: 'shift' },
      ];
      rows.forEach((row) => ws.addRow(row));
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filenameParts.join('-')}.xlsx"`);
      const buffer = await workbook.xlsx.writeBuffer();
      return res.send(buffer);
    }

    let PDFDocument;
    try {
      PDFDocument = (await import('pdfkit')).default;
    } catch (err) {
      return res.status(500).json({ error: 'pdfkit module not installed' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameParts.join('-')}.pdf"`);
    const doc = new PDFDocument();
    doc.fontSize(16).text('排班概覽', { align: 'center' });
    doc.moveDown();
    rows.forEach((row) => {
      doc.fontSize(12).text(
        `${row.organization}\t${row.department}\t${row.subDepartment}\t${row.employee}\t${row.title}\t${row.date}\t${row.shift}`
      );
    });
    doc.pipe(res);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
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

const CONFIRM_RESPONSES = new Set([
  'confirm',
  'confirmed',
  'approve',
  'approved',
  'accept',
  'accepted',
  'ok',
  'okay',
  'yes',
]);

const DISPUTE_RESPONSES = new Set([
  'dispute',
  'disputed',
  'reject',
  'rejected',
  'no',
  'object',
  'objection',
  'issue',
]);

function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isTransactionNotSupportedError(err) {
  if (!err) return false;
  const { code, codeName } = err;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message.includes('transaction numbers are only allowed')) {
    return true;
  }
  if (typeof code === 'number') {
    const unsupportedCodes = new Set([20, 303, 305]);
    if (unsupportedCodes.has(code)) {
      return true;
    }
  }
  if (typeof codeName === 'string') {
    const normalized = codeName.toLowerCase();
    if (['noreplicationenabled', 'notenoughreplicasetmembers', 'notprimary'].includes(normalized)) {
      return true;
    }
  }
  return false;
}

function applyEmployeeResponse(schedule, normalized, noteValue, now = new Date()) {
  if (!schedule) throw createError('schedule not found', 404);
  if (schedule.state === 'finalized') {
    throw createError('schedule finalized');
  }
  if (schedule.state !== 'pending_confirmation') {
    throw createError('schedule not awaiting confirmation');
  }

  if (CONFIRM_RESPONSES.has(normalized)) {
    schedule.employeeResponse = 'confirmed';
    schedule.state = 'pending_confirmation';
    schedule.responseNote = '';
    schedule.responseAt = now;
    return schedule;
  }

  if (DISPUTE_RESPONSES.has(normalized)) {
    if (!noteValue) {
      throw createError('objection note required');
    }
    schedule.employeeResponse = 'disputed';
    schedule.state = 'changes_requested';
    schedule.responseNote = noteValue;
    schedule.responseAt = now;
    return schedule;
  }

  throw createError('invalid response');
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

    const normalized = normalizeResponsePayload(response);
    const noteValue = sanitizeNote(note);
    const now = new Date();

    try {
      applyEmployeeResponse(schedule, normalized, noteValue, now);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const saved = await schedule.save();
    await saved.populate('employee');
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function respondToSchedulesBulk(req, res) {
  let session = null;
  let usingTransaction = false;

  const safelyAbortAndEnd = async () => {
    if (!session) return;
    if (usingTransaction && typeof session.abortTransaction === 'function') {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // ignore abort errors to avoid masking original error
      }
    }
    if (typeof session.endSession === 'function') {
      try {
        await session.endSession();
      } catch (endErr) {
        // swallow end session errors as fallback will continue without a session
      }
    }
    session = null;
    usingTransaction = false;
  };

  const loadAndSaveSchedules = async (ids, userId, normalized, noteValue, options = {}) => {
    const { session: activeSession = null, transactional = false } = options;
    const now = new Date();
    const updatedDocs = [];

    for (const scheduleId of ids) {
      let query = ShiftSchedule.findById(scheduleId);
      if (!query) {
        throw createError('schedule not found', 404);
      }
      if (activeSession && typeof query.session === 'function') {
        query = query.session(activeSession);
      }

      let schedule;
      if (query && typeof query.populate === 'function') {
        const populated = query.populate('employee');
        if (populated && typeof populated.then === 'function') {
          schedule = await populated;
        } else if (typeof populated.exec === 'function') {
          schedule = await populated.exec();
        } else {
          schedule = await query;
        }
      } else if (query && typeof query.then === 'function') {
        schedule = await query;
      } else {
        schedule = query;
      }

      if (!schedule) {
        throw createError('schedule not found', 404);
      }

      if (transactional && activeSession && typeof schedule.$session === 'function') {
        schedule.$session(activeSession);
      }

      const employeeId = schedule.employee?._id?.toString?.() || schedule.employee?.toString?.();
      if (!employeeId || employeeId !== String(userId)) {
        throw createError('forbidden', 403);
      }

      applyEmployeeResponse(schedule, normalized, noteValue, now);

      const saveOptions = transactional && activeSession ? { session: activeSession } : undefined;
      const saved = await schedule.save(saveOptions);
      if (typeof saved.populate === 'function') {
        await saved.populate('employee');
      }
      updatedDocs.push(saved);
    }

    return updatedDocs;
  };

  try {
    const { scheduleIds, response, note } = req.body || {};
    if (!Array.isArray(scheduleIds) || !scheduleIds.length) {
      return res.status(400).json({ error: 'scheduleIds required' });
    }
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const normalized = normalizeResponsePayload(response);
    const noteValue = sanitizeNote(note);

    if (typeof ShiftSchedule.startSession === 'function') {
      session = await ShiftSchedule.startSession();
    }
    if (session) {
      const supportsTransactions =
        typeof session.startTransaction === 'function' &&
        typeof session.commitTransaction === 'function' &&
        typeof session.abortTransaction === 'function';

      if (supportsTransactions) {
        try {
          await session.startTransaction();
          usingTransaction = true;
        } catch (startErr) {
          if (isTransactionNotSupportedError(startErr)) {
            await safelyAbortAndEnd();
          } else {
            throw startErr;
          }
        }
      } else {
        await safelyAbortAndEnd();
      }
    }

    const uniqueIds = Array.from(
      new Set(
        scheduleIds
          .map((value) => normalizeId(value))
          .filter((value) => !!value),
      ),
    );

    if (!uniqueIds.length) {
      throw createError('scheduleIds required');
    }

    let updated = [];
    const executeOnce = async (activeSession, transactional) =>
      loadAndSaveSchedules(uniqueIds, userId, normalized, noteValue, {
        session: activeSession,
        transactional,
      });

    try {
      updated = await executeOnce(session, usingTransaction);
    } catch (processErr) {
      if (usingTransaction && isTransactionNotSupportedError(processErr)) {
        await safelyAbortAndEnd();
        updated = await executeOnce(null, false);
      } else {
        throw processErr;
      }
    }

    if (usingTransaction && session && typeof session.commitTransaction === 'function') {
      try {
        await session.commitTransaction();
      } catch (commitErr) {
        if (isTransactionNotSupportedError(commitErr)) {
          await safelyAbortAndEnd();
          updated = await executeOnce(null, false);
        } else {
          throw commitErr;
        }
      }
    }

    const payload = updated.map((item) => (
      typeof item.toObject === 'function' ? item.toObject() : item
    ));
    return res.json({ success: true, count: payload.length, schedules: payload });
  } catch (err) {
    if (usingTransaction && session && typeof session.abortTransaction === 'function') {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // ignore abort errors to avoid masking original error
      }
    }
    return res.status(err.status || 400).json({ error: err.message });
  } finally {
    if (session && typeof session.endSession === 'function') await session.endSession();
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
