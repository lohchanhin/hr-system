import mongoose from 'mongoose';
import AttendanceSetting from '../models/AttendanceSetting.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import SubDepartment from '../models/SubDepartment.js';
import { parseTimeString } from '../utils/timeWindow.js';
import {
  hasNoWorkingTime,
  inferLegacyShiftSemanticType,
  isNonWorkShift,
  resolveShiftSemanticType,
} from '../services/shiftSemanticService.js';
import {
  assertUniqueShiftIdentity,
  ShiftIdentityConflictError,
} from '../services/shiftIdentityService.js';

// 班別內容填錯（必填、時間格式、休息時間、夜班津貼）：回 400；以前只有訊息含「必填」「格式不正確」的才是 400，其餘填錯都回 500
class ShiftValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShiftValidationError';
    this.statusCode = 400;
  }
}

function validateTimeField(value, label) {
  if (!value || typeof value !== 'string' || !parseTimeString(value)) {
    throw new ShiftValidationError(`${label}格式不正確，請輸入 HH:mm`);
  }
  return value;
}

function resolveErrorStatus(err) {
  if (err instanceof ShiftIdentityConflictError || err instanceof ShiftValidationError) return err.statusCode;
  // 兩位管理員同時修改班別設定：後存的那一位請重新整理再改
  if (err?.name === 'VersionError') return 409;
  return 500;
}

function respondShiftError(res, err) {
  const status = resolveErrorStatus(err);
  // 非預期的錯誤（資料庫連線等）不回原文，只記錄錯誤名稱
  if (status === 500) console.error(`Shift setting failed: ${err?.name || 'Error'}`);
  const error = err?.name === 'VersionError'
    ? '班別設定剛被其他人修改，請重新整理後再試'
    : status === 500 ? '班別設定儲存失敗，請稍後再試' : err.message;
  res.status(status).json({ error, ...(err.code ? { code: err.code } : {}) });
}

function normalizeBreakWindows(breakWindows) {
  if (breakWindows == null) return undefined;
  if (!Array.isArray(breakWindows)) {
    throw new ShiftValidationError('休息時段的格式不正確');
  }
  return breakWindows
    .map((item, idx) => {
      if (!item) return null;
      const start = item.start ? validateTimeField(item.start, `第 ${idx + 1} 筆休息開始時間`) : null;
      const end = item.end ? validateTimeField(item.end, `第 ${idx + 1} 筆休息結束時間`) : null;
      if (start && end && start === end) {
        throw new ShiftValidationError(`第 ${idx + 1} 筆休息時段的開始與結束不得相同`);
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

/**
 * 決定要存的班別性質：明確選了有效的類型就尊重；沒選或選錯就由代碼/名稱推斷。
 * 但沒有工作時間（開始等於結束且沒勾跨日，例如 00:00-00:00）的班別不可以存成 work，
 * 否則會被當成 24 小時的班，要改成推斷出來的休息/請假類型。
 */
function resolvePayloadSemanticType(shift) {
  const resolved = resolveShiftSemanticType(shift);
  if (resolved === 'work' && hasNoWorkingTime(shift)) {
    const inferred = inferLegacyShiftSemanticType(shift);
    return inferred === 'work' ? 'leave' : inferred;
  }
  return resolved;
}

function buildShiftPayload(input, existing = {}) {
  const merged = { ...existing, ...input };
  const name = (merged.name || '').trim();
  const code = (merged.code || '').trim();
  if (!name || !code) {
    throw new ShiftValidationError('班別名稱與代碼為必填');
  }
  const startTime = validateTimeField(merged.startTime, '上班時間');
  const endTime = validateTimeField(merged.endTime, '下班時間');
  const breakWindows = normalizeBreakWindows(merged.breakWindows ?? existing.breakWindows);
  const crossDay = Boolean(merged.crossDay ?? existing.crossDay);

  let breakDuration;
  if (merged.breakDuration !== undefined) {
    const parsed = Number(merged.breakDuration);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ShiftValidationError('休息時長必須是 0 或以上的數字');
    }
    breakDuration = parsed;
  } else if (existing.breakDuration !== undefined) {
    breakDuration = existing.breakDuration;
  }

  const payload = {
    name,
    code,
    semanticType: resolvePayloadSemanticType({ ...merged, name, code, startTime, endTime, crossDay }),
    startTime,
    endTime,
    breakTime: merged.breakTime,
    breakMinutes: merged.breakMinutes,
    breakDuration,
    breakWindows: breakWindows ?? [],
    allowMultiBreak: merged.allowMultiBreak ?? existing.allowMultiBreak ?? false,
    crossDay,
    remark: merged.remark ?? existing.remark ?? '',
    color: merged.color ?? existing.color ?? '',
    bgColor: merged.bgColor ?? existing.bgColor ?? '',
    // 夜班津貼設定
    isNightShift: Boolean(merged.isNightShift ?? existing.isNightShift ?? false),
    hasAllowance: Boolean(merged.hasAllowance ?? existing.hasAllowance ?? (merged.isNightShift ?? existing.isNightShift ?? false)),
    fixedAllowanceAmount: merged.fixedAllowanceAmount !== undefined
      ? Number(merged.fixedAllowanceAmount)
      : (existing.fixedAllowanceAmount ?? 0),
  };

  // 非夜班班別不啟用津貼
  if (!payload.isNightShift) {
    payload.hasAllowance = false;
    payload.fixedAllowanceAmount = 0;
  }

  // 驗證夜班津貼設定
  if (payload.isNightShift && payload.hasAllowance) {
    if (!Number.isFinite(payload.fixedAllowanceAmount) || payload.fixedAllowanceAmount <= 0) {
      throw new ShiftValidationError('啟用夜班津貼時，固定津貼金額必須大於 0');
    }
  }

  return payload;
}

// 找不到班別（另一位管理員剛刪掉，或還沒有任何班別設定）
const SHIFT_NOT_FOUND_BODY = Object.freeze({ error: '找不到這個班別，可能已被刪除，請重新整理', code: 'SHIFT_NOT_FOUND' });

export async function getShifts(req, res) {
  try {
    const setting = await AttendanceSetting.findOne();
    res.json(setting?.shifts || []);
  } catch (err) {
    console.error(`List shifts failed: ${err?.name || 'Error'}`);
    res.status(500).json({ error: '班別讀取失敗，請稍後再試' });
  }
}

export async function createShift(req, res) {
  try {
    let setting = await AttendanceSetting.findOne();
    if (!setting) {
      setting = await AttendanceSetting.create({ shifts: [] });
    }
    const payload = buildShiftPayload(req.body);
    assertUniqueShiftIdentity(setting.shifts, payload);
    setting.shifts.push(payload);
    await setting.save();
    const newShift = setting.shifts[setting.shifts.length - 1];
    res.status(201).json(newShift);
  } catch (err) {
    respondShiftError(res, err);
  }
}

export async function updateShift(req, res) {
  try {
    const { id } = req.params;
    const setting = await AttendanceSetting.findOne();
    if (!setting) return res.status(404).json(SHIFT_NOT_FOUND_BODY);
    const shift = setting.shifts.id(id);
    if (!shift) return res.status(404).json(SHIFT_NOT_FOUND_BODY);
    const payload = buildShiftPayload(req.body, shift.toObject ? shift.toObject() : shift);
    assertUniqueShiftIdentity(setting.shifts, payload, { excludeId: id });
    Object.assign(shift, payload);
    await setting.save();
    res.json(shift);
  } catch (err) {
    respondShiftError(res, err);
  }
}

/*
 * 刪掉的班別也要從小單位的「使用班別」（SubDepartment.allowedShiftIds）拿掉。以前留著已不存在的 _id：
 * 只選了這一個上班班別的小單位，清單不是空的（不算「全部」）卻沒有任何能用的上班班別，排班、匯入一律被擋。
 * 拿掉之後清單裡已經沒有上班的班別（只剩不用上班的、或空的）就清成空陣列 = 全部班別（docs/scheduler-access.md）。
 * 班別已經刪掉了：這裡失敗只記錄，不讓刪除回報失敗（讀取端看不到的 _id 也不會被選到）。
 */
async function removeShiftFromUnits(shiftId, remainingShifts = []) {
  // 沒有資料庫連線（單元測試以替身取代班別設定）時不查：mongoose 會把查詢排隊等到逾時
  if (mongoose.connection.readyState !== 1) return 0;
  try {
    const units = await SubDepartment.find({ allowedShiftIds: shiftId }).select('_id allowedShiftIds').lean();
    if (!units?.length) return 0;
    const workShiftIds = new Set(
      [...remainingShifts].filter((item) => item && !isNonWorkShift(item)).map((item) => String(item._id)),
    );
    const operations = units.map((unit) => {
      const rest = (unit.allowedShiftIds || []).map(String).filter((id) => id !== shiftId);
      const keepsWorkShift = rest.some((id) => workShiftIds.has(id));
      return {
        updateOne: {
          // 只改還選著這個班別的小單位（查詢之後管理員剛好改了設定，就不動它）
          filter: { _id: unit._id, allowedShiftIds: shiftId },
          update: keepsWorkShift ? { $pull: { allowedShiftIds: shiftId } } : { $set: { allowedShiftIds: [] } },
        },
      };
    });
    await SubDepartment.bulkWrite(operations, { ordered: false });
    return operations.length;
  } catch (err) {
    console.error(`Delete shift: failed to update unit shift lists: ${err?.name || 'Error'}`);
    return 0;
  }
}

export async function deleteShift(req, res) {
  try {
    const { id } = req.params;
    const setting = await AttendanceSetting.findOne();
    if (!setting) return res.status(404).json(SHIFT_NOT_FOUND_BODY);
    const shift = setting.shifts.id(id);
    if (!shift) return res.status(404).json(SHIFT_NOT_FOUND_BODY);
    // 還有班表在用的班別不能刪：刪掉以後那些班表找不到班別，工時、出勤天數、薪資都算不到（日薪的人那幾天變成 0 元），
    // 排班頁顯示空白，當天也打不了卡
    const usedCount = await ShiftSchedule.countDocuments({ shiftId: shift._id });
    if (usedCount > 0) {
      const latest = await ShiftSchedule.findOne({ shiftId: shift._id }).sort({ date: -1 }).select('date').lean();
      const latestKey = latest?.date ? new Date(latest.date).toISOString().slice(0, 10) : '';
      return res.status(409).json({
        error: `「${shift.name || shift.code || '這個班別'}」還有 ${usedCount} 筆班表在使用${latestKey ? `（最近一筆 ${latestKey}）` : ''}，不能刪除；請先把這些班表改成其他班別`,
        code: 'SHIFT_IN_USE',
        scheduleCount: usedCount,
        ...(latestKey ? { latestDate: latestKey } : {}),
      });
    }
    shift.deleteOne();
    await setting.save();
    await removeShiftFromUnits(String(shift._id), setting.shifts);
    res.status(204).end();
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json(SHIFT_NOT_FOUND_BODY);
    respondShiftError(res, err);
  }
}
