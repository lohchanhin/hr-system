import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockLeaveRequest = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockLeaveRequest.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));

const mockApprovalRequest = {
  find: jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }))
};
const mockEmployee = { find: jest.fn() };

jest.mock('../src/models/LeaveRequest.js', () => ({ default: mockLeaveRequest }), { virtual: true });
jest.mock('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }), { virtual: true });
jest.mock('../src/models/Employee.js', () => ({ default: mockEmployee }), { virtual: true });

let app;
let leaveRoutes;
let scheduleRoutes;

beforeAll(async () => {
  leaveRoutes = (await import('../src/routes/leaveRoutes.js')).default;
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/leaves', leaveRoutes);
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockLeaveRequest.find.mockReset();
  mockApprovalRequest.find.mockReset();
  mockEmployee.find.mockReset();
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

  it('lists leaves and approvals by employee', async () => {
    const fakeLeaves = [{ employee: 'e1', leaveType: 'sick', status: 'approved' }];
    const fakeApprovals = [{ applicant_employee: { name: 'A' }, status: 'pending', form_data: { leaveType: 'sick' } }];
    mockLeaveRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeLeaves) });
    mockApprovalRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeApprovals) });
    const res = await request(app).get('/api/schedules/leave-approvals?month=2023-01&employee=e1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ leaves: fakeLeaves, approvals: fakeApprovals });
  });

  it('filters by supervisor when listing leave approvals', async () => {
    mockEmployee.find.mockResolvedValue([{ _id: 'e1' }]);
    mockLeaveRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });
    mockApprovalRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });
    await request(app).get('/api/schedules/leave-approvals?month=2023-01&supervisor=s1');
    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: 's1' });
    const called = mockLeaveRequest.find.mock.calls[0][0];
    expect(called.employee).toEqual({ $in: ['e1'] });
  });
});
