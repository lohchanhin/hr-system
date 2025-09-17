import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockAttendanceRecord = jest.fn().mockImplementation((data = {}) => ({
  ...data,
  save: saveMock
}));
mockAttendanceRecord.find = jest.fn();

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }));

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
  currentUser = undefined;
});

describe('Attendance API', () => {
  it('lists records for privileged roles with newest first', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    const { sortMock, populateMock } = setupFindChain({ records: fakeRecords });
    currentUser = { id: 'sup1', role: 'supervisor' };

    const res = await request(app).get('/api/attendance');

    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({});
    expect(sortMock).toHaveBeenCalledWith({ timestamp: -1 });
    expect(populateMock).toHaveBeenCalledWith('employee');
    expect(res.status).toBe(200);
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
