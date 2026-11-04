import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import { buildLeaveFieldServiceMock } from './helpers/leaveFieldServiceMock.js';
import { createFakeOtherControlSettingModel } from './helpers/fakeOtherControlSettingModel.js';

const mockShiftSchedule = { find: jest.fn() };
const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => buildLeaveFieldServiceMock(mockGetLeaveFieldIds));
// 排班權限模式存在其他控制設定（記憶體版 model）：預設只有排班人員能排班，主管的統計要在「主管與排班人員」模式下測
const fakeSettings = createFakeOtherControlSettingModel();
jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: fakeSettings }));
const mockSubDepartment = { find: jest.fn() };
const mockDepartment = { find: jest.fn() };
jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));

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
let scheduleAccessService;

const rows = (list) => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(list) });

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  scheduleAccessService = await import('../src/services/scheduleAccessService.js');
  app = express();
  app.use(express.json());
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(async () => {
  fakeSettings.__clear();
  // 這個檔案原本的案例是主管排直屬部屬：2026/11 起要由管理員存成「主管與排班人員」才有（預設只有排班人員）
  await scheduleAccessService.setScheduleAccessMode('supervisor_and_scheduler');
  mockSubDepartment.find.mockReset();
  mockSubDepartment.find.mockImplementation(() => rows([]));
  mockDepartment.find.mockReset();
  mockDepartment.find.mockImplementation(() => rows([]));
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
    expect(res.body.employees).toEqual([
      { employee: 'emp1', name: 'Emp1', shiftCount: 1, leaveCount: 2, absenceCount: 0 },
      { employee: 'emp2', name: 'Emp2', shiftCount: 0, leaveCount: 0, absenceCount: 0 },
    ]);
    expect(res.body.stats).toEqual({
      direct: 2,
      unscheduled: 2,
      onLeave: 1,
      daysInMonth: 31,
    });
    expect(res.body.employees.find(e => e.employee === 'emp3')).toBeUndefined();
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
    const summaryRows = res.body.employees;
    expect(summaryRows.some((row) => row.employee === 'sup1')).toBe(true);
  });
});

// 2026/11 客戶：「直屬員工數」改成「排班員工數」，人數是排班頁目前看的員工（與名單同一個條件），不是直屬部屬
describe('排班員工數 (the employees of the schedule view)', () => {
  const oid = (n) => n.toString(16).padStart(24, '0');
  const SCHEDULER = oid(7);
  const UNIT = oid(200);
  const DEPT = oid(100);

  const stubMonth = () => {
    mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: [] }) });
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  };

  it('counts the scheduler units with the department and unit filters of the page, including the scheduler in their own unit', async () => {
    mockAuth.currentUser = { id: SCHEDULER, role: 'employee' };
    mockSubDepartment.find.mockImplementation((filter) => rows(filter?.schedulers ? [{ _id: UNIT, department: DEPT }] : []));
    mockEmployee.find.mockReturnValue(rows([
      { _id: SCHEDULER, name: '排班員' },
      { _id: oid(3), name: '護理甲' },
    ]));
    stubMonth();

    const res = await request(app).get(`/api/schedules/summary?month=2023-05&department=${DEPT}&subDepartment=${UNIT}`);
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({
      $and: [{ department: DEPT, subDepartment: UNIT }, { $or: [{ subDepartment: { $in: [UNIT] } }] }],
    });
    expect(res.body.stats.direct).toBe(2);
    expect(res.body.employees.map((row) => row.employee)).toEqual([SCHEDULER, oid(3)]);
  });

  it('refuses a supervisor without an assignment in the default mode (only schedulers schedule)', async () => {
    fakeSettings.__clear();
    const res = await request(app).get('/api/schedules/summary?month=2023-05');
    expect(res.status).toBe(403);
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });

  it('gives an administrator the summary of the selected department (it was refused, so the page always showed 0)', async () => {
    mockAuth.currentUser = { id: oid(1), role: 'admin' };
    mockEmployee.find.mockReturnValue(rows([{ _id: oid(3), name: '護理甲' }, { _id: oid(4), name: '護理乙' }]));
    stubMonth();

    const res = await request(app).get(`/api/schedules/summary?month=2023-05&department=${DEPT}`);
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ department: DEPT });
    expect(res.body.stats).toMatchObject({ direct: 2, unscheduled: 2, onLeave: 0 });
  });

  it('rejects a malformed department filter', async () => {
    mockAuth.currentUser = { id: oid(1), role: 'admin' };
    const res = await request(app).get('/api/schedules/summary?month=2023-05&department=junk');
    expect(res.status).toBe(400);
  });
});
