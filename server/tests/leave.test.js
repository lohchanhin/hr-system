import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const LeaveRequest = jest.fn().mockImplementation(() => ({ save: saveMock }));
LeaveRequest.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/LeaveRequest.js', () => ({ default: LeaveRequest }), { virtual: true });

let app;
let leaveRoutes;

beforeAll(async () => {
  leaveRoutes = (await import('../src/routes/leaveRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/leaves', leaveRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  LeaveRequest.find.mockReset();
});

describe('Leave API', () => {
  it('lists leaves', async () => {
    const fakeLeaves = [{ leaveType: 'vacation' }];
    LeaveRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeLeaves) });
    const res = await request(app).get('/api/leaves');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeLeaves);
  });

  it('creates leave', async () => {
    const payload = { leaveType: 'vacation' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/leaves').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });
});
