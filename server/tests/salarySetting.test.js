import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockSalarySetting = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockSalarySetting.find = jest.fn();
mockSalarySetting.findByIdAndUpdate = jest.fn();

jest.unstable_mockModule('../src/models/SalarySetting.js', () => ({ default: mockSalarySetting }));

let app;
let salaryRoutes;

beforeAll(async () => {
  salaryRoutes = (await import('../src/routes/salarySettingRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/salary-settings', salaryRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockSalarySetting.find.mockReset();
  mockSalarySetting.findByIdAndUpdate.mockReset();
});

describe('SalarySetting API', () => {
  it('lists settings', async () => {
    const fake = [{ salaryItems: [] }];
    mockSalarySetting.find.mockResolvedValue(fake);
    const res = await request(app).get('/api/salary-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fake);
  });

  it('returns 500 if listing fails', async () => {
    mockSalarySetting.find.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/salary-settings');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates setting', async () => {
    const payload = { salaryItems: [] };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/salary-settings').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toEqual({});
  });

  it('updates setting', async () => {
    mockSalarySetting.findByIdAndUpdate.mockResolvedValue({ _id: '1', salaryItems: [] });
    const res = await request(app).put('/api/salary-settings/1').send({ salaryItems: [] });
    expect(res.status).toBe(200);
    expect(mockSalarySetting.findByIdAndUpdate).toHaveBeenCalled();
  });
});
