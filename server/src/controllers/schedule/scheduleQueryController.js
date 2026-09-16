import ShiftSchedule from '../../models/ShiftSchedule.js';
import Employee from '../../models/Employee.js';
import ApprovalRequest from '../../models/approval_request.js';
import AttendanceSetting from '../../models/AttendanceSetting.js';
import { Types } from 'mongoose';
import dayjs from 'dayjs';
import { getLeaveFieldIds } from '../../services/leaveFieldService.js';
import { leaveDaysFromCalendar, loadApprovedLeaveCalendar } from '../../services/approvedLeaveCalendarService.js';
import { buildLiteralSearchRegex } from '../../utils/safeSearch.js';
import {
  toEntityId,
  getAllowedScheduleEmployeeIds,
  attachShiftInfo,
  buildScheduleOverview,
} from './scheduleShared.js';

export async function listMonthlySchedules(req, res) {
  try {
    const {
      month,
      employee,
      employeeIds: employeeIdsRaw,
      supervisor,
      includeSelf: includeSelfRaw,
      page: pageRaw,
      pageSize: pageSizeRaw,
      limit: limitRaw,
      department: departmentRaw,
      subDepartment: subDepartmentRaw,
      status: statusRaw,
      search: searchRaw,
      jobType: jobTypeRaw,
    } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const scheduleQuery = { date: { $gte: start, $lt: end } };
    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';
    const requestedPageOrLimit = pageRaw !== undefined || limitRaw !== undefined;

    const pageParsed = Number.parseInt(pageRaw, 10);
    const limitParsed = Number.parseInt(pageSizeRaw ?? limitRaw, 10);
    const page = Number.isFinite(pageParsed) && pageParsed > 0 ? pageParsed : 1;
    const pageSize = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, 200) : 50;
    const department = departmentRaw ? String(departmentRaw) : '';
    const subDepartment = subDepartmentRaw ? String(subDepartmentRaw) : '';
    const status = String(statusRaw || 'all').trim();
    const search = String(searchRaw || '').trim();
    const jobType = String(jobTypeRaw || '').trim();

    const parsedEmployeeIds = String(employeeIdsRaw || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id && Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id).toString());

    if (employeeIdsRaw !== undefined && parsedEmployeeIds.length === 0 && requestedPageOrLimit) {
      return res.json({
        schedules: [],
        employees: [],
        publishSummary: {
          status: 'draft',
          pendingEmployees: [],
          disputedEmployees: [],
          publishedAt: null,
          hasSchedules: false,
          totalEmployees: 0,
          allEmployeesConfirmed: false,
          currentRoundPendingEmployees: [],
          unaffectedConfirmedEmployees: [],
        },
        pagination: {
          total: 0,
          page,
          pageSize,
          limit: pageSize,
          totalPages: 1,
        },
      });
    }

    const actorId = toEntityId(req.user?.id);
    const actorRole = req.user?.role;
    if (!actorId) return res.status(401).json({ error: 'Invalid user' });

    let scopedIds = null;
    if (actorRole === 'employee') {
      if ((employee && toEntityId(employee) !== actorId) || (supervisor && toEntityId(supervisor) !== actorId)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (parsedEmployeeIds.some((id) => id !== actorId)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      scopedIds = [actorId];
    } else if (actorRole === 'supervisor') {
      if (supervisor && toEntityId(supervisor) !== actorId) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const allowedIds = await getAllowedScheduleEmployeeIds(req);
      if (employee && !allowedIds.includes(toEntityId(employee))) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (parsedEmployeeIds.some((id) => !allowedIds.includes(id))) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (employee) {
        scopedIds = [toEntityId(employee)];
      } else if (parsedEmployeeIds.length > 0) {
        scopedIds = parsedEmployeeIds;
      } else {
        scopedIds = includeSelf ? allowedIds : allowedIds.filter((id) => id !== actorId);
      }
    } else if (supervisor) {
      const emps = await Employee.find({ supervisor }).select('_id');
      const idSet = new Set(emps.map((e) => e._id.toString()));
      if (includeSelf && supervisor) {
        idSet.add(String(supervisor));
      }
      scopedIds = Array.from(idSet);
      if (parsedEmployeeIds.length > 0) {
        const requestedSet = new Set(parsedEmployeeIds);
        scopedIds = scopedIds.filter((id) => requestedSet.has(id));
      }
    } else {
      const empId = employee;
      if (empId && parsedEmployeeIds.length > 0) {
        if (parsedEmployeeIds.includes(String(empId))) {
          scopedIds = [String(empId)];
        } else {
          scopedIds = [];
        }
      } else if (empId) {
        scopedIds = [String(empId)];
      } else if (parsedEmployeeIds.length > 0) {
        scopedIds = parsedEmployeeIds;
      }
    }

    const employeeQuery = {};
    if (Array.isArray(scopedIds)) {
      employeeQuery._id = { $in: scopedIds };
    }
    if (department) employeeQuery.department = department;
    if (subDepartment) employeeQuery.subDepartment = subDepartment;
    const andFilters = [];
    if (search) {
      const rx = buildLiteralSearchRegex(search);
      andFilters.push({ $or: [{ name: rx }, { employeeId: rx }] });
    }
    if (jobType) {
      const rx = buildLiteralSearchRegex(jobType);
      andFilters.push({ $or: [{ practiceTitle: rx }, { title: rx }, { jobType: rx }] });
    }
    if (andFilters.length === 1) {
      Object.assign(employeeQuery, andFilters[0]);
    } else if (andFilters.length > 1) {
      employeeQuery.$and = andFilters;
    }

    const matchedEmployeeQuery = Employee.find(employeeQuery)
      .select('_id name department subDepartment photo practiceTitle title jobType');
    const matchedEmployees = typeof matchedEmployeeQuery.lean === 'function'
      ? await matchedEmployeeQuery.lean()
      : await matchedEmployeeQuery;

    let filteredEmployees = matchedEmployees;
    if (status !== 'all') {
      const employeeIdList = matchedEmployees.map((item) => item._id.toString());
      const statusMap = new Map();
      employeeIdList.forEach((id) => {
        statusMap.set(id, { shiftDays: new Set(), leaveDays: new Set() });
      });

      if (employeeIdList.length) {
        const monthSchedules = await ShiftSchedule.find({
          employee: { $in: employeeIdList },
          date: { $gte: start, $lt: end },
        })
          .select('employee date shiftId')
          .lean();

        monthSchedules.forEach((doc) => {
          const empId = doc.employee?.toString?.() || '';
          const entry = statusMap.get(empId);
          if (!entry) return;
          const dayKey = doc.date instanceof Date
            ? doc.date.toISOString().slice(0, 10)
            : new Date(doc.date).toISOString().slice(0, 10);
          if (doc.shiftId && dayKey) {
            entry.shiftDays.add(dayKey);
          }
        });

        const { formId, startId, endId } = await getLeaveFieldIds();
        if (formId && startId && endId) {
          const monthStart = `${month}-01`;
          const monthEnd = end.toISOString().slice(0, 10);
          const leaveQuery = {
            form: formId,
            status: 'approved',
            applicant_employee: { $in: employeeIdList },
          };
          leaveQuery[`form_data.${startId}`] = { $lt: monthEnd };
          leaveQuery[`form_data.${endId}`] = { $gte: monthStart };
          const leaveApprovals = await ApprovalRequest.find(leaveQuery)
            .select(`applicant_employee form_data.${startId} form_data.${endId}`)
            .lean();
          leaveApprovals.forEach((approval) => {
            const empId = approval.applicant_employee?.toString?.() || '';
            const entry = statusMap.get(empId);
            if (!entry) return;
            const approvalStart = dayjs(approval.form_data?.[startId]);
            const approvalEnd = dayjs(approval.form_data?.[endId]);
            const monthStart = dayjs(start);
            const monthEnd = dayjs(end).subtract(1, 'day');
            const leaveStart = approvalStart.isAfter(monthStart) ? approvalStart : monthStart;
            const leaveEnd = approvalEnd.isBefore(monthEnd) ? approvalEnd : monthEnd;
            if (!leaveStart.isValid() || !leaveEnd.isValid() || leaveEnd.isBefore(leaveStart)) return;
            let pointer = leaveStart.startOf('day');
            while (!pointer.isAfter(leaveEnd, 'day')) {
              entry.leaveDays.add(pointer.format('YYYY-MM-DD'));
              pointer = pointer.add(1, 'day');
            }
          });
        }
      }

      const daysInMonth = dayjs(`${month}-01`).daysInMonth();
      filteredEmployees = matchedEmployees.filter((emp) => {
        const key = emp._id.toString();
        const entry = statusMap.get(key) || { shiftDays: new Set(), leaveDays: new Set() };
        const hasLeave = entry.leaveDays.size > 0;
        const filledDays = new Set([...entry.shiftDays, ...entry.leaveDays]).size;
        const resolvedStatus = hasLeave ? 'onLeave' : (filledDays < daysInMonth ? 'unscheduled' : 'scheduled');
        return resolvedStatus === status;
      });
    }

    filteredEmployees.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));
    const total = filteredEmployees.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageEmployees = filteredEmployees.slice((safePage - 1) * pageSize, safePage * pageSize);
    const pageEmployeeIds = pageEmployees.map((emp) => emp._id.toString());

    if (pageEmployeeIds.length) {
      scheduleQuery.employee = { $in: pageEmployeeIds };
    } else {
      scheduleQuery.employee = { $in: [] };
    }
    if (department) scheduleQuery.department = department;
    if (subDepartment) scheduleQuery.subDepartment = subDepartment;

    const raw = await ShiftSchedule.find(scheduleQuery)
      .select('employee date shiftId department subDepartment state employeeResponse needsReconfirm responseNote responseAt publishedAt')
      .populate({ path: 'employee', select: 'name department subDepartment photo' })
      .lean();
    const schedules = await attachShiftInfo(raw);
    const employeeStatusMap = new Map();
    let hasFinalized = false;
    let hasDisputed = false;
    let hasPublished = false;
    let latestPublishedAt = null;
    raw.forEach((doc) => {
      const emp = doc.employee || {};
      const id = emp?._id?.toString?.() || doc.employee?.toString?.();
      if (!id) return;
      const prev = employeeStatusMap.get(id) || {
        id,
        name: emp.name || '',
        pendingCount: 0,
        disputedCount: 0,
        latestNote: '',
        latestResponseAt: null,
        disputes: [],
        hasCurrentRoundPending: false,
        hasUnaffectedConfirmed: false,
      };
      if (doc.state === 'finalized') hasFinalized = true;
      if (doc.state === 'pending_confirmation' || doc.state === 'changes_requested' || doc.state === 'finalized') {
        hasPublished = true;
      }
      if (doc.publishedAt) {
        const published = new Date(doc.publishedAt);
        if (!Number.isNaN(published.getTime()) && (!latestPublishedAt || latestPublishedAt < published)) {
          latestPublishedAt = published;
        }
      }

      if (doc.needsReconfirm === true && doc.state !== 'finalized') {
        prev.hasCurrentRoundPending = true;
      } else if (doc.employeeResponse === 'confirmed' || doc.state === 'finalized') {
        prev.hasUnaffectedConfirmed = true;
      }

      if (doc.employeeResponse === 'disputed' || doc.state === 'changes_requested') {
        hasDisputed = true;
        prev.disputedCount += 1;
        if (doc.responseNote) {
          prev.latestNote = doc.responseNote;
        }
        prev.disputes.push({
          date: doc.date instanceof Date ? doc.date.toISOString() : new Date(doc.date).toISOString(),
          note: doc.responseNote || '',
          responseAt: doc.responseAt ? new Date(doc.responseAt).toISOString() : null,
        });
      } else if (
        doc.state === 'pending_confirmation' &&
        doc.needsReconfirm !== false &&
        doc.employeeResponse !== 'confirmed'
      ) {
        prev.pendingCount += 1;
      }

      if (doc.responseAt) {
        const responded = new Date(doc.responseAt);
        if (!Number.isNaN(responded.getTime()) && (!prev.latestResponseAt || prev.latestResponseAt < responded)) {
          prev.latestResponseAt = responded;
        }
      }
      employeeStatusMap.set(id, prev);
    });
    const publishSummary = {
      status: 'draft',
      pendingEmployees: [],
      disputedEmployees: [],
      publishedAt: latestPublishedAt ? latestPublishedAt.toISOString() : null,
      hasSchedules: raw.length > 0,
      totalEmployees: employeeStatusMap.size,
      allEmployeesConfirmed: false,
      currentRoundPendingEmployees: [],
      unaffectedConfirmedEmployees: [],
    };
    employeeStatusMap.forEach((entry) => {
      if (entry.pendingCount > 0) {
        publishSummary.pendingEmployees.push({
          id: entry.id,
          name: entry.name,
          pendingCount: entry.pendingCount,
        });
      }
      if (entry.disputedCount > 0) {
        publishSummary.disputedEmployees.push({
          id: entry.id,
          name: entry.name,
          disputedCount: entry.disputedCount,
          latestNote: entry.latestNote,
          latestResponseAt: entry.latestResponseAt ? entry.latestResponseAt.toISOString() : null,
          disputes: entry.disputes,
        });
      }
      if (entry.hasCurrentRoundPending) {
        publishSummary.currentRoundPendingEmployees.push({ id: entry.id, name: entry.name });
      }
      if (entry.hasUnaffectedConfirmed && !entry.hasCurrentRoundPending) {
        publishSummary.unaffectedConfirmedEmployees.push({ id: entry.id, name: entry.name });
      }
    });
    if (hasFinalized) {
      publishSummary.status = 'finalized';
    } else if (hasDisputed) {
      publishSummary.status = 'disputed';
    } else if (hasPublished) {
      publishSummary.status = publishSummary.pendingEmployees.length ? 'pending' : 'ready';
    } else {
      publishSummary.status = 'draft';
    }
    publishSummary.allEmployeesConfirmed =
      publishSummary.status === 'ready' &&
      publishSummary.pendingEmployees.length === 0 &&
      publishSummary.disputedEmployees.length === 0;

    res.json({
      schedules,
      employees: pageEmployees.map((emp) => ({
        _id: emp._id?.toString?.() || String(emp._id),
        name: emp.name || '',
        photo: emp.photo || '',
        department: emp.department || '',
        subDepartment: emp.subDepartment || '',
      })),
      publishSummary,
      pagination: {
        total,
        page: safePage,
        pageSize,
        limit: pageSize,
        totalPages,
      },
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
    const actorId = toEntityId(req.user?.id);
    if (!actorId) return res.status(401).json({ error: 'Invalid user' });
    const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';
    const department = departmentRaw ? String(departmentRaw) : '';
    const subDepartment = subDepartmentRaw ? String(subDepartmentRaw) : '';
    let scopedEmployeeIds = null;
    const allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
    if (allowedEmployeeIds !== null) {
      if (supervisor && toEntityId(supervisor) !== actorId) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (employee && !allowedEmployeeIds.includes(toEntityId(employee))) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (employee) {
        scopedEmployeeIds = [toEntityId(employee)];
      } else if (supervisor) {
        scopedEmployeeIds = includeSelf
          ? allowedEmployeeIds
          : allowedEmployeeIds.filter((id) => id !== actorId);
      } else {
        scopedEmployeeIds = allowedEmployeeIds;
      }
    } else if (supervisor) {
      const emps = await Employee.find({ supervisor }).select('_id');
      const idSet = new Set(emps.map((e) => e._id.toString()));
      if (includeSelf && supervisor) {
        idSet.add(String(supervisor));
      }
      scopedEmployeeIds = Array.from(idSet);
    } else if (employee) {
      scopedEmployeeIds = [employee];
    }

    const { formId, startId, endId, typeId } = await getLeaveFieldIds();
    if (!formId || !startId || !endId) {
      return res.json({ leaves: [], approvals: [] });
    }
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const monthStart = `${month}-01`;
    const monthEnd = end.toISOString().slice(0, 10);

    let departmentEmployeeIds = null;
    if (department || subDepartment) {
      const employeeQuery = {};
      if (department) employeeQuery.department = department;
      if (subDepartment) employeeQuery.subDepartment = subDepartment;
      if (Array.isArray(scopedEmployeeIds)) {
        employeeQuery._id = { $in: scopedEmployeeIds };
      }
      const matchedEmployees = await Employee.find(employeeQuery).select('_id').lean();
      departmentEmployeeIds = matchedEmployees.map((emp) => emp._id.toString());
    }

    const approvalQuery = {
      form: formId,
      status: 'approved',
    };
    approvalQuery[`form_data.${startId}`] = { $lt: monthEnd };
    approvalQuery[`form_data.${endId}`] = { $gte: monthStart };

    if (Array.isArray(scopedEmployeeIds)) {
      if (!scopedEmployeeIds.length) {
        return res.json({ leaves: [], approvals: [] });
      }
      approvalQuery.applicant_employee = { $in: scopedEmployeeIds };
    }

    if (subDepartment) {
      approvalQuery.applicant_employee = { $in: departmentEmployeeIds || [] };
    } else if (department) {
      approvalQuery.$or = [{ applicant_department: department }];
      if (departmentEmployeeIds?.length) {
        approvalQuery.$or.push({ applicant_employee: { $in: departmentEmployeeIds } });
      }
    }

    const approvals = await ApprovalRequest.find(approvalQuery)
      .select(`applicant_employee applicant_department status form_data.${typeId} form_data.${startId} form_data.${endId}`)
      .populate({ path: 'applicant_employee', select: 'name department subDepartment' })
      .lean();

    const leaves = approvals.map((a) => ({
        employee: a.applicant_employee,
        leaveType: a.form_data?.[typeId],
        startDate: a.form_data?.[startId],
        endDate: a.form_data?.[endId],
        status: a.status,
      }));

    const approvalsLite = approvals.map((a) => ({
      _id: a._id,
      employee: a.applicant_employee,
      leaveType: a.form_data?.[typeId],
      startDate: a.form_data?.[startId],
      endDate: a.form_data?.[endId],
      status: a.status,
    }));

    res.json({ leaves, approvals: approvalsLite });
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

    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

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

    // 2️⃣ includeSelf=true 時，將主管本人加入統計範圍
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
    const leaveCalendar = await loadApprovedLeaveCalendar({
      employeeIds: uniqueIds,
      start,
      end,
    });
    const leaveDaysMap = new Map(uniqueIds.map((employeeId) => [
      toEntityId(employeeId),
      leaveDaysFromCalendar(leaveCalendar, employeeId),
    ]));

    if (uniqueIds.length) {
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

    // 6️⃣ 最後這一步：根據 includeSelf 決定是否包含主管本人
    const supervisorIdStr = supervisor ? String(supervisor) : '';
    const payload = Object.values(summaryMap).filter((entry) => {
      if (!supervisorIdStr) return true;
      // 當 includeSelf=true 時，保留主管；否則過濾掉
      if (includeSelf) return true;
      return String(entry.employee) !== supervisorIdStr;
    });
    const daysInMonth = new Date(end.getTime() - 86400000).getUTCDate();
    const stats = payload.reduce(
      (acc, item) => {
        const shiftCount = Number(item.shiftCount || 0);
        const leaveCount = Number(item.leaveCount || 0);
        const filledDays = shiftCount + leaveCount;
        if (filledDays < daysInMonth) acc.unscheduled += 1;
        if (leaveCount > 0) acc.onLeave += 1;
        return acc;
      },
      {
        direct: payload.length,
        unscheduled: 0,
        onLeave: 0,
        daysInMonth,
      }
    );

    res.json({
      employees: payload,
      stats,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
