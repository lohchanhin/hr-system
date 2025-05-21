import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const Employee = jest.fn().mockImplementation(() => ({ save: saveMock }));
Employee.find = jest.fn();
Employee.findById = jest.fn();
Employee.findByIdAndDelete = jest.fn();

jest.mock('../src/models/Employee.js', () => ({ default: Employee }), { virtual: true });

let app;
let employeeRoutes;

beforeAll(async () => {
  employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/employees', employeeRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  Employee.find.mockReset();
  Employee.findById.mockReset();
  Employee.findByIdAndDelete.mockReset();
});

describe('Employee API', () => {
  it('lists employees', async () => {

    const fakeEmployees = [{ name: 'John', department: 'Sales', title: 'Staff', status: '在職' }];

    Employee.find.mockResolvedValue(fakeEmployees);
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeEmployees);
  });

  it('returns 500 if listing fails', async () => {
    Employee.find.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates employee', async () => {

    const newEmp = { name: 'Jane', department: 'HR', title: 'Manager', status: '在職' };

    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/employees').send(newEmp);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(newEmp);
  });

  it('gets employee', async () => {
    const fake = { _id: '1', name: 'John' };
    Employee.findById.mockResolvedValue(fake);
    const res = await request(app).get('/api/employees/1');
    expect(res.status).toBe(200);
    expect(Employee.findById).toHaveBeenCalledWith('1');
    expect(res.body).toEqual(fake);
  });

  it('updates employee', async () => {
    Employee.findById.mockResolvedValue({ _id: '1', name: 'John', save: saveMock });
    saveMock.mockResolvedValue();
    const res = await request(app)
      .put('/api/employees/1')
      .send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(Employee.findById).toHaveBeenCalledWith('1');
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject({ _id: '1', name: 'Updated' });

  });

  it('deletes employee', async () => {
    Employee.findByIdAndDelete.mockResolvedValue({ _id: '1' });
    const res = await request(app).delete('/api/employees/1');
    expect(res.status).toBe(200);
    expect(Employee.findByIdAndDelete).toHaveBeenCalledWith('1');
    expect(res.body).toEqual({ success: true });
  });
});
