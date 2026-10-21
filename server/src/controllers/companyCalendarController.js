/**
 * 行事曆設定（管理員）：年度清單、取得政府資料、差異、套用／退回、核定／重新開啟、年度設定、提醒、對帳報告。
 * 路由掛在 /api/company-calendar（authenticate + 管理員）。
 */
import {
  applySnapshot,
  approveYear,
  buildCalendarReconciliation,
  checkPublicCalendarUpdates,
  dismissCalendarNotice,
  fetchYearCandidates,
  getCalendarYearDetail,
  getSnapshotDiff,
  listCalendarNotices,
  listCalendarYears,
  rejectSnapshot,
  reopenYear,
  updateYearSettings,
} from '../services/companyCalendarService.js';

const SOURCE_UNAVAILABLE_MESSAGE = '無法取得政府辦公日曆表，請稍後再試';

function actorIdOf(req) {
  return req.user?.id || req.user?.userId || req.user?._id || null;
}

function parseYear(value) {
  const year = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || String(year) !== String(value ?? '').trim()) return null;
  return year;
}

function sendError(res, error, fallbackMessage) {
  const code = error?.code;
  if (code === 'SOURCE_UNAVAILABLE') {
    return res.status(502).json({ code, error: SOURCE_UNAVAILABLE_MESSAGE });
  }
  if (code === 'INVALID_CSV') {
    return res.status(422).json({ code, detail: error.detail || '', error: '政府辦公日曆表的內容格式不正確，未寫入任何資料' });
  }
  if (code === 'YEAR_OUT_OF_RANGE') {
    return res.status(400).json({ code, error: '只能取得 2017 年到明年的政府辦公日曆表' });
  }
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code) && Number.isInteger(error?.status)) {
    const body = { code, error: error.message };
    if (error.count !== undefined) body.count = error.count;
    return res.status(error.status).json(body);
  }
  console.error('[CompanyCalendar] request failed', error?.name ?? 'Error');
  return res.status(500).json({ error: fallbackMessage });
}

function requireYear(req, res) {
  const year = parseYear(req.params.year);
  if (year === null) {
    res.status(400).json({ code: 'INVALID_YEAR', error: '年度格式不正確' });
    return null;
  }
  return year;
}

export async function listYears(_req, res) {
  try {
    res.json(await listCalendarYears());
  } catch (error) {
    sendError(res, error, '讀取行事曆年度失敗');
  }
}

export async function getYear(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  try {
    res.json(await getCalendarYearDetail(year));
  } catch (error) {
    sendError(res, error, '讀取行事曆失敗');
  }
}

export async function fetchYear(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  const source = ['auto', 'dgpa', 'ruyut'].includes(req.body?.source) ? req.body.source : 'auto';
  try {
    res.json(await fetchYearCandidates({ year, source, actorId: actorIdOf(req) }));
  } catch (error) {
    sendError(res, error, SOURCE_UNAVAILABLE_MESSAGE);
  }
}

export async function snapshotDiff(req, res) {
  try {
    res.json(await getSnapshotDiff(req.params.id));
  } catch (error) {
    sendError(res, error, '讀取差異失敗');
  }
}

export async function applyYear(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  const { snapshotId, decisions } = req.body || {};
  if (!snapshotId) return res.status(400).json({ code: 'SNAPSHOT_REQUIRED', error: '請選擇要套用的政府資料' });
  const safeDecisions = decisions && typeof decisions === 'object' && !Array.isArray(decisions) ? decisions : {};
  try {
    res.json(await applySnapshot({ year, snapshotId, decisions: safeDecisions, actorId: actorIdOf(req) }));
  } catch (error) {
    sendError(res, error, '套用政府資料失敗');
  }
}

export async function rejectYearSnapshot(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  const { snapshotId } = req.body || {};
  if (!snapshotId) return res.status(400).json({ code: 'SNAPSHOT_REQUIRED', error: '請選擇要退回的政府資料' });
  try {
    res.json(await rejectSnapshot({ year, snapshotId, actorId: actorIdOf(req) }));
  } catch (error) {
    sendError(res, error, '退回政府資料失敗');
  }
}

export async function approve(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  try {
    res.json(await approveYear({
      year,
      note: req.body?.note || '',
      acknowledgeWarnings: req.body?.acknowledgeWarnings === true,
      actorId: actorIdOf(req),
    }));
  } catch (error) {
    sendError(res, error, '核定失敗');
  }
}

export async function reopen(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  try {
    res.json(await reopenYear({ year, actorId: actorIdOf(req) }));
  } catch (error) {
    sendError(res, error, '重新開啟失敗');
  }
}

export async function updateSettings(req, res) {
  const year = requireYear(req, res);
  if (year === null) return;
  try {
    res.json(await updateYearSettings({
      year,
      followGovernmentAdjustments: req.body?.followGovernmentAdjustments === true,
      adjustmentAgreement: req.body?.adjustmentAgreement || {},
      actorId: actorIdOf(req),
    }));
  } catch (error) {
    sendError(res, error, '儲存年度設定失敗');
  }
}

export async function listNotices(req, res) {
  try {
    res.json({ notices: await listCalendarNotices({ status: String(req.query.status || 'open') }) });
  } catch (error) {
    sendError(res, error, '讀取提醒失敗');
  }
}

export async function dismissNotice(req, res) {
  try {
    res.json(await dismissCalendarNotice(req.params.id, actorIdOf(req)));
  } catch (error) {
    sendError(res, error, '略過提醒失敗');
  }
}

export async function checkUpdates(req, res) {
  try {
    res.json(await checkPublicCalendarUpdates({ actorId: actorIdOf(req), reason: 'manual' }));
  } catch (error) {
    sendError(res, error, SOURCE_UNAVAILABLE_MESSAGE);
  }
}

export async function reconciliation(_req, res) {
  try {
    res.json(await buildCalendarReconciliation());
  } catch (error) {
    sendError(res, error, '讀取對帳報告失敗');
  }
}
