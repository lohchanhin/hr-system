import AttendanceSetting from '../models/AttendanceSetting.js';

export async function getSettings(req, res) {
  const settings = await AttendanceSetting.findOne();
  res.json(settings || {});
}

export async function updateSettings(req, res) {
  try {
    const settings = await AttendanceSetting.findOneAndUpdate({}, req.body, {
      new: true,
      upsert: true
    });
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
