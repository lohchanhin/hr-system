import AttendanceSetting from '../models/AttendanceSetting.js';
import { parseTimeString } from '../utils/timeWindow.js';

function validateTimeField(value, label) {
  if (!value || typeof value !== 'string' || !parseTimeString(value)) {
    throw new Error(`${label}格式不正確，請輸入 HH:mm`);
  }
  return value;
}

function normalizeBreakWindows(breakWindows) {
  if (breakWindows == null) return undefined;
  if (!Array.isArray(breakWindows)) {
    throw new Error('breakWindows 必須是陣列');
  }
  return breakWindows
    .map((item, idx) => {
      if (!item) return null;
      const start = item.start ? validateTimeField(item.start, `第 ${idx + 1} 筆休息開始時間`) : null;
      const end = item.end ? validateTimeField(item.end, `第 ${idx + 1} 筆休息結束時間`) : null;
      if (start && end && start === end) {
        throw new Error(`第 ${idx + 1} 筆休息時段的開始與結束不得相同`);
      }
      if (!start && !end && !item.label) return null;
      return {
        start: start || '',
        end: end || '',
        label: item.label || '',
      };
    })
    .filter(Boolean);
}

function buildShiftPayload(input, existing = {}) {
  const merged = { ...existing, ...input };
  const name = (merged.name || '').trim();
  const code = (merged.code || '').trim();
  if (!name || !code) {
    throw new Error('班別名稱與代碼為必填');
  }
  const startTime = validateTimeField(merged.startTime, '上班時間');
  const endTime = validateTimeField(merged.endTime, '下班時間');
  const breakWindows = normalizeBreakWindows(merged.breakWindows ?? existing.breakWindows);

  let breakDuration;
  if (merged.breakDuration !== undefined) {
    const parsed = Number(merged.breakDuration);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('休息時長必須是 0 或以上的數字');
    }
    breakDuration = parsed;
  } else if (existing.breakDuration !== undefined) {
    breakDuration = existing.breakDuration;
  }

  const payload = {
    name,
    code,
    startTime,
    endTime,
    breakTime: merged.breakTime,
    breakMinutes: merged.breakMinutes,
    breakDuration,
    breakWindows: breakWindows ?? [],
    allowMultiBreak: merged.allowMultiBreak ?? existing.allowMultiBreak ?? false,
    crossDay: Boolean(merged.crossDay ?? existing.crossDay),
    remark: merged.remark ?? existing.remark ?? '',
    color: merged.color ?? existing.color ?? '',
    bgColor: merged.bgColor ?? existing.bgColor ?? '',
    // 夜班津貼設定
    isNightShift: Boolean(merged.isNightShift ?? existing.isNightShift ?? false),
    hasAllowance: Boolean(merged.hasAllowance ?? existing.hasAllowance ?? false),
    allowanceType: merged.allowanceType ?? existing.allowanceType ?? 'multiplier', // Default to multiplier
    allowanceMultiplier: merged.allowanceMultiplier !== undefined ? Number(merged.allowanceMultiplier) : (existing.allowanceMultiplier ?? 0),
    fixedAllowanceAmount: merged.fixedAllowanceAmount !== undefined ? Number(merged.fixedAllowanceAmount) : (existing.fixedAllowanceAmount ?? 0),
  };

  // 驗證夜班津貼設定
  if (payload.hasAllowance) {
    if (payload.allowanceType === 'multiplier' && (!payload.allowanceMultiplier || payload.allowanceMultiplier <= 0)) {
      throw new Error('啟用夜班津貼時，倍率必須大於 0');
    }
    if (payload.allowanceType === 'fixed' && (!payload.fixedAllowanceAmount || payload.fixedAllowanceAmount <= 0)) {
      throw new Error('啟用夜班津貼時，固定津貼金額必須大於 0');
    }
  }

  return payload;
}

export async function getShifts(req, res) {
  try {
    const setting = await AttendanceSetting.findOne();
    res.json(setting?.shifts || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createShift(req, res) {
  try {
    let setting = await AttendanceSetting.findOne();
    if (!setting) {
      setting = await AttendanceSetting.create({ shifts: [] });
    }
    const payload = buildShiftPayload(req.body);
    setting.shifts.push(payload);
    await setting.save();
    const newShift = setting.shifts[setting.shifts.length - 1];
    res.status(201).json(newShift);
  } catch (err) {
    const status = err.message?.includes('必填') || err.message?.includes('格式不正確') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
}

export async function updateShift(req, res) {
  try {
    const { id } = req.params;
    const setting = await AttendanceSetting.findOne();
    if (!setting) return res.status(404).json({ error: 'Attendance setting not found' });
    const shift = setting.shifts.id(id);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    const payload = buildShiftPayload(req.body, shift.toObject ? shift.toObject() : shift);
    Object.assign(shift, payload);
    await setting.save();
    res.json(shift);
  } catch (err) {
    const status = err.message?.includes('必填') || err.message?.includes('格式不正確') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
}

export async function deleteShift(req, res) {
  try {
    const { id } = req.params;
    const setting = await AttendanceSetting.findOne();
    if (!setting) return res.status(404).json({ error: 'Attendance setting not found' });
    const shift = setting.shifts.id(id);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    shift.deleteOne();
    await setting.save();
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
