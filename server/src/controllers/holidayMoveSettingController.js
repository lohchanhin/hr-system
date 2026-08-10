import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import Holiday from '../models/Holiday.js';

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

async function assertSourceHoliday(setting) {
  if (!setting.sourceDate) return;
  const exists = await Holiday.exists({ date: setting.sourceDate });
  if (!exists) throw new Error('sourceDate must reference an existing national holiday');
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
