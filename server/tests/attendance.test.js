import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const AttendanceRecord = jest.fn().mockImplementation(() => ({ save: saveMock }));
AttendanceRecord.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/AttendanceRecord.js', () => ({ default: AttendanceRecord }), { virtual: true });

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
  AttendanceRecord.find.mockReset();
});

describe('Attendance API', () => {
  it('lists records', async () => {
    const fakeRecords = [{ action: 'clockIn' }];
    AttendanceRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeRecords) });
    const res = await request(app).get('/api/attendance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
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
