import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';

export async function verifySupervisor(req, res, next) {
  try {
    const actor = await Employee.findById(req.user.id);
    if (!actor) return res.status(401).json({ error: 'Invalid user' });
    if (['admin'].includes(actor.role)) return next();

    let employeeIds = [];
    if (req.body.employee) employeeIds = [req.body.employee];
    else if (Array.isArray(req.body.schedules) && req.body.schedules.length) {
      employeeIds = req.body.schedules.map((s) => s.employee);
    } else if (req.params.id) {
      const schedule = await ShiftSchedule.findById(req.params.id);
      if (schedule) employeeIds = [schedule.employee.toString()];
    }
    if (!employeeIds.length) return res.status(400).json({ error: 'Missing employee' });

    const supervisorId = actor._id.toString();

    const normalized = employeeIds
      .map((id) => (typeof id?.toString === 'function' ? id.toString() : id))
      .filter(Boolean)
      .filter((id) => id !== supervisorId);

    const uniqueEmployeeIds = [];
    for (const id of normalized) {
      if (!uniqueEmployeeIds.includes(id)) uniqueEmployeeIds.push(id);
    }

    for (const id of uniqueEmployeeIds) {
      const emp = await Employee.findById(id);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      if (!(emp.supervisor && emp.supervisor.toString() === supervisorId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    return next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
