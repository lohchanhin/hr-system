import ShiftSchedule from '../../models/ShiftSchedule.js';
import Employee from '../../models/Employee.js';
import AttendanceSetting from '../../models/AttendanceSetting.js';
import { randomUUID } from 'node:crypto';
import { loadApprovedLeaveIntervals } from '../../services/approvedLeaveCalendarService.js';
import {
  assertScheduleRuleCompliance,
  isLaborRuleValidationError,
} from '../../services/laborRuleValidationService.js';
import {
  parseScheduleWorkbook,
  ScheduleWorkbookValidationError,
} from '../../services/scheduleWorkbookService.js';
import { isScheduleRuleExempt } from '../../services/scheduleRuleExemptionService.js';
import { normalizeEmployeeIdentifier } from '../../services/employeeIdentityService.js';
import { buildShiftIdentityLookup } from '../../services/shiftIdentityService.js';
import { ROSTER_LEAVE_BLOCK } from '../../services/leaveCoverageService.js';
import { calendarStatusFromContext, loadHolidayContext } from '../../services/holidayResolver.js';
import { buildImportHolidayWarnings } from '../../services/holidayRestLedgerService.js';
import {
  toEntityId,
  getAllowedScheduleEmployeeIds,
  buildRosterLeaveChecks,
  buildMonthDays,
  buildMonthRange,
  describePendingWeeks,
  IMPORT_HOLIDAY_CODES,
  IMPORT_LEAVE_CODES,
  normalizeWorkbookCode,
  resolveImportShiftKind,
  scheduleImportError,
} from './scheduleShared.js';

// Excel 會把「11-20」這類班別代碼轉成日期，帶有 fromDateCell 的儲存格同時嘗試「MM-DD」與「M-D」兩種寫法。
// 簡體的「国」「国定假日」NFKC 不會轉成繁體；班別表定義的是「國」時，簡體檔案仍要對得上
function foldSimplifiedHoliday(text) {
  return String(text ?? '').replace(/国/g, '國');
}

// 匯入預覽的年度行事曆提醒（依該年度的狀態）：
//   已核定 -> 不提醒；草稿（含舊版轉換）-> 尚未核定、僅供參考；
//   尚未建立、以固定日期的國定假日暫代 -> 說明農曆節日沒有核對；
//   尚未建立、也沒有暫代（從來沒有建立過公司行事曆）-> 沒有可核定的東西，不提醒（排班頁標頭會顯示「尚未建立」）
function buildImportCalendarWarning(yearStatus) {
  if (!yearStatus || yearStatus.state === 'approved') return '';
  if (yearStatus.state === 'none') {
    return yearStatus.synthetic
      ? `本月所屬年度（${yearStatus.year}）尚未建立公司行事曆，國定假日只核對固定日期的節日（農曆節日未列入）`
      : '';
  }
  return `本月所屬年度（${yearStatus.year}）的公司行事曆尚未核定，國定假日核對僅供參考`;
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
 * pendingWeeks 是跨月週（鄰月還沒排）目前無法判斷的週別，不算違規，只用來提醒。
 */
async function checkImportRules({ candidates, range, columnCount }) {
  try {
    const result = await assertScheduleRuleCompliance({
      candidateSchedules: candidates,
      ignoredScheduleIds: candidates.map((item) => item.existing?._id).filter(Boolean),
      range,
      strictWeeklyRest: columnCount === buildMonthDays(range.start).length,
    });
    return { violations: [], pendingWeeks: await describePendingWeeks(result?.pendingWeeks), unavailable: false };
  } catch (validationError) {
    if (isLaborRuleValidationError(validationError)) {
      return {
        violations: validationError.violations || [],
        pendingWeeks: await describePendingWeeks(validationError.pendingWeeks),
        unavailable: false,
      };
    }
    console.error('Schedule import rule validation failed', {
      error: validationError?.name || 'Error',
    });
    return { violations: [], pendingWeeks: [], unavailable: true };
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
    let employeeFind = Employee.find(employeeQuery).select('_id employeeId name department subDepartment partTime appointment status holidayRegime requiresScheduling isIndigenous');
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
    const importedIdSet = new Set(importedEmployeeIds.map((employeeId) => toEntityId(employeeId)));
    const importedEmployeeDocs = (employees || []).filter((employee) => importedIdSet.has(toEntityId(employee._id)));
    // 核准請假只讀一次（時間區間）：每一格用自己的班別判斷，只請幾小時的假不擋上班班別；國定假日核對也共用這一份。
    // 國定假日依員工判斷（holidayResolver：個人調移、已排定的補假、行政人員才有的公務機關補假），
    // 「國」可以排在當月任何一天（移休），所以不逐格比對日期，只提醒多出來的國與整月檔案裡沒休到的假日
    const [approvedLeaveIntervals, holidayContext, existingSchedules] = await Promise.all([
      loadApprovedLeaveIntervals({ employeeIds: importedEmployeeIds, start: range.start, end: range.end }),
      loadHolidayContext({ start: range.start, end: range.end, employees: importedEmployeeDocs }),
      importedEmployeeIds.length
        ? ShiftSchedule.find({
          employee: { $in: importedEmployeeIds },
          date: { $gte: range.start, $lt: range.end },
        }).lean()
        : [],
    ]);
    const holidayEmployeeStates = new Map();
    const leaveCheckOf = buildRosterLeaveChecks(approvedLeaveIntervals);
    const existingByKey = new Map((existingSchedules || []).map((schedule) => [
      `${toEntityId(schedule.employee)}:${new Date(schedule.date).toISOString().slice(0, 10)}`,
      schedule,
    ]));

    const errors = [];
    const overwriteConflicts = [];
    const warnings = [];
    const candidates = [];
    // 檔案裡不套用排班規範檢核的兼職人員（排班規範的免檢核由檢核服務統一處理，這裡只列出來讓管理員知道）
    const ruleExemptEmployees = [];
    const seenRuleExemptIds = new Set();
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
      if (isScheduleRuleExempt(employee) && !seenRuleExemptIds.has(employeeId)) {
        seenRuleExemptIds.add(employeeId);
        ruleExemptEmployees.push({ employeeId: employee.employeeId || '', name: employee.name || '' });
      }
      if (!holidayEmployeeStates.has(employeeId)) {
        holidayEmployeeStates.set(employeeId, {
          id: employeeId,
          employee,
          rowNumber: row.rowNumber,
          employeeCode: row.employeeId,
          cells: [],
          candidateKinds: new Map(),
          candidateShifts: new Map(),
        });
      }
      for (const entry of row.entries) {
        const dateKey = `${month}-${String(entry.day).padStart(2, '0')}`;
        const code = normalizeWorkbookCode(entry.code);
        const leaveCheck = leaveCheckOf(employeeId);
        // 當天有沒有任何核准請假（不論幾小時）：請假班別沒有對應假單的提醒用
        const onApprovedLeave = leaveCheck.hasLeaveOn(dateKey);
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
        // 已核准請假：不用上班的班別（休息日、例假、國定假日、請假）不算衝突；上班班別只有核准的整天請假、
        // 或有時分的請假涵蓋整個班次時才擋，只請幾小時的假不擋（與國定假日休假紀錄同一個判斷）
        const leaveBlock = leaveCheck.reason(dateKey, shift);
        if (leaveBlock) {
          const message = leaveBlock === ROSTER_LEAVE_BLOCK.COVERS_SHIFT
            ? '該日期已有核准請假涵蓋整個班別，無法匯入班別'
            : '該日期已有核准請假，無法匯入班別';
          errors.push(scheduleImportError(row.rowNumber, entry.day, entry.code, message));
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
        const holidayState = holidayEmployeeStates.get(employeeId);
        holidayState.candidateKinds.set(dateKey, kind);
        holidayState.candidateShifts.set(dateKey, shift);
        if (kind === 'holiday') {
          informationalDays += 1;
          holidayState.cells.push({ rowNumber: row.rowNumber, day: entry.day, code: entry.code, dateKey });
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

    const monthDayCount = buildMonthDays(range.start).length;
    const fullMonthFile = parsed.columns.length === monthDayCount;
    // 國定假日有沒有休到要看請假的時間：只請幾小時的假不算整天請假。
    // 只有整月檔案才核對有沒有休到；請假區間上面已經讀過，不再多查一次假單
    const leaveIntervals = fullMonthFile && importedEmployeeIds.length
      ? approvedLeaveIntervals
      : null;
    // 國定假日核對：只提醒多排的國；整月檔案另外提醒本月國定假日當天上班、卻沒有國可對應的員工（移休後仍沒休到）
    warnings.push(...buildImportHolidayWarnings({
      month,
      holidayContext,
      states: [...holidayEmployeeStates.values()],
      existingSchedules,
      setting,
      leaveIntervals,
      fullMonth: fullMonthFile,
    }));
    // 這個月所屬年度的公司行事曆還沒核定（或還沒建立、只以固定日期的國定假日暫代）：國定假日核對只能參考
    const calendarWarning = buildImportCalendarWarning(calendarStatusFromContext(holidayContext).years[0]);
    if (calendarWarning) {
      warnings.push(scheduleImportError(null, null, '', calendarWarning));
    }

    // 檔案的日期欄位不是整個月時，每週一例一休不檢核（缺的日子無從判斷），要明說，不能默默略過
    if (!errors.length && candidates.length && parsed.columns.length !== monthDayCount) {
      warnings.push(scheduleImportError(
        null,
        null,
        '',
        `此檔案只有 ${parsed.columns.length} 天的日期欄位（${month} 共 ${monthDayCount} 天），未檢核每週一例一休；請補齊整月日期欄位後再匯入，才能完整檢核`,
      ));
    }

    // 預覽也跑排班規範檢核（不寫入），讓管理員在確認匯入前就看到問題
    const violations = [];
    // 跨月週（鄰月還沒排）目前無法判斷的週別：不算違規、不擋匯入，只提醒；鄰月排定後再檢核就會判斷
    const pendingWeeks = [];
    if (mode === 'preview' && !errors.length && candidates.length) {
      const check = await checkImportRules({ candidates, range, columnCount: parsed.columns.length });
      violations.push(...check.violations);
      pendingWeeks.push(...check.pendingWeeks);
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
      ruleExemptEmployees,
      overwriteConflicts,
      overwriteCount: overwriteConflicts.length,
    };
    // pendingWeeks 只在有的時候才附上（沒有就維持原本的回應內容）
    const withPendingWeeks = (body) => (pendingWeeks.length ? { ...body, pendingWeeks } : body);
    if (mode === 'preview' || errors.length) {
      return res.status(errors.length ? 422 : 200).json(withPendingWeeks(summary));
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
    pendingWeeks.push(...check.pendingWeeks);
    if (check.unavailable) {
      warnings.push(scheduleImportError(
        null,
        null,
        '',
        '匯入已完成，但排班規範檢核暫時無法完成，請按「排班檢核」重試',
      ));
    }
    return res.status(201).json(withPendingWeeks({ ...summary, imported: candidates.length, importBatchId }));
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
