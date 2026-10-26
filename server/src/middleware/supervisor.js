import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import {
  getScheduleAccessSummaryForRequest,
  isEmployeeInScheduleScope,
} from '../services/scheduleAccessService.js';

// 新增、修改、刪除班表前的範圍檢查：管理員不限；主管（排班權限模式允許時：自己與直屬部屬）
// 與排班人員（被指定小單位的所有員工，任何角色）只能動自己排班範圍內的員工
export async function verifySupervisor(req, res, next) {
  try {
    const actor = await Employee.findById(req.user.id);
    if (!actor) return res.status(401).json({ error: 'Invalid user' });
    if (['admin'].includes(actor.role)) return next();

    let employeeIds = [];
    if (req.body.employee) employeeIds = [req.body.employee];
    else if (Array.isArray(req.body.schedules) && req.body.schedules.length) {
      employeeIds = req.body.schedules.map((s) => s.employee);
    }
    if (req.params.id) {
      // 修改、刪除既有班表：原本那位員工也必須在範圍內（不能把別人的班表改到自己範圍的員工身上）
      const schedule = await ShiftSchedule.findById(req.params.id);
      if (schedule?.employee) employeeIds.push(schedule.employee.toString());
    }
    if (!employeeIds.length) return res.status(400).json({ error: 'Missing employee' });

    const access = await getScheduleAccessSummaryForRequest(req);
    if (!access?.canSchedule) return res.status(403).json({ error: 'Forbidden' });

    const supervisorId = actor._id.toString();
    const normalized = employeeIds
      .map((id) => (typeof id?.toString === 'function' ? id.toString() : id))
      .filter(Boolean)
      // 主管範圍包含自己（原本的規則），不必再查
      .filter((id) => !(access.supervisorScope && id === supervisorId));

    const uniqueEmployeeIds = [];
    for (const id of normalized) {
      if (!uniqueEmployeeIds.includes(id)) uniqueEmployeeIds.push(id);
    }

    // 逐位員工依員工資料判斷：直屬主管是自己（主管範圍），或所屬小單位／部門被指定給自己排班（排班人員範圍）
    for (const id of uniqueEmployeeIds) {
      const emp = await Employee.findById(id);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      if (!isEmployeeInScheduleScope(access, supervisorId, emp)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    return next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
