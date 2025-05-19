import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const AttendanceManagementSetting = jest.fn().mockImplementation(() => ({ save: saveMock }));
AttendanceManagementSetting.find = jest.fn();

jest.mock('../src/models/AttendanceManagementSetting.js', () => ({ default: AttendanceManagementSetting }), { virtual: true });

let app;
let routes;

beforeAll(async () => {
  routes = (await import('../src/routes/attendanceSettingRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/attendance-settings', routes);
});

beforeEach(() => {
  saveMock.mockReset();
  AttendanceManagementSetting.find.mockReset();
});

describe('AttendanceManagementSetting API', () => {
  it('lists settings', async () => {
    const fake = [{ enableImport: true }];
    AttendanceManagementSetting.find.mockResolvedValue(fake);
    const res = await request(app).get('/api/attendance-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fake);
  });

  it('creates setting', async () => {
    const payload = { enableImport: true };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/attendance-settings').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
