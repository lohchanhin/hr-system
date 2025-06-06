import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockApproval = {
  find: jest.fn(),
  findByIdAndUpdate: jest.fn()
};

jest.mock('../src/models/Approval.js', () => ({ default: mockApproval }), { virtual: true });

let app;
let approvalRoutes;

beforeAll(async () => {
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/approvals', approvalRoutes);
});

beforeEach(() => {
  mockApproval.find.mockReset();
  mockApproval.findByIdAndUpdate.mockReset();
});

describe('Approval API', () => {
  it('lists approvals', async () => {
    const fakeApprovals = [{ type: 'leave' }];
    mockApproval.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeApprovals) });
    const res = await request(app).get('/api/approvals');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeApprovals);
  });

  it('returns 500 if listing fails', async () => {
    mockApproval.find.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('fail')) });
    const res = await request(app).get('/api/approvals');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('approves request', async () => {
    mockApproval.findByIdAndUpdate.mockResolvedValue({ status: 'approved' });
    const res = await request(app).post('/api/approvals/123/approve');
    expect(res.status).toBe(200);
    expect(mockApproval.findByIdAndUpdate).toHaveBeenCalledWith('123', { status: 'approved' }, { new: true });
  });

  it('rejects request', async () => {
    mockApproval.findByIdAndUpdate.mockResolvedValue({ status: 'rejected' });
    const res = await request(app).post('/api/approvals/123/reject');
    expect(res.status).toBe(200);
    expect(mockApproval.findByIdAndUpdate).toHaveBeenCalledWith('123', { status: 'rejected' }, { new: true });
  });
});
