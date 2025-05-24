import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockDepartment = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockDepartment.find = jest.fn();
mockDepartment.findByIdAndUpdate = jest.fn();
mockDepartment.findByIdAndDelete = jest.fn();

jest.mock('../src/models/Department.js', () => ({ default: mockDepartment }), { virtual: true });

let app;
let departmentRoutes;

beforeAll(async () => {
  departmentRoutes = (await import('../src/routes/departmentRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/departments', departmentRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockDepartment.find.mockReset();
  mockDepartment.findByIdAndUpdate.mockReset();
  mockDepartment.findByIdAndDelete.mockReset();
});

describe('Department API', () => {
  it('lists departments', async () => {
    mockDepartment.find.mockResolvedValue([{ name: 'HR' }]);
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
  });

  it('filters departments by organization', async () => {
    mockDepartment.find.mockResolvedValue([{ name: 'HR' }]);
    const res = await request(app).get('/api/departments?organization=1');
    expect(res.status).toBe(200);
    expect(mockDepartment.find).toHaveBeenCalledWith({ organization: '1' });
  });

  it('creates department', async () => {
    saveMock.mockResolvedValue();

    const res = await request(app).post('/api/departments').send({ name: 'HR', code: 'D1', organization: 'org1' });

    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(mockDepartment).toHaveBeenCalledWith(
      expect.objectContaining({ organization: '1' })
    );
  });

  it('fails when organization missing', async () => {
    saveMock.mockRejectedValue(new Error('Validation'));
    const res = await request(app).post('/api/departments').send({ name: 'HR' });
    expect(res.status).toBe(400);
  });

  it('updates department', async () => {
    mockDepartment.findByIdAndUpdate.mockResolvedValue({ name: 'HR' });

    const res = await request(app).put('/api/departments/1').send({ name: 'HR', organization: 'org1' });

    expect(res.status).toBe(200);
    expect(mockDepartment.findByIdAndUpdate).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ organization: '1' }),
      expect.any(Object)
    );
  });

  it('deletes department', async () => {
    mockDepartment.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/departments/1');
    expect(res.status).toBe(200);
    expect(mockDepartment.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
