import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockAttendanceRecord = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockAttendanceRecord.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }), { virtual: true });

let app;
let attendanceRoutes;

beforeAll(async () => {
  attendanceRoutes = (await import('../src/routes/attendanceRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockAttendanceRecord.find.mockReset();
});

describe('Attendance API', () => {
  it('lists records', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    mockAttendanceRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeRecords) });
    const res = await request(app).get('/api/attendance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 500 if listing fails', async () => {
    mockAttendanceRecord.find.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('fail')) });
    const res = await request(app).get('/api/attendance');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates record', async () => {
    const payload = { action: 'clockIn' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/attendance').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
