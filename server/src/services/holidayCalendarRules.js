/**
 * 公司行事曆的共用規則（純函式，不碰資料庫）。
 *
 * 行事曆（Holiday 集合）每一筆都有明確的類型 kind，不再從名稱或類型文字猜：
 *   statutory           勞基法第 37 條國定假日，全體員工適用（含落在週末的日子）
 *   gov_makeup_off      公務機關補假日：調休存摺上線後只是「行政」制度員工的建議調休日（上線前照舊自動放假）；輪班人員僅供參考
 *   gov_bridge_off      公務機關調整放假：不是國定假日；啟用「依政府調整放假」時才是行政人員的休息日
 *   gov_makeup_workday  公務機關補行上班：啟用「依政府調整放假」時才是行政人員的上班日
 *   company_off         公司自訂休息日（不是國定假日）
 *   company_workday     公司自訂上班日
 *   designated          選舉、罷免、公投等指定應放假日：只適用當天原應出勤的員工，不補假、不可調移
 * 舊資料（還沒有 kind）由 legacyKindOf 判斷，啟動時的資料轉換會把結果寫回去。
 */

export const HOLIDAY_KINDS = [
  'statutory',
  'gov_makeup_off',
  'gov_bridge_off',
  'gov_makeup_workday',
  'company_off',
  'company_workday',
  'designated',
];

export const HOLIDAY_KIND_LABELS = {
  statutory: '國定假日',
  gov_makeup_off: '公務機關補假',
  gov_bridge_off: '公務機關調整放假',
  gov_makeup_workday: '公務機關補行上班',
  company_off: '公司休息日',
  company_workday: '公司上班日',
  designated: '指定應放假日',
};

// 寫入 Holiday.type 的舊版顯示字串（舊畫面、舊匯出還在讀 type）
const LEGACY_TYPE_LABELS = {
  statutory: '國定假日',
  gov_makeup_off: '公務機關補假',
  gov_bridge_off: '公務機關調整放假',
  gov_makeup_workday: '補班日',
  company_off: '公司休息日',
  company_workday: '公司上班日',
  designated: '指定應放假日',
};

export function holidayTypeLabelOf(kind) {
  return LEGACY_TYPE_LABELS[kind] || '';
}

export const HOLIDAY_DISPLAY_KINDS = ['holiday', 'designated', 'gov_info', 'company_off', 'company_workday', 'moved_away'];

const DISPLAY_KIND_BY_KIND = {
  statutory: 'holiday',
  designated: 'designated',
  gov_makeup_off: 'gov_info',
  gov_bridge_off: 'gov_info',
  gov_makeup_workday: 'gov_info',
  company_off: 'company_off',
  company_workday: 'company_workday',
};

export function displayKindOf(kind) {
  return DISPLAY_KIND_BY_KIND[kind] || null;
}

// 假日制度：輪班（依班表個別補假）或行政（週一至週五，依政府補假日）
export const HOLIDAY_REGIMES = ['roster', 'office'];
export const HOLIDAY_REGIME_LABELS = { roster: '輪班', office: '行政' };

/** 員工實際適用的假日制度：有設定就用設定；沒設定時不需要排班＝行政，其餘＝輪班 */
export function resolveHolidayRegime(employee) {
  const value = employee?.holidayRegime;
  if (value === 'roster' || value === 'office') return value;
  return employee?.requiresScheduling === false ? 'office' : 'roster';
}

const REGIME_TEXT = new Map([
  ['輪班', 'roster'],
  ['輪班人員', 'roster'],
  ['roster', 'roster'],
  ['行政', 'office'],
  ['行政人員', 'office'],
  ['office', 'office'],
]);

/**
 * 匯入、表單送來的假日制度文字：輪班 -> 'roster'、行政 -> 'office'；
 * 空白或 null -> null（清除設定，回到預設）；其他文字 -> undefined（不合法）。
 */
export function parseHolidayRegime(text) {
  if (text === null || text === undefined) return null;
  const normalized = String(text).replace(/[\s　]/g, '');
  if (!normalized) return null;
  const mapped = REGIME_TEXT.get(normalized) ?? REGIME_TEXT.get(normalized.toLowerCase());
  return mapped ?? undefined;
}

export const CALENDAR_YEAR_STATES = ['none', 'draft', 'approved'];

// 紀念日及節日實施條例 施行日：小年夜、教師節、光復節、行憲紀念日從這天起才是國定假日
export const STATUTE_CUTOVER_DATE = '2025-05-28';

/**
 * 政府辦公日曆表「備註」裡的法定假日名稱對照（依序比對，比對前去掉半形與全形空白）。
 * 每列：[名稱規則, statutoryKey, 標準名稱, 生效日（null = 一直都是）]
 * children_tomb_combined（兒童節及民族掃墓節同一天）只是比對用的中間結果，由分類程式拆成兩天。
 */
export const STATUTORY_NAME_TABLE = [
  [/^(中華民國)?開國紀念日$/, 'new_year', '開國紀念日', null],
  [/^(農曆)?除夕$/, 'lunar_new_year_eve', '農曆除夕', null],
  [/^春節$/, 'spring_festival', '春節', null],
  [/^小年夜$/, 'lunar_eve_eve', '小年夜', STATUTE_CUTOVER_DATE],
  [/^和平紀念日$/, 'peace_memorial', '和平紀念日', null],
  [/^兒童節$/, 'children', '兒童節', null],
  [/^(民族掃墓節|清明節)$/, 'tomb_sweeping', '民族掃墓節', null],
  [/^兒童節及民族掃墓節$/, 'children_tomb_combined', '兒童節及民族掃墓節', null],
  [/^勞動節$/, 'labor', '勞動節', null],
  [/^端午節$/, 'dragon_boat', '端午節', null],
  [/^中秋節$/, 'mid_autumn', '中秋節', null],
  [/^(孔子誕辰紀念日(\/教師節)?|教師節)$/, 'teachers', '孔子誕辰紀念日/教師節', STATUTE_CUTOVER_DATE],
  [/^國慶日$/, 'national_day', '國慶日', null],
  [/^([臺台]灣光復暨金門古寧頭大捷紀念日|光復節)$/, 'retrocession', '臺灣光復暨金門古寧頭大捷紀念日', STATUTE_CUTOVER_DATE],
  [/^行憲紀念日$/, 'constitution', '行憲紀念日', STATUTE_CUTOVER_DATE],
];

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value) {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value);
}

function compactText(value) {
  return String(value ?? '').replace(/[\s　]/g, '');
}

/**
 * 備註文字是不是法定假日名稱。
 * 回傳 { key, name }；名稱對得上但那天條例還沒施行時多帶 notYetStatutory: true；對不上回傳 null。
 * 沒有日期時不判斷生效日（視為有效）。
 */
export function lookupStatutoryName(remark, dateKey) {
  const text = compactText(remark);
  if (!text) return null;
  for (const [pattern, key, name, effectiveFrom] of STATUTORY_NAME_TABLE) {
    if (!pattern.test(text)) continue;
    if (effectiveFrom && isDateKey(dateKey) && dateKey < effectiveFrom) {
      return { key, name, notYetStatutory: true };
    }
    return { key, name };
  }
  return null;
}

// 固定日期的國定假日（農曆與節氣假日不在這裡）：[MM-DD, statutoryKey, 名稱, 生效日]
export const FIXED_STATUTORY_DAYS = [
  ['01-01', 'new_year', '開國紀念日', null],
  ['02-28', 'peace_memorial', '和平紀念日', null],
  ['05-01', 'labor', '勞動節', null],
  ['09-28', 'teachers', '孔子誕辰紀念日/教師節', STATUTE_CUTOVER_DATE],
  ['10-10', 'national_day', '國慶日', null],
  ['10-25', 'retrocession', '臺灣光復暨金門古寧頭大捷紀念日', STATUTE_CUTOVER_DATE],
  ['12-25', 'constitution', '行憲紀念日', STATUTE_CUTOVER_DATE],
];

/** 某年度固定日期的國定假日（只列當天已生效的）：[{ date, key, name }] */
export function fixedStatutoryDaysForYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y)) return [];
  const prefix = String(y).padStart(4, '0');
  return FIXED_STATUTORY_DAYS
    .map(([monthDay, key, name, effectiveFrom]) => ({ date: `${prefix}-${monthDay}`, key, name, effectiveFrom }))
    .filter((entry) => !entry.effectiveFrom || entry.date >= entry.effectiveFrom)
    .map(({ date, key, name }) => ({ date, key, name }));
}

function rowDateKey(row) {
  const value = row?.date;
  if (value === null || value === undefined || value === '') return '';
  if (isDateKey(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** 週幾（0=週日…6=週六），以日期鍵在 UTC 計算；不合法回傳 null */
export function weekdayOfKey(dateKey) {
  if (!isDateKey(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCDay();
}

export function isWeekendKey(dateKey) {
  const weekday = weekdayOfKey(dateKey);
  return weekday === 0 || weekday === 6;
}

const COMPANY_OFF_TYPES = new Set(['例假日', '公司休息日']);
const WORKDAY_TEXT = /工作日|補班|補行上班|調整上班|makeup\s*work/i;
const GOV_WORKDAY_TEXT = /補行上班|調整上班/;
const HOLIDAY_TEXT = /國定|假日|holiday/i;
const BRIDGE_NAMES = new Set(['調整放假', '放假']);

/**
 * 舊資料（還沒有 kind）單筆判斷類型，不看同年度其他資料：
 *  1) 已有合法 kind 直接用；
 *  2) 類型是「例假日」「公司休息日」-> company_off；
 *  3) 文字含工作日／補班／補行上班／調整上班 -> 週末且（來自舊版匯入或寫明補行上班）為 gov_makeup_workday，否則 company_workday；
 *  4) 名稱是法定假日（已生效）-> statutory；
 *  5) 名稱是「補假」-> gov_makeup_off；
 *  6) 名稱是「調整放假」「放假」或條例施行前的「小年夜」-> gov_bridge_off；
 *  7) 文字沒有國定／假日 -> company_off；
 *  8) 其餘 -> statutory（手動新增的不明名稱維持舊行為照算國定假日，資料轉換時會標記待確認）。
 */
export function legacyKindOf(row) {
  if (HOLIDAY_KINDS.includes(row?.kind)) return row.kind;
  const type = String(row?.type ?? '').trim();
  if (COMPANY_OFF_TYPES.has(type)) return 'company_off';

  const joined = [row?.type, row?.name, row?.description, row?.desc].filter(Boolean).join(' ');
  const dateKey = rowDateKey(row);
  if (WORKDAY_TEXT.test(joined)) {
    const fromGovernment = String(row?.source ?? '').trim() === 'roc-calendar' || GOV_WORKDAY_TEXT.test(joined);
    return isWeekendKey(dateKey) && fromGovernment ? 'gov_makeup_workday' : 'company_workday';
  }

  const nameText = String(row?.name || row?.description || row?.desc || '').trim();
  const hit = lookupStatutoryName(nameText, dateKey);
  if (hit && !hit.notYetStatutory) return 'statutory';
  if (nameText === '補假') return 'gov_makeup_off';
  if (BRIDGE_NAMES.has(nameText) || (hit?.notYetStatutory && hit.key === 'lunar_eve_eve')) return 'gov_bridge_off';
  if (!HOLIDAY_TEXT.test(joined)) return 'company_off';
  return 'statutory';
}

export function effectiveHolidayKind(row) {
  return HOLIDAY_KINDS.includes(row?.kind) ? row.kind : legacyKindOf(row);
}
