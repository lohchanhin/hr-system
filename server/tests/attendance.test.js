import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockAttendanceRecord = jest.fn().mockImplementation((data = {}) => ({
  ...data,
  save: saveMock
}));
mockAttendanceRecord.find = jest.fn();

const mockEmployee = {
  findById: jest.fn(),
  find: jest.fn(),
};

const mockAttendanceManagementSetting = {
  findOne: jest.fn(),
};

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceManagementSetting.js', () => ({ default: mockAttendanceManagementSetting }));

let app;
let attendanceRoutes;
let currentUser;

const setupFindChain = ({ records = [], error } = {}) => {
  const populateMock = error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue(records);
  const sortMock = jest.fn().mockReturnValue({ populate: populateMock });
  mockAttendanceRecord.find.mockReturnValue({ sort: sortMock });
  return { sortMock, populateMock };
};

beforeAll(async () => {
  attendanceRoutes = (await import('../src/routes/attendanceRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (currentUser) {
      req.user = currentUser;
    }
    next();
  });
  app.use('/api/attendance', attendanceRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockAttendanceRecord.find.mockReset();
  mockEmployee.findById.mockReset();
  mockEmployee.find.mockReset();
  mockAttendanceManagementSetting.findOne.mockReset();
  mockEmployee.findById.mockResolvedValue(null);
  mockEmployee.find.mockResolvedValue([]);
  mockAttendanceManagementSetting.findOne.mockResolvedValue(null);
  currentUser = undefined;
});

describe('Attendance API', () => {
  it('lists records for admins with newest first', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    const { sortMock, populateMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'admin1', role: 'admin' };

    const res = await request(app).get('/api/attendance');

    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({});
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(populateMock).toHaveBeenCalledWith('employee');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 403 when supervisor queries unauthorized employee', async () => {
    currentUser = { id: 'sup1', role: 'supervisor' };
    mockEmployee.findById.mockImplementation((id) => {
      if (id === 'sup1') return Promise.resolve({ _id: 'sup1', department: 'deptA' });
      if (id === 'empX') return Promise.resolve({ _id: 'empX', department: 'deptB', supervisor: 'other' });
      return Promise.resolve(null);
    });
    mockAttendanceManagementSetting.findOne.mockResolvedValue({ supervisorCrossDept: false });

    const res = await request(app).get('/api/attendance').query({ employee: 'empX' });

    expect(res.status).toBe(403);
    expect(mockAttendanceRecord.find).not.toHaveBeenCalled();
  });

  it('scopes supervisor queries to authorized employees when no employee filter is provided', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    const { sortMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'sup1', role: 'supervisor' };
    mockEmployee.findById.mockResolvedValue({ _id: 'sup1', department: 'deptA' });
    mockEmployee.find.mockImplementation((filter) => {
      if (filter.supervisor === 'sup1') {
        return Promise.resolve([
          { _id: 'empA', department: 'deptA', supervisor: 'sup1' },
          { _id: 'empB', department: 'deptB', supervisor: 'sup1' }
        ]);
      }
      if (filter.department === 'deptA') {
        return Promise.resolve([
          { _id: 'empA', department: 'deptA', supervisor: 'sup1' },
          { _id: 'empC', department: 'deptA', supervisor: 'sup2' },
          { _id: 'sup1', department: 'deptA' }
        ]);
      }
      return Promise.resolve([]);
    });
    mockAttendanceManagementSetting.findOne.mockResolvedValue({ supervisorCrossDept: false });

    const res = await request(app).get('/api/attendance');

    expect(res.status).toBe(200);
    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({ employee: { $in: expect.any(Array) } });
    const scopedIds = mockAttendanceRecord.find.mock.calls[0][0].employee.$in;
    expect(scopedIds).toEqual(expect.arrayContaining(['empA', 'empC']));
    expect(scopedIds).not.toContain('empB');
    expect(scopedIds).not.toContain('sup1');
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(res.body).toEqual(fakeRecords);
  });

  it('restricts employees to their own records and sorts by newest first', async () => {
    const fakeRecords = [{ action: 'clockOut' }];
    const { sortMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'emp1', role: 'employee' };

    const res = await request(app).get('/api/attendance').query({ employee: 'someoneElse' });

    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({ employee: 'emp1' });
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 500 if listing fails', async () => {
    setupFindChain({ error: new Error('fail') });

    const res = await request(app).get('/api/attendance');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates record with remark', async () => {
    const payload = { action: 'clockIn', employee: 'emp1', remark: 'test' };
    saveMock.mockResolvedValue();

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });

  it('returns 400 when employee is missing', async () => {
    const payload = { action: 'clockIn' };

    const res = await request(app).post('/api/attendance').send(payload);

    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
