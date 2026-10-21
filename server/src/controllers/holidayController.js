import mongoose from 'mongoose';
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import {
  HOLIDAY_KINDS,
  displayKindOf,
  effectiveHolidayKind,
  holidayTypeLabelOf,
  legacyKindOf,
  lookupStatutoryName,
} from '../services/holidayCalendarRules.js';
import { importYearCompat, isImportManagedRow, markCalendarYearEdited } from '../services/companyCalendarService.js';
import { currentTaipeiYear } from '../services/publicCalendarSource.js';

// 舊版「一鍵載入」相容入口可接受的年份（實際能下載的範圍由 publicCalendarSource 再檢查）
const ROC_YEAR_MIN = 1900;
const ROC_YEAR_MAX = 2100;
const NAME_MAX_LENGTH = 100;
const NOTE_MAX_LENGTH = 500;
const DUPLICATE_DAY = { code: 'DUPLICATE_DAY', error: '這一天已有相同類型的行事曆紀錄' };

/**
 * 解析日期（YYYY-MM-DD、YYYY/MM/DD、YYYYMMDD 或 ISO 字串），一律存成該日的 UTC 午夜
 */
function parseDateInput(value) {
  if (value === null || value === undefined || value === '') return null;
  const dateStr = value.toString().trim();
  const dateOnlyMatch = dateStr.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      candidate.getUTCFullYear() === Number(year) &&
      candidate.getUTCMonth() === Number(month) - 1 &&
      candidate.getUTCDate() === Number(day)
    ) {
      return candidate;
    }
    return null;
  }
  const candidate = new Date(dateStr);
  if (Number.isNaN(candidate.getTime())) return null;
  return new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate()));
}

function utcDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function asPlainObject(value) {
  return typeof value?.toObject === 'function' ? value.toObject() : { ...value };
}

async function leanResult(value) {
  return value && typeof value.lean === 'function' ? value.lean() : value;
}

async function leanList(value) {
  const result = await leanResult(value);
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

async function leanOne(value) {
  return (await leanResult(value)) ?? null;
}

function actorIdOf(req) {
  return req.user?.id || req.user?.userId || null;
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

/** 回傳給前端的資料：補上實際類型與顯示分類（舊資料沒有 kind 時依舊規則判斷） */
function withDisplayKind(row) {
  const plain = asPlainObject(row);
  const kind = effectiveHolidayKind(plain);
  return { ...plain, kind, displayKind: displayKindOf(kind) };
}

// 只有管理員看得到的欄位：指定應放假日不適用的員工（沒有投票權＝個人資料）、人資備註與內部紀錄
const ADMIN_ONLY_FIELDS = ['excludedEmployees', 'note', 'reviewNote', 'updatedBy', 'publicSnapshot'];

function isAdminRequest(req) {
  return req.user?.role === 'admin';
}

/** 讀取清單（/api/holidays-public 開放給所有已登入使用者）：非管理員拿掉只有管理員看得到的欄位 */
function forReader(req, rows) {
  if (isAdminRequest(req)) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of ADMIN_ONLY_FIELDS) delete copy[field];
    return copy;
  });
}

function hasOwn(body, key) {
  return Object.prototype.hasOwnProperty.call(body ?? {}, key);
}

/**
 * 新增／修改行事曆的輸入：{ date, kind, name|desc|description, compensatesDate?, excludedEmployees?, note? }。
 * 沒帶 kind 的舊格式（{ type, ... }）依舊規則換算類型。回傳 { value } 或 { error: { code, error } }。
 */
function parseHolidayInput(body = {}, existing = null) {
  const fail = (code, error) => ({ error: { code, error } });

  const date = hasOwn(body, 'date') ? parseDateInput(body.date) : (existing ? new Date(existing.date) : null);
  if (!date || Number.isNaN(date.getTime())) return fail('INVALID_DATE', '無效的日期格式');

  const rawName = [body.name, body.description, body.desc].find((value) => String(value ?? '').trim() !== '');
  const name = rawName !== undefined
    ? String(rawName).trim()
    : String(existing?.name || existing?.description || existing?.desc || '').trim();
  if (!name) return fail('NAME_REQUIRED', '請填寫名稱');
  if (name.length > NAME_MAX_LENGTH) return fail('NAME_TOO_LONG', `名稱不可超過 ${NAME_MAX_LENGTH} 個字`);

  let kind;
  if (hasOwn(body, 'kind') && body.kind !== '' && body.kind !== null) {
    kind = String(body.kind);
    if (!HOLIDAY_KINDS.includes(kind)) return fail('INVALID_KIND', '行事曆類型不正確');
  } else if (existing && !hasOwn(body, 'type') && !hasOwn(body, 'holidayCategory')) {
    kind = effectiveHolidayKind(existing);
  } else {
    // 舊格式：沿用舊版的類型預設（有 isHoliday 才是國定假日），再換算成 kind
    const type = body.type || body.holidayCategory || (body.isHoliday ? '國定假日' : '工作日');
    kind = legacyKindOf({ type, name, description: name, desc: name, date, source: 'manual' });
  }

  let compensatesDate = null;
  const rawCompensates = hasOwn(body, 'compensatesDate') ? body.compensatesDate : (kind === 'gov_makeup_off' ? existing?.compensatesDate : null);
  if (rawCompensates !== null && rawCompensates !== undefined && rawCompensates !== '') {
    if (kind !== 'gov_makeup_off') return fail('COMPENSATES_NOT_ALLOWED', '只有公務機關補假可以設定補的是哪一天');
    compensatesDate = parseDateInput(rawCompensates);
    if (!compensatesDate) return fail('INVALID_DATE', '補假對應的日期格式不正確');
  }

  let excludedEmployees = [];
  const rawExcluded = hasOwn(body, 'excludedEmployees') ? body.excludedEmployees : (kind === 'designated' ? existing?.excludedEmployees : []);
  if (Array.isArray(rawExcluded) && rawExcluded.length) {
    if (kind !== 'designated') return fail('EXCLUSION_NOT_ALLOWED', '只有指定應放假日可以設定不適用的員工');
    const ids = [...new Set(rawExcluded.map((value) => String(value?._id ?? value)))];
    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id) || !/^[0-9a-f]{24}$/i.test(id))) {
      return fail('INVALID_EMPLOYEE', '不適用的員工資料不正確');
    }
    excludedEmployees = ids;
  } else if (rawExcluded !== undefined && rawExcluded !== null && !Array.isArray(rawExcluded)) {
    return fail('INVALID_EMPLOYEE', '不適用的員工資料不正確');
  }

  const note = hasOwn(body, 'note') ? String(body.note ?? '').trim() : String(existing?.note ?? '');
  if (note.length > NOTE_MAX_LENGTH) return fail('NOTE_TOO_LONG', `備註不可超過 ${NOTE_MAX_LENGTH} 個字`);

  const dateKey = utcDateKey(date);
  const hit = kind === 'statutory' ? lookupStatutoryName(name, dateKey) : null;
  return {
    value: {
      date,
      kind,
      name,
      description: name,
      desc: name,
      type: holidayTypeLabelOf(kind),
      statutoryKey: hit && !hit.notYetStatutory ? hit.key : (kind === 'statutory' ? (existing?.statutoryKey || '') : ''),
      compensatesDate,
      excludedEmployees,
      note,
      year: date.getUTCFullYear(),
    },
  };
}

/**
 * 人資把匯入（政府資料、系統規則、舊資料轉換）建立的日子改到別天時，在原日期留下一筆「已刪除」紀錄：
 * 重新匯入的差異會把原日期標成衝突、預設保留，不會把那一天自動加回來（否則同一個國定假日會放兩天）。
 */
async function leaveImportTombstone(existing, newDateKey, actorId) {
  const previousKey = utcDateKey(existing.date);
  const date = new Date(`${previousKey}T00:00:00.000Z`);
  const kind = effectiveHolidayKind(existing);
  const already = await Holiday.exists({ date, kind, archived: true, hrEdited: true });
  if (already) return;
  const name = String(existing.name || existing.description || existing.desc || '').trim() || holidayTypeLabelOf(kind);
  await Holiday.create({
    date,
    kind,
    name,
    description: name,
    desc: name,
    type: holidayTypeLabelOf(kind),
    statutoryKey: existing.statutoryKey || '',
    compensatesDate: existing.compensatesDate ?? null,
    compensatesName: existing.compensatesName || '',
    ...(existing.linkMethod ? { linkMethod: existing.linkMethod } : {}),
    origin: existing.origin || 'migrated',
    source: existing.source || '',
    publicSnapshot: existing.publicSnapshot ?? null,
    archived: true,
    hrEdited: true,
    reviewNote: `人資已把這一天改到 ${newDateKey}（重新匯入時預設不加回）`,
    updatedBy: actorId,
  });
}

/** 補假對應日的名稱：那天有效的國定假日名稱（找不到就留空） */
async function compensatesNameOf(compensatesDate) {
  if (!compensatesDate) return '';
  const rows = await leanList(Holiday.find({ date: compensatesDate, archived: { $ne: true } }));
  const statutory = rows.find((row) => effectiveHolidayKind(row) === 'statutory');
  return statutory ? String(statutory.name || statutory.description || statutory.desc || '').trim() : '';
}

/**
 * 清掉舊版匯入留下的週末假日：來源為 roc-calendar、沒有名稱、而且還沒轉換過類型（沒有 kind）。
 * 手動新增或手動改過的假日（source 不是 roc-calendar）不會動。
 * 不帶 year 就清全部年度（系統啟動時呼叫一次）；帶 year 只清該年度。回傳刪除筆數。
 */
export async function purgeLegacyRocWeekendHolidays({ year } = {}) {
  const filter = {
    source: 'roc-calendar',
    kind: { $exists: false },
    // 只清週末（週日=1、週六=7）：舊版匯入產生的雜訊都是週末，平日的資料一律不碰。
    // 星期以台灣時間判斷：2026 年 1～8 月的舊版匯入在 UTC+8 主機上把日期存成前一天 16:00Z
    $expr: { $in: [{ $dayOfWeek: { date: '$date', timezone: 'Asia/Taipei' } }, [1, 7]] },
    $or: [
      { description: { $exists: false } },
      { description: null },
      { description: { $regex: /^\s*$/ } },
    ],
  };
  if (Number.isInteger(year)) {
    filter.date = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
  }
  const removed = await Holiday.deleteMany(filter);
  return removed?.deletedCount || 0;
}

// ------------------------------------------------------------------
// 控制器 (Controllers)
// ------------------------------------------------------------------

// 0. 列出某月份的行事曆（不需要 admin 權限，舊版排班頁使用）
// 公司統一挪移可以跨月：來源在本月、目標在別月時從本月移除；目標在本月時補上來源那天的國定假日
export async function listHolidaysByMonth(req, res) {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '需要提供有效月份 (YYYY-MM)' });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);

    const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(year, monthNum, 1));

    const [holidayDocs, moveDocs] = await Promise.all([
      leanList(Holiday.find({
        date: { $gte: startDate, $lt: endDate },
        archived: { $ne: true },
      }).sort({ date: 1 })),
      leanList(HolidayMoveSetting.find({ enableHolidayMove: true })),
    ]);
    const holidays = holidayDocs.map(withDisplayKind);
    const moves = moveDocs.map(asPlainObject)
      .map((move) => ({ move, sourceKey: utcDateKey(move.sourceDate), targetKey: utcDateKey(move.targetDate) }))
      .filter(({ sourceKey, targetKey }) => sourceKey && targetKey && sourceKey !== targetKey);

    // 目標在本月、來源在別月的挪移：另外讀取來源那天的資料
    const outsideSources = [...new Set(moves
      .filter(({ sourceKey, targetKey }) => targetKey.slice(0, 7) === month && sourceKey.slice(0, 7) !== month)
      .map(({ sourceKey }) => sourceKey))];
    const outsideRows = outsideSources.length
      ? (await leanList(Holiday.find({
          date: { $in: outsideSources.map((key) => new Date(`${key}T00:00:00.000Z`)) },
          archived: { $ne: true },
        }))).map(withDisplayKind)
      : [];

    const statutoryOn = (pool, key) => pool.find((holiday) => utcDateKey(holiday.date) === key && holiday.kind === 'statutory');
    for (const { move, sourceKey, targetKey } of moves) {
      const sourceInMonth = sourceKey.slice(0, 7) === month;
      const targetInMonth = targetKey.slice(0, 7) === month;
      if (!sourceInMonth && !targetInMonth) continue;
      const source = sourceInMonth ? statutoryOn(holidays, sourceKey) : statutoryOn(outsideRows, sourceKey);
      if (!source) continue;
      if (sourceInMonth) holidays.splice(holidays.indexOf(source), 1);
      if (targetInMonth) {
        holidays.push({
          ...source,
          date: new Date(`${targetKey}T00:00:00.000Z`),
          source: 'holiday-move',
          movedFrom: sourceKey,
          holidayMoveId: move._id,
        });
      }
    }
    holidays.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(forReader(req, holidays));
  } catch (err) {
    console.error('[Holiday] 查詢失敗', err?.name ?? 'Error');
    res.status(500).json({ error: err.message });
  }
}

// 1. 列出行事曆：?year=YYYY&kind=<類型>&includeArchived=true（已刪除的資料只有管理員能列出）
export async function listHolidays(req, res) {
  try {
    const query = req.query || {};
    const filter = {};
    if (String(query.includeArchived) !== 'true' || !isAdminRequest(req)) filter.archived = { $ne: true };
    if (query.year !== undefined && query.year !== '') {
      const year = Number.parseInt(String(query.year), 10);
      if (!Number.isInteger(year) || year < ROC_YEAR_MIN || year > ROC_YEAR_MAX) {
        return res.status(400).json({ code: 'INVALID_YEAR', error: '年度格式不正確' });
      }
      filter.date = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
    }
    const kind = query.kind ? String(query.kind) : '';
    if (kind && !HOLIDAY_KINDS.includes(kind)) {
      return res.status(400).json({ code: 'INVALID_KIND', error: '行事曆類型不正確' });
    }
    const rows = (await leanList(Holiday.find(filter).sort({ date: 1 }))).map(withDisplayKind);
    res.json(forReader(req, kind ? rows.filter((row) => row.kind === kind) : rows));
  } catch (err) {
    console.error('[Holiday] 查詢失敗', err?.name ?? 'Error');
    res.status(500).json({ error: err.message });
  }
}

// 2. 手動新增一天
export async function createHoliday(req, res) {
  try {
    const parsed = parseHolidayInput(req.body);
    if (parsed.error) return res.status(400).json(parsed.error);
    const value = parsed.value;
    const duplicate = await Holiday.exists({ date: value.date, kind: value.kind, archived: { $ne: true } });
    if (duplicate) return res.status(409).json(DUPLICATE_DAY);
    const holiday = await Holiday.create({
      ...value,
      compensatesName: await compensatesNameOf(value.compensatesDate),
      ...(value.compensatesDate ? { linkMethod: 'manual' } : {}),
      source: 'manual',
      origin: 'manual',
      archived: false,
      hrEdited: false,
      updatedBy: actorIdOf(req),
    });
    await markCalendarYearEdited(value.year, actorIdOf(req));
    res.status(201).json(withDisplayKind(holiday));
  } catch (err) {
    if (isDuplicateKeyError(err)) return res.status(409).json(DUPLICATE_DAY);
    res.status(400).json({ error: err.message });
  }
}

// 3. 修改：匯入（政府資料、系統規則、舊資料轉換）建立的資料改過之後標記 hrEdited，重新匯入不會蓋掉；
//    改到別天時原日期留下已刪除紀錄。人資存檔也算確認過這一筆（清掉「待確認」）
export async function updateHoliday(req, res) {
  try {
    const existing = await leanOne(Holiday.findById(req.params.id));
    if (!existing) return res.status(404).json({ error: '找不到該資料' });
    const parsed = parseHolidayInput(req.body, existing);
    if (parsed.error) return res.status(400).json(parsed.error);
    const value = parsed.value;
    const duplicate = await Holiday.exists({
      _id: { $ne: existing._id },
      date: value.date,
      kind: value.kind,
      archived: { $ne: true },
    });
    if (duplicate) return res.status(409).json(DUPLICATE_DAY);

    const set = {
      ...value,
      compensatesName: await compensatesNameOf(value.compensatesDate),
      needsReview: false,
      reviewNote: '',
      updatedBy: actorIdOf(req),
    };
    if (isImportManagedRow(existing)) set.hrEdited = true;
    const unset = {};
    const compensatesChanged = utcDateKey(existing.compensatesDate) !== (value.compensatesDate ? utcDateKey(value.compensatesDate) : '');
    if (!value.compensatesDate) unset.linkMethod = '';
    else if (compensatesChanged || !existing.linkMethod) set.linkMethod = 'manual';
    const update = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;

    // 先留下原日期的已刪除紀錄再改日期：萬一改日期失敗，多一筆已刪除紀錄不影響任何計算
    const newDateKey = utcDateKey(value.date);
    if (isImportManagedRow(existing) && !existing.archived && utcDateKey(existing.date) && utcDateKey(existing.date) !== newDateKey) {
      await leaveImportTombstone(existing, newDateKey, actorIdOf(req));
    }
    const holiday = await Holiday.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!holiday) return res.status(404).json({ error: '找不到該資料' });
    const previousYear = new Date(existing.date).getUTCFullYear();
    await markCalendarYearEdited(value.year, actorIdOf(req));
    if (Number.isInteger(previousYear) && previousYear !== value.year) await markCalendarYearEdited(previousYear, actorIdOf(req));
    res.json(withDisplayKind(holiday));
  } catch (err) {
    if (isDuplicateKeyError(err)) return res.status(409).json(DUPLICATE_DAY);
    res.status(400).json({ error: err.message });
  }
}

// 4. 刪除：人資手動新增的直接刪除；匯入建立的改為「已刪除」（保留紀錄，重新匯入時不會自動加回）
export async function deleteHoliday(req, res) {
  try {
    const existing = await leanOne(Holiday.findById(req.params.id));
    if (!existing) return res.status(404).json({ error: '找不到該資料' });
    if (isImportManagedRow(existing)) {
      await Holiday.updateOne({ _id: existing._id }, { $set: { archived: true, hrEdited: true, updatedBy: actorIdOf(req) } });
    } else {
      const removed = await Holiday.findByIdAndDelete(req.params.id);
      if (!removed) return res.status(404).json({ error: '找不到該資料' });
    }
    await markCalendarYearEdited(new Date(existing.date).getUTCFullYear(), actorIdOf(req));
    res.json({ success: true, archived: isImportManagedRow(existing) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// 5. 復原已刪除的匯入資料（之後視為人資的決定）
export async function restoreHoliday(req, res) {
  try {
    const existing = await leanOne(Holiday.findById(req.params.id));
    if (!existing) return res.status(404).json({ error: '找不到該資料' });
    if (existing.archived) {
      const kind = effectiveHolidayKind(existing);
      const duplicate = await Holiday.exists({
        _id: { $ne: existing._id },
        date: existing.date,
        kind,
        archived: { $ne: true },
      });
      if (duplicate) return res.status(409).json(DUPLICATE_DAY);
      await Holiday.updateOne({ _id: existing._id }, { $set: { archived: false, hrEdited: true, kind, updatedBy: actorIdOf(req) } });
      await markCalendarYearEdited(new Date(existing.date).getUTCFullYear(), actorIdOf(req));
    }
    const restored = await leanOne(Holiday.findById(req.params.id));
    res.json(withDisplayKind(restored || { ...existing, archived: false, hrEdited: true }));
  } catch (err) {
    if (isDuplicateKeyError(err)) return res.status(409).json(DUPLICATE_DAY);
    res.status(400).json({ error: err.message });
  }
}

// 6. 確認「待確認」的日子：只清掉待確認標記，內容不變，所以不算人資修改，年度的核定狀態也不變
export async function confirmHoliday(req, res) {
  try {
    const existing = await leanOne(Holiday.findById(req.params.id));
    if (!existing) return res.status(404).json({ error: '找不到該資料' });
    await Holiday.updateOne({ _id: existing._id }, { $set: { needsReview: false, reviewNote: '', updatedBy: actorIdOf(req) } });
    res.json(withDisplayKind({ ...asPlainObject(existing), needsReview: false, reviewNote: '' }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// ------------------------------------------------------------------
// 舊版「一鍵載入」相容入口
// ------------------------------------------------------------------

// 該年度還沒有任何資料且政府資料只有一份時，直接建立草稿；其餘情況只下載、不寫入，請人資到「行事曆設定」檢視差異
export async function importRocHolidays(req, res) {
  const rawYear = req.query.year;
  const year = rawYear ? Number.parseInt(rawYear, 10) : currentTaipeiYear();
  if (Number.isNaN(year) || year < ROC_YEAR_MIN || year > ROC_YEAR_MAX) {
    return res.status(400).json({ code: 'YEAR_OUT_OF_RANGE', error: 'Year range invalid' });
  }
  try {
    const result = await importYearCompat({ year, actorId: actorIdOf(req) });
    if (result.applied) {
      return res.json({ success: true, year, imported: result.imported, count: result.imported, state: result.state });
    }
    return res.status(409).json({
      code: 'REVIEW_REQUIRED',
      error: '此年度已有行事曆或有多個版本，請到「行事曆設定」檢視差異後套用',
      year,
      candidates: result.candidates,
    });
  } catch (err) {
    if (err?.code === 'YEAR_OUT_OF_RANGE') {
      return res.status(400).json({ code: 'YEAR_OUT_OF_RANGE', error: '只能取得 2017 年到明年的政府辦公日曆表' });
    }
    if (err?.code === 'INVALID_CSV') {
      return res.status(422).json({ code: 'INVALID_CSV', detail: err.detail || '', error: '政府辦公日曆表的內容格式不正確，未寫入任何資料' });
    }
    console.error('[Import] 取得政府辦公日曆表失敗', err?.code || err?.name || 'Error');
    return res.status(502).json({ code: 'SOURCE_UNAVAILABLE', error: '無法取得政府辦公日曆表，請稍後再試' });
  }
}
