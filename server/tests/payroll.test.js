import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockPayrollRecord = jest.fn().mockImplementation((data = {}) => ({
  ...data,
  save: saveMock
}));
mockPayrollRecord.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.unstable_mockModule('../src/models/PayrollRecord.js', () => ({ default: mockPayrollRecord }));

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
  mockPayrollRecord.find.mockReset();
});

describe('Payroll API', () => {
  it('lists payroll records', async () => {
    const fakeRecords = [{ amount: 100 }];
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeRecords) });
    const res = await request(app).get('/api/payroll');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 500 if listing fails', async () => {
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('fail')) });
    const res = await request(app).get('/api/payroll');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
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
