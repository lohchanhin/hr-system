/**
 * 啟動時的行事曆資料轉換（冪等、只記錄筆數；單機 MongoDB 沒有交易，每筆一個 updateOne）。
 *
 * 舊版「一鍵載入」把政府資料裡所有放假日都存成「國定假日」：2026 年 22 天，其中 6 天是公務機關補假；
 * 2025 年以前還有調整放假（含小年夜），而且沒有勞動節。這裡替每一筆還沒有 kind 的舊資料決定類型：
 *   1. 類型「例假日」「公司休息日」-> company_off
 *   2. 補班／工作日 -> 週末且來自政府資料為 gov_makeup_workday，否則 company_workday
 *   3. 其餘的放假日：把整年排成和政府檔案相同的格式，交給同一套分類程式（publicCalendarClassifier）判斷，
 *      國定假日、公務機關補假（連到補的那一天）、調整放假各歸各位
 * 分類前先把不是 UTC 午夜的舊日期換成台灣日期（UTC+8 主機上的舊版程式存成前一天 16:00Z）。
 * 來源是舊版匯入、類型卻被改過的資料是管理員在舊畫面的修改：標記 hrEdited 與待確認，重新匯入時預設保留。
 * 由舊版匯入的年度另外補上政府資料沒有的國定假日（2025 年以前的勞動節、落在週末的兒童節）。
 * 同一天同類型的重複資料只留最早的一筆，其餘封存（不刪除）。轉換過的年度建立「草稿（舊資料轉換）」並提醒人資核定。
 * 國定假日休假紀錄的處理方式（HolidayRestResolution）與公司挪移一律不動，只計算需要對帳的筆數。
 */
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import HolidayRestResolution from '../models/HolidayRestResolution.js';
import HolidayCompensation from '../models/HolidayCompensation.js';
import HolidaySwap from '../models/HolidaySwap.js';
import CalendarYear from '../models/CalendarYear.js';
import PublicCalendarSnapshot from '../models/PublicCalendarSnapshot.js';
import CalendarNotice from '../models/CalendarNotice.js';
import CalendarSourceState from '../models/CalendarSourceState.js';
import {
  FIXED_STATUTORY_DAYS,
  HOLIDAY_KINDS,
  isWeekendKey,
  legacyKindOf,
  lookupStatutoryName,
  weekdayOfKey,
} from './holidayCalendarRules.js';
import { classifyPublicCalendarYear } from './publicCalendarClassifier.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPANY_OFF_TYPES = new Set(['例假日', '公司休息日']);
const WORKDAY_TEXT = /工作日|補班|補行上班|調整上班|makeup\s*work/i;
const GOV_WORKDAY_TEXT = /補行上班|調整上班/;
const OFF_KINDS = new Set(['statutory', 'gov_makeup_off', 'gov_bridge_off']);
// 舊版一鍵載入一律存成「國定假日」；來源是 roc-calendar、類型卻不是國定假日的資料，只可能是管理員在舊畫面改過
const LEGACY_IMPORT_TYPE = '國定假日';
const MANUAL_REVIEW_NOTE = '手動新增、名稱不在法定假日清單，請確認類型';
const IMPORT_REVIEW_NOTE = '舊版匯入、名稱不在法定假日清單，已當成公務機關調整放假，請確認類型';
const LEGACY_EDIT_NOTE = '舊版畫面修改過，重新匯入預設保留，請確認類型';
const DUPLICATE_NOTE = '重複紀錄（轉換時封存）';

async function leanList(value) {
  const resolved = value && typeof value.lean === 'function' ? value.lean() : value;
  const result = await resolved;
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

function dateKeyOf(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function utcDate(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function nameOf(row) {
  return String(row?.name || row?.description || row?.desc || '').trim();
}

function joinedText(row) {
  return [row?.type, row?.name, row?.description, row?.desc].filter(Boolean).join(' ');
}

/** 不看同年度其他資料就能決定的類型（公司休息日、補班／工作日）；其餘回傳 null 交給整年分類 */
function directKindOf(row) {
  if (COMPANY_OFF_TYPES.has(String(row?.type ?? '').trim())) return 'company_off';
  const text = joinedText(row);
  if (WORKDAY_TEXT.test(text)) {
    const fromGovernment = String(row?.source ?? '').trim() === 'roc-calendar' || GOV_WORKDAY_TEXT.test(text);
    return isWeekendKey(dateKeyOf(row.date)) && fromGovernment ? 'gov_makeup_workday' : 'company_workday';
  }
  return null;
}

function compareIds(a, b) {
  return String(a._id).localeCompare(String(b._id));
}

/**
 * 管理員在舊畫面改過的舊版匯入資料：轉換後標記為人資修改，重新匯入時預設保留。
 * - 類型被改成「國定假日」以外的值（舊版一鍵載入一律存國定假日）。
 * - 固定日期的國定假日名稱出現在別的日期（例如國慶日在 10/12）：舊畫面改日期時類型、來源都不變，只能從這裡看出來。
 *   日期用台灣日期判斷，舊版存成前一天 16:00Z 的資料不會被誤判。
 */
function isLegacyAdminEdit(row) {
  if (String(row?.source ?? '').trim() !== 'roc-calendar') return false;
  const type = String(row?.type ?? '').trim();
  if (type !== '' && type !== LEGACY_IMPORT_TYPE) return true;
  const key = row?.date ? toTaipeiDateKey(new Date(row.date)) : '';
  const name = nameOf(row);
  if (!key || !name) return false;
  const monthDay = key.slice(5);
  return FIXED_STATUTORY_DAYS.some(([fixedDay, , fixedName]) => (
    fixedDay !== monthDay && (name === fixedName || name === fixedName.split('/')[0])
  ));
}

/**
 * 舊資料日期換成「台灣日期的 UTC 午夜」：2026 年 1～8 月的舊版程式在 UTC+8 主機上用 setHours(0) 存日期，
 * 存成前一天 16:00Z（例如 2026-01-01 變成 2025-12-31T16:00Z）。已是 UTC 午夜的日期不變；無法解析回傳 null。
 */
function taipeiMidnightOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const key = toTaipeiDateKey(date);
  return key ? utcDate(key) : null;
}

/** 把一年份的資料排成政府檔案的格式（每天：是否放假、備註），供分類程式使用 */
function buildSyntheticGrid(year, offRows, workdayWeekendKeys) {
  const remarkByDate = new Map();
  for (const row of [...offRows].sort(compareIds)) {
    const key = dateKeyOf(row.date);
    const name = nameOf(row);
    const current = remarkByDate.get(key);
    const hit = lookupStatutoryName(name, key);
    const isStatutoryName = Boolean(hit && !hit.notYetStatutory);
    if (current === undefined || (isStatutoryName && !current.isStatutoryName)) {
      remarkByDate.set(key, { remark: name, isStatutoryName });
    }
  }
  const rows = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  for (let time = start; time < end; time += DAY_MS) {
    const key = new Date(time).toISOString().slice(0, 10);
    const weekday = weekdayOfKey(key);
    const weekend = weekday === 0 || weekday === 6;
    const off = remarkByDate.has(key) || (weekend && !workdayWeekendKeys.has(key));
    rows.push({ date: key, weekday, isOff: weekend && workdayWeekendKeys.has(key) ? false : off, remark: remarkByDate.get(key)?.remark || '' });
  }
  return rows;
}

/** 有效（未封存）的國定假日／指定應放假日日期 */
async function loadActiveHolidayKinds(dateKeys) {
  const keys = [...new Set(dateKeys.filter(Boolean))];
  const kindsByDate = new Map();
  if (!keys.length) return kindsByDate;
  const rows = await leanList(Holiday.find({ date: { $in: keys.map(utcDate) }, archived: { $ne: true } }).select('date kind type name description desc source'));
  for (const row of rows) {
    const key = dateKeyOf(row.date);
    if (!kindsByDate.has(key)) kindsByDate.set(key, new Set());
    kindsByDate.get(key).add(HOLIDAY_KINDS.includes(row.kind) ? row.kind : legacyKindOf(row));
  }
  return kindsByDate;
}

/** 國定假日休假紀錄的處理方式中，那天已不是國定假日（或指定應放假日）的筆數（只計算，不修改） */
export async function countOrphanHolidayResolutions() {
  const resolutions = await leanList(HolidayRestResolution.find({}).select('_id holidayDate'));
  if (!resolutions.length) return 0;
  const kindsByDate = await loadActiveHolidayKinds(resolutions.map((row) => dateKeyOf(row.holidayDate)));
  return resolutions.filter((row) => {
    const kinds = kindsByDate.get(dateKeyOf(row.holidayDate));
    return !kinds || !(kinds.has('statutory') || kinds.has('designated'));
  }).length;
}

async function countOrphanMoves() {
  const moves = await leanList(HolidayMoveSetting.find({ enableHolidayMove: true }).select('_id sourceDate'));
  const dated = moves.filter((move) => dateKeyOf(move.sourceDate));
  if (!dated.length) return 0;
  const kindsByDate = await loadActiveHolidayKinds(dated.map((move) => dateKeyOf(move.sourceDate)));
  return dated.filter((move) => !kindsByDate.get(dateKeyOf(move.sourceDate))?.has('statutory')).length;
}

function emptyResult() {
  return {
    rows: 0,
    years: 0,
    statutory: 0,
    govMakeupOff: 0,
    govBridgeOff: 0,
    workdays: 0,
    companyOff: 0,
    added: 0,
    duplicates: 0,
    needsReview: 0,
    normalizedDates: 0,
    orphanResolutions: 0,
    orphanMoves: 0,
  };
}

/** 決定一個年度裡每筆舊資料的類型與連結；回傳 { plans: Map(id -> 欄位), additions: [新增的國定假日] } */
function planYear(year, yearRows, legacyRows) {
  const plans = new Map();
  const directRows = [];
  const classifyRows = [];
  for (const row of legacyRows) {
    const kind = directKindOf(row);
    if (kind) {
      directRows.push(row);
      plans.set(String(row._id), { kind });
    } else {
      classifyRows.push(row);
    }
  }

  // 已經有 kind 的資料（例如上次轉換中途停止）也一起當作整年的背景
  const kindedActive = yearRows.filter((row) => HOLIDAY_KINDS.includes(row.kind) && !row.archived);
  const offRows = [...classifyRows, ...kindedActive.filter((row) => OFF_KINDS.has(row.kind))];
  const workdayWeekendKeys = new Set([
    ...directRows.filter((row) => plans.get(String(row._id)).kind !== 'company_off').map((row) => dateKeyOf(row.date)),
    ...kindedActive.filter((row) => row.kind === 'gov_makeup_workday' || row.kind === 'company_workday').map((row) => dateKeyOf(row.date)),
  ].filter((key) => isWeekendKey(key)));

  const { entries } = classifyPublicCalendarYear(year, buildSyntheticGrid(year, offRows, workdayWeekendKeys));
  const entryByDate = new Map(entries.map((entry) => [entry.date, entry]));

  for (const row of classifyRows) {
    const key = dateKeyOf(row.date);
    const entry = entryByDate.get(key);
    const fromImport = String(row.source ?? '').trim() === 'roc-calendar';
    const unknownBridge = entry?.kind === 'gov_bridge_off' && entry.needsReview;
    if (!entry || unknownBridge || entry.kind === 'gov_makeup_workday') {
      // 分類程式認不出來（平日不明名稱、週末備註）：手動資料維持舊判斷，舊版匯入當成調整放假，都標記待確認
      plans.set(String(row._id), fromImport
        ? { kind: 'gov_bridge_off', needsReview: true, reviewNote: IMPORT_REVIEW_NOTE }
        : { kind: legacyKindOf(row), needsReview: true, reviewNote: MANUAL_REVIEW_NOTE });
      continue;
    }
    const plan = { kind: entry.kind };
    if (entry.kind === 'statutory') plan.statutoryKey = entry.statutoryKey || '';
    if (entry.kind === 'gov_makeup_off') {
      plan.compensatesDate = entry.compensatesDate ? utcDate(entry.compensatesDate) : null;
      plan.compensatesName = entry.compensatesName || '';
      plan.linkMethod = entry.linkMethod || 'none';
      if (entry.needsReview) {
        plan.needsReview = true;
        plan.reviewNote = entry.compensatesDate ? '補假對應的國定假日依最近日期推定，請確認' : '補假找不到對應的國定假日，請確認';
      }
    }
    plans.set(String(row._id), plan);
  }

  // 舊版匯入的年度：補上政府資料沒有的國定假日（同一天完全沒有資料時才補）
  const additions = [];
  if (yearRows.some((row) => String(row.source ?? '').trim() === 'roc-calendar')) {
    const datesWithRows = new Set(yearRows.map((row) => dateKeyOf(row.date)));
    for (const entry of entries) {
      if (entry.kind !== 'statutory' || datesWithRows.has(entry.date)) continue;
      additions.push(entry);
    }
  }
  return { plans, additions };
}

/**
 * 替還沒有 kind 的舊資料決定類型（第二次執行時找不到這種資料，直接回傳 0）。
 * 回傳各類型筆數、補上的國定假日、封存的重複資料、待確認筆數與需要對帳的筆數。
 */
export async function migrateHolidayCalendarKinds() {
  const legacy = await leanList(Holiday.find({ kind: { $exists: false } }));
  const result = emptyResult();
  if (!legacy.length) return result;

  // 先把不是 UTC 午夜的舊日期換成台灣日期（之後的分組、分類、重複檢查都用換過的日期）
  for (const row of legacy) {
    const normalized = taipeiMidnightOf(row.date);
    if (!normalized || normalized.getTime() === new Date(row.date).getTime()) continue;
    await Holiday.updateOne({ _id: row._id }, { $set: { date: normalized } });
    row.date = normalized;
    result.normalizedDates += 1;
  }

  const legacyByYear = new Map();
  for (const row of legacy) {
    const key = dateKeyOf(row.date);
    if (!key) continue;
    const year = Number(key.slice(0, 4));
    if (!legacyByYear.has(year)) legacyByYear.set(year, []);
    legacyByYear.get(year).push(row);
  }

  const touchedYears = [];
  for (const [year, legacyRows] of [...legacyByYear.entries()].sort((a, b) => a[0] - b[0])) {
    const yearRows = await leanList(Holiday.find({
      date: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) },
    }));
    const { plans, additions } = planYear(year, yearRows, legacyRows);

    // 同一天同類型只留最早的一筆：先封存其餘的，再把留下的設為有效（唯一索引可能已經建立）
    const groups = new Map();
    for (const row of legacyRows) {
      const plan = plans.get(String(row._id));
      if (!plan) continue;
      const groupKey = `${dateKeyOf(row.date)}|${plan.kind}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ row, plan, legacy: true });
    }
    for (const row of yearRows) {
      if (!HOLIDAY_KINDS.includes(row.kind) || row.archived) continue;
      const groupKey = `${dateKeyOf(row.date)}|${row.kind}`;
      if (groups.has(groupKey)) groups.get(groupKey).push({ row, plan: { kind: row.kind }, legacy: false });
    }

    const archives = [];
    const keepers = [];
    for (const members of groups.values()) {
      members.sort((a, b) => compareIds(a.row, b.row));
      const [keeper, ...others] = members;
      if (keeper.legacy) keepers.push(keeper);
      for (const other of others) archives.push(other);
    }

    for (const { row, plan } of archives) {
      await Holiday.updateOne(
        { _id: row._id },
        {
          $set: {
            kind: plan.kind,
            year,
            origin: row.origin || (String(row.source ?? '') === 'manual' ? 'manual' : 'migrated'),
            archived: true,
            hrEdited: false,
            reviewNote: DUPLICATE_NOTE,
          },
        },
      );
      result.duplicates += 1;
    }

    for (const { row, plan } of keepers) {
      const name = nameOf(row);
      const adminEdited = isLegacyAdminEdit(row);
      const set = {
        kind: plan.kind,
        year,
        origin: String(row.source ?? '') === 'manual' ? 'manual' : 'migrated',
        hrEdited: adminEdited,
        archived: false,
      };
      if (!String(row.description ?? '').trim() && name) set.description = name;
      if (!String(row.desc ?? '').trim() && name) set.desc = name;
      if (plan.statutoryKey !== undefined) set.statutoryKey = plan.statutoryKey;
      if (plan.compensatesDate !== undefined) set.compensatesDate = plan.compensatesDate;
      if (plan.compensatesName !== undefined) set.compensatesName = plan.compensatesName;
      if (plan.linkMethod) set.linkMethod = plan.linkMethod;
      if (plan.needsReview || adminEdited) {
        set.needsReview = true;
        set.reviewNote = [plan.needsReview ? plan.reviewNote : '', adminEdited ? LEGACY_EDIT_NOTE : '']
          .filter(Boolean)
          .join('；')
          .slice(0, 300);
        result.needsReview += 1;
      }
      await Holiday.updateOne({ _id: row._id }, { $set: set });
      if (plan.kind === 'statutory') result.statutory += 1;
      else if (plan.kind === 'gov_makeup_off') result.govMakeupOff += 1;
      else if (plan.kind === 'gov_bridge_off') result.govBridgeOff += 1;
      else if (plan.kind === 'gov_makeup_workday' || plan.kind === 'company_workday') result.workdays += 1;
      else if (plan.kind === 'company_off') result.companyOff += 1;
    }
    result.rows += archives.filter((item) => item.legacy).length + keepers.length;

    for (const entry of additions) {
      const date = utcDate(entry.date);
      const exists = await Holiday.exists({ date, kind: 'statutory', archived: { $ne: true } });
      if (exists) continue;
      try {
        await Holiday.create({
          date,
          kind: 'statutory',
          name: entry.name,
          description: entry.name,
          desc: entry.name,
          type: '國定假日',
          origin: 'rule',
          source: 'statutory-rule',
          statutoryKey: entry.statutoryKey,
          year,
          archived: false,
        });
        result.added += 1;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
    touchedYears.push(year);
  }

  // 轉換過的年度：建立「草稿（舊資料轉換）」，已有年度文件的不動；新建的年度提醒人資確認後核定
  for (const year of touchedYears) {
    if (year < 2017 || year > 2100) continue;
    const upsert = await CalendarYear.updateOne(
      { year },
      { $setOnInsert: { state: 'draft', migrated: true, 'source.kind': 'migrated' } },
      { upsert: true },
    );
    if (upsert?.upsertedCount || upsert?.upsertedId) {
      try {
        await CalendarNotice.updateOne(
          { dedupeKey: `migrated:${year}` },
          {
            $setOnInsert: {
              type: 'migrated_review',
              year,
              status: 'open',
              message: `${year} 年行事曆由舊版資料轉換，請確認假日分類後核定（可按「檢查政府資料」比對差異）`,
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
  }
  result.years = touchedYears.length;
  result.orphanResolutions = await countOrphanHolidayResolutions();
  result.orphanMoves = await countOrphanMoves();
  return result;
}

/** 行事曆相關集合的索引（在資料轉換之後執行；個別失敗不影響其他，只記錄錯誤名稱） */
export async function ensureHolidayCalendarIndexes() {
  const models = [
    ['Holiday', Holiday],
    ['CalendarYear', CalendarYear],
    ['PublicCalendarSnapshot', PublicCalendarSnapshot],
    ['CalendarNotice', CalendarNotice],
    ['CalendarSourceState', CalendarSourceState],
    ['HolidayCompensation', HolidayCompensation],
    ['HolidaySwap', HolidaySwap],
  ];
  const errors = [];
  for (const [name, model] of models) {
    try {
      await model.createIndexes();
    } catch (error) {
      errors.push(error?.name ?? 'Error');
      console.error(`Failed to ensure ${name} indexes`, error?.name ?? 'Error');
    }
  }
  return { errors };
}
