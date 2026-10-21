import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import HolidayMoveSetting from '../src/models/HolidayMoveSetting.js';

const agreement = { agreementReference: 'LABOR-MEETING-2036-04', agreementDate: '2036-03-20' };

describe('HolidayMoveSetting', () => {
  it('keeps legacy feature-toggle records valid', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: false,
      needSignature: true,
      needMakeup: false,
    });

    await expect(setting.validate()).resolves.toBeUndefined();
    expect(setting.sourceDate).toBeNull();
    expect(setting.targetDate).toBeNull();
  });

  it('accepts and normalizes a national-holiday move within the same month', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07T10:30:00.000Z',
      targetDate: '2036-04-20T23:30:00.000Z',
      reason: 'CODEX_TEST_SAME_MONTH_MOVE',
      ...agreement,
    });

    await expect(setting.validate()).resolves.toBeUndefined();
    expect(setting.sourceDate.toISOString()).toBe('2036-04-07T00:00:00.000Z');
    expect(setting.targetDate.toISOString()).toBe('2036-04-20T00:00:00.000Z');
  });

  // 舊規則：只能同月挪移。新規則：可以跨月（例如 2027-02-28 週日的和平紀念日改到 3/2），但不超過 366 天
  it('accepts moving a national holiday into another month', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2027-02-28',
      targetDate: '2027-03-02',
      ...agreement,
    });

    await expect(setting.validate()).resolves.toBeUndefined();
    expect(setting.targetDate.toISOString()).toBe('2027-03-02T00:00:00.000Z');
  });

  it('rejects a move of more than 366 days', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2026-01-01',
      targetDate: '2027-01-03',
      ...agreement,
    });

    await expect(setting.validate()).rejects.toThrow('national holiday moves must stay within 366 days');
  });

  it('requires source and target dates together', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07',
    });

    await expect(setting.validate()).rejects.toThrow('provided together');
  });

  it('requires agreement evidence and makeup confirmation when enabled', async () => {
    const missingEvidence = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07',
      targetDate: '2036-04-20',
      needSignature: true,
    });
    await expect(missingEvidence.validate()).rejects.toThrow('agreement reference');

    const complete = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07',
      targetDate: '2036-04-20',
      needSignature: true,
      ...agreement,
      needMakeup: true,
      makeupConfirmed: true,
    });
    await expect(complete.validate()).resolves.toBeUndefined();

    const unconfirmed = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07',
      targetDate: '2036-04-20',
      ...agreement,
      needMakeup: true,
    });
    await expect(unconfirmed.validate()).rejects.toThrow('makeup holiday must be explicitly confirmed');
  });

  // 舊規則：只有勾選「需經簽核」才要協議資料。新規則：日期挪移一律需要協議文號與日期
  it('requires the agreement reference and date even when needSignature is off', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      needSignature: false,
      sourceDate: '2036-04-07',
      targetDate: '2036-04-20',
    });

    await expect(setting.validate()).rejects.toThrow('labor agreement reference and date are required');
    expect(new HolidayMoveSetting({}).needSignature).toBe(true);
  });
});

describe('holidayMoveSettingController source and target checks', () => {
  const findHolidays = jest.fn();
  const swapExists = jest.fn();
  const compensationExists = jest.fn();
  let moveExists;
  let app;

  beforeAll(async () => {
    await jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: { find: findHolidays } }));
    await jest.unstable_mockModule('../src/models/HolidaySwap.js', () => ({ default: { exists: swapExists } }));
    // 目標日不能是員工已排定的補假日：補假義務模型的替身
    await jest.unstable_mockModule('../src/models/HolidayCompensation.js', () => ({ default: { exists: compensationExists } }));
    const routes = (await import('../src/routes/holidayMoveSettingRoutes.js')).default;
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: '507f1f77bcf86cd799439011', role: 'admin' }; next(); });
    app.use('/api/holiday-move-settings', routes);
  });

  const rowsByDate = (map) => (filter) => ({
    lean: async () => map[new Date(filter.date).toISOString().slice(0, 10)] || [],
  });
  const body = { enableHolidayMove: true, sourceDate: '2027-02-28', targetDate: '2027-03-02', ...agreement };

  beforeEach(() => {
    findHolidays.mockReset();
    swapExists.mockReset();
    swapExists.mockResolvedValue(null);
    compensationExists.mockReset();
    compensationExists.mockResolvedValue(null);
    // 目標日不能和另一筆全公司調移同一天：查詢其他調移（沒有資料庫連線，換成替身）
    moveExists?.mockRestore();
    moveExists = jest.spyOn(HolidayMoveSetting, 'exists').mockResolvedValue(null);
  });

  it('rejects a source that is not a statutory holiday (e.g. a government make-up day)', async () => {
    findHolidays.mockImplementation(rowsByDate({ '2027-02-28': [{ kind: 'gov_makeup_off', name: '補假' }] }));

    const res = await request(app).post('/api/holiday-move-settings').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sourceDate must reference a statutory holiday');
  });

  it('rejects a target that is already a statutory or designated holiday', async () => {
    findHolidays.mockImplementation(rowsByDate({
      '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }],
      '2027-03-02': [{ kind: 'designated', name: '選舉' }],
    }));

    const res = await request(app).post('/api/holiday-move-settings').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('targetDate is already a holiday');
  });

  it('returns 409 SWAP_EXISTS when an employee already swapped that holiday personally', async () => {
    findHolidays.mockImplementation(rowsByDate({ '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }] }));
    swapExists.mockResolvedValue({ _id: 'swap-1' });

    const res = await request(app).post('/api/holiday-move-settings').send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SWAP_EXISTS');
  });

  it('saves a cross-month move whose source is statutory and whose target is a normal day', async () => {
    findHolidays.mockImplementation(rowsByDate({ '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }] }));
    const save = jest.spyOn(HolidayMoveSetting.prototype, 'save').mockImplementation(async function saveStub() { return this; });

    const res = await request(app).post('/api/holiday-move-settings').send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sourceDate: '2027-02-28T00:00:00.000Z', targetDate: '2027-03-02T00:00:00.000Z', needSignature: true });
    expect(swapExists).toHaveBeenCalledWith({ originalDate: new Date('2027-02-28T00:00:00.000Z'), status: 'active' });
    save.mockRestore();
  });

  // 目標日已是行政人員的公務機關補假：同一天兩個假，行政人員會少放一天
  it('rejects a target that is a government make-up day', async () => {
    findHolidays.mockImplementation(rowsByDate({
      '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }],
      '2027-03-02': [{ kind: 'gov_makeup_off', name: '補假' }],
    }));
    const save = jest.spyOn(HolidayMoveSetting.prototype, 'save').mockImplementation(async function saveStub() { return this; });

    const res = await request(app).post('/api/holiday-move-settings').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('targetDate is already a holiday');
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it('returns 409 TARGET_TAKEN when another company move already uses the target date', async () => {
    findHolidays.mockImplementation(rowsByDate({ '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }] }));
    moveExists.mockResolvedValue({ _id: 'move-other' });
    const save = jest.spyOn(HolidayMoveSetting.prototype, 'save').mockImplementation(async function saveStub() { return this; });

    const res = await request(app).post('/api/holiday-move-settings').send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TARGET_TAKEN');
    const [filter] = moveExists.mock.calls[0];
    expect(filter).toMatchObject({ enableHolidayMove: true, targetDate: new Date('2027-03-02T00:00:00.000Z') });
    expect(filter._id.$ne).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it('returns 409 TARGET_TAKEN when the target is an employee\'s personal swap date or assigned 補假', async () => {
    findHolidays.mockImplementation(rowsByDate({ '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }] }));
    swapExists.mockImplementation(async (filter) => (filter.targetDate ? { _id: 'swap-target' } : null));
    const save = jest.spyOn(HolidayMoveSetting.prototype, 'save').mockImplementation(async function saveStub() { return this; });

    const swapTarget = await request(app).post('/api/holiday-move-settings').send(body);

    swapExists.mockReset();
    swapExists.mockResolvedValue(null);
    compensationExists.mockResolvedValue({ _id: 'compensation-1' });
    const compensationTarget = await request(app).post('/api/holiday-move-settings').send(body);

    expect([swapTarget.status, swapTarget.body.code]).toEqual([409, 'TARGET_TAKEN']);
    expect([compensationTarget.status, compensationTarget.body.code]).toEqual([409, 'TARGET_TAKEN']);
    expect(compensationExists).toHaveBeenCalledWith({ assignedDate: new Date('2027-03-02T00:00:00.000Z'), status: 'assigned' });
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it('checks the target again when an existing move is edited, ignoring the move itself', async () => {
    findHolidays.mockImplementation(rowsByDate({ '2027-02-28': [{ kind: 'statutory', name: '和平紀念日' }] }));
    const existing = new HolidayMoveSetting({ enableHolidayMove: true, sourceDate: '2027-02-28', targetDate: '2027-03-03', ...agreement });
    const findById = jest.spyOn(HolidayMoveSetting, 'findById').mockResolvedValue(existing);
    const save = jest.spyOn(HolidayMoveSetting.prototype, 'save').mockImplementation(async function saveStub() { return this; });
    moveExists.mockResolvedValue({ _id: 'move-other' });

    const res = await request(app).put(`/api/holiday-move-settings/${existing._id}`).send({ targetDate: '2027-03-02' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TARGET_TAKEN');
    expect(String(moveExists.mock.calls[0][0]._id.$ne)).toBe(String(existing._id));
    expect(save).not.toHaveBeenCalled();
    findById.mockRestore();
    save.mockRestore();
  });
});
