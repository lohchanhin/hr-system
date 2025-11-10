import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

// Mock supervisor verification to always pass
jest.unstable_mockModule('../src/middleware/supervisor.js', () => ({
  verifySupervisor: (req, res, next) => next()
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
  publishSchedules: jest.fn(),
  finalizeSchedules: jest.fn(),
  respondToSchedule: jest.fn(),
  respondToSchedulesBulk: jest.fn(),
}));

let app;
let authorizeRoles;
let scheduleController;

beforeAll(async () => {
  const scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  ({ authorizeRoles } = await import('../src/middleware/auth.js'));
  scheduleController = await import('../src/controllers/scheduleController.js');

  app = express();
  app.use(express.json());
  // 模擬已驗證的員工使用者
  app.use((req, res, next) => {
    req.user = { id: 'emp1', role: 'employee' };
    next();
  });
  app.use(
    '/api/schedules',
    (req, res, next) => {
      if (req.method === 'GET') {
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
});
