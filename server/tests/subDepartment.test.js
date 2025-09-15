import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockSubDepartment = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockSubDepartment.find = jest.fn();
mockSubDepartment.findByIdAndUpdate = jest.fn();
mockSubDepartment.findByIdAndDelete = jest.fn();
const mockDepartment = { findOne: jest.fn() };

jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/middleware/auth.js', () => ({ authorizeRoles: () => (req, res, next) => next() }));

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
  mockDepartment.findOne.mockReset();
});

describe('SubDepartment API', () => {
  it('lists sub-departments', async () => {
    mockSubDepartment.find.mockResolvedValue([{ name: 'Sub', shift: '507f1f77bcf86cd799439014' }]);
    const res = await request(app).get('/api/sub-departments');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ shiftId: '507f1f77bcf86cd799439014' });
  });

  it('lists sub-departments by department id', async () => {
    const id = '507f1f77bcf86cd799439011';
    mockSubDepartment.find.mockResolvedValue([{ name: 'Sub' }]);
    const res = await request(app).get(`/api/sub-departments?department=${id}`);
    expect(res.status).toBe(200);
    expect(mockSubDepartment.find).toHaveBeenCalledWith({ department: id });
    expect(mockDepartment.findOne).not.toHaveBeenCalled();
  });

  it('lists sub-departments by department name', async () => {
    mockDepartment.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439012' });
    mockSubDepartment.find.mockResolvedValue([{ name: 'Sub' }]);
    const res = await request(app).get('/api/sub-departments?department=HR');
    expect(res.status).toBe(200);
    expect(mockDepartment.findOne).toHaveBeenCalledWith({ name: 'HR' });
    expect(mockSubDepartment.find).toHaveBeenCalledWith({ department: '507f1f77bcf86cd799439012' });
  });

  it('returns 400 when department not found', async () => {
    mockDepartment.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/sub-departments?department=Unknown');
    expect(res.status).toBe(400);
  });

  it('creates sub-department', async () => {
    saveMock.mockResolvedValue();
    const payload = { name: 'Sub', department: 'dept1', shiftId: 'shift1' };
    const res = await request(app).post('/api/sub-departments').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(mockSubDepartment).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Sub',
      department: 'dept1',
      shift: 'shift1'
    }));
    const constructed = mockSubDepartment.mock.calls[0][0];
    expect(constructed).not.toHaveProperty('shiftId');
  });

  it('updates sub-department', async () => {
    mockSubDepartment.findByIdAndUpdate.mockResolvedValue({ name: 'Sub', shift: 'shift2' });
    const res = await request(app)
      .put('/api/sub-departments/1')
      .send({ name: 'Sub', department: 'dept1', shiftId: 'shift2' });
    expect(res.status).toBe(200);
    expect(mockSubDepartment.findByIdAndUpdate).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ shift: 'shift2' }),
      { new: true }
    );
    const body = res.body;
    expect(body.shiftId).toBe('shift2');
  });

  it('deletes sub-department', async () => {
    mockSubDepartment.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/sub-departments/1');
    expect(res.status).toBe(200);
    expect(mockSubDepartment.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
