import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const InsuranceRecord = jest.fn().mockImplementation(() => ({ save: saveMock }));
InsuranceRecord.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/InsuranceRecord.js', () => ({ default: InsuranceRecord }), { virtual: true });

let app;
let insuranceRoutes;

beforeAll(async () => {
  insuranceRoutes = (await import('../src/routes/insuranceRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/insurance', insuranceRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  InsuranceRecord.find.mockReset();
});

describe('Insurance API', () => {
  it('lists insurance records', async () => {
    const fakeRecords = [{ provider: 'InsureCo' }];
    InsuranceRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeRecords) });
    const res = await request(app).get('/api/insurance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 500 if listing fails', async () => {
    InsuranceRecord.find.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('fail')) });
    const res = await request(app).get('/api/insurance');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates insurance record', async () => {
    const payload = { provider: 'InsureCo' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/insurance').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
