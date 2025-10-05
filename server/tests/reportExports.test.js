import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockGetDepartmentReportData = jest.fn();
const mockGetReportDisplayName = jest.fn((type) => ({
  attendance: '出勤統計',
  leave: '請假統計',
  tardiness: '遲到統計',
  earlyLeave: '早退統計',
  workHours: '工時統計',
  overtime: '加班申請統計',
  compTime: '補休申請統計',
  makeUp: '補打卡申請統計',
  specialLeave: '特休統計',
}[type] || '報表'));
const mockExportTabularReport = jest.fn((res, payload) => {
  res.status(200).json({ ok: true, payload });
});

class ReportAccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

jest.unstable_mockModule('../src/services/reportMetricsService.js', () => ({
  getDepartmentReportData: mockGetDepartmentReportData,
  ReportAccessError,
  getReportDisplayName: mockGetReportDisplayName,
}));

jest.unstable_mockModule('../src/services/reportExportHelper.js', () => ({
  exportTabularReport: mockExportTabularReport,
}));

let app;
let reportRoutes;
let controllers;

beforeAll(async () => {
  reportRoutes = (await import('../src/routes/reportRoutes.js')).default;
  controllers = await import('../src/controllers/reportController.js');
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
  mockGetDepartmentReportData.mockReset();
  mockGetReportDisplayName.mockClear();
  mockExportTabularReport.mockReset();
});

describe('Department report exports', () => {
  it('returns JSON preview for tardiness report', async () => {
    mockGetDepartmentReportData.mockResolvedValueOnce({
      summary: {
        totalLateCount: 2,
        totalLateMinutes: 15,
        averageLateMinutes: 7.5,
      },
      records: [
        {
          name: 'Alice',
          date: '2024-01-03',
          scheduledStart: '09:00',
          actualClockIn: '09:07',
          minutesLate: 7,
        },
        {
          name: 'Bob',
          date: '2024-01-08',
          scheduledStart: '09:00',
          actualClockIn: '09:08',
          minutesLate: 8,
        },
      ],
    });

    const res = await request(app)
      .get('/api/reports/department/tardiness/export')
      .query({ month: '2024-01', department: 'dept1', format: 'json' })
      .set('x-user-role', 'supervisor')
      .set('x-user-id', 'sup1');

    expect(mockGetDepartmentReportData).toHaveBeenCalledWith({
      type: 'tardiness',
      month: '2024-01',
      departmentId: 'dept1',
      actor: { role: 'supervisor', id: 'sup1' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: '2024-01',
      department: 'dept1',
      summary: {
        totalLateCount: 2,
        totalLateMinutes: 15,
        averageLateMinutes: 7.5,
      },
      records: expect.arrayContaining([
        expect.objectContaining({ name: 'Alice', minutesLate: 7 }),
        expect.objectContaining({ name: 'Bob', minutesLate: 8 }),
      ]),
    });
  });

  it('calls export helper for Excel report', async () => {
    mockGetDepartmentReportData.mockResolvedValueOnce({
      summary: { totalWorkedHours: 160, totalScheduledHours: 168, differenceHours: -8 },
      records: [
        {
          name: 'Alice',
          date: '2024-01-02',
          scheduledHours: 8,
          workedHours: 7.5,
          differenceHours: -0.5,
        },
      ],
    });

    const req = {
      query: { month: '2024-01', department: 'dept2', format: 'excel' },
      user: { role: 'admin', id: 'adm1' },
    };
    const res = {
      statusCode: 0,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
    };

    await controllers.exportDepartmentWorkHours(req, res);

    expect(mockExportTabularReport).toHaveBeenCalledTimes(1);
    const exportArgs = mockExportTabularReport.mock.calls[0][1];
    expect(exportArgs.format).toBe('excel');
    expect(exportArgs.fileName).toBe('workHours-dept2-2024-01');
    expect(exportArgs.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'name' }),
        expect.objectContaining({ key: 'date' }),
        expect.objectContaining({ key: 'scheduledHours' }),
      ]),
    );
    expect(exportArgs.rows).toHaveLength(1);
    expect(exportArgs.summaryRows).toEqual(
      expect.arrayContaining([
        { label: '排定總工時', value: 168 },
        { label: '實際總工時', value: 160 },
      ]),
    );
  });

  it('propagates ReportAccessError status', async () => {
    mockGetDepartmentReportData.mockRejectedValueOnce(new ReportAccessError(404, 'No data'));

    const res = await request(app)
      .get('/api/reports/department/overtime/export')
      .query({ month: '2024-01', department: 'dept3', format: 'json' })
      .set('x-user-role', 'supervisor')
      .set('x-user-id', 'sup2');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No data' });
  });

  it('validates required query params', async () => {
    const res = await request(app)
      .get('/api/reports/department/comp-time/export')
      .query({ month: '2024-01' })
      .set('x-user-role', 'admin');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'month and department required' });
    expect(mockGetDepartmentReportData).not.toHaveBeenCalled();
  });

  it('rejects unauthorized role', async () => {
    const res = await request(app)
      .get('/api/reports/department/make-up/export')
      .query({ month: '2024-01', department: 'dept4', format: 'json' })
      .set('x-user-role', 'employee')
      .set('x-user-id', 'emp1');

    expect(res.status).toBe(403);
  });
});
