import SalarySetting from '../models/SalarySetting.js';
import { pickAllowedFields, sendSafeError } from '../utils/requestSecurity.js';

const ALLOWED_FIELDS = ['salaryItems', 'grades', 'adjust', 'payment', 'other'];

export async function listSettings(req, res) {
  try {
    const settings = await SalarySetting.find();
    res.json(settings);
  } catch (err) {
    sendSafeError(req, res, err, { defaultMessage: '讀取薪資設定失敗' });
  }
}

export async function createSetting(req, res) {
  try {
    const payload = pickAllowedFields(req.body, ALLOWED_FIELDS);
    const setting = new SalarySetting(payload);
    await setting.save();
    res.status(201).json(setting);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '建立薪資設定失敗' });
  }
}

export async function getSetting(req, res) {
  try {
    const setting = await SalarySetting.findById(req.params.id);
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '讀取薪資設定失敗' });
  }
}

export async function updateSetting(req, res) {
  try {
    const payload = pickAllowedFields(req.body, ALLOWED_FIELDS);
    const setting = await SalarySetting.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '更新薪資設定失敗' });
  }
}

export async function deleteSetting(req, res) {
  try {
    const setting = await SalarySetting.findByIdAndDelete(req.params.id);
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '刪除薪資設定失敗' });
  }
}
