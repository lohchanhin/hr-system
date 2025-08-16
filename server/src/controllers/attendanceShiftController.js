import AttendanceSetting from '../models/AttendanceSetting.js';

export async function getAttendanceSettings(req, res) {
  try {
    const setting = await AttendanceSetting.findOne();
    res.json(setting?.shifts || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
