import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockSubDepartment = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockSubDepartment.find = jest.fn();
mockSubDepartment.findByIdAndUpdate = jest.fn();
mockSubDepartment.findByIdAndDelete = jest.fn();

jest.mock('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }), { virtual: true });

let app;
let subDepartmentRoutes;

beforeAll(async () => {
  subDepartmentRoutes = (await import('../src/routes/subDepartmentRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/sub-departments', subDepartmentRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockSubDepartment.find.mockReset();
  mockSubDepartment.findByIdAndUpdate.mockReset();
  mockSubDepartment.findByIdAndDelete.mockReset();
});

describe('SubDepartment API', () => {
  it('lists sub-departments', async () => {
    mockSubDepartment.find.mockResolvedValue([{ name: 'Sub' }]);
    const res = await request(app).get('/api/sub-departments');
    expect(res.status).toBe(200);
  });

  it('creates sub-department', async () => {
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/sub-departments').send({ name: 'Sub', department: 'dept1' });
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
  });

  it('updates sub-department', async () => {
    mockSubDepartment.findByIdAndUpdate.mockResolvedValue({ name: 'Sub' });
    const res = await request(app).put('/api/sub-departments/1').send({ name: 'Sub', department: 'dept1' });
    expect(res.status).toBe(200);
    expect(mockSubDepartment.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('deletes sub-department', async () => {
    mockSubDepartment.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/sub-departments/1');
    expect(res.status).toBe(200);
    expect(mockSubDepartment.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
