// 請假時間的共用計算（純函式）：請假檢核（時間順序、重複申請）、薪資扣款、部門報表都用這一份，數字才會一致。
// 日期一律以台灣時間判斷：前端日期選擇器送出的是 UTC ISO 字串（台灣 6/19 00:00 = 2026-06-18T16:00:00.000Z），
// 直接取 UTC 日期會少一天，所以這裡全部經過 taipeiTime。
import { TAIPEI_OFFSET_MS, dateKeyToUtcMidnight, toTaipeiDateKey, toTaipeiParts } from './taipeiTime.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// 一筆假單最多展開的天數（防呆，避免異常的日期範圍把迴圈撐爆）
const MAX_LEAVE_DAYS = 3700;
const DATE_ONLY_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 某個台灣日期鍵當天 00:00（台灣時間）的時間點（毫秒）。 */
export function taipeiMidnightMs(dateKey) {
  const midnight = dateKeyToUtcMidnight(dateKey);
  return midnight ? midnight.getTime() - TAIPEI_OFFSET_MS : null;
}

function addDaysToKey(dateKey, days) {
  const midnight = dateKeyToUtcMidnight(dateKey);
  return new Date(midnight.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// 解析成「時間點 + 是否剛好是台灣當天 00:00」；純日期字串視為當天 00:00
function toInstantInfo(value) {
  const dateKey = toTaipeiDateKey(value);
  if (!dateKey) return null;
  const midnightMs = taipeiMidnightMs(dateKey);
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return { dateKey, ms: midnightMs, atMidnight: true };
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return { dateKey, ms, atMidnight: ms === midnightMs };
}

/**
 * 把開始、結束兩個欄位值整理成一段請假區間，無法判讀時回傳 null。
 * - 整天（allDay）：欄位是 date 型別，或開始與結束都剛好在台灣 00:00（日期選擇器的午夜）。
 *   含頭尾整天計算，區間為 [開始日 00:00, 結束日隔天 00:00)。
 * - 有時分（datetime）：區間就是開始到結束的時間點。
 * reversed 代表結束早於開始（有時分的區間結束等於開始也算，長度為 0 的請假沒有意義）。
 */
export function parseLeaveInterval(startValue, endValue, { startType, endType } = {}) {
  const start = toInstantInfo(startValue);
  const end = toInstantInfo(endValue);
  if (!start || !end) return null;

  const typedAsDate = startType === 'date' && endType === 'date';
  const allDay = typedAsDate || (start.atMidnight && end.atMidnight);
  if (allDay) {
    return {
      allDay: true,
      reversed: end.dateKey < start.dateKey,
      startKey: start.dateKey,
      endKey: end.dateKey,
      lastKey: end.dateKey,
      startMs: taipeiMidnightMs(start.dateKey),
      endMs: taipeiMidnightMs(end.dateKey) + MS_PER_DAY,
    };
  }
  const lastKey = end.ms > start.ms ? toTaipeiDateKey(new Date(end.ms - 1)) : end.dateKey;
  return {
    allDay: false,
    reversed: end.ms <= start.ms,
    startKey: start.dateKey,
    endKey: end.dateKey,
    lastKey,
    startMs: start.ms,
    endMs: end.ms,
  };
}

/** 兩段請假區間是否重疊（任何一段無法判讀或順序顛倒都視為不重疊）。 */
export function leaveIntervalsOverlap(a, b) {
  if (!a || !b || a.reversed || b.reversed) return false;
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** 給錯誤訊息用的文字，例如「2026-10-05 09:00 ~ 2026-10-05 13:00」或「2026-10-05 ~ 2026-10-07」。 */
export function describeLeaveInterval(interval) {
  if (!interval) return '';
  if (interval.allDay) {
    return interval.startKey === interval.endKey ? interval.startKey : `${interval.startKey} ~ ${interval.endKey}`;
  }
  const label = (ms) => {
    const parts = toTaipeiParts(new Date(ms));
    return `${parts.dateKey} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  };
  return `${label(interval.startMs)} ~ ${label(interval.endMs)}`;
}

/**
 * 把一段請假區間拆到每個台灣日曆日：[{ dateKey, hours }]。
 * 整天每天算 hoursPerDay；有時分的區間每天取實際涵蓋的時數，單日最多 hoursPerDay
 * （例如 09:00-13:00 是 4 小時，09:00-18:00 含午休也只算 8 小時，跨日的整天算 8 小時）。
 */
export function splitLeaveByDay(interval, { hoursPerDay = 8 } = {}) {
  if (!interval || interval.reversed) return [];
  const result = [];
  let key = interval.startKey;
  for (let count = 0; count < MAX_LEAVE_DAYS && key <= interval.lastKey; count += 1) {
    if (interval.allDay) {
      result.push({ dateKey: key, hours: hoursPerDay });
    } else {
      const dayStart = taipeiMidnightMs(key);
      const covered = Math.min(interval.endMs, dayStart + MS_PER_DAY) - Math.max(interval.startMs, dayStart);
      if (covered > 0) result.push({ dateKey: key, hours: Math.min(round(covered / MS_PER_HOUR, 4), hoursPerDay) });
    }
    key = addDaysToKey(key, 1);
  }
  return result;
}

function positiveNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * 一張假單的請假時數與每日分布。優先順序：
 *   1. 表單的「天數」欄位（填了正數就以它為準，可以是 0.5 天）
 *   2. 舊資料裡直接存的 days / duration / hours 鍵
 *   3. 由開始、結束時間推算（台灣時間，整天或實際時數）
 * perDay 是這張假單落在每個台灣日曆日的時數（總和等於 hours），用來把跨月的假單拆到正確的月份；
 * 舊資料沒有日期時 perDay 是空陣列。
 */
export function computeLeaveDuration({
  startValue,
  endValue,
  startType,
  endType,
  filledDays,
  literalDays,
  literalHours,
  hoursPerDay = 8,
} = {}) {
  const interval = parseLeaveInterval(startValue, endValue, { startType, endType });
  const raw = interval && !interval.reversed ? splitLeaveByDay(interval, { hoursPerDay }) : [];
  const rawTotal = raw.reduce((sum, item) => sum + item.hours, 0);

  let source = 'none';
  let days = 0;
  let hours = 0;
  const filled = positiveNumber(filledDays);
  const legacyDays = positiveNumber(literalDays);
  const legacyHours = positiveNumber(literalHours);

  if (filled !== null) {
    source = 'days-field';
    days = filled;
    hours = filled * hoursPerDay;
  } else if (legacyDays !== null || legacyHours !== null) {
    source = 'legacy';
    days = legacyDays ?? 0;
    hours = legacyHours ?? days * hoursPerDay;
  } else if (rawTotal > 0) {
    source = 'dates';
    hours = rawTotal;
    days = hours / hoursPerDay;
  }

  let perDay = [];
  if (raw.length && hours > 0) {
    perDay = source === 'dates' || rawTotal === hours
      ? raw
      : raw.map((item) => ({
        dateKey: item.dateKey,
        hours: rawTotal > 0 ? (item.hours * hours) / rawTotal : hours / raw.length,
      }));
  }

  return {
    source,
    interval,
    startKey: interval?.startKey ?? '',
    endKey: interval?.endKey ?? '',
    days: round(days, 4),
    hours: round(hours, 4),
    perDay,
  };
}

/** perDay 落在 [startKey, endKeyExclusive) 這段台灣日期內的時數。 */
export function sumLeaveHoursInRange(perDay, startKey, endKeyExclusive) {
  return round((perDay || [])
    .filter((item) => item.dateKey >= startKey && item.dateKey < endKeyExclusive)
    .reduce((sum, item) => sum + item.hours, 0), 4);
}
