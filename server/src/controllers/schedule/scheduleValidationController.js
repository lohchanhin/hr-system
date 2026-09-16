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
  buildMonthRange,
  resolveScopedEmployeeIds,
  buildPublishQuery,
} from './scheduleShared.js';

/**
 * 驗證月度排班完整性
 */
export async function validateScheduleCompleteness(req, res) {
  try {
    const { month, department, subDepartment } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }
    
    const options = {};
    if (department) options.department = department;
    if (subDepartment) options.subDepartment = subDepartment;
    
    const validation = await validateMonthSchedules(month, options);
    res.json(validation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 非阻塞檢查目前範圍內的排班草稿；發布路由仍會再次強制檢核。
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
    const schedules = await ShiftSchedule.find(query).lean();
    if (!schedules.length) {
      return res.json({ ok: true, count: 0, violations: [] });
    }

    try {
      await assertScheduleRuleCompliance({
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
      return res.json({ ok: true, count: 0, violations: [] });
    } catch (error) {
      if (!isLaborRuleValidationError(error)) throw error;
      const violations = (error.violations || []).map((violation) => ({
        ...violation,
        rule: violation.rule || violation.code || 'SCHEDULE_RULE',
        employee: toEntityId(violation.employee),
        date: violation.date || violation.startDate || violation.weekStart || null,
        message: violation.message || error.message,
      }));
      return res.json({ ok: false, count: violations.length, violations });
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
    const { month, department, subDepartment } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }
    
    const options = {};
    if (department) options.department = department;
    if (subDepartment) options.subDepartment = subDepartment;
    
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
    const { month, department, subDepartment } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }
    
    const options = {};
    if (department) options.department = department;
    if (subDepartment) options.subDepartment = subDepartment;
    
    const result = await canFinalizeSchedules(month, options);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
