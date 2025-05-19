import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const PayrollRecord = jest.fn().mockImplementation(() => ({ save: saveMock }));
PayrollRecord.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/PayrollRecord.js', () => ({ default: PayrollRecord }), { virtual: true });

let app;
let payrollRoutes;

beforeAll(async () => {
  payrollRoutes = (await import('../src/routes/payrollRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/payroll', payrollRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  PayrollRecord.find.mockReset();
});

describe('Payroll API', () => {
  it('lists payroll records', async () => {
    const fakeRecords = [{ amount: 100 }];
    PayrollRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeRecords) });
    const res = await request(app).get('/api/payroll');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('creates payroll record', async () => {
    const payload = { amount: 100 };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/payroll').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
