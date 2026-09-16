import ShiftSchedule from '../../models/ShiftSchedule.js';
import Employee from '../../models/Employee.js';
import AttendanceSetting from '../../models/AttendanceSetting.js';
import Holiday from '../../models/Holiday.js';
import { randomUUID } from 'node:crypto';
import { loadApprovedLeaveCalendar } from '../../services/approvedLeaveCalendarService.js';
import {
  assertScheduleRuleCompliance,
  isLaborRuleValidationError,
} from '../../services/laborRuleValidationService.js';
import {
  parseScheduleWorkbook,
  ScheduleWorkbookValidationError,
} from '../../services/scheduleWorkbookService.js';
import { normalizeEmployeeIdentifier } from '../../services/employeeIdentityService.js';
import { buildShiftIdentityLookup } from '../../services/shiftIdentityService.js';
import {
  toEntityId,
  getAllowedScheduleEmployeeIds,
  buildMonthDays,
  buildMonthRange,
  IMPORT_LEAVE_CODES,
  normalizeWorkbookCode,
  scheduleImportError,
} from './scheduleShared.js';

export async function importSchedules(req, res) {
  const importBatchId = randomUUID();
  let rollbackExistingSchedules = [];
  try {
    const month = String(req.body?.month || '').trim();
    const department = String(req.body?.department || '').trim();
    const subDepartment = String(req.body?.subDepartment || '').trim();
    const mode = req.body?.mode === 'commit' ? 'commit' : 'preview';
    const overwrite = String(req.body?.overwrite || '').toLowerCase() === 'true';
    if (!department) return res.status(400).json({ error: 'department required' });
    let range;
    try {
      range = buildMonthRange(month);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!String(req.file?.originalname || '').toLowerCase().endsWith('.xlsx')) {
      return res.status(400).json({ error: 'schedule import only supports .xlsx files' });
    }

    const parsed = await parseScheduleWorkbook(req.file.buffer, { month });
    const includeSelf = String(req.body?.includeSelf || '').toLowerCase() === 'true';
    let allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
    if (req.user?.role === 'supervisor' && Array.isArray(allowedEmployeeIds) && !includeSelf) {
      const actorId = toEntityId(req.user?.id);
      allowedEmployeeIds = allowedEmployeeIds.filter((employeeId) => employeeId !== actorId);
    }
    if (allowedEmployeeIds !== null && !allowedEmployeeIds.length) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const employeeQuery = { department };
    if (subDepartment) employeeQuery.subDepartment = subDepartment;
    if (allowedEmployeeIds !== null) employeeQuery._id = { $in: allowedEmployeeIds };
    let employeeFind = Employee.find(employeeQuery).select('_id employeeId name department subDepartment');
    const employees = employeeFind && typeof employeeFind.lean === 'function'
      ? await employeeFind.lean()
      : await employeeFind;
    const employeesByCode = new Map();
    for (const employee of employees || []) {
      const code = normalizeEmployeeIdentifier(employee.employeeId);
      if (!code) continue;
      if (!employeesByCode.has(code)) employeesByCode.set(code, []);
      employeesByCode.get(code).push(employee);
    }

    const importedEmployeeCodes = new Map();
    for (const row of parsed.rows) {
      const code = normalizeEmployeeIdentifier(row.employeeId);
      if (code && !importedEmployeeCodes.has(code)) importedEmployeeCodes.set(code, row.employeeId);
    }
    const employeeIdentityConflicts = [...importedEmployeeCodes.entries()]
      .map(([code, importedEmployeeId]) => ({
        employeeId: importedEmployeeId,
        count: employeesByCode.get(code)?.length || 0,
      }))
      .filter((conflict) => conflict.count > 1);
    if (employeeIdentityConflicts.length) {
      return res.status(409).json({
        error: '員工代號在系統內重複，請先修正員工資料',
        code: 'EMPLOYEE_ID_AMBIGUOUS',
        conflicts: employeeIdentityConflicts,
      });
    }

    const employeeByCode = new Map();
    for (const [code, matchingEmployees] of employeesByCode) {
      if (matchingEmployees.length === 1) employeeByCode.set(code, matchingEmployees[0]);
    }

    const settingQuery = AttendanceSetting.findOne();
    const setting = settingQuery && typeof settingQuery.lean === 'function'
      ? await settingQuery.lean()
      : await settingQuery;
    const { lookup: shiftByCode, conflicts: shiftIdentityConflicts } = buildShiftIdentityLookup(setting?.shifts || []);
    const importedShiftIdentifiers = new Set(parsed.rows.flatMap((row) => row.entries)
      .map((entry) => normalizeWorkbookCode(entry.code))
      .filter((code) => code && code !== '國' && code !== '国' && !IMPORT_LEAVE_CODES.has(code)));
    const relevantShiftIdentityConflicts = shiftIdentityConflicts.filter((conflict) => (
      importedShiftIdentifiers.has(normalizeWorkbookCode(conflict.identifier))
    ));
    if (relevantShiftIdentityConflicts.length) {
      return res.status(409).json({
        error: '匯入檔使用的班別代碼或名稱對應到多個班別，請先修正班別設定',
        code: 'SHIFT_IDENTIFIER_CONFLICT',
        conflicts: relevantShiftIdentityConflicts.map((conflict) => ({
          identifier: conflict.identifier,
          firstShift: {
            id: toEntityId(conflict.firstShift?._id),
            code: conflict.firstShift?.code || '',
            name: conflict.firstShift?.name || '',
          },
          secondShift: {
            id: toEntityId(conflict.secondShift?._id),
            code: conflict.secondShift?.code || '',
            name: conflict.secondShift?.name || '',
          },
        })),
      });
    }

    const importedEmployeeIds = [...new Map(parsed.rows
      .map((row) => employeeByCode.get(normalizeEmployeeIdentifier(row.employeeId))?._id)
      .filter(Boolean)
      .map((employeeId) => [toEntityId(employeeId), employeeId])).values()];
    const [leaveCalendar, holidays, existingSchedules] = await Promise.all([
      loadApprovedLeaveCalendar({ employeeIds: importedEmployeeIds, start: range.start, end: range.end }),
      Holiday.find({ date: { $gte: range.start, $lt: range.end } }).lean(),
      importedEmployeeIds.length
        ? ShiftSchedule.find({
          employee: { $in: importedEmployeeIds },
          date: { $gte: range.start, $lt: range.end },
        }).lean()
        : [],
    ]);
    const holidayDays = new Set((holidays || []).map((holiday) => new Date(holiday.date).toISOString().slice(0, 10)));
    const existingByKey = new Map((existingSchedules || []).map((schedule) => [
      `${toEntityId(schedule.employee)}:${new Date(schedule.date).toISOString().slice(0, 10)}`,
      schedule,
    ]));

    const errors = [];
    const overwriteConflicts = [];
    const warnings = [];
    const candidates = [];
    let informationalDays = 0;
    for (const row of parsed.rows) {
      const employee = employeeByCode.get(normalizeEmployeeIdentifier(row.employeeId));
      if (!employee) {
        errors.push(scheduleImportError(row.rowNumber, null, row.employeeId, '员工代号不在目前部门或操作权限范围内'));
        continue;
      }
      const employeeId = toEntityId(employee._id);
      for (const entry of row.entries) {
        const dateKey = `${month}-${String(entry.day).padStart(2, '0')}`;
        const code = normalizeWorkbookCode(entry.code);
        if (code === '國' || code === '国') {
          informationalDays += 1;
          if (!holidayDays.has(dateKey)) {
            warnings.push(scheduleImportError(row.rowNumber, entry.day, entry.code, '公版标记为国定假日，但系统假日日历没有该日期'));
          }
          continue;
        }
        if (IMPORT_LEAVE_CODES.has(code)) {
          informationalDays += 1;
          if (!leaveCalendar.get(employeeId)?.has(dateKey)) {
            warnings.push(scheduleImportError(row.rowNumber, entry.day, entry.code, '请假代码仅供核对；系统没有对应的已核准假单，因此不会由班表汇入建立假单'));
          }
          continue;
        }
        if (leaveCalendar.get(employeeId)?.has(dateKey)) {
          errors.push(scheduleImportError(row.rowNumber, entry.day, entry.code, '該日期已有核准請假，無法匯入班別'));
          continue;
        }
        const shift = shiftByCode.get(code);
        if (!shift?._id) {
          errors.push(scheduleImportError(row.rowNumber, entry.day, entry.code, '找不到对应班别代码或名称'));
          continue;
        }
        const existing = existingByKey.get(`${employeeId}:${dateKey}`);
        if (existing && !overwrite) {
          const conflict = scheduleImportError(row.rowNumber, entry.day, entry.code, '该日期已有班表；确认后可覆盖');
          if (mode === 'preview') {
            overwriteConflicts.push(conflict);
          } else {
            errors.push(conflict);
          }
          continue;
        }
        candidates.push({
          existing,
          employee: employee._id,
          date: new Date(`${dateKey}T00:00:00.000Z`),
          shiftId: shift._id,
          department: employee.department || department,
          subDepartment: employee.subDepartment || subDepartment || undefined,
        });
      }
    }

    const violations = [];

    const summary = {
      mode,
      worksheet: parsed.worksheetName,
      employees: parsed.rows.length,
      scheduleDays: candidates.length,
      informationalDays,
      errors,
      warnings,
      violations,
      overwriteConflicts,
      overwriteCount: overwriteConflicts.length,
    };
    if (mode === 'preview' || errors.length) {
      return res.status(errors.length ? 422 : 200).json(summary);
    }
    if (!candidates.length) return res.status(400).json({ ...summary, error: 'no schedules to import' });

    rollbackExistingSchedules = candidates
      .map((candidate) => candidate.existing)
      .filter(Boolean)
      .map((existing) => ({ ...existing }));

    const operations = candidates.map(({ existing, ...candidate }) => ({
      updateOne: {
        filter: { employee: candidate.employee, date: candidate.date },
        update: {
          $set: {
            ...candidate,
            state: 'draft',
            publishedAt: null,
            employeeResponse: 'pending',
            responseNote: '',
            responseAt: null,
            needsReconfirm: true,
            importBatchId,
          },
        },
        upsert: true,
      },
    }));
    await ShiftSchedule.bulkWrite(operations, { ordered: true });

    try {
      await assertScheduleRuleCompliance({
        candidateSchedules: candidates,
        ignoredScheduleIds: candidates.map((item) => item.existing?._id).filter(Boolean),
        range,
        strictWeeklyRest: parsed.columns.length === buildMonthDays(range.start).length,
      });
    } catch (validationError) {
      if (isLaborRuleValidationError(validationError)) {
        violations.push(...(validationError.violations || []));
      } else {
        console.error('Post-import schedule validation failed', {
          error: validationError?.name || 'Error',
        });
        warnings.push(scheduleImportError(
          null,
          null,
          '',
          '匯入已完成，但排班規範檢核暫時無法完成，請按「排班檢核」重試',
        ));
      }
    }
    return res.status(201).json({ ...summary, imported: candidates.length, importBatchId });
  } catch (error) {
    if (error instanceof ScheduleWorkbookValidationError) {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        errors: error.errors,
        conflicts: error.conflicts,
      });
    }
    if (isLaborRuleValidationError(error)) {
      return res.status(422).json({
        error: error.message,
        violations: error.violations || [],
      });
    }
    try {
      const existingIds = rollbackExistingSchedules.map((schedule) => schedule._id).filter(Boolean);
      await ShiftSchedule.deleteMany({
        importBatchId,
        ...(existingIds.length ? { _id: { $nin: existingIds } } : {}),
      });
      if (rollbackExistingSchedules.length) {
        await ShiftSchedule.bulkWrite(rollbackExistingSchedules.map((schedule) => ({
          updateOne: {
            filter: { _id: schedule._id },
            update: {
              $set: {
                employee: schedule.employee,
                date: schedule.date,
                shiftId: schedule.shiftId,
                department: schedule.department,
                subDepartment: schedule.subDepartment,
                state: schedule.state,
                publishedAt: schedule.publishedAt,
                employeeResponse: schedule.employeeResponse,
                responseNote: schedule.responseNote,
                responseAt: schedule.responseAt,
                needsReconfirm: schedule.needsReconfirm,
              },
              $unset: { importBatchId: '' },
            },
          },
        })), { ordered: false });
      }
    } catch {
      // Preserve the original import error; the batch id remains available in logs.
    }
    return res.status(400).json({ error: error.message });
  }
}
