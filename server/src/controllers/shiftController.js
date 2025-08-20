import AttendanceSetting from '../models/AttendanceSetting.js';

export async function getShifts(req, res) {
  try {
    const setting = await AttendanceSetting.findOne();
    res.json(setting?.shifts || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createShift(req, res) {
  try {
    let setting = await AttendanceSetting.findOne();
    if (!setting) {
      setting = await AttendanceSetting.create({ shifts: [] });
    }
    setting.shifts.push(req.body);
    await setting.save();
    const newShift = setting.shifts[setting.shifts.length - 1];
    res.status(201).json(newShift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateShift(req, res) {
  try {
    const { id } = req.params;
    const setting = await AttendanceSetting.findOne();
    if (!setting) return res.status(404).json({ error: 'Attendance setting not found' });
    const shift = setting.shifts.id(id);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    Object.assign(shift, req.body);
    await setting.save();
    res.json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteShift(req, res) {
  try {
    const { id } = req.params;
    const setting = await AttendanceSetting.findOne();
    if (!setting) return res.status(404).json({ error: 'Attendance setting not found' });
    const shift = setting.shifts.id(id);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    shift.deleteOne();
    await setting.save();
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
