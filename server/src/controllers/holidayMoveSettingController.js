import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import Holiday from '../models/Holiday.js';
import HolidaySwap from '../models/HolidaySwap.js';
import HolidayCompensation from '../models/HolidayCompensation.js';
import { effectiveHolidayKind } from '../services/holidayCalendarRules.js';

const ALLOWED_FIELDS = [
  'enableHolidayMove',
  'needSignature',
  'needMakeup',
  'sourceDate',
  'targetDate',
  'reason',
  'agreementReference',
  'agreementDate',
  'makeupConfirmed',
];

function settingPayload(body = {}) {
  return Object.fromEntries(
    ALLOWED_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
      .map((field) => [field, body[field]]),
  );
}

class MoveValidationError extends Error {
  constructor(message, status = 400, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function activeKindsOn(date) {
  const query = Holiday.find({ date, archived: { $ne: true } });
  const rows = await (query && typeof query.lean === 'function' ? query.lean() : query);
  return new Set((Array.isArray(rows) ? rows : []).map((row) => effectiveHolidayKind(row)));
}

// 來源必須是有效的國定假日；目標不能已經是假日（國定假日、指定應放假日、行政人員的公務機關補假）；
// 已有員工個人調移這一天時不能再做全公司調移。
// 目標日也不能和另一筆全公司調移同一天、不能是員工的個人調移日或已排定的補假日：同一天放兩個假，員工會少放一天
async function assertSourceHoliday(setting) {
  if (!setting.sourceDate) return;
  const [sourceKinds, targetKinds, swapExists, otherMove, swapTarget, compensationTarget] = await Promise.all([
    activeKindsOn(setting.sourceDate),
    activeKindsOn(setting.targetDate),
    HolidaySwap.exists({ originalDate: setting.sourceDate, status: 'active' }),
    HolidayMoveSetting.exists({ _id: { $ne: setting._id }, enableHolidayMove: true, targetDate: setting.targetDate }),
    HolidaySwap.exists({ targetDate: setting.targetDate, status: 'active' }),
    HolidayCompensation.exists({ assignedDate: setting.targetDate, status: 'assigned' }),
  ]);
  if (!sourceKinds.has('statutory')) {
    throw new MoveValidationError('原國定假日必須是行事曆上的國定假日', 400, 'SOURCE_NOT_HOLIDAY');
  }
  if (targetKinds.has('statutory') || targetKinds.has('designated') || targetKinds.has('gov_makeup_off')) {
    throw new MoveValidationError('改放的那一天已經是假日（國定假日、指定應放假日或公務機關補假），請改選其他日子', 400, 'TARGET_IS_HOLIDAY');
  }
  if (swapExists) {
    throw new MoveValidationError('已有員工個人調移這一天的國定假日，請先撤銷個人調移再設定全公司調移', 409, 'SWAP_EXISTS');
  }
  if (otherMove) {
    throw new MoveValidationError('這一天已是另一筆全公司調移的調移日，請改選其他日子', 409, 'TARGET_TAKEN');
  }
  if (swapTarget || compensationTarget) {
    throw new MoveValidationError('這一天已是員工的個人調移日或已排定的補假日，請改選其他日子', 409, 'TARGET_TAKEN');
  }
}

function sendMoveError(res, err) {
  if (err instanceof MoveValidationError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    return res.status(err.status).json(body);
  }
  // 同一個國定假日只能有一筆全公司調移（sourceDate 唯一索引）：以前把資料庫的 E11000 原文回給畫面
  if (err?.code === 11000) {
    return res.status(409).json({ error: '這個國定假日已經設定過全公司調移，請直接修改那一筆', code: 'SOURCE_TAKEN' });
  }
  if (err?.name === 'CastError' || err?.name === 'ValidationError') {
    return res.status(400).json({ error: '資料格式不正確（日期、或說明超過 500 字、文號超過 200 字），請確認後再試', code: 'INVALID_INPUT' });
  }
  // 模型的檢查（models/HolidayMoveSetting.js）訊息已經是中文並帶 code
  if (typeof err?.code === 'string') return res.status(400).json({ error: err.message, code: err.code });
  console.error(`Holiday move setting failed: ${err?.name || 'Error'}`);
  return res.status(500).json({ error: '國定假日調移儲存失敗，請稍後再試' });
}

const NOT_FOUND_BODY = { error: '找不到這筆國定假日調移設定，可能已被刪除，請重新整理', code: 'NOT_FOUND' };

export async function listSettings(req, res) {
  try {
    const settings = await HolidayMoveSetting.find();
    res.json(settings);
  } catch (err) {
    console.error(`Holiday move settings list failed: ${err?.name || 'Error'}`);
    res.status(500).json({ error: '國定假日調移設定讀取失敗，請稍後再試' });
  }
}

export async function createSetting(req, res) {
  try {
    const setting = new HolidayMoveSetting(settingPayload(req.body));
    setting.updatedBy = req.user?.userId || req.user?.id;
    await setting.validate();
    await assertSourceHoliday(setting);
    await setting.save();
    res.status(201).json(setting);
  } catch (err) {
    sendMoveError(res, err);
  }
}

export async function getSetting(req, res) {
  try {
    const setting = await HolidayMoveSetting.findById(req.params.id);
    if (!setting) return res.status(404).json(NOT_FOUND_BODY);
    res.json(setting);
  } catch (err) {
    sendMoveError(res, err);
  }
}

export async function updateSetting(req, res) {
  try {
    const setting = await HolidayMoveSetting.findById(req.params.id);
    if (!setting) return res.status(404).json(NOT_FOUND_BODY);
    Object.assign(setting, settingPayload(req.body));
    setting.updatedBy = req.user?.userId || req.user?.id;
    await setting.validate();
    await assertSourceHoliday(setting);
    await setting.save();
    res.json(setting);
  } catch (err) {
    sendMoveError(res, err);
  }
}

export async function deleteSetting(req, res) {
  try {
    const setting = await HolidayMoveSetting.findByIdAndDelete(req.params.id);
    if (!setting) return res.status(404).json(NOT_FOUND_BODY);
    res.json({ success: true });
  } catch (err) {
    sendMoveError(res, err);
  }
}
