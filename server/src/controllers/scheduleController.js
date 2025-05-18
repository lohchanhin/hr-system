import Schedule from '../models/Schedule.js';

export async function listSchedules(req, res) {
  const schedules = await Schedule.find().populate('employee');
  res.json(schedules);
}

export async function createSchedule(req, res) {
  try {
    const schedule = new Schedule(req.body);
    await schedule.save();
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
