import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const Department = jest.fn().mockImplementation(() => ({ save: saveMock }));
Department.find = jest.fn();
Department.findByIdAndUpdate = jest.fn();
Department.findByIdAndDelete = jest.fn();

jest.mock('../src/models/Department.js', () => ({ default: Department }), { virtual: true });

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
  Department.find.mockReset();
  Department.findByIdAndUpdate.mockReset();
  Department.findByIdAndDelete.mockReset();
});

describe('Department API', () => {
  it('lists departments', async () => {
    Department.find.mockResolvedValue([{ name: 'HR' }]);
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
  });

  it('filters departments by organization', async () => {
    Department.find.mockResolvedValue([{ name: 'HR' }]);
    const res = await request(app).get('/api/departments?organization=1');
    expect(res.status).toBe(200);
    expect(Department.find).toHaveBeenCalledWith({ organization: '1' });
  });

  it('creates department', async () => {
    saveMock.mockResolvedValue();

    const res = await request(app).post('/api/departments').send({ name: 'HR', code: 'D1', organization: 'org1' });

    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(Department).toHaveBeenCalledWith(
      expect.objectContaining({ organization: '1' })
    );
  });

  it('fails when organization missing', async () => {
    saveMock.mockRejectedValue(new Error('Validation'));
    const res = await request(app).post('/api/departments').send({ name: 'HR' });
    expect(res.status).toBe(400);
  });

  it('updates department', async () => {
    Department.findByIdAndUpdate.mockResolvedValue({ name: 'HR' });

    const res = await request(app).put('/api/departments/1').send({ name: 'HR', organization: 'org1' });

    expect(res.status).toBe(200);
    expect(Department.findByIdAndUpdate).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ organization: '1' }),
      expect.any(Object)
    );
  });

  it('deletes department', async () => {
    Department.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/departments/1');
    expect(res.status).toBe(200);
    expect(Department.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
