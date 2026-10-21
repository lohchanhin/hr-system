/**
 * 公司行事曆的年度流程：政府資料 -> 草稿 -> 人資核定。
 *
 *   (尚未建立) --取得政府資料並套用--> 草稿 --核定--> 已核定 --修改／改設定／套用新版--> 草稿（需重新核定）
 *
 * - 每次下載的政府檔案存成 PublicCalendarSnapshot（同內容只存一次），分類結果也一起存。
 * - 套用前一律先算差異：人資改過或刪除過的資料（hrEdited／已刪除）預設「保留目前」，不會被政府資料蓋掉。
 * - 只有核定的年度才是正式的；草稿照樣給排班、薪資使用（不會有空窗），畫面上標示「尚未核定」。
 * - 每天（5 月起）檢查一次政府資料平台，有新年度或新版本時產生提醒；排班與薪資計算時從不連網路。
 * 單機 MongoDB 沒有交易：每筆寫入都是可重複執行的 upsert，同一年度的套用在同一個程序內排隊執行。
 */
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import HolidayRestResolution from '../models/HolidayRestResolution.js';
import HolidayCompensation from '../models/HolidayCompensation.js';
import HolidaySwap from '../models/HolidaySwap.js';
import Employee from '../models/Employee.js';
import CalendarYear from '../models/CalendarYear.js';
import PublicCalendarSnapshot from '../models/PublicCalendarSnapshot.js';
import CalendarNotice from '../models/CalendarNotice.js';
import CalendarSourceState from '../models/CalendarSourceState.js';
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_LABELS,
  displayKindOf,
  effectiveHolidayKind,
  holidayTypeLabelOf,
  weekdayOfKey,
} from './holidayCalendarRules.js';
import { classifyPublicCalendarYear } from './publicCalendarClassifier.js';
import {
  MIN_CALENDAR_YEAR,
  currentTaipeiYear,
  decodeCalendarCsv,
  discoverDgpaResources,
  fetchPublicCalendarFile,
  loadPublicCalendarCandidates,
  parseCalendarCsv,
  sha256Of,
} from './publicCalendarSource.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

const DGPA_STATE_KEY = 'dgpa-14718';
const DAILY_STATE_KEY = 'daily-maintenance';
const IMPORT_MANAGED_ORIGINS = new Set(['public', 'rule', 'migrated']);
const PUBLIC_KINDS = new Set(['statutory', 'gov_makeup_off', 'gov_bridge_off', 'gov_makeup_workday']);
const SNAPSHOT_NOTICE_TYPES = ['new_year_available', 'revision_available', 'multiple_resources'];
const MAX_CALENDAR_YEAR = 2100;

// ------------------------------------------------------------------
// 小工具
// ------------------------------------------------------------------

function codedError(code, message, status = 400, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

/** mongoose Query（有 lean）、Promise 或一般陣列都能用：方便測試以簡單的假物件取代模型 */
async function leanResult(value) {
  const resolved = value && typeof value.lean === 'function' ? value.lean() : value;
  return resolved;
}

async function leanList(value) {
  const result = await leanResult(value);
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

async function leanOne(value) {
  const result = await leanResult(value);
  return result ?? null;
}

function idOf(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value?._id ?? value);
}

function utcDate(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function dateKeyOf(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function yearRange(year) {
  return { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function isCalendarYearStorable(year) {
  return Number.isInteger(year) && year >= MIN_CALENDAR_YEAR && year <= MAX_CALENDAR_YEAR;
}

function originOf(row) {
  if (row?.origin) return row.origin;
  return String(row?.source ?? '') === 'roc-calendar' ? 'migrated' : 'manual';
}

export function isImportManagedRow(row) {
  return IMPORT_MANAGED_ORIGINS.has(originOf(row));
}

// 同一年度的套用、核定在同一個程序內排隊執行（多台 PM2 之間仍靠每筆寫入的冪等 upsert 保護）
const yearLocks = new Map();

export async function withYearLock(year, task) {
  const previous = yearLocks.get(year) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chained = previous.then(() => current);
  yearLocks.set(year, chained);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (yearLocks.get(year) === chained) yearLocks.delete(year);
  }
}

// ------------------------------------------------------------------
// 快照與差異
// ------------------------------------------------------------------

/** 一個候選檔案存成快照（同年度、同來源、同 sha256 只存一次），回傳快照（lean 物件） */
export async function storeSnapshot(year, candidate, { actorId = null } = {}) {
  const { entries, warnings, counts } = classifyPublicCalendarYear(year, candidate.rows);
  const filter = { year, source: candidate.source, sha256: candidate.sha256 };
  const refresh = {
    resourceDescription: candidate.description || '',
    url: candidate.url || '',
    uploadFolder: candidate.uploadFolder || '',
    encoding: candidate.encoding,
    fetchedAt: new Date(),
    metadataModifiedDate: candidate.metadataModifiedDate || '',
    rowCount: candidate.rows.length,
    rows: candidate.rows,
    entries,
    warnings,
    counts,
    recommended: Boolean(candidate.recommended),
  };
  const existing = await leanOne(PublicCalendarSnapshot.findOne(filter));
  if (existing) {
    await PublicCalendarSnapshot.updateOne({ _id: existing._id }, { $set: refresh });
    return { ...existing, ...refresh };
  }
  try {
    const created = await PublicCalendarSnapshot.create({ ...filter, ...refresh, status: 'candidate', createdBy: actorId });
    return typeof created?.toObject === 'function' ? created.toObject() : created;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const reread = await leanOne(PublicCalendarSnapshot.findOne(filter));
    if (!reread) throw error;
    return reread;
  }
}

function reviewNoteFor(entry, warnings = []) {
  if (!entry.needsReview) return '';
  return String(warnings.find((text) => String(text).includes(entry.date)) || '請確認此日期的類型').slice(0, 300);
}

/** 快照建議寫入公司行事曆的資料（只有國定假日與公務機關的三種日子；公司休息日、上班日、指定應放假日由人資自己建） */
export function proposedRowsForSnapshot(snapshot) {
  return (snapshot?.entries || [])
    .filter((entry) => PUBLIC_KINDS.has(entry.kind))
    .map((entry) => {
      const name = String(entry.name || HOLIDAY_KIND_LABELS[entry.kind] || '').trim().slice(0, 100);
      return {
        date: entry.date,
        kind: entry.kind,
        name,
        description: name,
        desc: name,
        type: holidayTypeLabelOf(entry.kind),
        statutoryKey: entry.statutoryKey || '',
        compensatesDate: entry.compensatesDate || null,
        compensatesName: entry.compensatesName || '',
        linkMethod: entry.linkMethod || undefined,
        needsReview: Boolean(entry.needsReview),
        reviewNote: reviewNoteFor(entry, snapshot.warnings),
        origin: entry.synthetic || entry.derived ? 'rule' : 'public',
        source: entry.synthetic ? 'statutory-rule' : snapshot.source,
        publicSnapshot: snapshot._id ?? null,
        synthetic: Boolean(entry.synthetic),
      };
    });
}

function summarizeCurrent(row) {
  return {
    id: idOf(row._id),
    kind: effectiveHolidayKind(row),
    name: String(row.name || row.description || row.desc || '').trim(),
    compensatesDate: dateKeyOf(row.compensatesDate),
    origin: originOf(row),
    hrEdited: Boolean(row.hrEdited),
    archived: Boolean(row.archived),
  };
}

function summarizeProposed(row) {
  return {
    kind: row.kind,
    name: row.name,
    compensatesDate: row.compensatesDate || null,
    statutoryKey: row.statutoryKey || '',
    linkMethod: row.linkMethod ?? null,
    synthetic: Boolean(row.synthetic),
    needsReview: Boolean(row.needsReview),
  };
}

function pickCurrent(rows, proposedKind) {
  const active = rows.filter((row) => !row.archived);
  const tombstones = rows.filter((row) => row.archived);
  return active.find((row) => effectiveHolidayKind(row) === proposedKind)
    || active[0]
    || tombstones.find((row) => row.hrEdited && effectiveHolidayKind(row) === proposedKind)
    || tombstones.find((row) => row.hrEdited)
    || tombstones.find((row) => effectiveHolidayKind(row) === proposedKind)
    || tombstones[0]
    || null;
}

/**
 * 快照和公司行事曆目前資料的差異（純函式）。currentRows = 該年度所有資料（含已刪除）。
 * 只比對匯入管理的資料（public／rule／migrated）；人資手動新增的資料不會被刪改，
 * 同一天同類型已有手動資料時視為相同。
 */
export function diffSnapshotAgainstYear(snapshot, currentRows = []) {
  const proposals = new Map(proposedRowsForSnapshot(snapshot).map((row) => [row.date, row]));
  const managedByDate = new Map();
  const manualKeys = new Set();
  for (const row of currentRows || []) {
    const key = dateKeyOf(row.date);
    if (!key) continue;
    if (isImportManagedRow(row)) {
      if (!managedByDate.has(key)) managedByDate.set(key, []);
      managedByDate.get(key).push(row);
    } else if (!row.archived) {
      manualKeys.add(`${key}|${effectiveHolidayKind(row)}`);
    }
  }

  const changes = [];
  let unchanged = 0;
  const keys = [...new Set([...proposals.keys(), ...managedByDate.keys()])].sort();
  for (const key of keys) {
    const proposed = proposals.get(key) || null;
    const rows = managedByDate.get(key) || [];
    const current = pickCurrent(rows, proposed?.kind);
    const extras = rows.filter((row) => row !== current && !row.archived);
    const base = { key, date: key, weekday: weekdayOfKey(key) };

    if (proposed && !current) {
      if (manualKeys.has(`${key}|${proposed.kind}`)) {
        unchanged += 1;
      } else {
        changes.push({ ...base, type: 'add', current: null, proposed: summarizeProposed(proposed), fields: [], conflict: false, defaultDecision: 'accept' });
      }
    } else if (proposed && current) {
      const summary = summarizeCurrent(current);
      if (current.archived) {
        const conflict = Boolean(current.hrEdited);
        changes.push({ ...base, type: 'add', current: summary, proposed: summarizeProposed(proposed), fields: [], conflict, defaultDecision: conflict ? 'keep' : 'accept' });
      } else {
        const fields = [];
        if (summary.kind !== proposed.kind) fields.push('kind');
        if (summary.name !== proposed.name) fields.push('name');
        if ((summary.compensatesDate || null) !== (proposed.compensatesDate || null)) fields.push('compensatesDate');
        if (!fields.length) {
          unchanged += 1;
        } else {
          const conflict = Boolean(current.hrEdited);
          changes.push({ ...base, type: 'change', current: summary, proposed: summarizeProposed(proposed), fields, conflict, defaultDecision: conflict ? 'keep' : 'accept' });
        }
      }
    } else if (current && !current.archived) {
      const conflict = Boolean(current.hrEdited);
      changes.push({ ...base, type: 'remove', current: summarizeCurrent(current), proposed: null, fields: [], conflict, defaultDecision: conflict ? 'keep' : 'accept' });
    }

    // 同一天多出來的匯入資料（例如舊資料重複）一律提議刪除
    for (const extra of extras) {
      const conflict = Boolean(extra.hrEdited);
      changes.push({
        ...base,
        key: `${key}#${idOf(extra._id)}`,
        type: 'remove',
        current: summarizeCurrent(extra),
        proposed: null,
        fields: [],
        conflict,
        defaultDecision: conflict ? 'keep' : 'accept',
      });
    }
  }

  const counts = { add: 0, change: 0, remove: 0, conflict: 0 };
  for (const change of changes) {
    counts[change.type] += 1;
    if (change.conflict) counts.conflict += 1;
  }
  return {
    year: Number(snapshot?.year),
    snapshotId: idOf(snapshot?._id),
    source: snapshot?.source || '',
    sha256: snapshot?.sha256 || '',
    changes,
    unchanged,
    counts,
  };
}

/** 某年度的所有行事曆資料（含已刪除） */
export async function loadYearRows(year) {
  return leanList(Holiday.find({ date: yearRange(year) }).sort({ date: 1 }));
}

function rowFieldsFromProposal(proposed) {
  return {
    name: proposed.name,
    description: proposed.description,
    desc: proposed.desc,
    type: proposed.type,
    statutoryKey: proposed.statutoryKey,
    compensatesDate: proposed.compensatesDate ? utcDate(proposed.compensatesDate) : null,
    compensatesName: proposed.compensatesName,
    needsReview: proposed.needsReview,
    reviewNote: proposed.reviewNote,
    origin: proposed.origin,
    source: proposed.source,
    publicSnapshot: proposed.publicSnapshot,
  };
}

function linkMethodUpdate(proposed) {
  return proposed.linkMethod ? { $set: { linkMethod: proposed.linkMethod } } : { $unset: { linkMethod: '' } };
}

function mergeUpdates(...updates) {
  const merged = {};
  for (const update of updates) {
    for (const [operator, fields] of Object.entries(update)) {
      merged[operator] = { ...(merged[operator] || {}), ...fields };
    }
  }
  return merged;
}

async function loadSnapshotById(snapshotId) {
  if (!snapshotId) return null;
  try {
    return await leanOne(PublicCalendarSnapshot.findById(snapshotId));
  } catch (error) {
    if (error?.name === 'CastError') return null;
    throw error;
  }
}

async function resolveNotices(filter, actorId) {
  await CalendarNotice.updateMany(
    { ...filter, status: 'open' },
    { $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: actorId || null } },
  );
}

/**
 * 套用快照：每個差異依 decisions[key]（'accept' 採用政府資料／'keep' 保留目前），沒給就用預設。
 * 回傳 { year, applied: { added, changed, removed, kept }, state }。
 */
export async function applySnapshot({ year, snapshotId, decisions = {}, actorId = null } = {}) {
  const y = Number(year);
  return withYearLock(y, async () => {
    const snapshot = await loadSnapshotById(snapshotId);
    if (!snapshot || Number(snapshot.year) !== y) {
      throw codedError('SNAPSHOT_NOT_FOUND', '找不到這份政府資料，請重新檢查政府資料', 404);
    }
    const proposalsByDate = new Map(proposedRowsForSnapshot(snapshot).map((row) => [row.date, row]));
    const currentRows = await loadYearRows(y);
    const diff = diffSnapshotAgainstYear(snapshot, currentRows);
    const applied = { added: 0, changed: 0, removed: 0, kept: 0 };

    for (const change of diff.changes) {
      const requested = decisions?.[change.key];
      const decision = requested === 'accept' || requested === 'keep' ? requested : change.defaultDecision;
      const proposed = proposalsByDate.get(change.date);
      if (decision === 'keep') {
        // 保留目前：匯入管理、人資還沒改過的資料標記為人資的決定，之後的差異就不再預設覆蓋
        if (change.current && !change.current.hrEdited) {
          await Holiday.updateOne({ _id: change.current.id }, { $set: { hrEdited: true, updatedBy: actorId } });
        } else if (!change.current && change.type === 'add' && proposed) {
          // 不採用新增的日子（那天沒有任何資料）：留下一筆已刪除紀錄記住人資的決定，下一份政府資料不會再預設加回
          await Holiday.updateOne(
            { date: utcDate(change.date), kind: proposed.kind, archived: true, hrEdited: true },
            {
              $setOnInsert: {
                ...rowFieldsFromProposal(proposed),
                ...(proposed.linkMethod ? { linkMethod: proposed.linkMethod } : {}),
                needsReview: false,
                reviewNote: '人資在匯入差異中選擇不採用（重新匯入時預設不加回）',
                year: y,
                excludedEmployees: [],
                note: '',
                updatedBy: actorId,
              },
            },
            { upsert: true },
          );
        }
        applied.kept += 1;
        continue;
      }
      try {
        if (change.type === 'add' && change.current?.archived) {
          await Holiday.updateOne(
            { _id: change.current.id },
            mergeUpdates(
              { $set: { ...rowFieldsFromProposal(proposed), kind: proposed.kind, year: y, archived: false, hrEdited: false, updatedBy: actorId } },
              linkMethodUpdate(proposed),
            ),
          );
          applied.added += 1;
        } else if (change.type === 'add') {
          const result = await Holiday.updateOne(
            { date: utcDate(change.date), kind: proposed.kind, archived: false },
            {
              $setOnInsert: {
                ...rowFieldsFromProposal(proposed),
                ...(proposed.linkMethod ? { linkMethod: proposed.linkMethod } : {}),
                year: y,
                hrEdited: false,
                excludedEmployees: [],
                note: '',
                updatedBy: actorId,
              },
            },
            { upsert: true },
          );
          if (result?.upsertedCount || result?.upsertedId) applied.added += 1;
        } else if (change.type === 'change') {
          await Holiday.updateOne(
            { _id: change.current.id },
            mergeUpdates(
              { $set: { ...rowFieldsFromProposal(proposed), kind: proposed.kind, year: y, hrEdited: false, updatedBy: actorId } },
              linkMethodUpdate(proposed),
            ),
          );
          applied.changed += 1;
        } else if (change.type === 'remove') {
          await Holiday.updateOne({ _id: change.current.id }, { $set: { archived: true, hrEdited: false, updatedBy: actorId } });
          applied.removed += 1;
        }
      } catch (error) {
        // 同一天同類型已有其他有效資料（唯一索引）：這一筆保留目前，不中斷整個套用
        if (!isDuplicateKeyError(error)) throw error;
        applied.kept += 1;
      }
    }

    const existing = await leanOne(CalendarYear.findOne({ year: y }));
    const touched = applied.added + applied.changed + applied.removed > 0;
    const set = {
      source: {
        kind: snapshot.source,
        snapshot: snapshot._id,
        sha256: snapshot.sha256,
        resourceDescription: snapshot.resourceDescription || '',
        importedAt: new Date(),
      },
      pendingSnapshot: null,
      updatedBy: actorId,
    };
    let state = existing?.state || 'draft';
    if (!existing || touched) {
      set.state = 'draft';
      state = 'draft';
      if (existing?.state === 'approved') set.previousApprovedAt = existing.approvedAt ?? null;
    }
    await CalendarYear.updateOne({ year: y }, { $set: set }, { upsert: true });

    await PublicCalendarSnapshot.updateOne({ _id: snapshot._id }, { $set: { status: 'applied' } });
    await PublicCalendarSnapshot.updateMany(
      { year: y, _id: { $ne: snapshot._id }, status: { $in: ['candidate', 'applied'] } },
      { $set: { status: 'superseded' } },
    );
    await resolveNotices({ year: y, type: { $in: SNAPSHOT_NOTICE_TYPES } }, actorId);
    return { year: y, applied, state };
  });
}

/** 退回某一份政府資料：之後同一份內容不會再提醒 */
export async function rejectSnapshot({ year, snapshotId, actorId = null } = {}) {
  const y = Number(year);
  const snapshot = await loadSnapshotById(snapshotId);
  if (!snapshot || Number(snapshot.year) !== y) {
    throw codedError('SNAPSHOT_NOT_FOUND', '找不到這份政府資料，請重新檢查政府資料', 404);
  }
  await PublicCalendarSnapshot.updateOne({ _id: snapshot._id }, { $set: { status: 'rejected' } });
  await CalendarYear.updateOne({ year: y, pendingSnapshot: snapshot._id }, { $set: { pendingSnapshot: null } });
  await resolveNotices({ snapshot: snapshot._id }, actorId);
  return { year: y, snapshotId: idOf(snapshot._id), status: 'rejected' };
}

// ------------------------------------------------------------------
// 年度狀態：核定、重新開啟、設定、人資修改
// ------------------------------------------------------------------

/** 人資新增／修改／刪除某年度的資料：確保年度文件存在（草稿），已核定的年度回到草稿 */
export async function markCalendarYearEdited(year, actorId = null) {
  const y = Number(year);
  if (!isCalendarYearStorable(y)) return;
  const existing = await leanOne(CalendarYear.findOne({ year: y }));
  if (!existing) {
    try {
      await CalendarYear.updateOne(
        { year: y },
        { $setOnInsert: { state: 'draft', 'source.kind': 'manual', updatedBy: actorId } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    return;
  }
  if (existing.state === 'approved') {
    await CalendarYear.updateOne(
      { year: y, state: 'approved' },
      { $set: { state: 'draft', previousApprovedAt: existing.approvedAt ?? null, updatedBy: actorId } },
    );
  }
}

export async function approveYear({ year, note = '', acknowledgeWarnings = false, actorId = null } = {}) {
  const y = Number(year);
  return withYearLock(y, async () => {
    const activeRows = await leanList(Holiday.find({ date: yearRange(y), archived: { $ne: true } }).select('_id needsReview'));
    if (!activeRows.length) {
      throw codedError('NO_ROWS', '這個年度還沒有任何行事曆資料，無法核定', 409);
    }
    const reviewCount = activeRows.filter((row) => row.needsReview).length;
    if (reviewCount && acknowledgeWarnings !== true) {
      throw codedError('NEEDS_REVIEW_ROWS', `還有 ${reviewCount} 筆待確認的日期`, 409, { count: reviewCount });
    }
    const existing = await leanOne(CalendarYear.findOne({ year: y }));
    const approvedAt = new Date();
    await CalendarYear.updateOne(
      { year: y },
      {
        $set: {
          state: 'approved',
          migrated: false,
          approvedAt,
          approvedBy: actorId,
          approvedSha256: existing?.source?.sha256 || '',
          approvalNote: String(note ?? '').slice(0, 500),
          updatedBy: actorId,
        },
      },
      { upsert: true },
    );
    await resolveNotices({ year: y, type: { $in: ['migrated_review', 'year_not_approved'] } }, actorId);
    return { year: y, state: 'approved', approvedAt };
  });
}

export async function reopenYear({ year, actorId = null } = {}) {
  const y = Number(year);
  const existing = await leanOne(CalendarYear.findOne({ year: y }));
  if (!existing) throw codedError('YEAR_NOT_FOUND', '這個年度還沒有建立行事曆', 404);
  if (existing.state === 'approved') {
    await CalendarYear.updateOne(
      { year: y },
      { $set: { state: 'draft', previousApprovedAt: existing.approvedAt ?? null, updatedBy: actorId } },
    );
  }
  return { year: y, state: 'draft' };
}

/** 依政府調整放假／補行上班（只影響行政人員）；啟用時必須有協議文號與同意日期 */
export async function updateYearSettings({ year, followGovernmentAdjustments, adjustmentAgreement = {}, actorId = null } = {}) {
  const y = Number(year);
  if (!isCalendarYearStorable(y)) throw codedError('YEAR_OUT_OF_RANGE', '年度不在可設定的範圍內', 400);
  const parsedDate = adjustmentAgreement?.date ? new Date(adjustmentAgreement.date) : null;
  const agreement = {
    reference: String(adjustmentAgreement?.reference ?? '').trim().slice(0, 200),
    date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    note: String(adjustmentAgreement?.note ?? '').slice(0, 500),
  };
  const follow = Boolean(followGovernmentAdjustments);
  // 和 CalendarYear 模型的驗證規則相同：啟用時協議文號與同意日期都必填
  if (follow && (!agreement.reference || !agreement.date)) {
    throw codedError('AGREEMENT_REQUIRED', '啟用「依政府調整放假」必須填寫勞資會議（或工會）同意的協議文號與同意日期', 400);
  }
  const existing = await leanOne(CalendarYear.findOne({ year: y }));
  const set = {
    followGovernmentAdjustments: follow,
    'adjustmentAgreement.reference': agreement.reference,
    'adjustmentAgreement.date': agreement.date,
    'adjustmentAgreement.note': agreement.note,
    updatedBy: actorId,
  };
  let state = existing?.state || 'draft';
  if (existing?.state === 'approved') {
    set.state = 'draft';
    set.previousApprovedAt = existing.approvedAt ?? null;
    state = 'draft';
  }
  const update = { $set: set };
  if (!existing) update.$setOnInsert = { state: 'draft', 'source.kind': 'manual' };
  await CalendarYear.updateOne({ year: y }, update, { upsert: true });
  return {
    year: y,
    state,
    followGovernmentAdjustments: follow,
    adjustmentAgreement: {
      reference: agreement.reference,
      date: dateKeyOf(agreement.date),
      note: agreement.note,
    },
  };
}

// ------------------------------------------------------------------
// 年度清單與明細
// ------------------------------------------------------------------

/** 最後一個連續核定年度的年底（今年沒核定時為 null） */
export function lastApprovedDateOf(yearDocs = [], now = new Date()) {
  const approved = new Set(yearDocs.filter((doc) => doc.state === 'approved').map((doc) => Number(doc.year)));
  let year = currentTaipeiYear(now);
  if (!approved.has(year)) return null;
  while (approved.has(year + 1)) year += 1;
  return `${year}-12-31`;
}

function emptyKindCounts() {
  return Object.fromEntries(HOLIDAY_KINDS.map((kind) => [kind, 0]));
}

function serializeAgreement(agreement) {
  return {
    reference: agreement?.reference || '',
    date: dateKeyOf(agreement?.date),
    note: agreement?.note || '',
  };
}

function serializeNotice(notice) {
  return {
    id: idOf(notice._id),
    type: notice.type,
    year: notice.year,
    message: notice.message || '',
    snapshotId: idOf(notice.snapshot),
    status: notice.status,
    createdAt: notice.createdAt || null,
  };
}

async function loadEmployeeNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const employees = await leanList(Employee.find({ _id: { $in: unique } }).select('_id name employeeId'));
  return new Map(employees.map((employee) => [String(employee._id), employee]));
}

async function buildYearItems({ yearDocs, activeRows, sourceState, now }) {
  const docByYear = new Map(yearDocs.map((doc) => [Number(doc.year), doc]));
  const statsByYear = new Map();
  for (const row of activeRows) {
    const key = dateKeyOf(row.date);
    if (!key) continue;
    const year = Number(key.slice(0, 4));
    if (!statsByYear.has(year)) statsByYear.set(year, { counts: emptyKindCounts(), needsReview: 0, unlinkedMakeup: 0, rows: 0 });
    const stats = statsByYear.get(year);
    const kind = effectiveHolidayKind(row);
    stats.rows += 1;
    stats.counts[kind] = (stats.counts[kind] || 0) + 1;
    if (row.needsReview) stats.needsReview += 1;
    if (kind === 'gov_makeup_off' && !row.compensatesDate) stats.unlinkedMakeup += 1;
  }
  const upstreamYears = new Set((sourceState?.resources || []).map((resource) => Number(resource.year)).filter(Number.isInteger));
  const current = currentTaipeiYear(now);
  const years = [...new Set([
    ...docByYear.keys(),
    ...statsByYear.keys(),
    current - 1,
    current,
    current + 1,
    ...upstreamYears,
  ])].filter(Number.isInteger).sort((a, b) => a - b);

  const pendingIds = yearDocs.map((doc) => doc.pendingSnapshot).filter(Boolean);
  const pendingSnapshots = pendingIds.length
    ? await leanList(PublicCalendarSnapshot.find({ _id: { $in: pendingIds } }).select('_id resourceDescription'))
    : [];
  const pendingById = new Map(pendingSnapshots.map((snapshot) => [String(snapshot._id), snapshot]));
  const approverNames = await loadEmployeeNames(yearDocs.map((doc) => doc.approvedBy));

  return years.map((year) => {
    const doc = docByYear.get(year) || null;
    const stats = statsByYear.get(year) || { counts: emptyKindCounts(), needsReview: 0, unlinkedMakeup: 0, rows: 0 };
    const pending = doc?.pendingSnapshot ? pendingById.get(String(doc.pendingSnapshot)) : null;
    return {
      year,
      state: doc ? doc.state : (stats.rows ? 'draft' : 'none'),
      migrated: Boolean(doc?.migrated),
      counts: stats.counts,
      needsReview: stats.needsReview,
      unlinkedMakeup: stats.unlinkedMakeup,
      source: doc?.source
        ? {
            kind: doc.source.kind || '',
            sha256: doc.source.sha256 || '',
            resourceDescription: doc.source.resourceDescription || '',
            importedAt: doc.source.importedAt || null,
          }
        : null,
      approvedAt: doc?.approvedAt || null,
      approvedByName: doc?.approvedBy ? (approverNames.get(String(doc.approvedBy))?.name || '') : '',
      approvalNote: doc?.approvalNote || '',
      followGovernmentAdjustments: Boolean(doc?.followGovernmentAdjustments),
      adjustmentAgreement: serializeAgreement(doc?.adjustmentAgreement),
      pendingSnapshot: pending ? { id: idOf(pending._id), resourceDescription: pending.resourceDescription || '' } : null,
      upstreamAvailable: upstreamYears.has(year),
    };
  });
}

export async function listCalendarYears({ now = new Date() } = {}) {
  const [yearDocs, activeRows, sourceState, notices] = await Promise.all([
    leanList(CalendarYear.find({})),
    leanList(Holiday.find({ archived: { $ne: true } }).select('date kind type name description desc source needsReview compensatesDate')),
    leanOne(CalendarSourceState.findOne({ key: DGPA_STATE_KEY })),
    leanList(CalendarNotice.find({ status: 'open' }).sort({ createdAt: -1 })),
  ]);
  const years = await buildYearItems({ yearDocs, activeRows, sourceState, now });
  return {
    years,
    lastApprovedDate: lastApprovedDateOf(yearDocs, now),
    notices: notices.map(serializeNotice),
    lastCheck: {
      lastCheckedAt: sourceState?.lastCheckedAt || null,
      lastSuccessAt: sourceState?.lastSuccessAt || null,
      lastError: sourceState?.lastError || '',
    },
  };
}

export function serializeCalendarDay(row) {
  const key = dateKeyOf(row.date);
  const kind = effectiveHolidayKind(row);
  return {
    id: idOf(row._id),
    date: key,
    weekday: weekdayOfKey(key),
    kind,
    displayKind: displayKindOf(kind),
    label: HOLIDAY_KIND_LABELS[kind] || '',
    name: String(row.name || row.description || row.desc || '').trim(),
    type: row.type || '',
    statutoryKey: row.statutoryKey || '',
    compensatesDate: dateKeyOf(row.compensatesDate),
    compensatesName: row.compensatesName || '',
    linkMethod: row.linkMethod || null,
    origin: originOf(row),
    source: row.source || '',
    hrEdited: Boolean(row.hrEdited),
    archived: Boolean(row.archived),
    needsReview: Boolean(row.needsReview),
    reviewNote: row.reviewNote || '',
    excludedEmployees: (row.excludedEmployees || []).map(idOf),
    note: row.note || '',
  };
}

export async function getCalendarYearDetail(year, { now = new Date() } = {}) {
  const y = Number(year);
  const overview = await listCalendarYears({ now });
  const item = overview.years.find((entry) => entry.year === y) || {
    year: y, state: 'none', migrated: false, counts: emptyKindCounts(), needsReview: 0, unlinkedMakeup: 0,
    source: null, approvedAt: null, approvedByName: '', approvalNote: '', followGovernmentAdjustments: false,
    adjustmentAgreement: serializeAgreement(null), pendingSnapshot: null, upstreamAvailable: false,
  };
  const rows = await loadYearRows(y);
  const days = rows.map(serializeCalendarDay);
  const links = days
    .filter((day) => !day.archived && day.kind === 'gov_makeup_off')
    .map((day) => ({ date: day.date, compensatesDate: day.compensatesDate }));
  let warnings = [];
  const sourceSnapshotId = (await leanOne(CalendarYear.findOne({ year: y })))?.source?.snapshot;
  if (sourceSnapshotId) {
    const snapshot = await leanOne(PublicCalendarSnapshot.findById(sourceSnapshotId).select('warnings'));
    warnings = snapshot?.warnings || [];
  }
  return { year: item, days, links, warnings };
}

// ------------------------------------------------------------------
// 取得政府資料
// ------------------------------------------------------------------

function serializeCandidate(snapshot) {
  return {
    snapshotId: idOf(snapshot._id),
    source: snapshot.source,
    resourceDescription: snapshot.resourceDescription || '',
    url: snapshot.url || '',
    sha256: snapshot.sha256,
    encoding: snapshot.encoding,
    counts: snapshot.counts || {},
    warnings: snapshot.warnings || [],
    recommended: Boolean(snapshot.recommended),
    status: snapshot.status || 'candidate',
  };
}

/** 下載某年度的政府資料並存成快照；只有一份時一併算出差異，多份時讓人資選 */
export async function fetchYearCandidates({ year, source = 'auto', actorId = null, fetchImpl = fetch, now = new Date() } = {}) {
  const y = Number(year);
  const loaded = await loadPublicCalendarCandidates(y, { source, fetchImpl, now });
  const snapshots = [];
  for (const candidate of loaded) snapshots.push(await storeSnapshot(y, candidate, { actorId }));
  const conflict = snapshots.length > 1;
  const diff = conflict ? null : diffSnapshotAgainstYear(snapshots[0], await loadYearRows(y));
  return {
    year: y,
    candidates: snapshots.map(serializeCandidate),
    conflict,
    selected: conflict ? null : idOf(snapshots[0]._id),
    diff,
  };
}

export async function getSnapshotDiff(snapshotId) {
  const snapshot = await loadSnapshotById(snapshotId);
  if (!snapshot) throw codedError('SNAPSHOT_NOT_FOUND', '找不到這份政府資料，請重新檢查政府資料', 404);
  return diffSnapshotAgainstYear(snapshot, await loadYearRows(Number(snapshot.year)));
}

/**
 * 舊版「一鍵載入」相容入口：該年度沒有任何資料、也沒有年度文件，而且政府資料只有一份時直接套用成草稿；
 * 否則只存快照、不寫入任何資料，回傳 REVIEW_REQUIRED 請人資到「行事曆設定」檢視差異。
 */
export async function importYearCompat({ year, actorId = null, fetchImpl = fetch, now = new Date() } = {}) {
  const y = Number(year);
  const loaded = await loadPublicCalendarCandidates(y, { source: 'auto', fetchImpl, now });
  const snapshots = [];
  for (const candidate of loaded) snapshots.push(await storeSnapshot(y, candidate, { actorId }));
  const [existingDoc, existingRows] = await Promise.all([
    leanOne(CalendarYear.findOne({ year: y })),
    leanList(Holiday.find({ date: yearRange(y) }).select('_id')),
  ]);
  if (!existingDoc && !existingRows.length && snapshots.length === 1) {
    const result = await applySnapshot({ year: y, snapshotId: snapshots[0]._id, actorId });
    return { applied: true, year: y, imported: result.applied.added, state: result.state };
  }
  return { applied: false, year: y, candidates: snapshots.map(serializeCandidate) };
}

// ------------------------------------------------------------------
// 提醒與每日檢查
// ------------------------------------------------------------------

export async function listCalendarNotices({ status = 'open' } = {}) {
  const filter = status === 'all' ? {} : { status: ['open', 'resolved', 'dismissed'].includes(status) ? status : 'open' };
  const notices = await leanList(CalendarNotice.find(filter).sort({ createdAt: -1 }).limit(200));
  return notices.map(serializeNotice);
}

export async function dismissCalendarNotice(noticeId, actorId = null) {
  let notice;
  try {
    notice = await leanOne(CalendarNotice.findById(noticeId));
  } catch (error) {
    if (error?.name !== 'CastError') throw error;
  }
  if (!notice) throw codedError('NOTICE_NOT_FOUND', '找不到這則提醒', 404);
  await CalendarNotice.updateOne(
    { _id: notice._id },
    { $set: { status: 'dismissed', resolvedAt: new Date(), resolvedBy: actorId } },
  );
  return { id: idOf(notice._id), status: 'dismissed' };
}

/** 建立提醒（dedupeKey 唯一，同一件事只提醒一次）；新建立時回傳提醒，否則 null */
async function createNotice({ type, year, dedupeKey, message, snapshot = null }) {
  try {
    const result = await CalendarNotice.updateOne(
      { dedupeKey },
      { $setOnInsert: { type, year, message, snapshot, status: 'open' } },
      { upsert: true },
    );
    if (!(result?.upsertedCount || result?.upsertedId)) return null;
    return { type, year, dedupeKey, message, snapshotId: idOf(snapshot) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

/** 政府資料的分類結果（不含備註）：比較兩份檔案的內容是否相同 */
function entriesKeyOf(snapshot) {
  return JSON.stringify((snapshot?.entries || [])
    .map((entry) => [entry.date, entry.kind, entry.name || '', entry.statutoryKey || '', entry.compensatesDate || null])
    .sort((a, b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`)));
}

/** 年度目前套用的政府資料的內容（沒有套用過、或快照已不存在時為 null） */
async function appliedEntriesKeyOf(yearDoc) {
  const applied = await loadSnapshotById(yearDoc?.source?.snapshot);
  return Array.isArray(applied?.entries) ? entriesKeyOf(applied) : null;
}

async function updateSourceState({ checkedAt, success, errorCode, metadataModifiedDate, resources }) {
  const existing = await leanOne(CalendarSourceState.findOne({ key: DGPA_STATE_KEY }));
  const set = { lastCheckedAt: checkedAt };
  if (success) {
    set.lastSuccessAt = checkedAt;
    set.lastError = errorCode || '';
  } else {
    set.lastError = errorCode || 'FETCH_FAILED';
  }
  if (metadataModifiedDate) set.metadataModifiedDate = metadataModifiedDate;
  if (Array.isArray(resources)) {
    const firstSeen = new Map((existing?.resources || []).map((item) => [item.url, item.firstSeenAt]));
    set.resources = resources.map((resource) => ({
      year: resource.year,
      description: resource.description,
      url: resource.url,
      firstSeenAt: firstSeen.get(resource.url) || checkedAt,
    }));
  }
  try {
    await CalendarSourceState.updateOne({ key: DGPA_STATE_KEY }, { $set: set }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await CalendarSourceState.updateOne({ key: DGPA_STATE_KEY }, { $set: set });
  }
}

/**
 * 檢查政府資料平台（預設去年、今年、明年）：
 *   沒有行事曆的年度出現政府資料 -> 「可建立草稿」；已有資料的年度出現新版本 -> 「有新版本」並記錄待處理快照；
 *   同年度多份檔案 -> 「請選擇版本」；12 月起明年還沒核定 -> 「明年尚未核定」。
 */
export async function checkPublicCalendarUpdates({ years, fetchImpl = fetch, actorId = null, reason = 'manual', now = new Date() } = {}) {
  void reason;
  const checkedAt = new Date();
  const current = currentTaipeiYear(now);
  const targetYears = (Array.isArray(years) && years.length ? years : [current - 1, current, current + 1])
    .map(Number)
    .filter((year) => Number.isInteger(year) && year >= MIN_CALENDAR_YEAR && year <= current + 1);
  const created = [];
  const errors = [];

  let discovery;
  try {
    discovery = await discoverDgpaResources({ fetchImpl });
  } catch (error) {
    errors.push(error?.code || 'FETCH_FAILED');
  }

  if (discovery) {
    for (const year of targetYears) {
      const snapshots = [];
      for (const resource of discovery.resources.filter((item) => item.year === year)) {
        try {
          const buffer = await fetchPublicCalendarFile(resource.url, { fetchImpl });
          const { text, encoding } = decodeCalendarCsv(buffer);
          const rows = parseCalendarCsv(text, year);
          const snapshot = await storeSnapshot(year, {
            source: 'dgpa',
            description: resource.description,
            url: resource.url,
            uploadFolder: resource.uploadFolder,
            sha256: sha256Of(buffer),
            encoding,
            rows,
            recommended: resource.recommended,
            metadataModifiedDate: discovery.metadataModifiedDate,
          }, { actorId });
          if (!snapshots.some((item) => item.sha256 === snapshot.sha256)) snapshots.push(snapshot);
        } catch (error) {
          errors.push(error?.code || 'FETCH_FAILED');
        }
      }
      if (!snapshots.length) continue;

      const [yearDoc, rowCount] = await Promise.all([
        leanOne(CalendarYear.findOne({ year })),
        Holiday.countDocuments({ date: yearRange(year), archived: { $ne: true } }),
      ]);
      const recommended = snapshots.find((snapshot) => snapshot.recommended) || null;
      if (!yearDoc && !rowCount) {
        const pick = recommended || snapshots[0];
        const notice = await createNotice({
          type: 'new_year_available',
          year,
          dedupeKey: `new_year:${year}:${pick.sha256}`,
          message: `政府已公告 ${year} 年辦公日曆表，可建立 ${year} 年公司行事曆草稿`,
          snapshot: pick._id,
        });
        if (notice) created.push(notice);
      } else {
        const sourceSha = yearDoc?.source?.sha256 || '';
        const pool = snapshots.length > 1 ? (recommended ? [recommended] : []) : snapshots;
        const currentRows = pool.length ? await loadYearRows(year) : [];
        const appliedKey = pool.length ? await appliedEntriesKeyOf(yearDoc) : null;
        for (const snapshot of pool) {
          if (snapshot.sha256 === sourceSha || (snapshot.status && snapshot.status !== 'candidate')) continue;
          // 政府重新上傳內容相同的檔案（位元組不同、sha256 不同）不是新版本
          if (appliedKey !== null && entriesKeyOf(snapshot) === appliedKey) continue;
          const diff = diffSnapshotAgainstYear(snapshot, currentRows);
          // 內容和目前的行事曆完全相同（例如舊資料轉換的年度）就不提醒「有新版本」；
          // 沒有套用過的政府資料可以比對時，差異只剩人資自己的修改（預設保留、沒有東西可套用）也不提醒
          if (!diff.changes.length) continue;
          if (appliedKey === null && !diff.changes.some((change) => !change.conflict)) continue;
          const notice = await createNotice({
            type: 'revision_available',
            year,
            dedupeKey: `revision:${year}:${snapshot.sha256}`,
            message: `${year} 年辦公日曆表有新版本（${snapshot.resourceDescription || snapshot.source}），請檢視差異後套用`,
            snapshot: snapshot._id,
          });
          if (notice) {
            created.push(notice);
            await CalendarYear.updateOne({ year }, { $set: { pendingSnapshot: snapshot._id } });
          }
        }
      }
      if (snapshots.length > 1) {
        const shas = snapshots.map((snapshot) => snapshot.sha256).sort().join(',');
        const notice = await createNotice({
          type: 'multiple_resources',
          year,
          dedupeKey: `multiple:${year}:${shas}`,
          message: `${year} 年有 ${snapshots.length} 份辦公日曆表檔案，請選擇要採用的版本`,
          snapshot: (recommended || snapshots[0])._id,
        });
        if (notice) created.push(notice);
      }
    }
  }

  // 12 月起：明年的公司行事曆還沒核定就提醒
  const todayKey = toTaipeiDateKey(now);
  if (todayKey.slice(5, 7) === '12') {
    const nextYear = current + 1;
    const nextDoc = await leanOne(CalendarYear.findOne({ year: nextYear }));
    if (nextDoc?.state !== 'approved') {
      const notice = await createNotice({
        type: 'year_not_approved',
        year: nextYear,
        dedupeKey: `not_approved:${nextYear}`,
        message: `${nextYear} 年公司行事曆尚未核定`,
      });
      if (notice) created.push(notice);
    }
  }

  await updateSourceState({
    checkedAt,
    success: Boolean(discovery),
    errorCode: errors[0] || '',
    metadataModifiedDate: discovery?.metadataModifiedDate || '',
    resources: discovery?.resources,
  });
  return { checkedAt, notices: created, errors };
}

/**
 * 每日例行工作：以台灣日期領取當天的執行權（多個 PM2 執行個體或多次觸發，同一天只跑一次）；
 * 5～12 月檢查政府資料，接著依序執行其他每日工作（例如重新計算國定假日補假）。
 */
export async function runDailyHolidayMaintenance({ dailyTasks = [], now = new Date(), fetchImpl } = {}) {
  const dayKey = toTaipeiDateKey(now);
  let claimed;
  try {
    claimed = await leanOne(CalendarSourceState.findOneAndUpdate(
      { key: DAILY_STATE_KEY, lastRunDay: { $ne: dayKey } },
      { $set: { lastRunDay: dayKey, lastRunAt: now } },
      { upsert: true, new: true },
    ));
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ran: false };
    throw error;
  }
  if (!claimed) return { ran: false };

  const result = { ran: true, check: null, tasks: 0 };
  const month = Number(dayKey.slice(5, 7));
  if (month >= 5) {
    try {
      result.check = await checkPublicCalendarUpdates({ reason: 'daily', now, ...(fetchImpl ? { fetchImpl } : {}) });
      console.log(`Holiday calendar check created ${result.check.notices.length} notices`);
    } catch (error) {
      console.error('Holiday calendar daily task failed', error?.name ?? 'Error');
    }
  }
  for (const task of dailyTasks) {
    try {
      await task({ now });
      result.tasks += 1;
    } catch (error) {
      console.error('Holiday calendar daily task failed', error?.name ?? 'Error');
    }
  }
  return result;
}

/** 啟動每小時一次的檢查（每天實際只執行一次）；測試環境與 HOLIDAY_CALENDAR_WATCHER=off 時不啟動 */
export function startHolidayCalendarWatcher({ dailyTasks = [], intervalMs = 3600000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.HOLIDAY_CALENDAR_WATCHER === 'off') {
    return { stop() {} };
  }
  const tick = () => {
    runDailyHolidayMaintenance({ dailyTasks }).catch((error) => {
      console.error('Holiday calendar daily task failed', error?.name ?? 'Error');
    });
  };
  // 啟動後稍等一下再跑第一次，之後每小時檢查一次今天是否已執行
  const firstRun = setTimeout(tick, Math.min(120000, intervalMs));
  firstRun.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearTimeout(firstRun);
      clearInterval(timer);
    },
  };
}

// ------------------------------------------------------------------
// 對帳報告（只讀，不刪除任何資料）
// ------------------------------------------------------------------

/**
 * 行事曆重新分類後需要人資確認的紀錄：
 *   resolutions   國定假日休假紀錄的處理方式，但那天已不是國定假日（例如 2026-02-20 公務機關補假）
 *   moves         公司統一挪移的來源不是國定假日、目標已是假日（含公務機關補假）、和其他挪移同一天、
 *                 目標已是員工的個人調移日或補假日、或缺少協議資料
 *   compensations 補假義務對應的日子已不是國定假日
 *   swaps         個人調移的原日期不是國定假日，或調移日已是假日
 */
export async function buildCalendarReconciliation() {
  const [resolutions, moves, compensations, swaps] = await Promise.all([
    leanList(HolidayRestResolution.find({}).select('_id employee holidayDate holidayName kind')),
    leanList(HolidayMoveSetting.find({ enableHolidayMove: true })),
    leanList(HolidayCompensation.find({ status: { $ne: 'void' } }).select('_id employee holidayDate holidayName status assignedDate')),
    leanList(HolidaySwap.find({ status: 'active' }).select('_id employee originalDate targetDate originalName')),
  ]);
  const dates = new Set();
  for (const row of resolutions) dates.add(dateKeyOf(row.holidayDate));
  for (const move of moves) { dates.add(dateKeyOf(move.sourceDate)); dates.add(dateKeyOf(move.targetDate)); }
  for (const row of compensations) dates.add(dateKeyOf(row.holidayDate));
  for (const swap of swaps) { dates.add(dateKeyOf(swap.originalDate)); dates.add(dateKeyOf(swap.targetDate)); }
  dates.delete(null);

  const kindsByDate = new Map();
  if (dates.size) {
    const rows = await leanList(Holiday.find({ date: { $in: [...dates].map(utcDate) }, archived: { $ne: true } }));
    for (const row of rows) {
      const key = dateKeyOf(row.date);
      if (!kindsByDate.has(key)) kindsByDate.set(key, new Set());
      kindsByDate.get(key).add(effectiveHolidayKind(row));
    }
  }
  const kindsOf = (key) => kindsByDate.get(key) || new Set();
  const isStatutory = (key) => kindsOf(key).has('statutory');
  const isHolidayDay = (key) => kindsOf(key).has('statutory') || kindsOf(key).has('designated');
  const currentKindOf = (key) => {
    const kinds = [...kindsOf(key)];
    if (!kinds.length) return 'none';
    return HOLIDAY_KINDS.find((kind) => kinds.includes(kind)) || kinds[0];
  };

  const employees = await loadEmployeeNames([
    ...resolutions.map((row) => row.employee),
    ...compensations.map((row) => row.employee),
    ...swaps.map((row) => row.employee),
  ]);
  const personOf = (id) => {
    const employee = employees.get(String(id));
    return { employeeId: idOf(id), employeeNo: employee?.employeeId || '', name: employee?.name || '' };
  };

  const resolutionItems = resolutions
    .filter((row) => !isHolidayDay(dateKeyOf(row.holidayDate)))
    .map((row) => {
      const key = dateKeyOf(row.holidayDate);
      return {
        id: idOf(row._id),
        ...personOf(row.employee),
        holidayDate: key,
        holidayName: row.holidayName || '',
        resolutionKind: row.kind,
        currentKind: currentKindOf(key),
      };
    });

  // 公司調移的目標日：和其他公司調移同一天，或已是員工的個人調移日／已排定的補假日，都會讓員工少放一天
  const moveTargetCounts = new Map();
  for (const move of moves) {
    const targetKey = dateKeyOf(move.targetDate);
    if (targetKey) moveTargetCounts.set(targetKey, (moveTargetCounts.get(targetKey) || 0) + 1);
  }
  const personalTargets = new Set([
    ...swaps.map((swap) => dateKeyOf(swap.targetDate)),
    ...compensations.filter((row) => row.status === 'assigned').map((row) => dateKeyOf(row.assignedDate)),
  ].filter(Boolean));

  const moveItems = [];
  for (const move of moves) {
    const sourceKey = dateKeyOf(move.sourceDate);
    const targetKey = dateKeyOf(move.targetDate);
    if (!sourceKey || !targetKey) continue;
    const base = { id: idOf(move._id), sourceDate: sourceKey, targetDate: targetKey };
    if (!isStatutory(sourceKey)) moveItems.push({ ...base, problem: 'source_not_statutory' });
    if (isHolidayDay(targetKey) || kindsOf(targetKey).has('gov_makeup_off')) moveItems.push({ ...base, problem: 'target_is_holiday' });
    if ((moveTargetCounts.get(targetKey) || 0) > 1) moveItems.push({ ...base, problem: 'duplicate_target' });
    if (personalTargets.has(targetKey)) moveItems.push({ ...base, problem: 'target_taken' });
    if (!String(move.agreementReference ?? '').trim() || !move.agreementDate) moveItems.push({ ...base, problem: 'missing_agreement' });
  }

  const compensationItems = compensations
    .filter((row) => !isStatutory(dateKeyOf(row.holidayDate)))
    .map((row) => ({
      id: idOf(row._id),
      employeeId: idOf(row.employee),
      name: personOf(row.employee).name,
      holidayDate: dateKeyOf(row.holidayDate),
      status: row.status,
      problem: 'holiday_not_statutory',
    }));

  const swapItems = [];
  for (const swap of swaps) {
    const originalKey = dateKeyOf(swap.originalDate);
    const targetKey = dateKeyOf(swap.targetDate);
    const base = {
      id: idOf(swap._id),
      employeeId: idOf(swap.employee),
      name: personOf(swap.employee).name,
      originalDate: originalKey,
      targetDate: targetKey,
    };
    if (!isStatutory(originalKey)) swapItems.push({ ...base, problem: 'original_not_statutory' });
    if (isHolidayDay(targetKey)) swapItems.push({ ...base, problem: 'target_is_holiday' });
  }

  return {
    resolutions: resolutionItems,
    moves: moveItems,
    compensations: compensationItems,
    swaps: swapItems,
    counts: {
      resolutions: resolutionItems.length,
      moves: moveItems.length,
      compensations: compensationItems.length,
      swaps: swapItems.length,
    },
  };
}
