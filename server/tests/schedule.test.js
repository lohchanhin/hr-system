// scheduleRoutes.test.ts (或 .js)
// 整合版：含 list / create(upsert) / monthly / supervisor / export(pdf|excel) / batch / delete-old

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import { authorizeRoles } from '../src/middleware/auth.js';

/* ----------------------------- Mocks: Models ----------------------------- */
// 統一成物件型態，提供各端點會用到的方法
const mockShiftSchedule = {
  find: jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) })),
  findOne: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
};

const mockApprovalRequest = { findOne: jest.fn(), find: jest.fn() };

const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };

const mockGetLeaveFieldIds = jest.fn();

const buildScheduleDoc = (data = {}) => {
  const doc = {
    _id: 'sch1',
    employee: 'e1',
    date: new Date('2023-01-01'),
    shiftId: 'old',
    department: 'd1',
    subDepartment: 'sd1',
    ...data,
  };
  doc.save = jest.fn().mockImplementation(function save() {
    return Promise.resolve({ ...this });
  });
  return doc;
};

/* --------------------------- jest.mock 設定區 --------------------------- */


jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: mockGetLeaveFieldIds,
}));

let currentRole = 'supervisor';

/* --------------------------------- App --------------------------------- */
let app;
let scheduleRoutes;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    currentRole = 'supervisor';
    req.user = { id: 'tester', role: currentRole };
    next();
  });
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  currentRole = 'supervisor';
  mockShiftSchedule.find.mockReset();
  mockShiftSchedule.findOne.mockReset();
  mockShiftSchedule.create.mockReset();
  mockShiftSchedule.insertMany.mockReset();
  mockShiftSchedule.deleteMany.mockReset();

  mockApprovalRequest.findOne.mockReset();
  mockApprovalRequest.find.mockReset();
  mockGetLeaveFieldIds.mockReset();
  mockGetLeaveFieldIds.mockResolvedValue({
    formId: 'form1',
    startId: 's',
    endId: 'e',
    typeId: 't',
    typeOptions: [],
  });
  mockEmployee.find.mockReset();
  mockEmployee.findById.mockReset();
  mockEmployee.findById.mockImplementation(async (id) => {
    if (id === 'tester') return { _id: 'tester', role: currentRole };
    if (!id) return null;
    return { _id: id, supervisor: 'tester' };
  });
  mockAttendanceSetting.findOne.mockReset();
  mockAttendanceSetting.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      shifts: [{ _id: 's1', name: 'Morning' }]
    })
  });
});

/* --------------------------------- Tests -------------------------------- */
describe('Schedule API', () => {
  const buildScheduleAppWithRole = (role) => {
    const exportApp = express();
    exportApp.use(express.json());
    exportApp.use((req, res, next) => {
      currentRole = role;
      req.user = { id: 'tester', role };
      next();
    });
    exportApp.use(
      '/api/schedules',
      (req, res, next) => {
        if (req.method === 'GET') {
          if (req.path?.startsWith('/export')) {
            return authorizeRoles('admin', 'supervisor')(req, res, next);
          }
          return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
        }
        return authorizeRoles('supervisor', 'admin')(req, res, next);
      },
      scheduleRoutes
    );
    return exportApp;
  };

  it('lists schedules', async () => {
    const fakeSchedules = [{ shiftId: 's1', date: new Date('2023-01-01') }];
    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(fakeSchedules)
    });

    const res = await request(app).get('/api/schedules');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { shiftId: 's1', date: '2023/01/01', shiftName: 'Morning' }
    ]);
  });

  it('returns 500 if listing fails', async () => {
    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockRejectedValue(new Error('fail')),
    });

    const res = await request(app).get('/api/schedules');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates schedule', async () => {
    const payload = { employee: 'e1', date: '2023-01-01', shiftId: 's1' };
    const fake = { ...payload, _id: '1' };

    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.create.mockResolvedValue(fake);

    const res = await request(app).post('/api/schedules').send(payload);

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.create).toHaveBeenCalledWith({
      employee: payload.employee,
      date: new Date(payload.date),
      shiftId: payload.shiftId,
      department: undefined,
      subDepartment: undefined,
    });
    expect(res.body).toEqual(fake);
  });

  it('rejects creation if schedule exists', async () => {
    mockShiftSchedule.findOne.mockResolvedValue({ _id: '1', department: 'd1' });
    const res = await request(app)
      .post('/api/schedules')
      .send({ employee: 'e1', date: '2023-01-01', shiftId: 's1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'employee conflict' });
  });

  it('rejects creation if cross-department', async () => {
    mockShiftSchedule.findOne.mockResolvedValue({ _id: '1', department: 'd1' });
    const res = await request(app)
      .post('/api/schedules')
      .send({ employee: 'e1', date: '2023-01-01', shiftId: 's1', department: 'd2' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'department overlap' });
  });

  it('rejects creation if leave conflict', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue({ _id: 'a1' });
    const res = await request(app)
      .post('/api/schedules')
      .send({ employee: 'e1', date: '2023-01-01', shiftId: 's1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'leave conflict' });
  });


  it('lists schedules by month (with employee filter)', async () => {
    const fake = [{ shiftId: 's1', date: new Date('2023-01-02') }];
    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(fake)
    });

    const res = await request(app).get('/api/schedules/monthly?month=2023-01&employee=e1');

    expect(res.status).toBe(200);
    expect(mockShiftSchedule.find).toHaveBeenCalled();
    expect(res.body).toEqual([
      { shiftId: 's1', date: '2023/01/02', shiftName: 'Morning' }
    ]);
  });

  it('拒絕員工使用主管篩選參數', async () => {
    const employeeApp = buildScheduleAppWithRole('employee');

    const res = await request(employeeApp)
      .get('/api/schedules/monthly?month=2023-01&supervisor=sup1');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(mockEmployee.find).not.toHaveBeenCalled();
    expect(mockShiftSchedule.find).not.toHaveBeenCalled();
  });

  it('允許主管使用主管篩選參數', async () => {
    const supervisorApp = buildScheduleAppWithRole('supervisor');
    const fake = [{ employee: 'emp1', shiftId: 's1', date: new Date('2023-01-02') }];
    const leanMock = jest.fn().mockResolvedValue(fake);
    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: leanMock
    });
    const selectMock = jest.fn().mockResolvedValue([{ _id: 'emp1' }]);
    mockEmployee.find.mockReturnValue({ select: selectMock });

    const res = await request(supervisorApp)
      .get('/api/schedules/monthly?month=2023-01&supervisor=sup1');

    expect(res.status).toBe(200);
    expect(selectMock).toHaveBeenCalledWith('_id');
    expect(mockShiftSchedule.find).toHaveBeenCalledWith(expect.objectContaining({
      employee: { $in: ['emp1'] }
    }));
    expect(res.body).toEqual([
      { employee: 'emp1', shiftId: 's1', date: '2023/01/02', shiftName: 'Morning' }
    ]);
  });


  it('creates schedules batch', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.insertMany.mockResolvedValue([{ _id: '1' }]);

    const payload = { schedules: [{ employee: 'e1', date: '2023-01-01', shiftId: 'day' }] };
    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.insertMany).toHaveBeenCalledWith([
      {
        employee: 'e1',
        date: new Date('2023-01-01'),
        shiftId: 'day',
        department: undefined,
        subDepartment: undefined
      }
    ], { ordered: false });
  });

  it('creates schedules batch with department and subDepartment', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.insertMany.mockResolvedValue([{ _id: '1' }]);

    const payload = {
      schedules: [
        {
          employee: 'e1',
          date: '2023-01-01',
          shiftId: 'day',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ]
    };
    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.insertMany).toHaveBeenCalledWith([
      {
        employee: 'e1',
        date: new Date('2023-01-01'),
        shiftId: 'day',
        department: 'd1',
        subDepartment: 'sd1'
      }
    ], { ordered: false });
  });

  it('allows supervisor to include self in batch payload without duplicate lookups', async () => {
    mockShiftSchedule.findOne.mockResolvedValueOnce(null);
    mockShiftSchedule.findOne.mockResolvedValueOnce(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.insertMany.mockImplementation(async (docs) =>
      docs.map((doc, index) => ({ ...doc, _id: `new${index}` }))
    );

    const payload = {
      schedules: [
        { employee: 'tester', date: '2023-01-01', shiftId: 'day' },
        { employee: 'emp1', date: '2023-01-02', shiftId: 'night' },
        { employee: 'emp1', date: '2023-01-02', shiftId: 'night' },
      ]
    };

    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      expect.objectContaining({ employee: 'tester', shiftId: 'day' }),
      expect.objectContaining({ employee: 'emp1', shiftId: 'night' })
    ]);
    expect(mockEmployee.findById.mock.calls.filter(([id]) => id === 'emp1')).toHaveLength(1);
    expect(mockEmployee.findById.mock.calls.map(([id]) => id)).toEqual([
      'tester',
      'emp1'
    ]);
    expect(mockShiftSchedule.insertMany).toHaveBeenCalledWith([
      {
        employee: 'tester',
        date: new Date('2023-01-01'),
        shiftId: 'day',
        department: undefined,
        subDepartment: undefined
      },
      {
        employee: 'emp1',
        date: new Date('2023-01-02'),
        shiftId: 'night',
        department: undefined,
        subDepartment: undefined
      }
    ], { ordered: false });
  });

  it('rejects batch if schedule exists', async () => {
    const existing = buildScheduleDoc();
    mockShiftSchedule.findOne.mockResolvedValue(existing);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.insertMany.mockResolvedValue([]);

    const payload = {
      schedules: [
        {
          employee: 'e1',
          date: '2023-01-01',
          shiftId: 'day',
          department: 'd2',
          subDepartment: 'sd2'
        }
      ]
    };

    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(201);
    expect(existing.save).toHaveBeenCalled();
    expect(mockShiftSchedule.insertMany).not.toHaveBeenCalled();
    expect(res.body).toEqual([
      expect.objectContaining({
        _id: 'sch1',
        employee: 'e1',
        shiftId: 'day',
        department: 'd2',
        subDepartment: 'sd2'
      })
    ]);
  });

  it('keeps existing department info when override payload omits it', async () => {
    const existing = buildScheduleDoc({ department: 'd3', subDepartment: 'sd9' });
    mockShiftSchedule.findOne.mockResolvedValue(existing);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.insertMany.mockResolvedValue([]);

    const payload = {
      schedules: [
        {
          employee: 'e1',
          date: '2023-01-01',
          shiftId: 'day'
        }
      ]
    };

    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(201);
    expect(existing.save).toHaveBeenCalled();
    const savedPayload = res.body[0];
    expect(savedPayload.department).toBe('d3');
    expect(savedPayload.subDepartment).toBe('sd9');
  });

  it('rejects batch if leave conflict', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue({ _id: 'a1' });
    const payload = { schedules: [{ employee: 'e1', date: '2023-01-01', shiftId: 'day' }] };
    const res = await request(app).post('/api/schedules/batch').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'leave conflict' });
  });

  it('lists leave approvals', async () => {
    const approvals = [{
      _id: 'a1',
      applicant_employee: { _id: 'e1', name: 'E1' },
      form: { _id: 'form1', name: '請假' },
      form_data: { s: '2023-01-01', e: '2023-01-02', t: '病假' },
      status: 'approved'
    }];
    const populateMock = jest.fn().mockReturnThis();
    mockApprovalRequest.find.mockReturnValue({
      populate: populateMock,
      then: (resolve) => resolve(approvals)
    });
    const res = await request(app).get('/api/schedules/leave-approvals?month=2023-01&employee=e1');
    expect(res.status).toBe(200);
    expect(populateMock).toHaveBeenCalledWith('applicant_employee');
    expect(populateMock).toHaveBeenCalledWith({ path: 'form', select: 'name category' });
    expect(res.body).toEqual({
      leaves: [{
        employee: approvals[0].applicant_employee,
        leaveType: '病假',
        startDate: '2023-01-01',
        endDate: '2023-01-02',
        status: 'approved'
      }],
      approvals
    });
  });

  it('filters leave approvals by department and subDepartment', async () => {
    const approvals = [
      {
        _id: 'a1',
        applicant_employee: { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' },
        applicant_department: 'd1',
        form: { _id: 'form1', name: '請假' },
        form_data: { s: '2023-01-05', e: '2023-01-06', t: '病假' },
        status: 'approved'
      },
      {
        _id: 'a2',
        applicant_employee: { _id: 'e2', name: 'E2', department: 'd1', subDepartment: 'sd2' },
        applicant_department: 'd1',
        form: { _id: 'form1', name: '請假' },
        form_data: { s: '2023-01-03', e: '2023-01-04', t: '事假' },
        status: 'approved'
      },
      {
        _id: 'a3',
        applicant_employee: { _id: 'e3', name: 'E3', department: 'd1', subDepartment: 'sd1' },
        applicant_department: '',
        form: { _id: 'form1', name: '請假' },
        form_data: { s: '2023-01-07', e: '2023-01-08', t: '特休' },
        status: 'approved'
      },
      {
        _id: 'a4',
        applicant_employee: { _id: 'e4', name: 'E4', department: 'd2', subDepartment: 'sd2' },
        applicant_department: 'd2',
        form: { _id: 'form1', name: '請假' },
        form_data: { s: '2023-01-09', e: '2023-01-10', t: '病假' },
        status: 'approved'
      }
    ];
    const populateMock = jest.fn().mockReturnThis();
    mockApprovalRequest.find.mockReturnValue({
      populate: populateMock,
      then: (resolve) => resolve(approvals)
    });

    const res = await request(app)
      .get('/api/schedules/leave-approvals?month=2023-01&department=d1&subDepartment=sd1');

    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(2);
    expect(res.body.approvals.map((a) => a._id)).toEqual(['a1', 'a3']);
    expect(res.body.leaves).toEqual([
      {
        employee: approvals[0].applicant_employee,
        leaveType: '病假',
        startDate: '2023-01-05',
        endDate: '2023-01-06',
        status: 'approved'
      },
      {
        employee: approvals[2].applicant_employee,
        leaveType: '特休',
        startDate: '2023-01-07',
        endDate: '2023-01-08',
        status: 'approved'
      }
    ]);
    expect(populateMock).toHaveBeenCalledWith('applicant_employee');
    expect(populateMock).toHaveBeenCalledWith({ path: 'form', select: 'name category' });
  });

  it('leave approvals include supervisor when includeSelf is true', async () => {
    const selectMock = jest.fn().mockResolvedValue([{ _id: 'emp1' }]);
    mockEmployee.find.mockReturnValue({ select: selectMock });
    const approvals = [];
    const populateMock = jest.fn().mockReturnThis();
    mockApprovalRequest.find.mockReturnValue({
      populate: populateMock,
      then: (resolve) => resolve(approvals),
    });

    const res = await request(app)
      .get('/api/schedules/leave-approvals?month=2023-01&supervisor=sup1&includeSelf=true');

    expect(res.status).toBe(200);
    const queryArg = mockApprovalRequest.find.mock.calls[0][0];
    expect(queryArg.applicant_employee.$in).toEqual(expect.arrayContaining(['emp1', 'sup1']));
    expect(populateMock).toHaveBeenCalledWith('applicant_employee');
    expect(populateMock).toHaveBeenCalledWith({ path: 'form', select: 'name category' });
  });

  it('deletes old schedules', async () => {
    // 用本地陣列模擬資料，deleteMany 以條件計算刪除數
    const data = [
      { _id: '1', date: new Date('2020-01-01') },
      { _id: '2', date: new Date('2030-01-01') },
    ];

    mockShiftSchedule.deleteMany.mockImplementation(({ date }) => {
      const beforeDate = date.$lt;
      const remaining = data.filter((s) => s.date >= beforeDate);
      const deleted = data.length - remaining.length;
      data.length = 0;
      data.push(...remaining);
      return { deletedCount: deleted };
    });

    const res = await request(app)
      .delete('/api/schedules/older-than?before=2021-01-01')
      .send({ employee: 'tester' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(data).toHaveLength(1);
    expect(data[0]._id).toBe('2');
  });

  it('rejects export when employee calls endpoint', async () => {
    const exportApp = buildScheduleAppWithRole('employee');
    const res = await request(exportApp)
      .get('/api/schedules/export?month=2024-05&department=deptA');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(mockShiftSchedule.find).not.toHaveBeenCalled();
  });

  it('exports filtered excel with custom filename', async () => {
    const exportApp = buildScheduleAppWithRole('admin');
    const allSchedules = [
      {
        employee: { name: 'Alice' },
        date: new Date('2024-05-10T00:00:00.000Z'),
        shiftId: 's1',
        department: 'deptA',
      },
      {
        employee: { name: 'Bob' },
        date: new Date('2024-06-01T00:00:00.000Z'),
        shiftId: 's1',
        department: 'deptA',
      },
      {
        employee: { name: 'Cara' },
        date: new Date('2024-05-05T00:00:00.000Z'),
        shiftId: 's2',
        department: 'deptB',
      },
    ];

    mockShiftSchedule.find.mockImplementation((query) => {
      expect(query.department).toBe('deptA');
      expect(query.date.$gte.toISOString()).toBe(
        new Date('2024-05-01T00:00:00.000Z').toISOString()
      );
      expect(query.date.$lt.toISOString()).toBe(
        new Date('2024-06-01T00:00:00.000Z').toISOString()
      );

      const filtered = allSchedules.filter(
        (item) =>
          item.date >= query.date.$gte &&
          item.date < query.date.$lt &&
          item.department === query.department
      );

      const chain = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(filtered),
      };
      return chain;
    });

    const res = await request(exportApp)
      .get('/api/schedules/export?month=2024-05&department=deptA&format=excel')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="schedules-202405-deptA.xlsx"'
    );
    expect(mockShiftSchedule.find).toHaveBeenCalledTimes(1);

    const toBuffer = (body) => {
      if (Buffer.isBuffer(body)) return body;
      if (body instanceof Uint8Array) return Buffer.from(body);
      if (Array.isArray(body)) return Buffer.from(body);
      if (body && typeof body === 'object' && 'data' in body) {
        return Buffer.from(body.data);
      }
      const type = body === null
        ? 'null'
        : `${typeof body}:${body.constructor?.name ?? 'unknown'}`;
      throw new Error(`Unexpected response body type: ${type}`);
    };

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toBuffer(res.body));
    const worksheet = workbook.getWorksheet('Schedules');
    expect(worksheet.rowCount).toBe(2);
    const dataRow = worksheet.getRow(2).values;
    expect(dataRow[1]).toBe('Alice');
    expect(dataRow[2]).toBe('2024/05/10');
    expect(dataRow[3]).toBe('s1');
    expect(dataRow[4]).toBe('Morning');
  });
});
