import AttendanceRecord from '../models/AttendanceRecord.js';

export async function listRecords(req, res) {
  try {
    const isEmployee = req.user?.role === 'employee';
    const query = {};

    if (isEmployee) {
      query.employee = req.user?.id;
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
