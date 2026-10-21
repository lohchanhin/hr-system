import {
  calendarStatusFromContext,
  getCalendarStatus,
  listCalendarHeaders,
  loadHolidayContext,
} from '../services/holidayResolver.js';

// 唯讀的行事曆檢視（排班頁標頭、請假單提醒），已登入的員工、主管、管理員都可以讀。
// 資料只來自公司行事曆（資料庫），不會連線政府資料。

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// 查詢期間最多 3 年（含閏年）
const MAX_STATUS_SPAN_DAYS = 3 * 365 + 1;

function validDateKey(value) {
  const text = String(value ?? '').trim();
  if (!DATE_PATTERN.test(text)) return '';
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}

/** 排班頁標頭上方的年度提醒文字（已核定的年度不提醒） */
export function buildCalendarStatusMessage({ year, state, migrated, synthetic }) {
  if (state === 'approved') return '';
  if (state === 'none') {
    return synthetic
      ? `尚未建立 ${year} 年公司行事曆，目前只標示固定日期的國定假日（農曆節日未列入）`
      : `尚未建立 ${year} 年公司行事曆`;
  }
  if (migrated) return `${year} 年公司行事曆由舊版資料轉換、尚未核定，國定假日標示僅供參考`;
  return `${year} 年公司行事曆尚未核定，國定假日標示僅供參考`;
}

// GET /api/holiday-calendar/headers?month=YYYY-MM
export async function getHolidayCalendarHeaders(req, res) {
  const month = String(req.query?.month ?? '').trim();
  const match = MONTH_PATTERN.exec(month);
  if (!match) return res.status(400).json({ error: '需要提供有效月份 (YYYY-MM)', code: 'INVALID_MONTH' });
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  try {
    const context = await loadHolidayContext({ start, end });
    const entries = listCalendarHeaders(context, { start, end });
    const yearStatus = calendarStatusFromContext(context, { from: start, to: start }).years[0];
    return res.json({
      month,
      entries,
      status: {
        year,
        state: yearStatus.state,
        migrated: yearStatus.migrated,
        provisional: yearStatus.state !== 'approved',
        synthetic: yearStatus.synthetic,
        message: buildCalendarStatusMessage(yearStatus),
      },
    });
  } catch (error) {
    console.error('Failed to load holiday calendar headers', error?.name ?? 'Error');
    return res.status(500).json({ error: '無法讀取公司行事曆', code: 'CALENDAR_UNAVAILABLE' });
  }
}

// GET /api/holiday-calendar/status?from=YYYY-MM-DD&to=YYYY-MM-DD（to 預設為 from，期間最多 3 年）
export async function getHolidayCalendarStatus(req, res) {
  const from = validDateKey(req.query?.from);
  const rawTo = String(req.query?.to ?? '').trim();
  const to = rawTo ? validDateKey(rawTo) : from;
  if (!from || !to) return res.status(400).json({ error: '需要提供有效日期 (YYYY-MM-DD)', code: 'INVALID_DATE' });
  if (to < from) return res.status(400).json({ error: '結束日期不可早於開始日期', code: 'INVALID_RANGE' });
  const spanDays = Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY);
  if (spanDays > MAX_STATUS_SPAN_DAYS) {
    return res.status(400).json({ error: '查詢期間最多 3 年', code: 'RANGE_TOO_LONG' });
  }
  try {
    return res.json(await getCalendarStatus({ from, to }));
  } catch (error) {
    console.error('Failed to load holiday calendar status', error?.name ?? 'Error');
    return res.status(500).json({ error: '無法讀取公司行事曆', code: 'CALENDAR_UNAVAILABLE' });
  }
}
