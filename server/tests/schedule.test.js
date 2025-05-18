import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const ShiftSchedule = jest.fn().mockImplementation(() => ({ save: saveMock }));
ShiftSchedule.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/ShiftSchedule.js', () => ({ default: ShiftSchedule }), { virtual: true });

let app;
let scheduleRoutes;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  ShiftSchedule.find.mockReset();
});

describe('Schedule API', () => {
  it('lists schedules', async () => {
    const fakeSchedules = [{ shiftType: 'morning' }];
    ShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeSchedules) });
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeSchedules);
  });

  it('creates schedule', async () => {
    const payload = { shiftType: 'morning' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/schedules').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
