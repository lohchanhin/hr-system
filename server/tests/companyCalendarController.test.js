import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// 行事曆設定 API：服務層（companyCalendarService）換成替身，這裡只確認路由、權限、參數與錯誤代碼的對應
const service = {
  applySnapshot: jest.fn(),
  approveYear: jest.fn(),
  buildCalendarReconciliation: jest.fn(),
  checkPublicCalendarUpdates: jest.fn(),
  dismissCalendarNotice: jest.fn(),
  fetchYearCandidates: jest.fn(),
  getCalendarYearDetail: jest.fn(),
  getSnapshotDiff: jest.fn(),
  listCalendarNotices: jest.fn(),
  listCalendarYears: jest.fn(),
  rejectSnapshot: jest.fn(),
  reopenYear: jest.fn(),
  updateYearSettings: jest.fn(),
};

let routes;

beforeAll(async () => {
  await jest.unstable_mockModule('../src/services/companyCalendarService.js', () => service);
  routes = (await import('../src/routes/companyCalendarRoutes.js')).default;
});

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
});

function buildApp(role = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (role) req.user = { id: 'admin-1', role };
    next();
  });
  app.use('/api/company-calendar', routes);
  return app;
}

const coded = (code, message, status, extra = {}) => Object.assign(new Error(message), { code, status, ...extra });

describe('company calendar routes', () => {
  it.each(['employee', 'supervisor', null])('are closed to %s', async (role) => {
    const app = buildApp(role);
    const responses = [
      await request(app).get('/api/company-calendar/years'),
      await request(app).post('/api/company-calendar/years/2026/fetch'),
      await request(app).post('/api/company-calendar/years/2026/apply').send({ snapshotId: 's1' }),
      await request(app).post('/api/company-calendar/years/2026/approve'),
      await request(app).put('/api/company-calendar/years/2026/settings').send({}),
      await request(app).post('/api/company-calendar/check-updates'),
      await request(app).get('/api/company-calendar/reconciliation'),
    ];

    expect(responses.map((response) => response.status)).toEqual(Array(7).fill(403));
    Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('lists years and returns one year in detail', async () => {
    service.listCalendarYears.mockResolvedValue({ years: [{ year: 2026, state: 'draft' }], lastApprovedDate: null, notices: [], lastCheck: {} });
    service.getCalendarYearDetail.mockResolvedValue({ year: { year: 2026 }, days: [], links: [], warnings: [] });

    const list = await request(buildApp()).get('/api/company-calendar/years');
    const detail = await request(buildApp()).get('/api/company-calendar/years/2026');
    const invalid = await request(buildApp()).get('/api/company-calendar/years/20x6');

    expect(list.status).toBe(200);
    expect(list.body.years).toEqual([{ year: 2026, state: 'draft' }]);
    expect(detail.status).toBe(200);
    expect(service.getCalendarYearDetail).toHaveBeenCalledWith(2026);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('INVALID_YEAR');
  });

  it('fetches the government calendar with the requested source and passes the actor', async () => {
    service.fetchYearCandidates.mockResolvedValue({ year: 2025, candidates: [{}, {}], conflict: true, selected: null, diff: null });

    const res = await request(buildApp()).post('/api/company-calendar/years/2025/fetch').send({ source: 'dgpa' });
    await request(buildApp()).post('/api/company-calendar/years/2025/fetch').send({ source: 'https://evil.example' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conflict: true, selected: null, diff: null });
    expect(service.fetchYearCandidates).toHaveBeenNthCalledWith(1, { year: 2025, source: 'dgpa', actorId: 'admin-1' });
    expect(service.fetchYearCandidates).toHaveBeenNthCalledWith(2, { year: 2025, source: 'auto', actorId: 'admin-1' });
  });

  it('maps source failures to 502, invalid files to 422 and out-of-range years to 400', async () => {
    service.fetchYearCandidates
      .mockRejectedValueOnce(coded('SOURCE_UNAVAILABLE', 'x', 502))
      .mockRejectedValueOnce(coded('INVALID_CSV', 'x', 422, { detail: 'ROW_COUNT' }))
      .mockRejectedValueOnce(coded('YEAR_OUT_OF_RANGE', 'x', 400));

    const unavailable = await request(buildApp()).post('/api/company-calendar/years/2026/fetch');
    const invalid = await request(buildApp()).post('/api/company-calendar/years/2026/fetch');
    const range = await request(buildApp()).post('/api/company-calendar/years/2030/fetch');

    expect(unavailable.status).toBe(502);
    expect(unavailable.body).toEqual({ code: 'SOURCE_UNAVAILABLE', error: '無法取得政府辦公日曆表，請稍後再試' });
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ code: 'INVALID_CSV', detail: 'ROW_COUNT' });
    expect(range.status).toBe(400);
    expect(range.body.code).toBe('YEAR_OUT_OF_RANGE');
  });

  it('applies a snapshot with per-change decisions and requires a snapshot id', async () => {
    service.applySnapshot.mockResolvedValue({ year: 2026, applied: { added: 0, changed: 1, removed: 0, kept: 1 }, state: 'draft' });

    const missing = await request(buildApp()).post('/api/company-calendar/years/2026/apply').send({});
    const res = await request(buildApp()).post('/api/company-calendar/years/2026/apply')
      .send({ snapshotId: 's1', decisions: { '2026-02-27': 'accept', '2026-10-26': 'keep' } });

    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('SNAPSHOT_REQUIRED');
    expect(res.status).toBe(200);
    expect(service.applySnapshot).toHaveBeenCalledWith({
      year: 2026,
      snapshotId: 's1',
      decisions: { '2026-02-27': 'accept', '2026-10-26': 'keep' },
      actorId: 'admin-1',
    });
  });

  it('returns 409 NEEDS_REVIEW_ROWS with the count when approval needs an acknowledgement', async () => {
    service.approveYear.mockRejectedValueOnce(coded('NEEDS_REVIEW_ROWS', '還有 2 筆待確認的日期', 409, { count: 2 }));
    service.approveYear.mockResolvedValueOnce({ year: 2026, state: 'approved' });

    const blocked = await request(buildApp()).post('/api/company-calendar/years/2026/approve').send({});
    const approved = await request(buildApp()).post('/api/company-calendar/years/2026/approve').send({ acknowledgeWarnings: true, note: '已確認' });

    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ code: 'NEEDS_REVIEW_ROWS', error: '還有 2 筆待確認的日期', count: 2 });
    expect(approved.status).toBe(200);
    expect(service.approveYear).toHaveBeenLastCalledWith({ year: 2026, note: '已確認', acknowledgeWarnings: true, actorId: 'admin-1' });
  });

  it('returns 400 AGREEMENT_REQUIRED when following government adjustments without an agreement', async () => {
    service.updateYearSettings.mockRejectedValue(coded('AGREEMENT_REQUIRED', '必須填寫協議文號與同意日期', 400));

    const res = await request(buildApp()).put('/api/company-calendar/years/2026/settings')
      .send({ followGovernmentAdjustments: true, adjustmentAgreement: { reference: '' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AGREEMENT_REQUIRED');
    expect(service.updateYearSettings).toHaveBeenCalledWith({
      year: 2026,
      followGovernmentAdjustments: true,
      adjustmentAgreement: { reference: '' },
      actorId: 'admin-1',
    });
  });

  it('rejects, reopens, diffs, dismisses notices, checks for updates and reports reconciliation', async () => {
    service.rejectSnapshot.mockResolvedValue({ status: 'rejected' });
    service.reopenYear.mockResolvedValue({ state: 'draft' });
    service.getSnapshotDiff.mockResolvedValue({ changes: [] });
    service.listCalendarNotices.mockResolvedValue([{ id: 'n1' }]);
    service.dismissCalendarNotice.mockResolvedValue({ id: 'n1', status: 'dismissed' });
    service.checkPublicCalendarUpdates.mockResolvedValue({ notices: [], errors: [] });
    service.buildCalendarReconciliation.mockResolvedValue({ counts: { resolutions: 1 } });
    const app = buildApp();

    expect((await request(app).post('/api/company-calendar/years/2026/reject').send({ snapshotId: 's1' })).status).toBe(200);
    expect((await request(app).post('/api/company-calendar/years/2026/reopen')).body).toEqual({ state: 'draft' });
    expect((await request(app).get('/api/company-calendar/snapshots/s1/diff')).body).toEqual({ changes: [] });
    expect((await request(app).get('/api/company-calendar/notices?status=all')).body).toEqual({ notices: [{ id: 'n1' }] });
    expect((await request(app).post('/api/company-calendar/notices/n1/dismiss')).body.status).toBe('dismissed');
    expect((await request(app).post('/api/company-calendar/check-updates')).body).toEqual({ notices: [], errors: [] });
    expect((await request(app).get('/api/company-calendar/reconciliation')).body.counts).toEqual({ resolutions: 1 });

    expect(service.listCalendarNotices).toHaveBeenCalledWith({ status: 'all' });
    expect(service.dismissCalendarNotice).toHaveBeenCalledWith('n1', 'admin-1');
    expect(service.checkPublicCalendarUpdates).toHaveBeenCalledWith({ actorId: 'admin-1', reason: 'manual' });
  });

  it('hides unexpected errors behind a generic message', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    service.listCalendarYears.mockRejectedValue(new TypeError('secret detail about 王小美'));

    const res = await request(buildApp()).get('/api/company-calendar/years');

    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain('王小美');
    expect(errorSpy).toHaveBeenCalledWith('[CompanyCalendar] request failed', 'TypeError');
    errorSpy.mockRestore();
  });
});
