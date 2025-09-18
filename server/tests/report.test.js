import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockReport = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockReport.find = jest.fn();

const mockEmployee = { find: jest.fn(), exists: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceRecord = { find: jest.fn() };

jest.unstable_mockModule('../src/models/Report.js', () => ({ default: mockReport }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }));

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

  mockEmployee.find.mockResolvedValue([]);
  mockEmployee.exists.mockResolvedValue(null);
  mockShiftSchedule.find.mockResolvedValue([]);
  mockAttendanceRecord.find.mockResolvedValue([]);
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
});

