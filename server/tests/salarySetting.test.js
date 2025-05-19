import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const SalarySetting = jest.fn().mockImplementation(() => ({ save: saveMock }));
SalarySetting.find = jest.fn();
SalarySetting.findByIdAndUpdate = jest.fn();

jest.mock('../src/models/SalarySetting.js', () => ({ default: SalarySetting }), { virtual: true });

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
  SalarySetting.find.mockReset();
  SalarySetting.findByIdAndUpdate.mockReset();
});

describe('SalarySetting API', () => {
  it('lists settings', async () => {
    const fake = [{ salaryItems: [] }];
    SalarySetting.find.mockResolvedValue(fake);
    const res = await request(app).get('/api/salary-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fake);
  });

  it('creates setting', async () => {
    const payload = { salaryItems: [] };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/salary-settings').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });

  it('updates setting', async () => {
    SalarySetting.findByIdAndUpdate.mockResolvedValue({ _id: '1', salaryItems: [] });
    const res = await request(app).put('/api/salary-settings/1').send({ salaryItems: [] });
    expect(res.status).toBe(200);
    expect(SalarySetting.findByIdAndUpdate).toHaveBeenCalled();
  });
});
