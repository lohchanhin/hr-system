import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockEmployee = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockEmployee.find = jest.fn();
mockEmployee.findById = jest.fn();
mockEmployee.findByIdAndDelete = jest.fn();

const mockUser = { create: jest.fn(), findOneAndUpdate: jest.fn() };

jest.mock('../src/models/Employee.js', () => ({ default: mockEmployee }), { virtual: true });
jest.mock('../src/models/User.js', () => ({ default: mockUser }), { virtual: true });

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
  mockEmployee.find.mockReset();
  mockEmployee.findById.mockReset();
  mockEmployee.findByIdAndDelete.mockReset();
  mockUser.create.mockReset();
  mockUser.findOneAndUpdate.mockReset();
});

describe('Employee API', () => {
  it('lists employees', async () => {

    const fakeEmployees = [{ name: 'John', department: 'Sales', title: 'Staff', status: '在職' }];

    mockEmployee.find.mockResolvedValue(fakeEmployees);
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeEmployees);
  });

  it('lists employees filtered by supervisor', async () => {
    const fakeEmployees = [{ name: 'Bob' }];
    mockEmployee.find.mockResolvedValue(fakeEmployees);
    const res = await request(app).get('/api/employees?supervisor=s1');
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: 's1' });
    expect(res.body).toEqual(fakeEmployees);
  });

  it('lists employee options', async () => {
    const opts = [{ _id: '1', name: 'A', title: 'T' }];
    mockEmployee.find.mockResolvedValue(opts);
    const res = await request(app).get('/api/employees/options');
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({}, 'name title');
    expect(res.body).toEqual(opts);
  });

  it('returns 500 if listing fails', async () => {
    mockEmployee.find.mockRejectedValue(new Error('fail'));
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates employee', async () => {

    const newEmp = {
      name: 'Jane',
      email: 'jane@example.com',
      organization: 'Org',
      department: 'HR',
      subDepartment: 'Sub',
      title: 'Manager',
      status: '在職',
      username: 'jane',
      password: 'secret',
      role: 'employee',
      supervisor: 's1'
    };

    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/employees').send(newEmp);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(mockUser.create).toHaveBeenCalledWith({
      username: 'jane',
      password: 'secret',
      role: 'employee',
      organization: 'Org',
      department: 'HR',
      subDepartment: 'Sub',
      employee: undefined,
      supervisor: 's1'
    });
    expect(res.body).toMatchObject({
      name: 'Jane',
      email: 'jane@example.com',
      organization: 'Org',
      department: 'HR',
      subDepartment: 'Sub',
      title: 'Manager',
      status: '在職',
      role: 'employee',
      supervisor: 's1'
    });
  });

  it('fails on invalid email or role', async () => {
    const payload = { name: 'A', email: 'bad', role: 'x' };
    const res = await request(app).post('/api/employees').send(payload);
    expect(res.status).toBe(400);
  });

  it('gets employee', async () => {
    const fake = { _id: '1', name: 'John' };
    mockEmployee.findById.mockResolvedValue(fake);
    const res = await request(app).get('/api/employees/1');
    expect(res.status).toBe(200);
    expect(mockEmployee.findById).toHaveBeenCalledWith('1');
    expect(res.body).toEqual(fake);
  });

  it('updates employee', async () => {
    mockEmployee.findById.mockResolvedValue({ _id: '1', name: 'John', save: saveMock });
    saveMock.mockResolvedValue();
    const res = await request(app)
      .put('/api/employees/1')
      .send({ name: 'Updated', supervisor: 's2' });
    expect(res.status).toBe(200);
    expect(mockEmployee.findById).toHaveBeenCalledWith('1');
    expect(saveMock).toHaveBeenCalled();
    expect(mockUser.findOneAndUpdate).toHaveBeenCalledWith({ employee: '1' }, { supervisor: 's2' });
    expect(res.body).toMatchObject({ _id: '1', name: 'Updated', supervisor: 's2' });

  });

  it('fails updating with invalid email or role', async () => {
    mockEmployee.findById.mockResolvedValue({ _id: '1', name: 'John', save: saveMock });
    const res = await request(app)
      .put('/api/employees/1')
      .send({ email: 'bad', role: 'x' });
    expect(res.status).toBe(400);
  });

  it('deletes employee', async () => {
    mockEmployee.findByIdAndDelete.mockResolvedValue({ _id: '1' });
    const res = await request(app).delete('/api/employees/1');
    expect(res.status).toBe(200);
    expect(mockEmployee.findByIdAndDelete).toHaveBeenCalledWith('1');
    expect(res.body).toEqual({ success: true });
  });
});

describe('Employee authorization middleware', () => {
  it('allows supervisor to list employees', async () => {
    const { authorizeRoles } = await import('../src/middleware/auth.js');
    const authenticate = (req, res, next) => {
      req.user = { role: 'supervisor' };
      next();
    };
    const appAuth = express();
    appAuth.use(express.json());
    appAuth.use(
      '/api/employees',
      authenticate,
      (req, res, next) => {
        if (req.method === 'GET') {
          return authorizeRoles('admin', 'supervisor')(req, res, next);
        }
        return authorizeRoles('admin')(req, res, next);
      },
      employeeRoutes
    );
    mockEmployee.find.mockResolvedValue([]);
    const res = await request(appAuth).get('/api/employees');
    expect(res.status).toBe(200);
  });

  it('blocks supervisor from creating employee', async () => {
    const { authorizeRoles } = await import('../src/middleware/auth.js');
    const authenticate = (req, res, next) => {
      req.user = { role: 'supervisor' };
      next();
    };
    const appAuth = express();
    appAuth.use(express.json());
    appAuth.use(
      '/api/employees',
      authenticate,
      (req, res, next) => {
        if (req.method === 'GET') {
          return authorizeRoles('admin', 'supervisor')(req, res, next);
        }
        return authorizeRoles('admin')(req, res, next);
      },
      employeeRoutes
    );
    const res = await request(appAuth).post('/api/employees').send({});
    expect(res.status).toBe(403);
  });
});
