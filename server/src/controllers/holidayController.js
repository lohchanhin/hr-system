import Holiday from '../models/Holiday.js';

export async function listHolidays(req, res) {
  try {
    const holidays = await Holiday.find();
    res.json(holidays);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createHoliday(req, res) {
  try {
    const holiday = await Holiday.create(req.body);
    res.status(201).json(holiday);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateHoliday(req, res) {
  try {
    const holiday = await Holiday.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!holiday) return res.status(404).json({ error: 'Not found' });
    res.json(holiday);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteHoliday(req, res) {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
