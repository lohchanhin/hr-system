import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const Approval = {
  find: jest.fn(),
  findByIdAndUpdate: jest.fn()
};

jest.mock('../src/models/Approval.js', () => ({ default: Approval }), { virtual: true });

let app;
let approvalRoutes;

beforeAll(async () => {
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/approvals', approvalRoutes);
});

beforeEach(() => {
  Approval.find.mockReset();
  Approval.findByIdAndUpdate.mockReset();
});

describe('Approval API', () => {
  it('lists approvals', async () => {
    const fakeApprovals = [{ type: 'leave' }];
    Approval.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeApprovals) });
    const res = await request(app).get('/api/approvals');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeApprovals);
  });

  it('approves request', async () => {
    Approval.findByIdAndUpdate.mockResolvedValue({ status: 'approved' });
    const res = await request(app).post('/api/approvals/123/approve');
    expect(res.status).toBe(200);
    expect(Approval.findByIdAndUpdate).toHaveBeenCalledWith('123', { status: 'approved' }, { new: true });
  });

  it('rejects request', async () => {
    Approval.findByIdAndUpdate.mockResolvedValue({ status: 'rejected' });
    const res = await request(app).post('/api/approvals/123/reject');
    expect(res.status).toBe(200);
    expect(Approval.findByIdAndUpdate).toHaveBeenCalledWith('123', { status: 'rejected' }, { new: true });
  });
});
