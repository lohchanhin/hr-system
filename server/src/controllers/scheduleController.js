import ShiftSchedule from '../models/ShiftSchedule.js';

export async function listSchedules(req, res) {
  const schedules = await ShiftSchedule.find().populate('employee');
  res.json(schedules);
}

export async function createSchedule(req, res) {
  try {
    const schedule = new ShiftSchedule(req.body);
    await schedule.save();
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
