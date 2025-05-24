import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';


const mockAttendanceSetting = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
};

jest.mock('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }), { virtual: true });

let app;
let settingRoutes;

beforeAll(async () => {
  settingRoutes = (await import('../src/routes/attendanceSettingRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/attendance-settings', settingRoutes);
});

beforeEach(() => {
  mockAttendanceSetting.findOne.mockReset();
  mockAttendanceSetting.findOneAndUpdate.mockReset();
});

describe('AttendanceSetting API', () => {
  it('gets settings', async () => {
    const data = { shifts: [] };
    mockAttendanceSetting.findOne.mockResolvedValue(data);
    const res = await request(app).get('/api/attendance-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(data);
  });

  it('returns 500 if listing fails', async () => {
    mockAttendanceSetting.findOne.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/attendance-settings');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('updates settings', async () => {
    const payload = { shifts: [] };
    mockAttendanceSetting.findOneAndUpdate.mockResolvedValue(payload);
    const res = await request(app).put('/api/attendance-settings').send(payload);
    expect(res.status).toBe(200);
    expect(mockAttendanceSetting.findOneAndUpdate).toHaveBeenCalledWith({}, payload, { new: true, upsert: true });

  });
});
