import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';


const AttendanceSetting = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
};

jest.mock('../src/models/AttendanceSetting.js', () => ({ default: AttendanceSetting }), { virtual: true });

let app;
let settingRoutes;

beforeAll(async () => {
  settingRoutes = (await import('../src/routes/attendanceSettingRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/attendance-settings', settingRoutes);
});

beforeEach(() => {
  AttendanceSetting.findOne.mockReset();
  AttendanceSetting.findOneAndUpdate.mockReset();
});

describe('AttendanceSetting API', () => {
  it('gets settings', async () => {
    const data = { shifts: [] };
    AttendanceSetting.findOne.mockResolvedValue(data);
    const res = await request(app).get('/api/attendance-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(data);
  });

  it('updates settings', async () => {
    const payload = { shifts: [] };
    AttendanceSetting.findOneAndUpdate.mockResolvedValue(payload);
    const res = await request(app).put('/api/attendance-settings').send(payload);
    expect(res.status).toBe(200);
    expect(AttendanceSetting.findOneAndUpdate).toHaveBeenCalledWith({}, payload, { new: true, upsert: true });

  });
});
