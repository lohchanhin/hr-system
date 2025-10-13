import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();

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
    save: saveMock,
    toObject() {
      const { save, toObject, ...rest } = this;
      return { ...rest };
    },
  };
}

const mockReport = jest.fn().mockImplementation((payload = {}) => buildReportDocument(payload));
mockReport.find = jest.fn();
mockReport.findById = jest.fn();
mockReport.findByIdAndUpdate = jest.fn();
mockReport.findByIdAndDelete = jest.fn();
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
  saveMock.mockReset();
  mockReport.mockClear();
  mockReport.find.mockReset();
  mockReport.findById.mockReset();
  mockReport.findByIdAndUpdate.mockReset();
  mockReport.findByIdAndDelete.mockReset();
  mockReport.exists.mockReset();
  mockReport.updateOne.mockReset();
  saveMock.mockResolvedValue(undefined);
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
  it('lists reports', async () => {
    const fakeReports = [
      buildReportDocument({
        _id: 'r1',
        name: '出勤統計',
        fields: ['員工', '部門', '出勤天數 '],
        exportSettings: { formats: ['PDF', ' Excel '], includeLogo: true, footerNote: ' 需覆核 ' },
      }),
      buildReportDocument({
        _id: 'r2',
        name: '請假統計',
        type: 'leave',
        fields: ['員工', '請假天數'],
        notificationSettings: { autoSend: true, sendFrequency: 'weekly', recipients: ['HR', ' 主管 '] },
      }),
    ];
    mockReport.find.mockResolvedValue(fakeReports);
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      id: 'r1',
      name: '出勤統計',
      type: 'custom',
      fields: ['員工', '部門', '出勤天數'],
      exportSettings: {
        formats: ['PDF', 'Excel'],
        includeLogo: true,
        footerNote: '需覆核',
      },
      permissionSettings: expect.objectContaining({ hrAllDept: true }),
      notificationSettings: { autoSend: false, sendFrequency: '', recipients: [] },
    });
    expect(res.body[1]).toMatchObject({
      id: 'r2',
      name: '請假統計',
      type: 'leave',
      notificationSettings: {
        autoSend: true,
        sendFrequency: 'weekly',
        recipients: ['HR', '主管'],
      },
    });
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

  it('returns 500 if listing fails', async () => {
    mockReport.find.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates report with sanitization', async () => {
    const payload = {
      name: '  月度報表  ',
      type: '',
      fields: [' 員工 ', '', ' 部門 '],
      exportSettings: { formats: ['PDF', ''], includeLogo: 'true', footerNote: ' 重要 ' },
      permissionSettings: { historyMonths: 3.6, hrAllDept: false },
      notificationSettings: {
        autoSend: true,
        sendFrequency: 'weekly',
        recipients: ['HR', ''],
      },
    };

    const res = await request(app).post('/api/reports').send(payload);

    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '月度報表',
        type: 'custom',
        fields: ['員工', '部門'],
      })
    );
    expect(res.body).toMatchObject({
      id: 'report-id',
      name: '月度報表',
      type: 'custom',
      fields: ['員工', '部門'],
      exportSettings: {
        formats: ['PDF'],
        includeLogo: true,
        footerNote: '重要',
      },
      permissionSettings: {
        supervisorDept: false,
        hrAllDept: false,
        employeeDownload: false,
        historyMonths: 3,
      },
      notificationSettings: {
        autoSend: true,
        sendFrequency: 'weekly',
        recipients: ['HR'],
      },
    });
  });

  it('rejects create without name', async () => {
    const res = await request(app).post('/api/reports').send({ fields: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '報表名稱為必填' });
  });

  it('gets report with formatted response', async () => {
    mockReport.findById.mockResolvedValue(
      buildReportDocument({ _id: 'r1', name: '人員報表', type: 'people' })
    );
    const res = await request(app).get('/api/reports/r1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'r1', name: '人員報表', type: 'people' });
  });

  it('updates report template', async () => {
    mockReport.findByIdAndUpdate.mockResolvedValue(
      buildReportDocument({
        _id: 'r-update',
        name: '更新後模板',
        fields: ['姓名'],
        exportSettings: { formats: ['CSV'], includeLogo: true, footerNote: '最終版' },
        permissionSettings: {
          supervisorDept: true,
          hrAllDept: false,
          employeeDownload: true,
          historyMonths: 12,
        },
        notificationSettings: {
          autoSend: true,
          sendFrequency: 'monthly',
          recipients: ['HR'],
        },
      })
    );

    const res = await request(app)
      .put('/api/reports/r-update')
      .send({
        name: ' 更新後模板 ',
        fields: ['姓名', ''],
        exportSettings: { formats: ['CSV'], includeLogo: true, footerNote: '最終版 ' },
        permissionSettings: {
          supervisorDept: true,
          hrAllDept: false,
          employeeDownload: true,
          historyMonths: 12,
        },
        notificationSettings: {
          autoSend: true,
          sendFrequency: 'monthly',
          recipients: ['HR', ''],
        },
      });

    expect(res.status).toBe(200);
    expect(mockReport.findByIdAndUpdate).toHaveBeenCalledWith(
      'r-update',
      expect.objectContaining({
        name: '更新後模板',
        fields: ['姓名'],
        exportSettings: {
          formats: ['CSV'],
          includeLogo: true,
          footerNote: '最終版',
        },
        permissionSettings: expect.objectContaining({ historyMonths: 12 }),
        notificationSettings: {
          autoSend: true,
          sendFrequency: 'monthly',
          recipients: ['HR'],
        },
      }),
      expect.objectContaining({ new: true, runValidators: true })
    );
    expect(res.body).toMatchObject({
      id: 'r-update',
      name: '更新後模板',
      fields: ['姓名'],
      notificationSettings: {
        autoSend: true,
        sendFrequency: 'monthly',
        recipients: ['HR'],
      },
    });
  });

  it('rejects invalid update payload', async () => {
    const res = await request(app)
      .put('/api/reports/r-update')
      .send({ exportSettings: { formats: 'csv' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '匯出格式需為陣列' });
    expect(mockReport.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('deletes report template', async () => {
    mockReport.findByIdAndDelete.mockResolvedValue(buildReportDocument({ _id: 'r-delete' }));
    const res = await request(app).delete('/api/reports/r-delete');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

});

