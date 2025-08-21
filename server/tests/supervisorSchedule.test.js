import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockShiftSchedule = { findOne: jest.fn(), create: jest.fn(), insertMany: jest.fn() };
const mockLeaveRequest = { findOne: jest.fn() };
const mockEmployee = { findById: jest.fn() };
const mockUser = { findById: jest.fn() };

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/LeaveRequest.js', () => ({ default: mockLeaveRequest }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }));

let app;
let scheduleRoutes;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'u1', role: 'supervisor' };
    next();
  });
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  mockShiftSchedule.findOne.mockReset();
  mockShiftSchedule.create.mockReset();
  mockShiftSchedule.insertMany.mockReset();
  mockLeaveRequest.findOne.mockReset();
  mockEmployee.findById.mockReset();
  mockUser.findById.mockReset();
});

describe('Supervisor schedule permissions', () => {
  it('allows supervisor to create schedule for own employee', async () => {
    mockUser.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'u1', role: 'supervisor', employee: null, supervisor: 'sup1' })
    });
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1', supervisor: 'sup1' });
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockLeaveRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.create.mockResolvedValue({ _id: 'sch1' });

    const res = await request(app)
      .post('/api/schedules')
      .send({ employee: 'emp1', date: '2023-01-01', shiftId: 'day' });

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.create).toHaveBeenCalled();
  });

  it('rejects batch creation if any employee not under supervisor', async () => {
    mockUser.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'u1', role: 'supervisor', employee: null, supervisor: 'sup1' })
    });
    mockEmployee.findById.mockImplementation((id) => {
      if (id === 'emp1') return Promise.resolve({ _id: 'emp1', supervisor: 'sup1' });
      if (id === 'emp2') return Promise.resolve({ _id: 'emp2', supervisor: 'other' });
      return Promise.resolve(null);
    });

    const payload = {
      schedules: [
        { employee: 'emp1', date: '2023-01-01', shiftId: 'day' },
        { employee: 'emp2', date: '2023-01-02', shiftId: 'day' }
      ]
    };

    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(403);
    expect(mockShiftSchedule.insertMany).not.toHaveBeenCalled();
  });
});
