import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

// Mock supervisor verification to always pass
jest.unstable_mockModule('../src/middleware/supervisor.js', () => ({
  verifySupervisor: (req, res, next) => next()
}));

jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = req.user ?? { id: 'emp1', role: 'employee' };
    next();
  },
  authorizeRoles: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  }
}));

// Mock schedule controller functions
const listSchedules = jest.fn((req, res) => {
  res.json([{ _id: 'sch1', employee: 'emp1' }]);
});
const createSchedule = jest.fn((req, res) => {
  res.status(201).json({ _id: 'sch1' });
});
const updateSchedule = jest.fn((req, res) => {
  res.json({ _id: 'sch1' });
});
const respondToSchedule = jest.fn((req, res) => {
  res.status(200).json({ status: 'ok', scheduleId: req.params.id });
});
const respondToSchedulesBulk = jest.fn((req, res) => {
  res.status(200).json({ status: 'ok', count: req.body?.length ?? 0 });
});

jest.unstable_mockModule('../src/controllers/scheduleController.js', () => ({
  listSchedules,
  createSchedule,
  getSchedule: jest.fn(),
  updateSchedule,
  deleteSchedule: jest.fn(),
  exportSchedules: jest.fn(),
  listMonthlySchedules: jest.fn(),
  createSchedulesBatch: jest.fn(),
  deleteOldSchedules: jest.fn(),
  listLeaveApprovals: jest.fn(),
  listSupervisorSummary: jest.fn(),
  listScheduleOverview: jest.fn(),
  exportScheduleOverview: jest.fn(),
  publishSchedules: jest.fn(),
  finalizeSchedules: jest.fn(),
  respondToSchedule,
  respondToSchedulesBulk,
}));

let app;
let authenticate;
let authorizeRoles;
let scheduleController;

beforeAll(async () => {
  const scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  ({ authenticate, authorizeRoles } = await import('../src/middleware/auth.js'));
  scheduleController = await import('../src/controllers/scheduleController.js');

  app = express();
  app.use(express.json());
  app.use(
    '/api/schedules',
    authenticate,
    (req, res, next) => {
      if (req.method === 'GET') {
        return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
      }
      const segments = (req.path ?? '').split('/').filter(Boolean);
      if (
        req.method === 'POST' &&
        (segments[0] === 'respond' || segments[1] === 'respond')
      ) {
        return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
      }
      return authorizeRoles('supervisor', 'admin')(req, res, next);
    },
    scheduleRoutes
  );
});

afterEach(() => {
  listSchedules.mockClear();
  createSchedule.mockClear();
  updateSchedule.mockClear();
  respondToSchedule.mockClear();
  respondToSchedulesBulk.mockClear();
});

describe('Employee schedule permissions', () => {
  it('允許員工取得自己的班表', async () => {
    const res = await request(app).get('/api/schedules?employee=emp1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ _id: 'sch1', employee: 'emp1' }]);
    expect(scheduleController.listSchedules).toHaveBeenCalled();
  });

  it('禁止員工新增他人班表', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ employee: 'emp2', date: '2023-01-02', shiftId: 'day' });
    expect(res.status).toBe(403);
    expect(scheduleController.createSchedule).not.toHaveBeenCalled();
  });

  it('禁止員工修改班表', async () => {
    const res = await request(app).put('/api/schedules/1').send({ shiftId: 'night' });
    expect(res.status).toBe(403);
    expect(scheduleController.updateSchedule).not.toHaveBeenCalled();
  });

  it('允許員工回覆單筆班表', async () => {
    const res = await request(app)
      .post('/api/schedules/123/respond')
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', scheduleId: '123' });
    const [controllerReq] = scheduleController.respondToSchedule.mock.calls.at(-1);
    expect(controllerReq.params).toEqual({ id: '123' });
  });

  it('允許員工批次回覆班表', async () => {
    const payload = [
      { scheduleId: 'sch1', status: 'accepted' },
      { scheduleId: 'sch2', status: 'declined' }
    ];
    const res = await request(app)
      .post('/api/schedules/respond/bulk')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', count: payload.length });
    const [bulkReq] = scheduleController.respondToSchedulesBulk.mock.calls.at(-1);
    expect(bulkReq.body).toEqual(payload);
  });
});
