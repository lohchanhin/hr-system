import SalarySetting from '../models/SalarySetting.js';

export async function listSettings(req, res) {
  try {
    const settings = await SalarySetting.find();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSetting(req, res) {
  try {
    const setting = new SalarySetting(req.body);
    await setting.save();
    res.status(201).json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getSetting(req, res) {
  try {
    const setting = await SalarySetting.findById(req.params.id);
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateSetting(req, res) {
  try {
    const setting = await SalarySetting.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteSetting(req, res) {
  try {
    const setting = await SalarySetting.findByIdAndDelete(req.params.id);
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
