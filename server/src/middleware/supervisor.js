import User from '../models/User.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';

export async function verifySupervisor(req, res, next) {
  try {
    const user = await User.findById(req.user.id).populate('employee');
    if (!user) return res.status(401).json({ error: 'Invalid user' });
    if (['admin', 'hr'].includes(user.role)) return next();

    let employeeId = req.body.employee;
    if (!employeeId && Array.isArray(req.body.schedules) && req.body.schedules.length) {
      employeeId = req.body.schedules[0].employee;
    }
    if (!employeeId && req.params.id) {
      const schedule = await ShiftSchedule.findById(req.params.id);
      if (schedule) employeeId = schedule.employee.toString();
    }
    if (!employeeId) return res.status(400).json({ error: 'Missing employee' });

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    if (
      employee.supervisor &&
      user.employee &&
      employee.supervisor.toString() === user.employee._id.toString()
    ) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
