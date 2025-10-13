import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

function buildReportDocument(overrides = {}) {
  return {
    _id: overrides._id ?? 'report-id',
    name: overrides.name ?? '月度報表',
    type: overrides.type ?? 'custom',
    fields: overrides.fields ?? ['欄位一'],
    data: overrides.data ?? {},
    exportSettings:
      overrides.exportSettings ??
      {
        formats: ['PDF'],
        includeLogo: false,
        footerNote: '',
      },
    permissionSettings:
      overrides.permissionSettings ??
      {
        supervisorDept: false,
        hrAllDept: true,
        employeeDownload: false,
        historyMonths: 6,
      },
    notificationSettings:
      overrides.notificationSettings ??
      {
        autoSend: false,
        sendFrequency: '',
        recipients: [],
      },
    createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2024-01-02T00:00:00Z'),
    toObject() {
      const { toObject, ...rest } = this;
      return { ...rest };
    },
  };
}

const mockReport = jest.fn().mockImplementation((payload = {}) => buildReportDocument(payload));
mockReport.find = jest.fn();
mockReport.exists = jest.fn();
mockReport.updateOne = jest.fn();

jest.unstable_mockModule('../src/models/Report.js', () => ({ default: mockReport }));

let app;
let reportRoutes;
let ensureDefaultSupervisorReports;
let SUPERVISOR_REPORT_TEMPLATES;

beforeAll(async () => {
  reportRoutes = (await import('../src/routes/reportRoutes.js')).default;
  ({ ensureDefaultSupervisorReports, SUPERVISOR_REPORT_TEMPLATES } = await import(
    '../src/services/supervisorReportSeed.js'
  ));
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
  mockReport.mockClear();
  mockReport.find.mockReset();
  mockReport.exists.mockReset();
  mockReport.updateOne.mockReset();
});

describe('ensureDefaultSupervisorReports', () => {
  it('建立主管預設報表模板', async () => {
    mockReport.updateOne.mockResolvedValue({ acknowledged: true });

    await ensureDefaultSupervisorReports();

    expect(mockReport.updateOne).toHaveBeenCalledTimes(SUPERVISOR_REPORT_TEMPLATES.length);
    SUPERVISOR_REPORT_TEMPLATES.forEach((template) => {
      expect(mockReport.updateOne).toHaveBeenCalledWith(
        { type: template.type },
        {
          $setOnInsert: expect.objectContaining({
            name: template.name,
            type: template.type,
            exportSettings: expect.objectContaining({
              formats: expect.arrayContaining(template.exportSettings.formats),
            }),
            permissionSettings: expect.objectContaining({ supervisorDept: true }),
          }),
        },
        { upsert: true }
      );
    });
  });
});

describe('Report API', () => {
  it('已停用一般報表列表端點', async () => {
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(404);
    expect(mockReport.find).not.toHaveBeenCalled();
  });

  it('提供主管可用的報表模板清單', async () => {
    mockReport.find.mockResolvedValue([
      buildReportDocument({
        _id: 'tpl-attendance',
        name: '出勤統計模板',
        type: 'attendance',
        exportSettings: { formats: ['excel', 'pdf'], includeLogo: false, footerNote: '' },
        permissionSettings: {
          supervisorDept: true,
          hrAllDept: false,
          employeeDownload: false,
          historyMonths: 6,
        },
      }),
      buildReportDocument({
        _id: 'tpl-leave',
        name: '請假統計模板',
        type: 'leave',
        exportSettings: { formats: ['pdf'], includeLogo: false, footerNote: '' },
        permissionSettings: {
          supervisorDept: true,
          hrAllDept: true,
          employeeDownload: false,
          historyMonths: 3,
        },
      }),
    ]);

    const res = await request(app)
      .get('/api/reports/department/templates')
      .set('x-user-role', 'supervisor')
      .set('x-user-id', 'sup-1');

    expect(mockReport.find).toHaveBeenCalledWith({ 'permissionSettings.supervisorDept': true });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      id: 'tpl-attendance',
      type: 'attendance',
      name: '出勤統計模板',
      exportSettings: { formats: ['excel', 'pdf'] },
      permissionSettings: expect.objectContaining({ supervisorDept: true }),
    });
  });

  it('拒絕未授權角色查詢主管報表模板', async () => {
    const res = await request(app)
      .get('/api/reports/department/templates')
      .set('x-user-role', 'employee')
      .set('x-user-id', 'emp-1');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('已停用建立報表端點', async () => {
    const res = await request(app).post('/api/reports').send({ name: '報表' });
    expect(res.status).toBe(404);
    expect(mockReport.mock.calls).toHaveLength(0);
  });

  it('已停用單一報表讀取端點', async () => {
    const res = await request(app).get('/api/reports/r1');
    expect(res.status).toBe(404);
  });

  it('已停用更新報表端點', async () => {
    const res = await request(app).put('/api/reports/r-update').send({ name: '更新' });
    expect(res.status).toBe(404);
  });

  it('已停用刪除報表端點', async () => {
    const res = await request(app).delete('/api/reports/r-delete');
    expect(res.status).toBe(404);
  });

});

