import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const findOne = jest.fn();
const create = jest.fn();

jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({
  default: {
    findOne,
    create,
  },
}));

let app;
let authorizeRoles;
let attendanceSettingRoutes;

function buildDoc(overrides = {}) {
  const doc = {
    _id: 'setting-id',
    shifts: [],
    abnormalRules: {
      lateGrace: 5,
      earlyLeaveGrace: 5,
      missingThreshold: 30,
      autoNotify: true,
    },
    breakOutRules: {
      enableBreakPunch: true,
      breakInterval: 60,
      outingNeedApprove: false,
    },
    globalBreakSetting: {
      enableGlobalBreak: false,
      breakMinutes: 60,
      allowMultiBreak: false,
    },
    overtimeRules: {
      weekdayThreshold: 30,
      holidayRate: 2,
      toCompRate: 1.5,
    },
    management: {
      enableImport: false,
      importFormat: '',
      importMapping: '',
      allowMakeUpClock: true,
      makeUpDays: 3,
      makeUpNeedApprove: true,
      supervisorCrossDept: false,
      hrAllDept: true,
      employeeHistoryMonths: 6,
      nonExtWorkAlert: false,
      overtimeNoClockNotify: true,
      notifyTargets: ['員工', '主管'],
    },
    ...overrides,
  };

    doc.save = jest.fn().mockResolvedValue(doc);
    doc.toObject = jest.fn(() => ({
      _id: doc._id,
      shifts: doc.shifts,
      abnormalRules: doc.abnormalRules,
      breakOutRules: doc.breakOutRules,
      globalBreakSetting: doc.globalBreakSetting,
      overtimeRules: doc.overtimeRules,
      management: doc.management,
    }));
    return doc;
  }

beforeAll(async () => {
  ({ authorizeRoles } = await import('../src/middleware/auth.js'));
  attendanceSettingRoutes = (await import('../src/routes/attendanceSettingRoutes.js')).default;

  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { role: 'admin' };
    next();
  });
  app.use('/api/attendance-settings', authorizeRoles('admin'), attendanceSettingRoutes);
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AttendanceSetting routes', () => {
  it('returns existing setting with merged defaults', async () => {
    const doc = buildDoc({
      abnormalRules: {
        lateGrace: 10,
        autoNotify: false,
      },
    });
    findOne.mockResolvedValue(doc);

    const res = await request(app).get('/api/attendance-settings');

    expect(res.status).toBe(200);
    expect(res.body.shifts).toBeUndefined();
    expect(res.body.abnormalRules).toEqual({
      lateGrace: 10,
      earlyLeaveGrace: 5,
      missingThreshold: 30,
      autoNotify: false,
    });
    expect(res.body.breakOutRules).toEqual({
      enableBreakPunch: true,
      breakInterval: 60,
      outingNeedApprove: false,
    });
    expect(res.body.globalBreakSetting).toEqual({
      enableGlobalBreak: false,
      breakMinutes: 60,
      allowMultiBreak: false,
    });
    expect(res.body.management).toEqual({
      enableImport: false,
      importFormat: '',
      importMapping: '',
      allowMakeUpClock: true,
      makeUpDays: 3,
      makeUpNeedApprove: true,
      supervisorCrossDept: false,
      hrAllDept: true,
      employeeHistoryMonths: 6,
      nonExtWorkAlert: false,
      overtimeNoClockNotify: true,
      notifyTargets: ['員工', '主管'],
    });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('creates default setting if none exists', async () => {
    const created = buildDoc();
    findOne.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(created);

    const res = await request(app).get('/api/attendance-settings');

    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        shifts: [],
        abnormalRules: expect.objectContaining({ lateGrace: 5 }),
        globalBreakSetting: expect.objectContaining({ breakMinutes: 60 }),
        management: expect.objectContaining({ enableImport: false }),
      })
    );
    expect(res.body.shifts).toBeUndefined();
    expect(res.body.overtimeRules).toEqual({
      weekdayThreshold: 30,
      holidayRate: 2,
      toCompRate: 1.5,
    });
    expect(res.body.globalBreakSetting).toEqual({
      enableGlobalBreak: false,
      breakMinutes: 60,
      allowMultiBreak: false,
    });
  });

  it('persists updated rules', async () => {
    const doc = buildDoc();
    findOne.mockResolvedValue(doc);

    const res = await request(app)
      .put('/api/attendance-settings')
      .send({
        abnormalRules: { lateGrace: 3, autoNotify: false },
        breakOutRules: { breakInterval: 90 },
        globalBreakSetting: { enableGlobalBreak: true, breakMinutes: 75 },
        overtimeRules: { holidayRate: 2.5 },
        shifts: [{ name: '禁用班別' }],
      });

    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(doc.abnormalRules).toEqual({
      lateGrace: 3,
      earlyLeaveGrace: 5,
      missingThreshold: 30,
      autoNotify: false,
    });
    expect(doc.breakOutRules.breakInterval).toBe(90);
    expect(doc.overtimeRules.holidayRate).toBe(2.5);
    expect(doc.globalBreakSetting).toEqual({
      enableGlobalBreak: true,
      breakMinutes: 75,
      allowMultiBreak: false,
    });
    expect(doc.shifts).toEqual([]);
    expect(res.body.shifts).toBeUndefined();
    expect(res.body.abnormalRules.lateGrace).toBe(3);
    expect(res.body.breakOutRules.breakInterval).toBe(90);
    expect(res.body.globalBreakSetting.breakMinutes).toBe(75);
  });

  it('updates management preferences', async () => {
    const doc = buildDoc();
    findOne.mockResolvedValue(doc);

    const res = await request(app)
      .put('/api/attendance-settings')
      .send({
        management: {
          enableImport: true,
          notifyTargets: ['HR'],
        },
      });

    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalled();
    expect(doc.management.enableImport).toBe(true);
    expect(doc.management.notifyTargets).toEqual(['HR']);
    expect(res.body.management.enableImport).toBe(true);
    expect(res.body.management.notifyTargets).toEqual(['HR']);
  });
});
