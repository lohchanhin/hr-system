import DeptSchedule from '../models/DeptSchedule.js';
import { pickAllowedFields, sendSafeError } from '../utils/requestSecurity.js';

const ALLOWED_FIELDS = ['department', 'rules'];

export async function listDeptSchedules(req, res) {
  try {
    const schedules = await DeptSchedule.find().populate('department');
    res.json(schedules);
  } catch (err) {
    sendSafeError(req, res, err, { defaultMessage: '讀取部門排班設定失敗' });
  }
}

export async function createDeptSchedule(req, res) {
  try {
    const payload = pickAllowedFields(req.body, ALLOWED_FIELDS);
    const schedule = await DeptSchedule.create(payload);
    res.status(201).json(schedule);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '建立部門排班設定失敗' });
  }
}

export async function getDeptSchedule(req, res) {
  try {
    const schedule = await DeptSchedule.findById(req.params.id).populate('department');
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '讀取部門排班設定失敗' });
  }
}

export async function updateDeptSchedule(req, res) {
  try {
    const payload = pickAllowedFields(req.body, ALLOWED_FIELDS);
    const schedule = await DeptSchedule.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '更新部門排班設定失敗' });
  }
}

export async function deleteDeptSchedule(req, res) {
  try {
    const schedule = await DeptSchedule.findByIdAndDelete(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '刪除部門排班設定失敗' });
  }
}
