import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';

// 唯讀的行事曆檢視 /api/holiday-calendar（排班頁標頭、請假單提醒）：回應格式、參數檢查，
// 以及透過真實 Express app（src/index.js）掛載後的登入與角色權限。

process.env.PORT = process.env.PORT || '3000';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes';

const mockEmployee = { findById: jest.fn(), find: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMove = { find: jest.fn() };
const mockIsTokenBlacklisted = jest.fn();

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMove }));
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  isTokenBlacklisted: mockIsTokenBlacklisted,
  blacklistToken: jest.fn(),
}));
const { CalendarYear } = await registerHolidayResolverModelMocks(jest);

const { getHolidayCalendarHeaders, getHolidayCalendarStatus, buildCalendarStatusMessage } = await import(
  '../src/controllers/holidayCalendarViewController.js'
);

const day = (key) => new Date(`${key}T00:00:00.000Z`);
const ROWS_2026_FEB = [
  ...[['2026-02-15', '小年夜'], ['2026-02-16', '農曆除夕'], ['2026-02-17', '春節'], ['2026-02-18', '春節'], ['2026-02-19', '春節'], ['2026-02-28', '和平紀念日']]
    .map(([key, name], index) => ({ _id: `s${index}`, date: day(key), kind: 'statutory', name, type: '國定假日', source: 'dgpa' })),
  { _id: 'g1', date: day('2026-02-20'), kind: 'gov_makeup_off', name: '補假', source: 'dgpa', compensatesDate: day('2026-02-15'), compensatesName: '小年夜' },
  { _id: 'g2', date: day('2026-02-27'), kind: 'gov_makeup_off', name: '補假', source: 'dgpa', compensatesDate: day('2026-02-28'), compensatesName: '和平紀念日' },
];

function leanQuery(value) {
  const query = { select: jest.fn(() => query), sort: jest.fn(() => query), lean: jest.fn(async () => value) };
  return query;
}

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  mockHoliday.find.mockReset().mockReturnValue(leanQuery(ROWS_2026_FEB));
  mockHolidayMove.find.mockReset().mockReturnValue(leanQuery([]));
  CalendarYear.__setRows([]);
});

describe('GET /api/holiday-calendar/headers（controller）', () => {
  it('回傳本月標頭與年度狀態：國定假日與公務機關補假資訊分開', async () => {
    CalendarYear.__setRows([{ year: 2026, state: 'approved' }]);
    const res = mockResponse();
    await getHolidayCalendarHeaders({ query: { month: '2026-02' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.month).toBe('2026-02');
    expect(body.status).toEqual({ year: 2026, state: 'approved', migrated: false, provisional: false, synthetic: false, message: '' });
    expect(body.entries.filter((entry) => entry.displayKind === 'holiday').map((entry) => entry.date)).toEqual([
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28',
    ]);
    expect(body.entries.find((entry) => entry.date === '2026-02-20')).toMatchObject({
      kind: 'gov_makeup_off',
      displayKind: 'gov_info',
      label: '公務機關補假',
      compensatesDate: '2026-02-15',
      compensatesName: '小年夜',
      appliesTo: 'office',
    });
    expect(Object.keys(body.entries[0]).sort()).toEqual([
      'appliesTo', 'compensatesDate', 'compensatesName', 'date', 'displayKind', 'kind', 'label',
      'movedFrom', 'movedTo', 'name', 'needsReview', 'synthetic',
    ]);
  });

  it('年度未核定時附上提醒文字', async () => {
    CalendarYear.__setRows([{ year: 2026, state: 'draft', migrated: true }]);
    const res = mockResponse();
    await getHolidayCalendarHeaders({ query: { month: '2026-02' } }, res);
    expect(res.json.mock.calls[0][0].status).toEqual({
      year: 2026,
      state: 'draft',
      migrated: true,
      provisional: true,
      synthetic: false,
      message: '2026 年公司行事曆由舊版資料轉換、尚未核定，國定假日標示僅供參考',
    });
  });

  it.each(['', '2026-13', '2026-2', 'abc'])('月份「%s」不合法回傳 400', async (month) => {
    const res = mockResponse();
    await getHolidayCalendarHeaders({ query: { month } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: '需要提供有效月份 (YYYY-MM)', code: 'INVALID_MONTH' });
    expect(mockHoliday.find).not.toHaveBeenCalled();
  });

  it('讀取失敗回傳 500，記錄只寫錯誤名稱', async () => {
    mockHoliday.find.mockReturnValue({ lean: () => Promise.reject(Object.assign(new Error('secret detail'), { name: 'MongoServerError' })) });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockResponse();
    await getHolidayCalendarHeaders({ query: { month: '2026-02' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: '無法讀取公司行事曆', code: 'CALENDAR_UNAVAILABLE' });
    expect(errorSpy).toHaveBeenCalledWith('Failed to load holiday calendar headers', 'MongoServerError');
    errorSpy.mockRestore();
  });

  it('年度提醒文字', () => {
    expect(buildCalendarStatusMessage({ year: 2028, state: 'none', synthetic: true })).toBe(
      '尚未建立 2028 年公司行事曆，目前只標示固定日期的國定假日（農曆節日未列入）',
    );
    expect(buildCalendarStatusMessage({ year: 2028, state: 'none', synthetic: false })).toBe('尚未建立 2028 年公司行事曆');
    expect(buildCalendarStatusMessage({ year: 2027, state: 'draft' })).toBe('2027 年公司行事曆尚未核定，國定假日標示僅供參考');
    expect(buildCalendarStatusMessage({ year: 2026, state: 'approved' })).toBe('');
  });
});

describe('GET /api/holiday-calendar/status（controller）', () => {
  it('回傳期間涵蓋的年度狀態；to 預設為 from', async () => {
    CalendarYear.__setRows([{ year: 2026, state: 'approved' }]);
    const res = mockResponse();
    await getHolidayCalendarStatus({ query: { from: '2026-12-20', to: '2027-01-05' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.years.map((item) => [item.year, item.state])).toEqual([[2026, 'approved'], [2027, 'none']]);
    expect(body).toMatchObject({ provisional: true, provisionalYears: [2027] });

    const single = mockResponse();
    await getHolidayCalendarStatus({ query: { from: '2026-06-01' } }, single);
    expect(single.json.mock.calls[0][0]).toMatchObject({ provisional: false, years: [expect.objectContaining({ year: 2026 })] });
  });

  it('日期不合法、結束早於開始、超過 3 年都回傳 400', async () => {
    const cases = [
      [{ from: 'x' }, 'INVALID_DATE'],
      [{ from: '2026-02-30' }, 'INVALID_DATE'],
      [{ from: '2026-05-01', to: '2026-04-01' }, 'INVALID_RANGE'],
      [{ from: '2026-01-01', to: '2029-01-03' }, 'RANGE_TOO_LONG'],
    ];
    for (const [query, code] of cases) {
      const res = mockResponse();
      await getHolidayCalendarStatus({ query }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0]).toMatchObject({ code });
    }
    const ok = mockResponse();
    await getHolidayCalendarStatus({ query: { from: '2026-01-01', to: '2028-12-31' } }, ok);
    expect(ok.status).not.toHaveBeenCalled();
  });
});

describe('/api/holiday-calendar mount（src/index.js）', () => {
  let app;

  beforeAll(async () => {
    ({ app } = await import('../src/index.js'));
  });

  beforeEach(() => {
    mockIsTokenBlacklisted.mockReset().mockResolvedValue(false);
  });

  function authHeader(role) {
    const id = '507f1f77bcf86c0000000001';
    mockEmployee.findById.mockReset().mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: id, role, status: '在職', accountEnabled: true, authVersion: 0 }),
    });
    const token = jwt.sign({ id, role, ver: 0 }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: 'hr-system',
      audience: 'hr-system-api',
    });
    return `Bearer ${token}`;
  }

  it('需要登入', async () => {
    const res = await request(app).get('/api/holiday-calendar/headers?month=2026-02');
    expect(res.status).toBe(401);
  });

  it.each(['employee', 'supervisor', 'admin'])('%s 可以讀標頭與年度狀態', async (role) => {
    const header = authHeader(role);
    const headers = await request(app).get('/api/holiday-calendar/headers?month=2026-02').set('Authorization', header);
    expect(headers.status).toBe(200);
    expect(headers.body.entries.some((entry) => entry.date === '2026-02-28' && entry.displayKind === 'holiday')).toBe(true);
    const status = await request(app).get('/api/holiday-calendar/status?from=2026-02-01').set('Authorization', header);
    expect(status.status).toBe(200);
    expect(status.body.years).toEqual([expect.objectContaining({ year: 2026 })]);
  });

  it('不提供寫入', async () => {
    const res = await request(app).post('/api/holiday-calendar/headers').set('Authorization', authHeader('admin')).send({});
    expect(res.status).toBe(404);
  });
});
