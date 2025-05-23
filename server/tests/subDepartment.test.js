import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const SubDepartment = jest.fn().mockImplementation(() => ({ save: saveMock }));
SubDepartment.find = jest.fn();
SubDepartment.findByIdAndUpdate = jest.fn();
SubDepartment.findByIdAndDelete = jest.fn();

jest.mock('../src/models/SubDepartment.js', () => ({ default: SubDepartment }), { virtual: true });

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
  SubDepartment.find.mockReset();
  SubDepartment.findByIdAndUpdate.mockReset();
  SubDepartment.findByIdAndDelete.mockReset();
});

describe('SubDepartment API', () => {
  it('lists sub-departments', async () => {
    SubDepartment.find.mockResolvedValue([{ name: 'Sub' }]);
    const res = await request(app).get('/api/sub-departments');
    expect(res.status).toBe(200);
  });

  it('creates sub-department', async () => {
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/sub-departments').send({ name: 'Sub' });
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
  });

  it('updates sub-department', async () => {
    SubDepartment.findByIdAndUpdate.mockResolvedValue({ name: 'Sub' });
    const res = await request(app).put('/api/sub-departments/1').send({ name: 'Sub' });
    expect(res.status).toBe(200);
    expect(SubDepartment.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('deletes sub-department', async () => {
    SubDepartment.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/sub-departments/1');
    expect(res.status).toBe(200);
    expect(SubDepartment.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
