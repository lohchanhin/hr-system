import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const Report = jest.fn().mockImplementation(() => ({ save: saveMock }));
Report.find = jest.fn();

jest.mock('../src/models/Report.js', () => ({ default: Report }), { virtual: true });

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
  Report.find.mockReset();
});

describe('Report API', () => {
  it('lists reports', async () => {
    const fakeReports = [{ name: 'Monthly' }];
    Report.find.mockResolvedValue(fakeReports);
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeReports);
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
