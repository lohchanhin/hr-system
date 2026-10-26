import ShiftSchedule from '../../models/ShiftSchedule.js';
import {
  assertScheduleRuleCompliance,
  isLaborRuleValidationError,
} from '../../services/laborRuleValidationService.js';
import {
  validateMonthSchedules,
  getIncompleteScheduleEmployees,
  canFinalizeSchedules,
} from '../../services/scheduleValidationService.js';
import {
  toEntityId,
  attachEmployeeLabels,
  describePendingWeeks,
  buildMonthRange,
  resolveScopedEmployeeIds,
  buildPublishQuery,
  getEditableScheduleEmployeeIds,
} from './scheduleShared.js';

// 完整性檢查的範圍：管理員不限；其他人只檢查自己可以排的員工（主管：自己與直屬部屬；排班人員：被指定小單位的員工）
async function buildValidationOptions(req) {
  const { department, subDepartment } = req.query;
  const options = {};
  if (department) options.department = department;
  if (subDepartment) options.subDepartment = subDepartment;
  const employeeIds = await getEditableScheduleEmployeeIds(req);
  if (Array.isArray(employeeIds)) options.employeeIds = employeeIds;
  return options;
}

/**
 * 驗證月度排班完整性
 */
export async function validateScheduleCompleteness(req, res) {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }

    const options = await buildValidationOptions(req);

    const validation = await validateMonthSchedules(month, options);
    res.json(validation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 非阻塞檢查目前範圍內還沒鎖定的排班草稿（與發布同一個範圍）；發布、完成發布時會再檢核一次，同樣只提醒、不擋。
 * 整個範圍都已完成發布（沒有待發布的班表）時，改檢核這個月已鎖定的班表，回應另附 finalized: true：
 * 完成發布不再被排班規範擋下，鎖定的班表可能仍有違規，排班檢核要照實列出，不能回「已通過」。
 * 每項違規附上員工代號與姓名（畫面只載入一頁員工，發布前的確認視窗也要看得到是誰）。
 */
export async function validateScheduleRules(req, res) {
  try {
    const { month, department, subDepartment } = req.query || {};
    const includeSelf = String(req.query?.includeSelf || '').toLowerCase() === 'true';
    const range = buildMonthRange(month);
    const scopedIds = await resolveScopedEmployeeIds(req.user, { includeSelf });
    if (Array.isArray(scopedIds) && !scopedIds.length) {
      return res.json({ ok: true, count: 0, violations: [] });
    }

    const query = buildPublishQuery(range, { department, subDepartment });
    if (Array.isArray(scopedIds)) query.employee = { $in: scopedIds };
    let schedules = await ShiftSchedule.find(query).lean();
    let lockedScope = {};
    if (!schedules.length) {
      // 同一個月份、部門／單位與權限範圍，只換成已完成發布的班表
      const lockedQuery = { ...query, state: 'finalized' };
      delete lockedQuery.needsReconfirm;
      schedules = await ShiftSchedule.find(lockedQuery).lean();
      if (schedules.length) lockedScope = { finalized: true };
    }
    if (!schedules.length) {
      return res.json({ ok: true, count: 0, violations: [] });
    }

    try {
      const result = await assertScheduleRuleCompliance({
        candidateSchedules: schedules.map((schedule) => ({
          _id: schedule._id,
          employee: schedule.employee?._id || schedule.employee,
          date: schedule.date,
          shiftId: schedule.shiftId,
          department: schedule.department,
          subDepartment: schedule.subDepartment,
        })),
        range,
        strictWeeklyRest: true,
      });
      // pendingWeeks：跨月週（鄰月還沒排）目前無法判斷的週別，不算違規，ok/count 仍只代表違規
      const pendingWeeks = await describePendingWeeks(result?.pendingWeeks);
      return res.json({
        ok: true,
        count: 0,
        violations: [],
        ...lockedScope,
        ...(pendingWeeks.length ? { pendingWeeks } : {}),
      });
    } catch (error) {
      if (!isLaborRuleValidationError(error)) throw error;
      const violations = await attachEmployeeLabels((error.violations || []).map((violation) => ({
        ...violation,
        rule: violation.rule || violation.code || 'SCHEDULE_RULE',
        employee: toEntityId(violation.employee),
        date: violation.date || violation.startDate || violation.weekStart || null,
        message: violation.message || error.message,
      })));
      const pendingWeeks = await describePendingWeeks(error.pendingWeeks);
      return res.json({
        ok: false,
        count: violations.length,
        violations,
        ...lockedScope,
        ...(pendingWeeks.length ? { pendingWeeks } : {}),
      });
    }
  } catch (error) {
    return res.status(error.message === 'unauthorized' ? 401 : 400).json({ error: error.message });
  }
}

/**
 * 取得未完成排班的員工清單
 */
export async function getIncompleteSchedules(req, res) {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }

    const options = await buildValidationOptions(req);

    const incompleteEmployees = await getIncompleteScheduleEmployees(month, options);
    res.json({ 
      month,
      count: incompleteEmployees.length,
      employees: incompleteEmployees 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 檢查是否可以完成排班發布
 */
export async function checkCanFinalize(req, res) {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }

    const options = await buildValidationOptions(req);

    const result = await canFinalizeSchedules(month, options);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
