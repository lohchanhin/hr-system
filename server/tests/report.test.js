import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockReport = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockReport.find = jest.fn();

jest.mock('../src/models/Report.js', () => ({ default: mockReport }), { virtual: true });

let app;
let reportRoutes;

beforeAll(async () => {
  reportRoutes = (await import('../src/routes/reportRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/reports', reportRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockReport.find.mockReset();
});

describe('Report API', () => {
  it('lists reports', async () => {
    const fakeReports = [{ name: 'Monthly' }];
    mockReport.find.mockResolvedValue(fakeReports);
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeReports);
  });

  it('returns 500 if listing fails', async () => {
    mockReport.find.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates report', async () => {
    const payload = { name: 'Monthly' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/reports').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
