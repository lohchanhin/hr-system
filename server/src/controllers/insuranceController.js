import InsuranceRecord from '../models/InsuranceRecord.js';
import { pickAllowedFields, sendSafeError } from '../utils/requestSecurity.js';

const ALLOWED_FIELDS = ['employee', 'provider', 'policyNumber', 'coverageStart', 'coverageEnd'];

export async function listInsurance(req, res) {
  try {
    const records = await InsuranceRecord.find().populate('employee');
    res.json(records);
  } catch (err) {
    sendSafeError(req, res, err, { defaultMessage: '讀取保險紀錄失敗' });
  }
}

export async function createInsurance(req, res) {
  try {
    const payload = pickAllowedFields(req.body, ALLOWED_FIELDS);
    const record = new InsuranceRecord(payload);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '建立保險紀錄失敗' });
  }
}

export async function getInsurance(req, res) {
  try {
    const record = await InsuranceRecord.findById(req.params.id).populate('employee');
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '讀取保險紀錄失敗' });
  }
}

export async function updateInsurance(req, res) {
  try {
    const payload = pickAllowedFields(req.body, ALLOWED_FIELDS);
    const record = await InsuranceRecord.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '更新保險紀錄失敗' });
  }
}

export async function deleteInsurance(req, res) {
  try {
    const record = await InsuranceRecord.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    sendSafeError(req, res, err, { defaultStatus: 400, defaultMessage: '刪除保險紀錄失敗' });
  }
}
