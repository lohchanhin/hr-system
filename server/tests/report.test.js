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
  mockReport.mockClear();
  mockReport.find.mockReset();
  mockReport.findById.mockReset();
  mockReport.findByIdAndUpdate.mockReset();
  mockReport.findByIdAndDelete.mockReset();
  mockEmployee.find.mockReset();
  mockEmployee.exists.mockReset();
  mockShiftSchedule.find.mockReset();
  mockAttendanceRecord.find.mockReset();
  mockApprovalRequest.find.mockReset();
  mockGetLeaveFieldIds.mockReset();

  saveMock.mockResolvedValue(undefined);

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

  it('handles circular _id proxies in attendance export', async () => {
    const circularId = { toString: () => 'emp-loop' };
    circularId._id = circularId;
    const wrappedId = { _id: circularId };

    mockEmployee.find.mockResolvedValueOnce([{ _id: wrappedId, name: 'Loop' }]);
    mockShiftSchedule.find.mockResolvedValue([
      { employee: wrappedId, date: new Date('2024-01-05') },
    ]);
    mockAttendanceRecord.find.mockResolvedValue([
      { employee: wrappedId, action: 'clockIn', timestamp: new Date('2024-01-05T08:00:00Z') },
    ]);

    const res = await request(app)
      .get('/api/reports/department/attendance/export?month=2024-01&department=dept-loop')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([
      { employee: 'emp-loop', name: 'Loop', scheduled: 1, attended: 1, absent: 0 },
    ]);
    expect(res.body.summary).toEqual({ scheduled: 1, attended: 1, absent: 0 });
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

  it('handles circular _id proxies in leave export', async () => {
    const employeeCircularId = { toString: () => 'emp-leave-loop' };
    employeeCircularId._id = employeeCircularId;
    const employeeWrappedId = { _id: employeeCircularId };

    const approvalCircularId = { toString: () => 'approval-loop' };
    approvalCircularId._id = approvalCircularId;
    const approvalWrappedId = { _id: approvalCircularId };

    mockEmployee.find.mockResolvedValueOnce([{ _id: employeeWrappedId, name: 'Loop' }]);

    const populate = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue([
      {
        _id: approvalWrappedId,
        applicant_employee: { _id: employeeWrappedId, name: 'Loop' },
        form_data: { start: '2024-01-15', end: '2024-01-16', type: 'SICK' },
      },
    ]);
    mockApprovalRequest.find.mockReturnValue({ populate, lean });

    const res = await request(app)
      .get('/api/reports/department/leave/export?month=2024-01&department=dept-loop&format=json')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([
      {
        approvalId: 'approval-loop',
        employee: 'emp-leave-loop',
        name: 'Loop',
        leaveType: 'SICK',
        leaveCode: 'SICK',
        startDate: '2024-01-15',
        endDate: '2024-01-16',
        days: 2,
      },
    ]);
    expect(res.body.summary).toEqual({
      totalLeaves: 1,
      totalDays: 2,
      byType: [
        { leaveType: 'SICK', leaveCode: 'SICK', count: 1, days: 2 },
      ],
    });
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

