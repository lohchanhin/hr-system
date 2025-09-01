import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockShiftSchedule = { find: jest.fn() };
const mockEmployee = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));

jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'sup1', role: 'supervisor' };
    next();
  },
  authorizeRoles: () => (req, res, next) => next(),
}));

let app;
let scheduleRoutes;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  mockShiftSchedule.find.mockReset();
  mockEmployee.find.mockReset();
  mockAttendanceSetting.findOne.mockReset();
});

describe('Supervisor schedule summary', () => {
  it('主管只能取得自己員工的摘要', async () => {
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: 'emp1', name: 'Emp1' },
        { _id: 'emp2', name: 'Emp2' },
      ]),
    });

    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        shifts: [{ _id: 'shift1', name: '早班' }],
      }),
    });

    mockShiftSchedule.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { employee: 'emp1', shiftId: 'shift1', date: new Date('2023-05-01') },
        { employee: 'emp3', shiftId: 'shift1', date: new Date('2023-05-02') },
      ]),
    });

    const res = await request(app).get('/api/schedules/summary?month=2023-05');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { employee: 'emp1', name: 'Emp1', shiftCount: 1, leaveCount: 0, absenceCount: 0 },
      { employee: 'emp2', name: 'Emp2', shiftCount: 0, leaveCount: 0, absenceCount: 0 },
    ]);
    expect(res.body.find(e => e.employee === 'emp3')).toBeUndefined();
  });
});
