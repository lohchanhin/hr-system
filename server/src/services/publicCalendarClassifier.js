/**
 * 政府辦公日曆表（公務人員行事曆）-> 勞基法公司行事曆的分類（純函式，不碰資料庫、不連網路）。
 *
 * 政府資料的「備註」用字每年不同，不能當成類型看；這裡依（星期、是否放假）加上法定假日名稱對照表分類：
 *   statutory           備註是法定假日名稱的日子（含落在週末的）；2025 年以前政府資料沒有的勞動節由系統補上
 *   gov_makeup_workday  週末卻要上班（補行上班／調整上班）
 *   gov_makeup_off      平日放假、補的是落在週末的國定假日（週六補前一個上班日、週日補後一個上班日，春節前後皆可）
 *   gov_bridge_off      平日放假但不是補假（調整放假、條例施行前的小年夜）
 * 每個補假都會連到它補的那一天（可能跨月、跨年，例如 2027-12-31 補 2028-01-01）。
 */
import {
  fixedStatutoryDaysForYear,
  lookupStatutoryName,
  weekdayOfKey,
} from './holidayCalendarRules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SPRING_KEYS = new Set(['lunar_eve_eve', 'lunar_new_year_eve', 'spring_festival']);
// 只是調整放假（不是補假）的備註：即使日期剛好在補假的位置也不當補假
const BRIDGE_LABELS = new Set(['調整放假', '小年夜']);
// 調整放假常見的備註；其他備註的平日放假需要人工確認
const KNOWN_BRIDGE_REMARKS = new Set(['調整放假', '放假', '小年夜']);

function shiftKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function isWeekendDay(weekday) {
  return weekday === 0 || weekday === 6;
}

function makeEntry(date, kind, fields = {}) {
  return {
    date,
    kind,
    name: fields.name ?? '',
    statutoryKey: fields.statutoryKey ?? '',
    compensatesDate: fields.compensatesDate ?? null,
    compensatesName: fields.compensatesName ?? '',
    linkMethod: fields.linkMethod ?? null,
    synthetic: Boolean(fields.synthetic),
    derived: fields.derived ?? '',
    needsReview: Boolean(fields.needsReview),
    remark: fields.remark ?? '',
  };
}

/**
 * 分類一整年的政府資料。rows = [{ date: 'YYYY-MM-DD', weekday: 0-6, isOff: boolean, remark }]（365/366 筆，已驗證）。
 * 回傳 { entries（依日期排序）, warnings, counts }。
 */
export function classifyPublicCalendarYear(year, rows = []) {
  const y = Number(year);
  const warnings = [];
  const rowByDate = new Map();
  for (const row of rows || []) {
    if (!row?.date) continue;
    rowByDate.set(row.date, {
      date: row.date,
      weekday: Number.isInteger(row.weekday) ? row.weekday : weekdayOfKey(row.date),
      isOff: Boolean(row.isOff),
      remark: String(row.remark ?? '').trim(),
    });
  }
  const sortedRows = [...rowByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const entries = new Map();

  // 1. 備註是法定假日名稱的日子（不論是否放假）
  for (const row of sortedRows) {
    if (!row.remark) continue;
    const hit = lookupStatutoryName(row.remark, row.date);
    if (!hit || hit.notYetStatutory) continue;
    if (hit.key === 'children_tomb_combined') {
      // 兒童節與民族掃墓節同一天：當天算民族掃墓節，兒童節放前一天（前一天是週四時放後一天）
      entries.set(row.date, makeEntry(row.date, 'statutory', {
        name: '民族掃墓節', statutoryKey: 'tomb_sweeping', remark: row.remark,
      }));
      const childDate = shiftKey(row.date, row.weekday === 4 ? 1 : -1);
      entries.set(childDate, makeEntry(childDate, 'statutory', {
        name: '兒童節', statutoryKey: 'children', derived: 'children_tomb_rule',
        remark: rowByDate.get(childDate)?.remark ?? '',
      }));
      continue;
    }
    if (entries.has(row.date)) continue;
    entries.set(row.date, makeEntry(row.date, 'statutory', {
      name: row.remark, statutoryKey: hit.key, remark: row.remark,
    }));
  }

  // 2. 勞動節：2025 年以前政府（公務人員）資料沒有，勞基法一直都有
  if (![...entries.values()].some((entry) => entry.statutoryKey === 'labor')) {
    const laborDate = `${String(y).padStart(4, '0')}-05-01`;
    entries.set(laborDate, makeEntry(laborDate, 'statutory', {
      name: '勞動節', statutoryKey: 'labor', synthetic: true, remark: rowByDate.get(laborDate)?.remark ?? '',
    }));
    if (y >= 2026) warnings.push('政府資料缺少勞動節，已依勞基法補上');
  }

  // 3. 週末要上班的日子（2017–2020 寫「調整上班」、2021 起寫「補行上班」，備註不影響判斷）
  for (const row of sortedRows) {
    if (!isWeekendDay(row.weekday) || row.isOff || entries.has(row.date)) continue;
    entries.set(row.date, makeEntry(row.date, 'gov_makeup_workday', {
      name: row.remark || '補行上班', remark: row.remark,
    }));
  }

  // 4. 候選：平日放假、還沒有分類的日子
  const candidates = sortedRows.filter((row) => !isWeekendDay(row.weekday) && row.isOff && !entries.has(row.date));
  const candidateSet = new Set(candidates.map((row) => row.date));
  const makeupWorkdays = new Set(
    [...entries.values()].filter((entry) => entry.kind === 'gov_makeup_workday').map((entry) => entry.date),
  );

  // 5. 連結範圍：本年度的國定假日，加上前後年度的固定日期國定假日（只用來找跨年度的補假）
  const statutory = new Map(
    [...entries.values()].filter((entry) => entry.kind === 'statutory').map((entry) => [entry.date, entry.name]),
  );
  const neighbours = new Map(
    [...fixedStatutoryDaysForYear(y - 1), ...fixedStatutoryDaysForYear(y + 1)].map((entry) => [entry.date, entry.name]),
  );
  const holidayName = (dateKey) => statutory.get(dateKey) ?? neighbours.get(dateKey) ?? '';
  const isLinkHoliday = (dateKey) => statutory.has(dateKey) || neighbours.has(dateKey);
  const isLinkOff = (dateKey) => (
    isLinkHoliday(dateKey) || (isWeekendDay(weekdayOfKey(dateKey)) && !makeupWorkdays.has(dateKey))
  );
  const stepWorkday = (dateKey, direction) => {
    let cursor = shiftKey(dateKey, direction);
    for (let guard = 0; guard < 60 && isLinkOff(cursor); guard += 1) cursor = shiftKey(cursor, direction);
    return cursor;
  };
  const remarkOf = (dateKey) => rowByDate.get(dateKey)?.remark ?? '';

  // 6. 每個補假日預期補的是哪一天
  const expected = new Map();
  // (a) 春節連假：落在週末的除夕／春節（含小年夜）依序配對連假之後、再來是之前的平日放假
  const springBlock = [...entries.values()]
    .filter((entry) => entry.kind === 'statutory' && SPRING_KEYS.has(entry.statutoryKey))
    .map((entry) => entry.date)
    .sort();
  const paired = new Set();
  if (springBlock.length) {
    const weekendSpring = springBlock.filter((dateKey) => isWeekendDay(weekdayOfKey(dateKey)));
    const collectRun = (startKey, direction) => {
      const run = [];
      let cursor = startKey;
      for (let guard = 0; guard < 30; guard += 1) {
        const weekday = weekdayOfKey(cursor);
        if (isWeekendDay(weekday) && !makeupWorkdays.has(cursor)) {
          cursor = shiftKey(cursor, direction);
          continue;
        }
        if (!candidateSet.has(cursor)) break;
        run.push(cursor);
        cursor = shiftKey(cursor, direction);
      }
      return run;
    };
    const afterRun = collectRun(shiftKey(springBlock[springBlock.length - 1], 1), 1);
    const beforeRun = collectRun(shiftKey(springBlock[0], -1), -1);
    const pool = [...afterRun, ...beforeRun].filter((dateKey) => !BRIDGE_LABELS.has(remarkOf(dateKey)));
    weekendSpring.forEach((holidayDate, index) => {
      if (index >= pool.length) return;
      expected.set(pool[index], holidayDate);
      paired.add(holidayDate);
    });
  }
  // (b) 其他落在週末的國定假日（含前後年度的固定日期假日）：週六補前一個上班日、週日補後一個上班日
  const weekendHolidays = [...new Set([...statutory.keys(), ...neighbours.keys()])]
    .filter((dateKey) => isWeekendDay(weekdayOfKey(dateKey)) && !paired.has(dateKey))
    .sort();
  for (const holidayDate of weekendHolidays) {
    const direction = weekdayOfKey(holidayDate) === 6 ? -1 : 1;
    let target = stepWorkday(holidayDate, direction);
    for (let guard = 0; guard < 30 && expected.has(target); guard += 1) target = stepWorkday(target, direction);
    expected.set(target, holidayDate);
  }

  // 7. 平日放假的候選：補假（連到補的那一天）或調整放假
  const linkedTargets = new Set();
  for (const row of candidates) {
    if (expected.has(row.date) && !BRIDGE_LABELS.has(row.remark)) {
      const compensatesDate = expected.get(row.date);
      linkedTargets.add(compensatesDate);
      entries.set(row.date, makeEntry(row.date, 'gov_makeup_off', {
        name: row.remark || '補假',
        compensatesDate,
        compensatesName: holidayName(compensatesDate),
        linkMethod: 'rule',
        remark: row.remark,
      }));
    }
  }
  for (const row of candidates) {
    if (entries.has(row.date)) continue;
    if (row.remark.includes('補假')) {
      // 依規則找不到：連到 ±7 天內最近、還沒被連過的週末國定假日，並標記待確認
      const nearest = [...statutory.keys(), ...neighbours.keys()]
        .filter((dateKey) => isWeekendDay(weekdayOfKey(dateKey)) && !linkedTargets.has(dateKey))
        .map((dateKey) => ({
          dateKey,
          distance: Math.abs(new Date(`${dateKey}T00:00:00.000Z`) - new Date(`${row.date}T00:00:00.000Z`)) / DAY_MS,
        }))
        .filter((item) => item.distance <= 7)
        .sort((a, b) => a.distance - b.distance || a.dateKey.localeCompare(b.dateKey))[0];
      if (nearest) {
        linkedTargets.add(nearest.dateKey);
        entries.set(row.date, makeEntry(row.date, 'gov_makeup_off', {
          name: row.remark,
          compensatesDate: nearest.dateKey,
          compensatesName: holidayName(nearest.dateKey),
          linkMethod: 'nearest',
          needsReview: true,
          remark: row.remark,
        }));
        warnings.push(`補假 ${row.date} 依最近的週末國定假日（${nearest.dateKey}）對應，請確認`);
      } else {
        entries.set(row.date, makeEntry(row.date, 'gov_makeup_off', {
          name: row.remark,
          linkMethod: 'none',
          needsReview: true,
          remark: row.remark,
        }));
        warnings.push(`補假 ${row.date} 找不到對應的國定假日`);
      }
      continue;
    }
    const needsReview = !KNOWN_BRIDGE_REMARKS.has(row.remark);
    entries.set(row.date, makeEntry(row.date, 'gov_bridge_off', {
      name: row.remark || '調整放假',
      needsReview,
      remark: row.remark,
    }));
    if (needsReview) warnings.push(`平日放假 ${row.date}（${row.remark || '無備註'}）不是補假，已當成調整放假，請確認`);
  }

  // 8. 週末放假但備註不是法定假日名稱：不使用，只提醒
  for (const row of sortedRows) {
    if (!isWeekendDay(row.weekday) || !row.isOff || !row.remark || entries.has(row.date)) continue;
    warnings.push(`週末備註未使用：${row.date} ${row.remark}`);
  }

  const sorted = [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
  const counts = { statutory: 0, gov_makeup_off: 0, gov_bridge_off: 0, gov_makeup_workday: 0 };
  for (const entry of sorted) counts[entry.kind] = (counts[entry.kind] || 0) + 1;
  return { entries: sorted, warnings, counts };
}
