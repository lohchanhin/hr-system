import Holiday from '../models/Holiday.js';

function normalizeHolidayPayload(payload = {}) {
  const dateValue = payload.date ? new Date(payload.date) : null;
  const desc = payload.desc ?? payload.description ?? payload.name ?? payload.remark ?? '';
  const name = payload.name ?? desc ?? payload.type ?? '假日';

  return {
    name,
    date: dateValue,
    type: payload.type ?? payload.holidayCategory ?? '國定假日',
    desc,
    description: payload.description ?? desc,
    source: payload.source,
  };
}

export async function listHolidays(_req, res) {
  try {
    const holidays = await Holiday.find().sort({ date: 1 });
    res.json(holidays);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createHoliday(req, res) {
  try {
    const payload = normalizeHolidayPayload(req.body);
    if (!payload.date || Number.isNaN(payload.date.getTime())) {
      return res.status(400).json({ error: 'Invalid or missing date' });
    }
    const holiday = await Holiday.create(payload);
    res.status(201).json(holiday);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateHoliday(req, res) {
  try {
    const payload = normalizeHolidayPayload(req.body);
    const holiday = await Holiday.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true },
    );
    if (!holiday) return res.status(404).json({ error: 'Not found' });
    res.json(holiday);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteHoliday(req, res) {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

const ROC_CALENDAR_BASE =
  'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data';

export async function importRocHolidays(req, res) {
  const year = Number.parseInt(req.query.year, 10) || new Date().getFullYear();
  const url = `${ROC_CALENDAR_BASE}/${year}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ROC holidays: ${response.status}`);
    }
    const data = await response.json();
    const holidays = data
      .filter((item) => item?.isHoliday === 'Y' && item.date)
      .map((item) =>
        normalizeHolidayPayload({
          ...item,
          date: item.date,
          type: item.holidayCategory ?? '國定假日',
          source: 'roc-calendar',
        }),
      );

    const saved = [];
    for (const holiday of holidays) {
      const updated = await Holiday.findOneAndUpdate(
        { date: holiday.date },
        holiday,
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (updated) saved.push(updated);
    }

    res.json({ imported: saved.length, holidays: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
