import DeptSchedule from '../models/DeptSchedule.js';

export async function listDeptSchedules(req, res) {
  try {
    const schedules = await DeptSchedule.find().populate('department');
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createDeptSchedule(req, res) {
  try {
    const schedule = await DeptSchedule.create(req.body);
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getDeptSchedule(req, res) {
  try {
    const schedule = await DeptSchedule.findById(req.params.id).populate('department');
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateDeptSchedule(req, res) {
  try {
    const schedule = await DeptSchedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteDeptSchedule(req, res) {
  try {
    const schedule = await DeptSchedule.findByIdAndDelete(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
