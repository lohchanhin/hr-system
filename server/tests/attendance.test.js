import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockAttendanceRecord = jest.fn().mockImplementation((data = {}) => ({
  ...data,
  save: saveMock
}));
mockAttendanceRecord.find = jest.fn();
mockAttendanceRecord.exists = jest.fn();

const mockEmployee = {
  findById: jest.fn(),
  find: jest.fn(),
};

const mockAttendanceManagementSetting = {
  findOne: jest.fn(),
};

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceManagementSetting.js', () => ({ default: mockAttendanceManagementSetting }));
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));

let app;
let attendanceRoutes;
let currentUser;

const setupFindChain = ({ records = [], error } = {}) => {
  const populateMock = error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue(records);
  const sortMock = jest.fn().mockReturnValue({ populate: populateMock });
  mockAttendanceRecord.find.mockReturnValue({ sort: sortMock });
  return { sortMock, populateMock };
};

beforeAll(async () => {
  attendanceRoutes = (await import('../src/routes/attendanceRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (currentUser) {
      req.user = currentUser;
    }
    next();
  });
  app.use('/api/attendance', attendanceRoutes);
});

beforeEach(() => {
  mockAttendanceRecord.mockClear();
  saveMock.mockReset();
  mockAttendanceRecord.find.mockReset();
  mockAttendanceRecord.exists.mockReset();
  mockAttendanceRecord.exists.mockResolvedValue(false);
  mockEmployee.findById.mockReset();
  mockEmployee.find.mockReset();
  mockAttendanceManagementSetting.findOne.mockReset();
  mockShiftSchedule.find.mockReset();
  mockAttendanceSetting.findOne.mockReset();
  mockEmployee.findById.mockResolvedValue(null);
  mockEmployee.find.mockResolvedValue([]);
  mockAttendanceManagementSetting.findOne.mockResolvedValue(null);
  currentUser = undefined;
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-01-01T02:00:00.000Z'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setupScheduleMocks({ schedules = [], shifts = [] } = {}) {
  const leanSchedules = jest.fn().mockResolvedValue(schedules);
  mockShiftSchedule.find.mockReturnValue({ lean: leanSchedules });
  const leanSetting = jest.fn().mockResolvedValue({ shifts });
  mockAttendanceSetting.findOne.mockReturnValue({ lean: leanSetting });
}

describe('Attendance API', () => {

  it('returns punch-window settings for employee clients', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        actionBuffers: {
          clockIn: { earlyMinutes: 15, lateMinutes: 10 },
          clockOut: { earlyMinutes: 30, lateMinutes: 20 },
        },
        abnormalRules: { lateGrace: 5 },
      }),
    });

    const res = await request(app).get('/api/attendance/punch-window');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      actionBuffers: {
        clockIn: { earlyMinutes: 15, lateMinutes: 10 },
        clockOut: { earlyMinutes: 30, lateMinutes: 20 },
      },
      abnormalRules: { lateGrace: 5 },
    });
  });

  it('returns empty abnormalRules when lateGrace is not configured', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        actionBuffers: {
          clockIn: { earlyMinutes: 20, lateMinutes: 30 },
          clockOut: { earlyMinutes: 30, lateMinutes: 60 },
        },
        abnormalRules: {},
      }),
    });

    const res = await request(app).get('/api/attendance/punch-window');

    expect(res.status).toBe(200);
    expect(res.body.abnormalRules).toEqual({});
    expect(res.body.actionBuffers.clockIn.earlyMinutes).toBe(20);
  });

  it('lists records for admins with newest first', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    const { sortMock, populateMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'admin1', role: 'admin' };

    const res = await request(app).get('/api/attendance');

    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({});
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(populateMock).toHaveBeenCalledWith('employee');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 403 when supervisor queries unauthorized employee', async () => {
    currentUser = { id: 'sup1', role: 'supervisor' };
    mockEmployee.findById.mockImplementation((id) => {
      if (id === 'sup1') return Promise.resolve({ _id: 'sup1', department: 'deptA' });
      if (id === 'empX') return Promise.resolve({ _id: 'empX', department: 'deptB', supervisor: 'other' });
      return Promise.resolve(null);
    });
    mockAttendanceManagementSetting.findOne.mockResolvedValue({ supervisorCrossDept: false });

    const res = await request(app).get('/api/attendance').query({ employee: 'empX' });

    expect(res.status).toBe(403);
    expect(mockAttendanceRecord.find).not.toHaveBeenCalled();
  });

  it('scopes supervisor queries to authorized employees when no employee filter is provided', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    const { sortMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'sup1', role: 'supervisor' };
    mockEmployee.findById.mockResolvedValue({ _id: 'sup1', department: 'deptA' });
    mockEmployee.find.mockImplementation((filter) => {
      if (filter.supervisor === 'sup1') {
        return Promise.resolve([
          { _id: 'empA', department: 'deptA', supervisor: 'sup1' },
          { _id: 'empB', department: 'deptB', supervisor: 'sup1' }
        ]);
      }
      if (filter.department === 'deptA') {
        return Promise.resolve([
          { _id: 'empA', department: 'deptA', supervisor: 'sup1' },
          { _id: 'empC', department: 'deptA', supervisor: 'sup2' },
          { _id: 'sup1', department: 'deptA' }
        ]);
      }
      return Promise.resolve([]);
    });
    mockAttendanceManagementSetting.findOne.mockResolvedValue({ supervisorCrossDept: false });

    const res = await request(app).get('/api/attendance');

    expect(res.status).toBe(200);
    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({ employee: { $in: expect.any(Array) } });
    const scopedIds = mockAttendanceRecord.find.mock.calls[0][0].employee.$in;
    expect(scopedIds).toEqual(expect.arrayContaining(['empA', 'empC']));
    expect(scopedIds).not.toContain('empB');
    expect(scopedIds).not.toContain('sup1');
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(res.body).toEqual(fakeRecords);
  });

  it('restricts employees to their own records and sorts by newest first', async () => {
    const fakeRecords = [{ action: 'clockOut' }];
    const { sortMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'emp1', role: 'employee' };

    const res = await request(app).get('/api/attendance').query({ employee: 'someoneElse' });

    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({ employee: 'emp1' });
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 500 if listing fails', async () => {
    setupFindChain({ error: new Error('fail') });

    const res = await request(app).get('/api/attendance');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates record with remark when within window', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shift1' }],
      shifts: [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    });
    const payload = {
      action: 'clockIn',
      employee: 'emp1',
      remark: 'test',
      timestamp: '2024-01-01T02:00:00.000Z'
    };
    saveMock.mockResolvedValue();

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject({ action: 'clockIn', employee: 'emp1', remark: 'test' });
    expect(res.body.punchKey).toBeUndefined();
    expect(mockAttendanceRecord.mock.calls.at(-1)[0].timestamp.toISOString()).toBe(
      '2024-01-01T02:00:00.000Z'
    );
  });

  it('rejects clock-in on a regular rest day', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'regular-rest' }],
      shifts: [{
        _id: 'regular-rest',
        code: 'REG',
        name: '例假',
        startTime: '09:00',
        endTime: '18:00',
      }],
    });

    const res = await request(app).post('/api/attendance').send({
      action: 'clockIn',
      employee: 'emp1',
      remark: 'CODEX_TEST_REGULAR_REST',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: '例假不得打卡或加班',
      rule: 'regular-rest-attendance',
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  describe('non-work shifts (rest day / regular rest / national holiday / leave)', () => {
    const zeroShift = (_id, code, name, semanticType) => ({
      _id, code, name, startTime: '00:00', endTime: '00:00', semanticType,
    });
    const scheduleOn = (date, shiftId, _id = `sched-${shiftId}`) => ({ _id, employee: 'emp1', date, shiftId });
    const TODAY = new Date(Date.UTC(2024, 0, 1));
    const YESTERDAY = new Date(Date.UTC(2023, 11, 31));

    it.each([
      ['rest_day', '休', '休假', { error: '今日為休息日，不需打卡', rule: 'non-work-day-attendance' }],
      ['holiday', '國', '國定假日', { error: '今日為國定假日，不需打卡', rule: 'non-work-day-attendance' }],
      ['leave', '特', '特休', { error: '今日為請假日，不需打卡', rule: 'non-work-day-attendance' }],
      ['regular_rest', '例', '例假', { error: '例假不得打卡或加班', rule: 'regular-rest-attendance' }],
    ])('rejects both clock actions on a %s day with an explicit day-off reason', async (semanticType, code, name, expected) => {
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(TODAY, 'off')],
        shifts: [zeroShift('off', code, name, semanticType)],
      });

      for (const action of ['clockIn', 'clockOut']) {
        const res = await request(app).post('/api/attendance').send({ action, employee: 'emp1' });
        expect(res.status).toBe(400);
        expect(res.body).toEqual(expected);
      }
      expect(saveMock).not.toHaveBeenCalled();
      expect(mockAttendanceRecord.exists).not.toHaveBeenCalled();
    });

    it('treats a shift without working time as a day off even if its semantic type says work', async () => {
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(TODAY, 'legacy')],
        shifts: [zeroShift('legacy', 'XX', '未分類', 'work')],
      });

      const res = await request(app).post('/api/attendance').send({ action: 'clockIn', employee: 'emp1' });

      expect(res.status).toBe(400);
      expect(res.body.rule).toBe('non-work-day-attendance');
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('does not offer the old 23:00-04:00 window on a day off', async () => {
      // 台北時間 2024-01-01 23:30（舊的 24 小時視窗內）
      Date.now.mockReturnValue(Date.parse('2024-01-01T15:30:00.000Z'));
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(TODAY, 'rest')],
        shifts: [zeroShift('rest', '休', '休假', 'rest_day')],
      });

      const res = await request(app).post('/api/attendance').send({ action: 'clockIn', employee: 'emp1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('今日為休息日，不需打卡');
      expect(res.body.allowedWindow).toBeUndefined();
    });

    it("still allows the clock-out of yesterday's cross-day night shift on the morning of a day off", async () => {
      // 台北時間 2024-01-01 06:30，昨天的 22:00-06:00 夜班剛下班，今天排休
      Date.now.mockReturnValue(Date.parse('2023-12-31T22:30:00.000Z'));
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(YESTERDAY, 'night', 'sched-night'), scheduleOn(TODAY, 'rest')],
        shifts: [
          { _id: 'night', code: 'N', name: '夜班', startTime: '22:00', endTime: '06:00', crossDay: true, semanticType: 'work' },
          zeroShift('rest', '休', '休假', 'rest_day'),
        ],
      });
      mockAttendanceRecord.exists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      saveMock.mockResolvedValue();

      const clockOut = await request(app).post('/api/attendance').send({ action: 'clockOut', employee: 'emp1' });
      expect(clockOut.status).toBe(201);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(mockAttendanceRecord.mock.calls.at(-1)[0].punchKey).toBe('emp1:sched-night:clockOut');

      // 但今天休假，不能再用這個時間上班簽到
      const clockIn = await request(app).post('/api/attendance').send({ action: 'clockIn', employee: 'emp1' });
      expect(clockIn.status).toBe(400);
      expect(clockIn.body.rule).toBe('non-work-day-attendance');
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("does not fall back to yesterday's finished day shift on a day off", async () => {
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(YESTERDAY, 'day'), scheduleOn(TODAY, 'rest')],
        shifts: [
          { _id: 'day', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', semanticType: 'work' },
          zeroShift('rest', '休', '休假', 'rest_day'),
        ],
      });

      const res = await request(app).post('/api/attendance').send({ action: 'clockIn', employee: 'emp1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('今日為休息日，不需打卡');
    });

    it('treats a yesterday-only day off as no schedule today', async () => {
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(YESTERDAY, 'rest')],
        shifts: [zeroShift('rest', '休', '休假', 'rest_day')],
      });

      const res = await request(app).post('/api/attendance').send({ action: 'clockIn', employee: 'emp1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('今日未設定班表，請洽管理員');
    });

    it('lets a normal day shift punch in when yesterday was a day off', async () => {
      currentUser = { id: 'emp1', role: 'employee' };
      setupScheduleMocks({
        schedules: [scheduleOn(YESTERDAY, 'rest'), scheduleOn(TODAY, 'day')],
        shifts: [
          { _id: 'day', code: '日', name: '日班', startTime: '09:00', endTime: '18:00', semanticType: 'work' },
          zeroShift('rest', '休', '休假', 'rest_day'),
        ],
      });
      saveMock.mockResolvedValue();

      const res = await request(app).post('/api/attendance').send({ action: 'clockIn', employee: 'emp1' });

      expect(res.status).toBe(201);
      expect(mockAttendanceRecord.mock.calls.at(-1)[0].punchKey).toBe('emp1:sched-day:clockIn');
    });
  });

  it('rejects clockIn before allowed window', async () => {
    Date.now.mockReturnValue(Date.parse('2023-12-31T23:30:00.000Z'));
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shift1' }],
      shifts: [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    });
    const payload = {
      action: 'clockIn',
      employee: 'emp1',
      timestamp: '2023-12-31T23:30:00.000Z'
    };

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('尚未開放');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rejects clockOut after allowed window', async () => {
    Date.now.mockReturnValue(Date.parse('2024-01-01T12:30:00.000Z'));
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shift1' }],
      shifts: [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    });
    const payload = {
      action: 'clockOut',
      employee: 'emp1',
      timestamp: '2024-01-01T12:30:00.000Z'
    };

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('時段已結束');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('accepts clockOut during cross-day shift on following morning', async () => {
    Date.now.mockReturnValue(Date.parse('2024-01-01T21:30:00.000Z'));
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shiftNight' }],
      shifts: [{ _id: 'shiftNight', startTime: '22:00', endTime: '06:00', crossDay: true }]
    });
    const payload = {
      action: 'clockOut',
      employee: 'emp1',
      timestamp: '2024-01-01T21:30:00.000Z'
    };
    mockAttendanceRecord.exists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    saveMock.mockResolvedValue();

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
  });

  it('rejects a duplicate clock action for the same scheduled shift', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shift1' }],
      shifts: [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    });
    mockAttendanceRecord.exists.mockResolvedValueOnce(true);

    const res = await request(app).post('/api/attendance').send({
      action: 'clockIn',
      employee: 'emp1',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already recorded');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('requires a clock-in before clock-out', async () => {
    Date.now.mockReturnValue(Date.parse('2024-01-01T09:30:00.000Z'));
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shift1' }],
      shifts: [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    });
    mockAttendanceRecord.exists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const res = await request(app).post('/api/attendance').send({
      action: 'clockOut',
      employee: 'emp1',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Clock-in is required');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('ignores a valid client timestamp and stores the server time', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    const scheduleDate = new Date(Date.UTC(2024, 0, 1));
    setupScheduleMocks({
      schedules: [{ _id: 'sched1', employee: 'emp1', date: scheduleDate, shiftId: 'shift1' }],
      shifts: [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    });
    saveMock.mockResolvedValue();

    const res = await request(app).post('/api/attendance').send({
      action: 'clockIn',
      employee: 'emp1',
      timestamp: '1999-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(mockAttendanceRecord.mock.calls.at(-1)[0].timestamp.toISOString()).toBe(
      '2024-01-01T02:00:00.000Z'
    );
  });

  it('returns 400 when employee is missing', async () => {
    currentUser = { id: 'emp1', role: 'employee' };
    const payload = { action: 'clockIn' };

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rejects writing an attendance record for another employee', async () => {
    currentUser = { id: 'emp1', role: 'employee' };

    const res = await request(app).post('/api/attendance').send({
      employee: 'admin1',
      action: 'outing',
      timestamp: '2024-01-01T02:00:00.000Z',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(saveMock).not.toHaveBeenCalled();
  });
});
