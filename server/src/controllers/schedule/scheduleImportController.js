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
import { isNonWorkShift } from '../../services/shiftSemanticService.js';
import {
  toEntityId,
  getAllowedScheduleEmployeeIds,
  buildMonthDays,
  buildMonthRange,
  IMPORT_HOLIDAY_CODES,
  IMPORT_LEAVE_CODES,
  isCountedHolidayRecord,
  normalizeWorkbookCode,
  resolveImportShiftKind,
  scheduleImportError,
} from './scheduleShared.js';

// Excel 會把「11-20」這類班別代碼轉成日期，帶有 fromDateCell 的儲存格同時嘗試「MM-DD」與「M-D」兩種寫法。
// 簡體的「国」「国定假日」NFKC 不會轉成繁體；班別表定義的是「國」時，簡體檔案仍要對得上
function foldSimplifiedHoliday(text) {
  return String(text ?? '').replace(/国/g, '國');
}

function findImportShift(shiftByCode, entry) {
  const texts = [entry.code, ...(entry.alternatives || [])];
  for (const text of texts) {
    const shift = shiftByCode.get(normalizeWorkbookCode(text));
    if (shift?._id) return shift;
  }
  for (const text of texts) {
    const folded = foldSimplifiedHoliday(text);
    if (folded === text) continue;
    const shift = shiftByCode.get(normalizeWorkbookCode(folded));
    if (shift?._id) return shift;
  }
  return null;
}

function unknownShiftMessage(entry) {
  if (entry.fromDateCell) {
    return `找不到對應的班別代碼或名稱。此儲存格是 Excel 日期格式，已還原為「${entry.code}」；請將班別欄位的儲存格格式設為「文字」後重新輸入班別代碼再匯入`;
  }
  return '找不到對應的班別代碼或名稱';
}

/**
 * 對即將匯入的班表跑排班規範檢核（不寫入）；規範問題不阻擋匯入，只回報供管理員修正。
 * 檢核本身出錯時回傳 unavailable，由呼叫端決定要顯示的提醒。
 */
async function checkImportRules({ candidates, range, columnCount }) {
  try {
    await assertScheduleRuleCompliance({
      candidateSchedules: candidates,
      ignoredScheduleIds: candidates.map((item) => item.existing?._id).filter(Boolean),
      range,
      strictWeeklyRest: columnCount === buildMonthDays(range.start).length,
    });
    return { violations: [], unavailable: false };
  } catch (validationError) {
    if (isLaborRuleValidationError(validationError)) {
      return { violations: validationError.violations || [], unavailable: false };
    }
    console.error('Schedule import rule validation failed', {
      error: validationError?.name || 'Error',
    });
    return { violations: [], unavailable: true };
  }
}

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
    // 國定假日與請假代碼現在也先到班別設定裡找，所以它們同樣要檢查代碼／名稱是否重複
    const importedShiftIdentifiers = new Set(parsed.rows.flatMap((row) => row.entries)
      .flatMap((entry) => [entry.code, ...(entry.alternatives || [])])
      .map((code) => normalizeWorkbookCode(code))
      .filter(Boolean));
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
    // 只有算入的國定假日才拿來核對（工作日、補班日不算）
    const holidayDays = new Set((holidays || [])
      .filter(isCountedHolidayRecord)
      .map((holiday) => new Date(holiday.date).toISOString().slice(0, 10)));
    const existingByKey = new Map((existingSchedules || []).map((schedule) => [
      `${toEntityId(schedule.employee)}:${new Date(schedule.date).toISOString().slice(0, 10)}`,
      schedule,
    ]));

    const errors = [];
    const overwriteConflicts = [];
    const warnings = [];
    const candidates = [];
    // 國定假日／請假標示的天數（不論有沒有存成班表）；skippedDays 為其中班別設定沒定義、因此略過的天數
    let informationalDays = 0;
    let skippedDays = 0;
    for (const row of parsed.rows) {
      const employee = employeeByCode.get(normalizeEmployeeIdentifier(row.employeeId));
      if (!employee) {
        errors.push(scheduleImportError(row.rowNumber, null, row.employeeId, '員工代號不在目前部門或操作權限範圍內'));
        continue;
      }
      const employeeId = toEntityId(employee._id);
      for (const entry of row.entries) {
        const dateKey = `${month}-${String(entry.day).padStart(2, '0')}`;
        const code = normalizeWorkbookCode(entry.code);
        const onApprovedLeave = Boolean(leaveCalendar.get(employeeId)?.has(dateKey));
        const shift = findImportShift(shiftByCode, entry);
        if (!shift) {
          // 國定假日／請假代碼：班別設定裡沒定義才退回「僅供核對」的舊行為，並提醒管理員去定義
          if (IMPORT_HOLIDAY_CODES.has(code)) {
            informationalDays += 1;
            skippedDays += 1;
            warnings.push(scheduleImportError(row.rowNumber, entry.day, entry.code, `班別設定中沒有「${entry.code}」這個班別，此日不會建立班表；請先到「班別設定」新增國定假日班別後再匯入`));
            continue;
          }
          if (IMPORT_LEAVE_CODES.has(code)) {
            informationalDays += 1;
            skippedDays += 1;
            warnings.push(scheduleImportError(row.rowNumber, entry.day, entry.code, `班別設定中沒有「${entry.code}」這個班別，此日不會建立班表，也不會建立假單；請先到「班別設定」新增對應的請假班別後再匯入`));
            continue;
          }
          errors.push(scheduleImportError(row.rowNumber, entry.day, entry.code, unknownShiftMessage(entry)));
          continue;
        }
        // 已核准請假日：不用上班的班別（休息日、例假、國定假日、請假）不算衝突，上班班別才擋
        if (onApprovedLeave && !isNonWorkShift(shift)) {
          errors.push(scheduleImportError(row.rowNumber, entry.day, entry.code, '該日期已有核准請假，無法匯入班別'));
          continue;
        }
        const existing = existingByKey.get(`${employeeId}:${dateKey}`);
        if (existing && !overwrite) {
          const conflict = scheduleImportError(row.rowNumber, entry.day, entry.code, '該日期已有班表；確認後可覆蓋');
          if (mode === 'preview') {
            overwriteConflicts.push(conflict);
          } else {
            errors.push(conflict);
          }
          continue;
        }
        const kind = resolveImportShiftKind(shift);
        if (kind === 'holiday') {
          informationalDays += 1;
          if (!holidayDays.has(dateKey)) {
            warnings.push(scheduleImportError(row.rowNumber, entry.day, entry.code, `「${entry.code}」為國定假日班別，但系統假日日曆沒有該日期的國定假日，請確認假日設定`));
          }
        } else if (kind === 'leave') {
          informationalDays += 1;
          if (!onApprovedLeave) {
            warnings.push(scheduleImportError(row.rowNumber, entry.day, entry.code, `「${entry.code}」為請假班別，已存入班表；系統沒有該日對應的已核准假單，班表匯入不會建立假單`));
          }
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

    // 預覽也跑排班規範檢核（不寫入），讓管理員在確認匯入前就看到問題
    const violations = [];
    if (mode === 'preview' && !errors.length && candidates.length) {
      const check = await checkImportRules({ candidates, range, columnCount: parsed.columns.length });
      violations.push(...check.violations);
      if (check.unavailable) {
        warnings.push(scheduleImportError(null, null, '', '排班規範檢核暫時無法完成，匯入後請按「排班檢核」重試'));
      }
    }

    const summary = {
      mode,
      worksheet: parsed.worksheetName,
      employees: parsed.rows.length,
      scheduleDays: candidates.length,
      informationalDays,
      skippedDays,
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

    const check = await checkImportRules({ candidates, range, columnCount: parsed.columns.length });
    violations.push(...check.violations);
    if (check.unavailable) {
      warnings.push(scheduleImportError(
        null,
        null,
        '',
        '匯入已完成，但排班規範檢核暫時無法完成，請按「排班檢核」重試',
      ));
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
