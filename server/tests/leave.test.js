import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockLeaveRequest = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockLeaveRequest.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/models/LeaveRequest.js', () => ({ default: mockLeaveRequest }), { virtual: true });

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
  mockLeaveRequest.find.mockReset();
});

describe('Leave API', () => {
  it('lists leaves', async () => {
    const fakeLeaves = [{ leaveType: 'vacation' }];
    mockLeaveRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeLeaves) });
    const res = await request(app).get('/api/leaves');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeLeaves);
  });

  it('returns 500 if listing fails', async () => {
    mockLeaveRequest.find.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('fail')) });
    const res = await request(app).get('/api/leaves');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
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
