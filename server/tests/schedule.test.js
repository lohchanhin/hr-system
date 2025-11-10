// scheduleRoutes.test.ts (或 .js)
// 整合版：含 list / create(upsert) / monthly / supervisor / export(pdf|excel) / batch / delete-old

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';

/* ----------------------------- Mocks: Models ----------------------------- */
// 統一成物件型態，提供各端點會用到的方法
const mockShiftSchedule = {
  find: jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) })),
  findOne: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
  updateMany: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  startSession: jest.fn(),
};

const mockApprovalRequest = { findOne: jest.fn(), find: jest.fn() };

const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockDepartment = { find: jest.fn() };

const mockGetLeaveFieldIds = jest.fn();
const mockIsTokenBlacklisted = jest.fn();

const createSelectResponse = (rows = []) => {
  const chain = {
    lean: jest.fn().mockResolvedValue(rows),
  };
  chain.then = (resolve) => Promise.resolve(rows).then(resolve);
  chain.catch = (reject) => Promise.resolve(rows).catch(reject);
  return chain;
};

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

const buildPopulateChain = (value) => {
  const chain = {
    populate: jest.fn(function populate() {
      return chain;
    }),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
};

/* --------------------------- jest.mock 設定區 --------------------------- */


jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: mockGetLeaveFieldIds,
}));
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  isTokenBlacklisted: mockIsTokenBlacklisted,
}));

let currentRole = 'supervisor';

/* --------------------------------- App --------------------------------- */
let app;
let scheduleRoutes;
let authorizeRoles;

beforeAll(async () => {
  ({ authorizeRoles } = await import('../src/middleware/auth.js'));
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
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
  mockShiftSchedule.updateMany.mockReset();
  mockShiftSchedule.findById.mockReset();
  mockShiftSchedule.findByIdAndDelete.mockReset();
  mockShiftSchedule.startSession.mockReset();

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
  mockIsTokenBlacklisted.mockReset();
  mockIsTokenBlacklisted.mockResolvedValue(false);
  mockEmployee.find.mockReset();
  mockEmployee.find.mockReturnValue({
    select: jest.fn().mockImplementation(() => createSelectResponse([])),
    lean: jest.fn().mockResolvedValue([]),
  });
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
  mockDepartment.find.mockReset();
  mockDepartment.find.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([])
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

const buildAuthHeader = (role = 'supervisor', overrides = {}) => {
  const payload = { id: 'tester', role, ...overrides };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret');
  return `Bearer ${token}`;
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

  describe('publish and finalize workflow', () => {
    it('publishes schedules for a supervisor', async () => {
      const docs = [
        {
          _id: 'sch1',
          employee: { _id: 'emp1', name: '王小明' },
          state: 'draft',
          employeeResponse: 'pending',
          date: new Date('2024-05-01'),
        },
      ];
      mockShiftSchedule.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(docs),
      });
      mockShiftSchedule.updateMany.mockResolvedValue({ modifiedCount: 1 });
      const selectMock = jest.fn().mockResolvedValue([{ _id: 'emp1' }]);
      mockEmployee.find.mockReturnValue({ select: selectMock });

      const res = await request(app)
        .post('/api/schedules/publish')
        .set('Authorization', buildAuthHeader('supervisor'))
        .send({ month: '2024-05' });

      expect(res.status).toBe(200);
      expect(mockShiftSchedule.find).toHaveBeenCalledWith(expect.objectContaining({
        date: expect.any(Object),
        state: { $ne: 'finalized' },
      }));
      expect(mockShiftSchedule.updateMany).toHaveBeenCalledWith({
        _id: { $in: ['sch1'] },
      }, {
        $set: expect.objectContaining({
          state: 'pending_confirmation',
          employeeResponse: 'pending',
          responseNote: '',
        }),
      });
      expect(res.body).toEqual({
        updated: 1,
        employees: [
          {
            id: 'emp1',
            name: '王小明',
            response: 'pending',
            state: 'pending_confirmation',
          },
        ],
        publishedAt: expect.any(String),
      });
    });

    it('blocks finalize when employees are pending', async () => {
      const docs = [
        {
          _id: 'sch1',
          employee: { _id: 'emp1', name: '王小明' },
          state: 'pending_confirmation',
          employeeResponse: 'pending',
          responseNote: '',
          date: new Date('2024-05-02'),
        },
      ];
      mockShiftSchedule.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(docs),
      });
      const selectMock = jest.fn().mockResolvedValue([{ _id: 'emp1' }]);
      mockEmployee.find.mockReturnValue({ select: selectMock });

      const res = await request(app)
        .post('/api/schedules/publish/finalize')
        .set('Authorization', buildAuthHeader('supervisor'))
        .send({ month: '2024-05' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'unconfirmed employees',
        pendingEmployees: [
          expect.objectContaining({ id: 'emp1', name: '王小明' }),
        ],
        disputedEmployees: [],
      });
      expect(mockShiftSchedule.updateMany).not.toHaveBeenCalled();
    });

    it('finalizes schedules when all confirmed', async () => {
      const docs = [
        {
          _id: 'sch1',
          employee: { _id: 'emp1', name: '王小明' },
          state: 'pending_confirmation',
          employeeResponse: 'confirmed',
          responseNote: '',
          date: new Date('2024-05-03'),
        },
      ];
      mockShiftSchedule.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(docs),
      });
      const selectMock = jest.fn().mockResolvedValue([{ _id: 'emp1' }]);
      mockEmployee.find.mockReturnValue({ select: selectMock });

      const res = await request(app)
        .post('/api/schedules/publish/finalize')
        .set('Authorization', buildAuthHeader('supervisor'))
        .send({ month: '2024-05' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ finalized: 1 });
      expect(mockShiftSchedule.updateMany).toHaveBeenCalledWith({
        _id: { $in: ['sch1'] },
      }, { $set: { state: 'finalized' } });
    });
  });

  describe('employee schedule response', () => {
    const buildDoc = (overrides = {}) => ({
      _id: 'schX',
      state: 'pending_confirmation',
      employeeResponse: 'pending',
      responseNote: '',
      employee: { _id: 'empX', name: '回應員工' },
      save: jest.fn().mockImplementation(function save() {
        return Promise.resolve(this);
      }),
      populate: jest.fn().mockImplementation(function populate() {
        return Promise.resolve(this);
      }),
      $session: jest.fn().mockReturnThis(),
      ...overrides,
    });

    it('allows employee to confirm schedule', async () => {
      const doc = buildDoc({ _id: 'sch1', employee: { _id: 'emp1', name: '王小明' } });
      mockShiftSchedule.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(doc),
      });

      const res = await request(app)
        .post('/api/schedules/sch1/respond')
        .set('Authorization', buildAuthHeader('employee', { id: 'emp1' }))
        .send({ response: 'confirm' });

      expect(res.status).toBe(200);
      expect(doc.save).toHaveBeenCalled();
      expect(res.body.employeeResponse).toBe('confirmed');
      expect(res.body.responseNote).toBe('');
      expect(res.body.state).toBe('pending_confirmation');
      expect(res.body.responseAt).toBeDefined();
    });

    it('allows supervisor to confirm own schedule', async () => {
      const doc = buildDoc({
        _id: 'sch-sup-1',
        employee: { _id: 'sup1', name: '主管本人' },
      });
      mockShiftSchedule.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(doc),
      });

      const res = await request(app)
        .post('/api/schedules/sch-sup-1/respond')
        .set('Authorization', buildAuthHeader('supervisor', { id: 'sup1' }))
        .send({ response: 'confirm' });

      expect(res.status).toBe(200);
      expect(doc.save).toHaveBeenCalled();
      expect(res.body.employeeResponse).toBe('confirmed');
      expect(res.body.responseNote).toBe('');
    });

    it('requires dispute note when rejecting schedule', async () => {
      const doc = buildDoc({ _id: 'sch2', employee: { _id: 'emp2', name: '李小華' } });
      mockShiftSchedule.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(doc),
      });

      const res = await request(app)
        .post('/api/schedules/sch2/respond')
        .set('Authorization', buildAuthHeader('employee', { id: 'emp2' }))
        .send({ response: 'dispute', note: '班別與請假衝突' });

      expect(res.status).toBe(200);
      expect(res.body.employeeResponse).toBe('disputed');
      expect(res.body.state).toBe('changes_requested');
      expect(res.body.responseNote).toBe('班別與請假衝突');
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects dispute without note', async () => {
      const doc = buildDoc({ _id: 'sch3', employee: { _id: 'emp3', name: '張大成' } });
      mockShiftSchedule.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(doc),
      });

      const res = await request(app)
        .post('/api/schedules/sch3/respond')
        .set('Authorization', buildAuthHeader('employee', { id: 'emp3' }))
        .send({ response: 'dispute' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'objection note required' });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('allows employee to confirm schedules in bulk', async () => {
      const doc1 = buildDoc({ _id: 'sch-b1', employee: { _id: 'empBulk', name: '員工A' } });
      const doc2 = buildDoc({ _id: 'sch-b2', employee: { _id: 'empBulk', name: '員工A' } });
      const sessionMock = {
        startTransaction: jest.fn().mockResolvedValue(),
        commitTransaction: jest.fn().mockResolvedValue(),
        abortTransaction: jest.fn().mockResolvedValue(),
        endSession: jest.fn().mockResolvedValue(),
      };
      mockShiftSchedule.startSession.mockResolvedValue(sessionMock);
      mockShiftSchedule.findById.mockImplementation((id) => ({
        populate: jest.fn().mockResolvedValue(id === 'sch-b1' ? doc1 : doc2),
      }));

      const res = await request(app)
        .post('/api/schedules/respond/bulk')
        .set('Authorization', buildAuthHeader('employee', { id: 'empBulk' }))
        .send({ scheduleIds: ['sch-b1', 'sch-b2'], response: 'confirm' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        count: 2,
        schedules: expect.any(Array),
      });
      expect(doc1.employeeResponse).toBe('confirmed');
      expect(doc2.employeeResponse).toBe('confirmed');
      expect(sessionMock.startTransaction).toHaveBeenCalled();
      expect(sessionMock.commitTransaction).toHaveBeenCalled();
      expect(sessionMock.abortTransaction).not.toHaveBeenCalled();
    });

    it('allows supervisor to confirm own schedules in bulk', async () => {
      const doc1 = buildDoc({ _id: 'sch-sup-b1', employee: { _id: 'supBulk', name: '主管A' } });
      const doc2 = buildDoc({ _id: 'sch-sup-b2', employee: { _id: 'supBulk', name: '主管A' } });
      const sessionMock = {
        startTransaction: jest.fn().mockResolvedValue(),
        commitTransaction: jest.fn().mockResolvedValue(),
        abortTransaction: jest.fn().mockResolvedValue(),
        endSession: jest.fn().mockResolvedValue(),
      };
      mockShiftSchedule.startSession.mockResolvedValue(sessionMock);
      mockShiftSchedule.findById.mockImplementation((id) => ({
        populate: jest.fn().mockResolvedValue(id === 'sch-sup-b1' ? doc1 : doc2),
      }));

      const res = await request(app)
        .post('/api/schedules/respond/bulk')
        .set('Authorization', buildAuthHeader('supervisor', { id: 'supBulk' }))
        .send({ scheduleIds: ['sch-sup-b1', 'sch-sup-b2'], response: 'confirm' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        count: 2,
        schedules: expect.any(Array),
      });
      expect(doc1.employeeResponse).toBe('confirmed');
      expect(doc2.employeeResponse).toBe('confirmed');
      expect(sessionMock.commitTransaction).toHaveBeenCalled();
      expect(sessionMock.abortTransaction).not.toHaveBeenCalled();
    });

    it('falls back to non-transaction bulk confirmation when replica set unavailable', async () => {
      const doc1 = buildDoc({ _id: 'sch-rs-1', employee: { _id: 'empRS', name: '員工RS' } });
      const doc2 = buildDoc({ _id: 'sch-rs-2', employee: { _id: 'empRS', name: '員工RS' } });
      const sessionMock = {
        startTransaction: jest.fn().mockRejectedValue(
          Object.assign(
            new Error('Transaction numbers are only allowed on a replica set member or mongos'),
            { code: 20 },
          ),
        ),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn().mockResolvedValue(),
      };
      mockShiftSchedule.startSession.mockResolvedValue(sessionMock);
      mockShiftSchedule.findById.mockImplementation((id) => ({
        populate: jest.fn().mockResolvedValue(id === 'sch-rs-1' ? doc1 : doc2),
      }));

      const res = await request(app)
        .post('/api/schedules/respond/bulk')
        .set('Authorization', buildAuthHeader('employee', { id: 'empRS' }))
        .send({ scheduleIds: ['sch-rs-1', 'sch-rs-2'], response: 'confirm' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        count: 2,
        schedules: expect.any(Array),
      });
      expect(doc1.employeeResponse).toBe('confirmed');
      expect(doc2.employeeResponse).toBe('confirmed');
      expect(sessionMock.startTransaction).toHaveBeenCalledTimes(1);
      expect(sessionMock.commitTransaction).not.toHaveBeenCalled();
      expect(sessionMock.abortTransaction).not.toHaveBeenCalled();
      expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
    });

    it('retries bulk confirmation without transaction when save fails due to replica set restrictions', async () => {
      const buildQuery = (doc) => ({
        session: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue(doc),
      });

      const sessionMock = {
        startTransaction: jest.fn().mockResolvedValue(),
        commitTransaction: jest.fn().mockResolvedValue(),
        abortTransaction: jest.fn().mockResolvedValue(),
        endSession: jest.fn().mockResolvedValue(),
      };

      mockShiftSchedule.startSession.mockResolvedValue(sessionMock);

      const replicaError = Object.assign(
        new Error('Transaction numbers are only allowed on a replica set member or mongos'),
        { code: 20 },
      );

      const doc1First = buildDoc({ _id: 'sch-save-1', employee: { _id: 'empSave', name: '員工RS' } });
      const doc2First = buildDoc({ _id: 'sch-save-2', employee: { _id: 'empSave', name: '員工RS' } });
      doc2First.save = jest.fn().mockRejectedValue(replicaError);

      const doc1Second = buildDoc({ _id: 'sch-save-1', employee: { _id: 'empSave', name: '員工RS' } });
      const doc2Second = buildDoc({ _id: 'sch-save-2', employee: { _id: 'empSave', name: '員工RS' } });

      mockShiftSchedule.findById
        .mockImplementationOnce(() => buildQuery(doc1First))
        .mockImplementationOnce(() => buildQuery(doc2First))
        .mockImplementationOnce(() => buildQuery(doc1Second))
        .mockImplementationOnce(() => buildQuery(doc2Second));

      const res = await request(app)
        .post('/api/schedules/respond/bulk')
        .set('Authorization', buildAuthHeader('employee', { id: 'empSave' }))
        .send({ scheduleIds: ['sch-save-1', 'sch-save-2'], response: 'confirm' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        count: 2,
        schedules: expect.any(Array),
      });

      expect(doc1First.save).toHaveBeenCalledTimes(1);
      expect(doc2First.save).toHaveBeenCalledTimes(1);
      expect(doc1Second.save).toHaveBeenCalledTimes(1);
      expect(doc2Second.save).toHaveBeenCalledTimes(1);
      expect(doc1Second.employeeResponse).toBe('confirmed');
      expect(doc2Second.employeeResponse).toBe('confirmed');

      expect(sessionMock.abortTransaction).toHaveBeenCalledTimes(1);
      expect(sessionMock.commitTransaction).not.toHaveBeenCalled();
      expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
      expect(mockShiftSchedule.findById).toHaveBeenCalledTimes(4);
    });

    it('aborts bulk response when schedule not owned by employee', async () => {
      const doc = buildDoc({ _id: 'sch-b3', employee: { _id: 'empOther', name: '其他人' } });
      const sessionMock = {
        startTransaction: jest.fn().mockResolvedValue(),
        commitTransaction: jest.fn().mockResolvedValue(),
        abortTransaction: jest.fn().mockResolvedValue(),
        endSession: jest.fn().mockResolvedValue(),
      };
      mockShiftSchedule.startSession.mockResolvedValue(sessionMock);
      mockShiftSchedule.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(doc),
      });

      const res = await request(app)
        .post('/api/schedules/respond/bulk')
        .set('Authorization', buildAuthHeader('employee', { id: 'empBulk' }))
        .send({ scheduleIds: ['sch-b3'], response: 'confirm' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden' });
      expect(sessionMock.abortTransaction).toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('requires note when disputing schedules in bulk', async () => {
      const doc = buildDoc({ _id: 'sch-b4', employee: { _id: 'empBulk', name: '員工B' } });
      const sessionMock = {
        startTransaction: jest.fn().mockResolvedValue(),
        commitTransaction: jest.fn().mockResolvedValue(),
        abortTransaction: jest.fn().mockResolvedValue(),
        endSession: jest.fn().mockResolvedValue(),
      };
      mockShiftSchedule.startSession.mockResolvedValue(sessionMock);
      mockShiftSchedule.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(doc),
      });

      const res = await request(app)
        .post('/api/schedules/respond/bulk')
        .set('Authorization', buildAuthHeader('employee', { id: 'empBulk' }))
        .send({ scheduleIds: ['sch-b4'], response: 'dispute' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'objection note required' });
      expect(sessionMock.abortTransaction).toHaveBeenCalled();
    });
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

  describe('schedule overview', () => {
    it('requires admin role to access overview', async () => {
      currentRole = 'employee';

      const res = await request(app).get('/api/schedules/overview?month=2024-05');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('returns hierarchical overview data for the selected month', async () => {
      currentRole = 'admin';
      const month = '2024-05';
      const fakeSchedules = [
        {
          _id: 'sch-1',
          shiftId: 's1',
          date: new Date('2024-05-01T00:00:00.000Z'),
          employee: { _id: 'emp-1', name: 'Alice', title: '護理師' },
          department: {
            _id: 'dept-1',
            name: '內科部',
            organization: { _id: 'org-1', name: '台北總院' },
          },
          subDepartment: { _id: 'sub-1', name: '急診一科' },
        },
        {
          _id: 'sch-2',
          shiftId: 's2',
          date: new Date('2024-05-02T00:00:00.000Z'),
          employee: { _id: 'emp-1', name: 'Alice', title: '護理師' },
          department: {
            _id: 'dept-1',
            name: '內科部',
            organization: { _id: 'org-1', name: '台北總院' },
          },
          subDepartment: { _id: 'sub-1', name: '急診一科' },
        },
        {
          _id: 'sch-3',
          shiftId: 's2',
          date: new Date('2024-05-01T00:00:00.000Z'),
          employee: { _id: 'emp-2', name: 'Brian', title: '護理師' },
          department: {
            _id: 'dept-2',
            name: '外科部',
            organization: { _id: 'org-1', name: '台北總院' },
          },
          subDepartment: { _id: 'sub-2', name: '外科病房' },
        },
      ];

      mockAttendanceSetting.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          shifts: [
            { _id: 's1', name: '早班' },
            { _id: 's2', name: '小夜班' },
          ],
        }),
      });
      mockShiftSchedule.find.mockReturnValue(buildPopulateChain(fakeSchedules));

      const res = await request(app).get(`/api/schedules/overview?month=${month}`);

      expect(res.status).toBe(200);
      expect(res.body.month).toBe(month);
      expect(Array.isArray(res.body.days)).toBe(true);
      expect(res.body.days[0]).toBe('2024-05-01');
      expect(res.body.organizations).toEqual([
        {
          id: 'org-1',
          name: '台北總院',
          departments: [
            {
              id: 'dept-1',
              name: '內科部',
              subDepartments: [
                {
                  id: 'sub-1',
                  name: '急診一科',
                  employees: [
                    {
                      id: 'emp-1',
                      name: 'Alice',
                      title: '護理師',
                      schedules: [
                        { date: '2024-05-01', shiftId: 's1', shiftName: '早班' },
                        { date: '2024-05-02', shiftId: 's2', shiftName: '小夜班' },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              id: 'dept-2',
              name: '外科部',
              subDepartments: [
                {
                  id: 'sub-2',
                  name: '外科病房',
                  employees: [
                    {
                      id: 'emp-2',
                      name: 'Brian',
                      title: '護理師',
                      schedules: [
                        { date: '2024-05-01', shiftId: 's2', shiftName: '小夜班' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
    });

    it('returns empty result when organization has no departments', async () => {
      currentRole = 'admin';
      mockDepartment.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      const res = await request(app).get('/api/schedules/overview?month=2024-05&organization=org-x');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ month: '2024-05', days: expect.any(Array), organizations: [] });
      expect(res.body.days[0]).toBe('2024-05-01');
    });
  });
});
