// scheduleRoutes.test.ts (或 .js)
// 整合版：含 list / create(upsert) / monthly / supervisor / export(pdf|excel) / batch / delete-old

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

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

const mockFormTemplate = { findOne: jest.fn() };
const mockFormField = { find: jest.fn() };

const mockEmployee = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };

/* --------------------------- jest.mock 設定區 --------------------------- */


jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));

// 驗證中介層直接放行
jest.unstable_mockModule('../src/middleware/supervisor.js', () => ({ verifySupervisor: (req, res, next) => next() }));

/* --------------------------------- App --------------------------------- */
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
  mockShiftSchedule.findOne.mockReset();
  mockShiftSchedule.create.mockReset();
  mockShiftSchedule.insertMany.mockReset();
  mockShiftSchedule.deleteMany.mockReset();

  mockApprovalRequest.findOne.mockReset();
  mockApprovalRequest.find.mockReset();
  mockFormTemplate.findOne.mockResolvedValue({ _id: 'form1' });
  mockFormField.find.mockResolvedValue([
    { _id: 's', label: '開始日期' },
    { _id: 'e', label: '結束日期' },
    { _id: 't', label: '假別' },
  ]);
  mockEmployee.find.mockReset();
  mockAttendanceSetting.findOne.mockReset();
  mockAttendanceSetting.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      shifts: [{ _id: 's1', name: 'Morning' }]
    })
  });
});

/* --------------------------------- Tests -------------------------------- */
describe('Schedule API', () => {
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

  it('rejects batch if schedule exists', async () => {
    mockShiftSchedule.findOne.mockResolvedValue({ _id: '1', department: 'd1' });
    const payload = { schedules: [{ employee: 'e1', date: '2023-01-01', shiftId: 'day' }] };
    const res = await request(app).post('/api/schedules/batch').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'employee conflict' });
  });

  it('rejects batch if cross-department', async () => {
    mockShiftSchedule.findOne.mockResolvedValue({ _id: '1', department: 'd1' });
    const payload = {
      schedules: [
        { employee: 'e1', date: '2023-01-01', shiftId: 'day', department: 'd2' }
      ]
    };
    const res = await request(app).post('/api/schedules/batch').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'department overlap' });
  });

  it('rejects batch if cross sub-department', async () => {
    mockShiftSchedule.findOne.mockResolvedValue({ _id: '1', department: 'd1', subDepartment: 'sd1' });
    const payload = {
      schedules: [
        {
          employee: 'e1',
          date: '2023-01-01',
          shiftId: 'day',
          department: 'd1',
          subDepartment: 'sd2'
        }
      ]
    };
    const res = await request(app).post('/api/schedules/batch').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'department overlap' });
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
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      then: (resolve) => resolve(approvals)
    });
    const res = await request(app).get('/api/schedules/leave-approvals?month=2023-01&employee=e1');
    expect(res.status).toBe(200);
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

    const res = await request(app).delete('/api/schedules/older-than?before=2021-01-01');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(data).toHaveLength(1);
    expect(data[0]._id).toBe('2');
  });
});
