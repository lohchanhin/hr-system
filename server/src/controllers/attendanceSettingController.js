import mongoose from 'mongoose';
import AttendanceManagementSetting from '../models/AttendanceManagementSetting.js';

function validateObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function notFound(res) {
  return res.status(404).json({ error: '找不到考勤管理設定' });
}

export async function listSettings(req, res) {
  try {
    const settings = await AttendanceManagementSetting.find().sort({ createdAt: -1 });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSetting(req, res) {
  try {
    const setting = new AttendanceManagementSetting(req.body);
    await setting.save();
    res.status(201).json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getSetting(req, res) {
  const { id } = req.params;
  if (!validateObjectId(id)) {
    return res.status(400).json({ error: '設定編號格式不正確' });
  }
  try {
    const setting = await AttendanceManagementSetting.findById(id);
    if (!setting) {
      return notFound(res);
    }
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateSetting(req, res) {
  const { id } = req.params;
  if (!validateObjectId(id)) {
    return res.status(400).json({ error: '設定編號格式不正確' });
  }
  try {
    const setting = await AttendanceManagementSetting.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!setting) {
      return notFound(res);
    }
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteSetting(req, res) {
  const { id } = req.params;
  if (!validateObjectId(id)) {
    return res.status(400).json({ error: '設定編號格式不正確' });
  }
  try {
    const setting = await AttendanceManagementSetting.findByIdAndDelete(id);
    if (!setting) {
      return notFound(res);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
