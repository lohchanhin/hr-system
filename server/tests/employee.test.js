import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
};
const mockUser = {
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
};

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }));

let app;
let employeeRoutes;

beforeAll(async () => {
  employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/employees', employeeRoutes);
});

beforeEach(() => {
  Object.values(mockEmployee).forEach((fn) => fn.mockReset && fn.mockReset());
  Object.values(mockUser).forEach((fn) => fn.mockReset && fn.mockReset());
});

describe('Employee API', () => {
  it('lists employees', async () => {
    const fakeEmployees = [{ name: 'John', department: 'Sales', title: 'Staff', status: '正職員工' }];
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue(fakeEmployees),
      }),
    });
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeEmployees);
  });

  it('lists employees filtered by supervisor', async () => {
    const fakeEmployees = [{ name: 'Bob' }];
    const populate = jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(fakeEmployees) });
    mockEmployee.find.mockReturnValue({ populate });
    const res = await request(app).get('/api/employees?supervisor=s1');
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: 's1' });
    expect(res.body).toEqual(fakeEmployees);
  });

  it('lists employees filtered by subDepartment', async () => {
    const fakeEmployees = [{ name: 'Alice' }];
    const populate = jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(fakeEmployees) });
    mockEmployee.find.mockReturnValue({ populate });
    const res = await request(app).get('/api/employees?subDepartment=sd1');
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ subDepartment: 'sd1' });
    expect(res.body).toEqual(fakeEmployees);
  });

  it('lists employee options', async () => {
    const opts = [{ _id: '1', name: 'A' }];
    mockEmployee.find.mockResolvedValue(opts);
    const res = await request(app).get('/api/employees/options');
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({}, 'name');
    expect(res.body).toEqual([{ id: '1', name: 'A' }]);
  });

  it('returns 500 if listing fails', async () => {
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockRejectedValue(new Error('fail')),
      }),
    });
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
      employmentStatus: '正職員工',
      username: 'jane',
      password: 'secret',
      role: 'employee',
      supervisor: 's1'
    };

    mockEmployee.create.mockImplementation(async (doc) => ({ _id: '1', ...doc }));
    const res = await request(app).post('/api/employees').send(newEmp);
    expect(res.status).toBe(201);
    expect(mockEmployee.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane',
      email: 'jane@example.com',
      organization: 'Org',
      department: 'HR',
      subDepartment: 'Sub',
      title: 'Manager',
      employmentStatus: '正職員工',
      supervisor: 's1'
    }));
    expect(mockUser.create).toHaveBeenCalledWith({
      username: 'jane',
      password: 'secret',
      role: 'employee',
      organization: 'Org',
      department: 'HR',
      subDepartment: 'Sub',
      employee: '1',
      supervisor: 's1'
    });
  });

  it('sanitizes enum fields when creating employee', async () => {
    const payload = {
      name: 'Ann',
      email: 'ann@example.com',
      username: 'ann',
      password: 'pass',
      role: 'employee',
      maritalStatus: '',
      employmentStatus: 'wrong',
      bloodType: 'X',
      medicalBloodType: ''
    };

    mockEmployee.create.mockImplementation(async (doc) => ({ _id: '2', ...doc }));
    const res = await request(app).post('/api/employees').send(payload);
    expect(res.status).toBe(201);
    const doc = mockEmployee.create.mock.calls[0][0];
    expect(doc.maritalStatus).toBeUndefined();
    expect(doc.employmentStatus).toBeUndefined();
    expect(doc.bloodType).toBeUndefined();
    expect(doc.medicalCheck.bloodType).toBeUndefined();
  });

  it('fails on invalid email or role', async () => {
    const payload = { name: 'A', email: 'bad', role: 'x', username: 'a', password: 'p' };
    const res = await request(app).post('/api/employees').send(payload);
    expect(res.status).toBe(400);
  });

  it('gets employee', async () => {
    const fake = { _id: '1', name: 'John' };
    mockEmployee.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(fake) });
    const res = await request(app).get('/api/employees/1');
    expect(res.status).toBe(200);
    expect(mockEmployee.findById).toHaveBeenCalledWith('1');
    expect(res.body).toEqual(fake);
  });

  it('updates employee', async () => {
    mockEmployee.findById
      .mockResolvedValueOnce({ _id: '1', name: 'John' })
      .mockResolvedValueOnce({ _id: '1', name: 'Updated', supervisor: 's2' });
    mockEmployee.updateOne.mockResolvedValue();

    const res = await request(app).put('/api/employees/1').send({ name: 'Updated', supervisor: 's2' });
    expect(res.status).toBe(200);
    expect(mockEmployee.updateOne).toHaveBeenCalledWith({ _id: '1' }, { $set: { name: 'Updated', supervisor: 's2' } });
    expect(mockUser.findOneAndUpdate).toHaveBeenCalledWith({ employee: '1' }, { supervisor: 's2' }, { new: true });
    expect(res.body).toMatchObject({ _id: '1', name: 'Updated', supervisor: 's2' });
  });

  it('fails updating with invalid email or role', async () => {
    mockEmployee.findById.mockResolvedValue({ _id: '1', name: 'John' });
    const res = await request(app).put('/api/employees/1').send({ email: 'bad', role: 'x' });
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
          return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
        }
        return authorizeRoles('admin')(req, res, next);
      },
      employeeRoutes
    );
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
    });
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
          return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
        }
        return authorizeRoles('admin')(req, res, next);
      },
      employeeRoutes
    );
    const res = await request(appAuth).post('/api/employees').send({});
    expect(res.status).toBe(403);
  });

  it('allows employee to list employees but not create', async () => {
    const { authorizeRoles } = await import('../src/middleware/auth.js');
    const authenticate = (req, res, next) => {
      req.user = { role: 'employee' };
      next();
    };
    const appAuth = express();
    appAuth.use(express.json());
    appAuth.use(
      '/api/employees',
      authenticate,
      (req, res, next) => {
        if (req.method === 'GET') {
          return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
        }
        return authorizeRoles('admin')(req, res, next);
      },
      employeeRoutes
    );

    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
    });
    const resList = await request(appAuth).get('/api/employees');
    expect(resList.status).toBe(200);

    const resCreate = await request(appAuth).post('/api/employees').send({});
    expect(resCreate.status).toBe(403);
  });
});
