import AttendanceRecord from '../models/AttendanceRecord.js';
import Employee from '../models/Employee.js';
import AttendanceManagementSetting from '../models/AttendanceManagementSetting.js';

function toStringId(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return undefined;
}

function isSameDepartment(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b;
}

export async function listRecords(req, res) {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const query = {};

    if (role === 'employee') {
      query.employee = req.user?.id;
    } else if (role === 'supervisor') {
      if (!userId) return res.status(403).json({ error: 'Forbidden' });

      const supervisor = await Employee.findById(userId);
      if (!supervisor) return res.status(403).json({ error: 'Forbidden' });

      const supervisorDeptId = toStringId(supervisor.department);
      const supervisorId = toStringId(supervisor._id);

      let allowCrossDeptCache;
      const ensureCrossDeptAllowed = async () => {
        if (typeof allowCrossDeptCache === 'boolean') return allowCrossDeptCache;
        const setting = await AttendanceManagementSetting.findOne();
        allowCrossDeptCache = Boolean(setting?.supervisorCrossDept);
        return allowCrossDeptCache;
      };

      const rawEmployeeParam = req.query.employee;
      const requestedEmployeeId = Array.isArray(rawEmployeeParam) ? rawEmployeeParam[0] : rawEmployeeParam;

      if (requestedEmployeeId) {
        const target = await Employee.findById(requestedEmployeeId);
        if (!target) return res.status(404).json({ error: 'Employee not found' });

        const targetDeptId = toStringId(target.department);
        const sameDept = isSameDepartment(supervisorDeptId, targetDeptId);
        const inAuthorizedList = toStringId(target.supervisor) === supervisorId;

        if (!sameDept && !inAuthorizedList) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        if (!sameDept) {
          const crossDeptAllowed = await ensureCrossDeptAllowed();
          if (!crossDeptAllowed) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        }

        query.employee = requestedEmployeeId;
      } else {
        const [directReports, setting] = await Promise.all([
          Employee.find({ supervisor: supervisorId }),
          AttendanceManagementSetting.findOne(),
        ]);

        const allowCrossDept = Boolean(setting?.supervisorCrossDept);

        let departmentEmployees = [];
        if (supervisorDeptId) {
          departmentEmployees = await Employee.find({ department: supervisor.department });
        }

        const allowed = new Set();

        directReports.forEach((emp) => {
          const empDeptId = toStringId(emp.department);
          if (allowCrossDept || isSameDepartment(supervisorDeptId, empDeptId)) {
            const id = toStringId(emp._id);
            if (id && id !== supervisorId) allowed.add(id);
          }
        });

        departmentEmployees.forEach((emp) => {
          const id = toStringId(emp._id);
          if (id && id !== supervisorId) allowed.add(id);
        });

        if (!allowed.size) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        query.employee = { $in: [...allowed] };
      }
    } else if (req.query.employee) {
      query.employee = req.query.employee;
    }

    const records = await AttendanceRecord.find(query)
      .sort({ timestamp: -1 })
      .populate('employee');
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRecord(req, res) {
  try {
    const { employee, action, timestamp, remark } = req.body;
    if (!employee || !action) {
      return res.status(400).json({ error: 'employee and action are required' });
    }
    const record = new AttendanceRecord({ employee, action, timestamp, remark });
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
