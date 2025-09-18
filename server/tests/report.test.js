import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockReport = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockReport.find = jest.fn();

const mockEmployee = { find: jest.fn(), exists: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceRecord = { find: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();

jest.unstable_mockModule('../src/models/Report.js', () => ({ default: mockReport }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: mockGetLeaveFieldIds,
}));

let app;
let reportRoutes;

beforeAll(async () => {
  reportRoutes = (await import('../src/routes/reportRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-user-role'] || 'admin';
    const id = req.headers['x-user-id'] || 'admin';
    req.user = { role, id };
    next();
  });
  app.use('/api/reports', reportRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockReport.find.mockReset();
  mockEmployee.find.mockReset();
  mockEmployee.exists.mockReset();
  mockShiftSchedule.find.mockReset();
  mockAttendanceRecord.find.mockReset();
  mockApprovalRequest.find.mockReset();
  mockGetLeaveFieldIds.mockReset();

  mockEmployee.find.mockResolvedValue([]);
  mockEmployee.exists.mockResolvedValue(null);
  mockShiftSchedule.find.mockResolvedValue([]);
  mockAttendanceRecord.find.mockResolvedValue([]);
  mockGetLeaveFieldIds.mockResolvedValue({
    formId: 'leaveForm',
    startId: 'start',
    endId: 'end',
    typeId: 'type',
    typeOptions: [],
  });
});

describe('Report API', () => {
  it('lists reports', async () => {
    const fakeReports = [{ name: 'Monthly' }];
    mockReport.find.mockResolvedValue(fakeReports);
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeReports);
  });

  it('returns 500 if listing fails', async () => {
    mockReport.find.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates report', async () => {
    const payload = { name: 'Monthly' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/reports').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toEqual({});
  });

  it('exports department attendance for supervisor', async () => {
    mockEmployee.find.mockResolvedValueOnce([
      { _id: 'emp1', name: 'Alice' },
      { _id: 'emp2', name: 'Bob' },
    ]);
    mockShiftSchedule.find.mockResolvedValue([
      { employee: 'emp1', date: new Date('2024-01-05') },
      { employee: 'emp1', date: new Date('2024-01-10') },
      { employee: 'emp2', date: new Date('2024-01-05') },
    ]);
    mockAttendanceRecord.find.mockResolvedValue([
      { employee: 'emp1', action: 'clockIn', timestamp: new Date('2024-01-05T08:00:00Z') },
      { employee: 'emp2', action: 'clockIn', timestamp: new Date('2024-01-05T09:00:00Z') },
    ]);

    const res = await request(app)
      .get('/api/reports/department/attendance/export?month=2024-01&department=dept1')
      .set('x-user-role', 'supervisor')
      .set('x-user-id', 'sup1');

    expect(mockEmployee.find).toHaveBeenCalledWith({ department: 'dept1', supervisor: 'sup1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: '2024-01',
      department: 'dept1',
      summary: { scheduled: 3, attended: 2, absent: 1 },
      records: [
        { employee: 'emp1', name: 'Alice', scheduled: 2, attended: 1, absent: 1 },
        { employee: 'emp2', name: 'Bob', scheduled: 1, attended: 1, absent: 0 },
      ],
    });
  });

  it('rejects supervisor export without access', async () => {
    mockEmployee.find.mockResolvedValueOnce([]);
    mockEmployee.exists.mockResolvedValueOnce(true);

    const res = await request(app)
      .get('/api/reports/department/attendance/export?month=2024-01&department=dept2')
      .set('x-user-role', 'supervisor')
      .set('x-user-id', 'sup1');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when no department data', async () => {
    mockEmployee.find.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/reports/department/attendance/export?month=2024-01&department=dept3')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No data' });
  });

  it('exports department leave for supervisor', async () => {
    mockEmployee.find.mockResolvedValueOnce([
      { _id: 'emp1', name: 'Alice' },
      { _id: 'emp2', name: 'Bob' },
    ]);
    mockGetLeaveFieldIds.mockResolvedValueOnce({
      formId: 'leaveForm',
      startId: 'start',
      endId: 'end',
      typeId: 'type',
      typeOptions: [
        { value: 'SICK', label: '病假' },
        { value: 'ANNUAL', label: '特休' },
      ],
    });
    const approvals = [
      {
        _id: 'a1',
        applicant_employee: { _id: 'emp1', name: 'Alice' },
        form_data: { start: '2024-01-05', end: '2024-01-06', type: 'SICK' },
      },
      {
        _id: 'a2',
        applicant_employee: { _id: 'emp2', name: 'Bob' },
        form_data: {
          start: '2024-01-10',
          end: '2024-01-10',
          type: { code: 'ANNUAL', label: '特休' },
        },
      },
    ];
    const populate = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue(approvals);
    mockApprovalRequest.find.mockReturnValue({ populate, lean });

    const res = await request(app)
      .get('/api/reports/department/leave/export?month=2024-01&department=dept1&format=json')
      .set('x-user-role', 'supervisor')
      .set('x-user-id', 'sup1');

    expect(mockEmployee.find).toHaveBeenCalledWith({ department: 'dept1', supervisor: 'sup1' });
    const queryArg = mockApprovalRequest.find.mock.calls[0][0];
    expect(queryArg.form).toBe('leaveForm');
    expect(queryArg.status).toBe('approved');
    expect(queryArg.applicant_employee).toEqual({ $in: ['emp1', 'emp2'] });
    expect(queryArg.createdAt.$gte).toBeInstanceOf(Date);
    expect(queryArg.createdAt.$lt).toBeInstanceOf(Date);
    expect(queryArg.createdAt.$gte.toISOString()).toBe(
      new Date('2024-01-01T00:00:00.000Z').toISOString()
    );
    expect(queryArg.createdAt.$lt.toISOString()).toBe(
      new Date('2024-02-01T00:00:00.000Z').toISOString()
    );
    expect(populate).toHaveBeenCalledWith('applicant_employee', 'name');
    expect(lean).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: '2024-01',
      department: 'dept1',
      summary: {
        totalLeaves: 2,
        totalDays: 3,
        byType: [
          { leaveType: '病假', leaveCode: 'SICK', count: 1, days: 2 },
          { leaveType: '特休', leaveCode: 'ANNUAL', count: 1, days: 1 },
        ],
      },
      records: [
        {
          approvalId: 'a1',
          employee: 'emp1',
          name: 'Alice',
          leaveType: '病假',
          leaveCode: 'SICK',
          startDate: '2024-01-05',
          endDate: '2024-01-06',
          days: 2,
        },
        {
          approvalId: 'a2',
          employee: 'emp2',
          name: 'Bob',
          leaveType: '特休',
          leaveCode: 'ANNUAL',
          startDate: '2024-01-10',
          endDate: '2024-01-10',
          days: 1,
        },
      ],
    });
  });

  it('returns 404 when no leave data', async () => {
    mockEmployee.find.mockResolvedValueOnce([
      { _id: 'emp1', name: 'Alice' },
    ]);
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const res = await request(app)
      .get('/api/reports/department/leave/export?month=2024-01&department=dept1&format=json')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No data' });
  });

  it('rejects employee leave export', async () => {
    const res = await request(app)
      .get('/api/reports/department/leave/export?month=2024-01&department=dept1')
      .set('x-user-role', 'employee')
      .set('x-user-id', 'emp0');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });
});

