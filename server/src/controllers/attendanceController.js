import AttendanceRecord from '../models/AttendanceRecord.js';

export async function listRecords(req, res) {
  try {
    const records = await AttendanceRecord.find().populate('employee');
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRecord(req, res) {
  try {
    const record = new AttendanceRecord(req.body);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
