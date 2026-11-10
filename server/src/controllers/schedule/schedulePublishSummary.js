// 排班頁的發布狀態（GET /api/schedules/monthly 的 publishSummary）。
// 以前直接用「目前這一頁員工」的班表算：員工比一頁多時，狀態與筆數只代表那一頁（第一頁都確認了就顯示可完成發布）。
// 現在對整個範圍（月份 + 部門／小單位 + 登入者看得到的員工，不看頁次、搜尋與畫面只要求的那幾位）用一次彙總查詢算出每位員工的筆數，
// 有異議的班表另外讀一次（只有那幾筆），不會每位員工查一次。
//
// 一筆班表的狀態（models/ShiftSchedule.js）：
//   draft                         還沒送給員工（新增或異動過，needsReconfirm: true）
//   pending_confirmation/pending  已發送，等員工回覆
//   pending_confirmation/confirmed 員工已確認，等完成發布
//   changes_requested/disputed    員工提出異議
//   finalized                     已完成發布（鎖定）；之後再改這一筆會回到 draft
// 整個範圍的狀態（畫面認得的五種，client/src/utils/schedulePublishStatus.js）：
//   disputed  還有異議
//   pending   已發送、還有人沒回覆        ready 已發送的都確認了，可以完成發布
//   finalized 全部都已完成發布（沒有還沒發送的異動）
//   draft     其他：還沒發送過，或已完成發布之後又有新增／異動的班表還沒發送（unpublishedCount 是筆數）
// 以前只要有一筆已完成發布就回報 finalized：鎖定的月份改一格之後畫面仍顯示已完成發布、不能再發送，那一格永遠送不到員工手上。
import { Types } from 'mongoose';
import ShiftSchedule from '../../models/ShiftSchedule.js';
import { toEntityId } from './scheduleShared.js';

const isDisputedRow = (row) => row.employeeResponse === 'disputed' || row.state === 'changes_requested';
// needsReconfirm 沒有值（2026-03 以前的舊資料）也算這一輪要確認的，和發布的查詢（buildPublishQuery）一致
const isCurrentRoundRow = (row) => row.needsReconfirm !== false && row.state !== 'finalized';

function emptyEntry(id, person = {}) {
  return {
    id,
    name: person.name || '',
    photo: person.photo || '',
    total: 0,
    finalizedCount: 0,
    draftCount: 0,
    publishedOpenCount: 0,
    pendingCount: 0,
    disputedCount: 0,
    currentRoundCount: 0,
    unaffectedCount: 0,
    latestPublishedAt: null,
    latestResponseAt: null,
    latestNote: '',
    disputes: [],
  };
}

function laterDate(current, value) {
  if (!value) return current;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return current;
  return !current || current < date ? date : current;
}

const toIso = (value) => (value ? new Date(value).toISOString() : null);

function addDispute(entry, row) {
  if (row.responseNote) entry.latestNote = row.responseNote;
  entry.disputes.push({
    date: toIso(row.date),
    note: row.responseNote || '',
    responseAt: toIso(row.responseAt),
  });
}

/**
 * 由班表資料逐筆統計每位員工的筆數（rows 的 employee 可以是已 populate 的員工或 _id）。
 * 沒有資料庫彙總可用時（單元測試以替身取代模型）用這個；規則與 loadPublishSummaryEntries 的彙總相同。
 */
export function summarizePublishRows(rows) {
  const entries = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const person = row.employee && typeof row.employee === 'object' ? row.employee : {};
    const id = person?._id?.toString?.() || row.employee?.toString?.();
    if (!id) return;
    if (!entries.has(id)) entries.set(id, emptyEntry(id, person));
    const entry = entries.get(id);
    entry.total += 1;
    if (row.state === 'finalized') entry.finalizedCount += 1;
    if (row.state === 'draft' && row.needsReconfirm !== false) entry.draftCount += 1;
    if (row.state === 'pending_confirmation' || row.state === 'changes_requested') entry.publishedOpenCount += 1;
    entry.latestPublishedAt = laterDate(entry.latestPublishedAt, row.publishedAt);
    entry.latestResponseAt = laterDate(entry.latestResponseAt, row.responseAt);
    if (isCurrentRoundRow(row)) entry.currentRoundCount += 1;
    else if (row.employeeResponse === 'confirmed' || row.state === 'finalized') entry.unaffectedCount += 1;
    if (isDisputedRow(row)) {
      entry.disputedCount += 1;
      addDispute(entry, row);
    } else if (row.state === 'pending_confirmation' && row.needsReconfirm !== false && row.employeeResponse !== 'confirmed') {
      entry.pendingCount += 1;
    }
  });
  return { entries: Array.from(entries.values()), rowCount: (Array.isArray(rows) ? rows : []).length };
}

const countWhen = (expression) => ({ $sum: { $cond: [expression, 1, 0] } });
const DISPUTED_EXPR = { $or: [{ $eq: ['$employeeResponse', 'disputed'] }, { $eq: ['$state', 'changes_requested'] }] };
const CURRENT_ROUND_EXPR = { $and: [{ $ne: ['$needsReconfirm', false] }, { $ne: ['$state', 'finalized'] }] };

/**
 * 整個範圍每位員工的筆數：一次彙總查詢 + 一次只讀有異議的班表。
 * employees：範圍內的員工（[{ _id, name, photo }]）；回傳 null 表示這個環境沒有彙總可用（呼叫端改用 summarizePublishRows）。
 */
export async function loadPublishSummaryEntries({ start, end, employees }) {
  if (typeof ShiftSchedule.aggregate !== 'function') return null;
  const people = new Map();
  (Array.isArray(employees) ? employees : []).forEach((person) => {
    const id = toEntityId(person?._id);
    if (id && Types.ObjectId.isValid(id)) people.set(id, person);
  });
  if (!people.size) return { entries: [], rowCount: 0 };
  const employeeIds = Array.from(people.keys()).map((id) => new Types.ObjectId(id));
  const match = { date: { $gte: start, $lt: end }, employee: { $in: employeeIds } };

  const grouped = await ShiftSchedule.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$employee',
        total: { $sum: 1 },
        finalizedCount: countWhen({ $eq: ['$state', 'finalized'] }),
        draftCount: countWhen({ $and: [{ $eq: ['$state', 'draft'] }, { $ne: ['$needsReconfirm', false] }] }),
        publishedOpenCount: countWhen({ $in: ['$state', ['pending_confirmation', 'changes_requested']] }),
        disputedCount: countWhen(DISPUTED_EXPR),
        pendingCount: countWhen({
          $and: [
            { $not: [DISPUTED_EXPR] },
            { $eq: ['$state', 'pending_confirmation'] },
            { $ne: ['$needsReconfirm', false] },
            { $ne: ['$employeeResponse', 'confirmed'] },
          ],
        }),
        currentRoundCount: countWhen(CURRENT_ROUND_EXPR),
        unaffectedCount: countWhen({
          $and: [
            { $not: [CURRENT_ROUND_EXPR] },
            { $or: [{ $eq: ['$employeeResponse', 'confirmed'] }, { $eq: ['$state', 'finalized'] }] },
          ],
        }),
        latestPublishedAt: { $max: '$publishedAt' },
        latestResponseAt: { $max: '$responseAt' },
      },
    },
  ]);
  if (!Array.isArray(grouped)) return null;

  const entries = new Map();
  let rowCount = 0;
  grouped.forEach((group) => {
    const id = toEntityId(group._id);
    if (!id) return;
    rowCount += group.total || 0;
    entries.set(id, {
      ...emptyEntry(id, people.get(id)),
      total: group.total || 0,
      finalizedCount: group.finalizedCount || 0,
      draftCount: group.draftCount || 0,
      publishedOpenCount: group.publishedOpenCount || 0,
      pendingCount: group.pendingCount || 0,
      disputedCount: group.disputedCount || 0,
      currentRoundCount: group.currentRoundCount || 0,
      unaffectedCount: group.unaffectedCount || 0,
      latestPublishedAt: laterDate(null, group.latestPublishedAt),
      latestResponseAt: laterDate(null, group.latestResponseAt),
    });
  });

  if (Array.from(entries.values()).some((entry) => entry.disputedCount > 0)) {
    const disputedRows = await ShiftSchedule.find({
      ...match,
      $or: [{ employeeResponse: 'disputed' }, { state: 'changes_requested' }],
    })
      .select('employee date responseNote responseAt')
      .sort({ date: 1 })
      .lean();
    (disputedRows || []).forEach((row) => {
      const entry = entries.get(toEntityId(row.employee));
      if (entry) addDispute(entry, row);
    });
  }
  return { entries: Array.from(entries.values()), rowCount };
}

/** 每位員工的筆數 -> 回給畫面的 publishSummary */
export function composePublishSummary({ entries, rowCount }) {
  const list = Array.isArray(entries) ? entries : [];
  let latestPublishedAt = null;
  let finalizedCount = 0;
  let unpublishedCount = 0;
  let publishedOpenCount = 0;
  const summary = {
    status: 'draft',
    pendingEmployees: [],
    disputedEmployees: [],
    publishedAt: null,
    hasSchedules: rowCount > 0,
    totalEmployees: list.length,
    allEmployeesConfirmed: false,
    currentRoundPendingEmployees: [],
    unaffectedConfirmedEmployees: [],
    // 還沒送給員工的班表筆數（新增或異動過）：已發送或已完成發布之後不是 0，代表要再發送一次
    unpublishedCount: 0,
  };
  list.forEach((entry) => {
    latestPublishedAt = laterDate(latestPublishedAt, entry.latestPublishedAt);
    finalizedCount += entry.finalizedCount;
    unpublishedCount += entry.draftCount;
    publishedOpenCount += entry.publishedOpenCount;
    if (entry.pendingCount > 0) {
      summary.pendingEmployees.push({ id: entry.id, name: entry.name, photo: entry.photo, pendingCount: entry.pendingCount });
    }
    if (entry.disputedCount > 0) {
      summary.disputedEmployees.push({
        id: entry.id,
        name: entry.name,
        photo: entry.photo,
        disputedCount: entry.disputedCount,
        latestNote: entry.latestNote,
        latestResponseAt: entry.latestResponseAt ? entry.latestResponseAt.toISOString() : null,
        disputes: entry.disputes,
      });
    }
    if (entry.currentRoundCount > 0) {
      summary.currentRoundPendingEmployees.push({ id: entry.id, name: entry.name });
    } else if (entry.unaffectedCount > 0) {
      summary.unaffectedConfirmedEmployees.push({ id: entry.id, name: entry.name });
    }
  });
  summary.publishedAt = latestPublishedAt ? latestPublishedAt.toISOString() : null;
  summary.unpublishedCount = unpublishedCount;

  if (summary.disputedEmployees.length) {
    summary.status = 'disputed';
  } else if (publishedOpenCount > 0) {
    summary.status = summary.pendingEmployees.length ? 'pending' : 'ready';
  } else if (finalizedCount > 0 && unpublishedCount === 0) {
    summary.status = 'finalized';
  } else {
    summary.status = 'draft';
  }
  summary.allEmployeesConfirmed = summary.status === 'ready'
    && summary.pendingEmployees.length === 0
    && summary.disputedEmployees.length === 0;
  return summary;
}

export default { summarizePublishRows, loadPublishSummaryEntries, composePublishSummary };
