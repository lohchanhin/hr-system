import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockShiftSchedule = { find: jest.fn() };
const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getLeaveFieldIds: mockGetLeaveFieldIds }));

const mockAuth = {
  currentUser: { id: 'sup1', role: 'supervisor' },
  authenticate: (req, res, next) => {
    req.user = mockAuth.currentUser;
    next();
  },
  authorizeRoles: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
};

jest.unstable_mockModule('../src/middleware/auth.js', () => mockAuth);

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
  mockEmployee.findById.mockReset();
  mockAttendanceSetting.findOne.mockReset();
  mockApprovalRequest.find.mockReset();
  mockGetLeaveFieldIds.mockReset();
  mockGetLeaveFieldIds.mockResolvedValue({
    formId: 'leaveForm',
    startId: 'start',
    endId: 'end',
    typeId: 'type',
  });
  mockApprovalRequest.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  mockAuth.currentUser = { id: 'sup1', role: 'supervisor' };
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
        { employee: 'emp1', shiftId: 'shift1', date: new Date('2023-05-02') },
        { employee: 'emp3', shiftId: 'shift1', date: new Date('2023-05-03') },
      ]),
    });

    mockApprovalRequest.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          applicant_employee: 'emp1',
          form_data: { start: '2023-05-02', end: '2023-05-03' },
        },
      ]),
    });

    const res = await request(app).get('/api/schedules/summary?month=2023-05');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { employee: 'emp1', name: 'Emp1', shiftCount: 1, leaveCount: 2, absenceCount: 0 },
      { employee: 'emp2', name: 'Emp2', shiftCount: 0, leaveCount: 0, absenceCount: 0 },
    ]);
    expect(res.body.find(e => e.employee === 'emp3')).toBeUndefined();
  });

  it('拒絕非主管角色', async () => {
    mockAuth.currentUser = { id: 'emp1', role: 'employee' };
    const res = await request(app).get('/api/schedules/summary?month=2023-05');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('缺少 month 參數時回傳 400', async () => {
    const res = await request(app).get('/api/schedules/summary');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('month required');
  });

  it('includeSelf=true 時會加入主管本人資料', async () => {
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'emp1', name: 'Emp1' }]),
    });
    mockEmployee.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'sup1', name: '主管本人' }),
    });
    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ shifts: [{ _id: 'shift1', name: '早班' }] }),
    });
    mockShiftSchedule.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { employee: 'sup1', shiftId: 'shift1', date: new Date('2023-05-01') },
      ]),
    });
    mockApprovalRequest.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          applicant_employee: 'sup1',
          form_data: { start: '2023-05-03', end: '2023-05-04' },
        },
      ]),
    });

    const res = await request(app).get('/api/schedules/summary?month=2023-05&includeSelf=true');

    expect(res.status).toBe(200);
    const summaryRows = res.body;
    expect(summaryRows.some((row) => row.employee === 'sup1')).toBe(true);
  });
});
