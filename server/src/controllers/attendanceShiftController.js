import AttendanceSetting from '../models/AttendanceSetting.js';
import { sendSafeError } from '../utils/requestSecurity.js';

export async function getAttendanceSettings(req, res) {
  try {
    const setting = await AttendanceSetting.findOne();
    res.json(setting?.shifts || []);
  } catch (err) {
    sendSafeError(req, res, err, { defaultMessage: '讀取班別設定失敗' });
  }
}
