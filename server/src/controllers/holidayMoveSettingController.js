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
  if (!sourceKinds.has('statutory')) throw new MoveValidationError('sourceDate must reference a statutory holiday');
  if (targetKinds.has('statutory') || targetKinds.has('designated') || targetKinds.has('gov_makeup_off')) {
    throw new MoveValidationError('targetDate is already a holiday');
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
  return res.status(400).json({ error: err.message });
}

export async function listSettings(req, res) {
  try {
    const settings = await HolidayMoveSetting.find();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateSetting(req, res) {
  try {
    const setting = await HolidayMoveSetting.findById(req.params.id);
    if (!setting) return res.status(404).json({ error: 'Not found' });
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
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
