import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  countDocuments: jest.fn(),
};

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));

let app;
let employeeRoutes;

beforeAll(async () => {
  employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'admin1', role: 'admin' };
    next();
  });
  app.use('/api/employees', employeeRoutes);
});

beforeEach(() => {
  Object.values(mockEmployee).forEach((fn) => fn.mockReset && fn.mockReset());
  mockEmployee.countDocuments.mockResolvedValue(0);
});

function makeEmployeeListQuery(result) {
  const query = {
    select: jest.fn(),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
  };
  Object.keys(query).forEach((key) => {
    if (key !== 'lean') query[key].mockReturnValue(query);
  });
  query.lean.mockImplementation(() => result);
  return query;
}

describe('Employee API', () => {
  it('lists employees', async () => {
    const fakeEmployees = [{ name: 'John', department: 'd1', title: 'Staff', status: '正職員工' }];
    const query = makeEmployeeListQuery(Promise.resolve(fakeEmployees));
    mockEmployee.find.mockReturnValue(query);
    mockEmployee.countDocuments
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(query.select).toHaveBeenCalledWith(expect.not.stringContaining('salaryAmount'));
    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(res.body).toEqual({
      employees: fakeEmployees,
      pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
      summary: { active: 1 },
    });
  });

  it('lists employees filtered by supervisor', async () => {
    const fakeEmployees = [{ name: 'Bob' }];
    const supervisorId = '507f1f77bcf86cd799439011';
    const query = makeEmployeeListQuery(Promise.resolve(fakeEmployees));
    mockEmployee.find.mockReturnValue(query);
    mockEmployee.countDocuments.mockResolvedValue(1);
    const res = await request(app).get(`/api/employees?supervisor=${supervisorId}`);
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: supervisorId });
    expect(res.body.employees).toEqual(fakeEmployees);
  });

  it('lists employees filtered by subDepartment', async () => {
    const fakeEmployees = [{ name: 'Alice' }];
    const subDepartmentId = '507f1f77bcf86cd799439012';
    const query = makeEmployeeListQuery(Promise.resolve(fakeEmployees));
    mockEmployee.find.mockReturnValue(query);
    mockEmployee.countDocuments.mockResolvedValue(1);
    const res = await request(app).get(`/api/employees?subDepartment=${subDepartmentId}`);
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ subDepartment: subDepartmentId });
    expect(res.body.employees).toEqual(fakeEmployees);
  });

  it('escapes regex metacharacters and applies stable server pagination', async () => {
    const query = makeEmployeeListQuery(Promise.resolve([{ name: '[Test]' }]));
    mockEmployee.find.mockReturnValue(query);
    mockEmployee.countDocuments
      .mockResolvedValueOnce(25)
      .mockResolvedValueOnce(20);

    const res = await request(app).get('/api/employees?q=%5B&page=3&pageSize=10');

    expect(res.status).toBe(200);
    const filter = mockEmployee.find.mock.calls[0][0];
    expect(filter.$or[0].name).toBeInstanceOf(RegExp);
    expect(filter.$or[0].name.source).toBe('\\[');
    expect(query.sort).toHaveBeenCalledWith({ name: 1, employeeId: 1, _id: 1 });
    expect(query.skip).toHaveBeenCalledWith(20);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(res.body.pagination).toEqual({ total: 25, page: 3, pageSize: 10, totalPages: 3 });
  });

  it('rejects invalid object id filters before querying MongoDB', async () => {
    const res = await request(app).get('/api/employees?department=not-an-object-id');

    expect(res.status).toBe(400);
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });

  it('lists employee options', async () => {
    const fakeEmployees = [{
      _id: '1',
      name: 'Alice',
      username: 'alice',
      signRole: 'R003',
      signLevel: 'U002',
      signTags: ['人資'],
      organization: 'org1',
      department: { _id: 'd1', name: '人資部' },
      role: 'supervisor',
    }];
    const lean = jest.fn().mockResolvedValue(fakeEmployees);
    const populate = jest.fn().mockReturnValue({ lean });
    mockEmployee.find.mockReturnValue({ populate });
    const res = await request(app).get('/api/employees/options');
    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith(
      { username: { $exists: true, $ne: '' } },
      'name username signRole signTags signLevel organization department role'
    );
    expect(populate).toHaveBeenCalledWith('department', 'name');
    expect(lean).toHaveBeenCalled();
    expect(res.body).toEqual([
      {
        id: '1',
        name: 'Alice',
        username: 'alice',
        signRole: 'R003',
        signLevel: 'U002',
        signTags: ['人資'],
        organization: 'org1',
        department: { id: 'd1', name: '人資部' },
        role: 'supervisor',
        displayName: 'Alice（alice）',
      },
    ]);
  });

  it('returns 500 if listing fails', async () => {
    const query = makeEmployeeListQuery(Promise.resolve([]));
    query.lean.mockRejectedValue(new Error('fail'));
    mockEmployee.find.mockReturnValue(query);
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to list employees' });
  });

  it('returns only minimal fields for attendance import matching', async () => {
    const rows = [{ _id: '1', name: 'Alice', employeeId: 'E001', email: 'a@example.com' }];
    const query = makeEmployeeListQuery(Promise.resolve(rows));
    mockEmployee.find.mockReturnValue(query);

    const res = await request(app).get('/api/employees/attendance-import-options');

    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({}, '_id name email employeeId status');
    expect(query.limit).toHaveBeenCalledWith(5000);
    expect(res.body).toEqual(rows);
  });

  it('creates employee', async () => {
    const newEmp = {
      name: 'Jane',
      email: 'jane@example.com',
      employeeNo: 'E001',
      organization: 'Org',
      department: 'd1',
      subDepartment: 'sd1',
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
      department: 'd1',
      subDepartment: 'sd1',
      title: 'Manager',
      employmentStatus: '正職員工',
      supervisor: 's1'
    }));
  });

  it('sanitizes enum fields when creating employee', async () => {
    const payload = {
      name: 'Ann',
      email: 'ann@example.com',
      username: 'ann',
      password: 'pass',
      role: 'employee',
      employeeNo: 'E002',
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
    const payload = { name: 'A', email: 'bad', role: 'x', username: 'a', password: 'p', employeeNo: 'E003' };
    const res = await request(app).post('/api/employees').send(payload);
    expect(res.status).toBe(400);
  });

  it('fails when email is missing', async () => {
    const payload = { name: 'A', username: 'a', password: 'p', employeeNo: 'E004' };
    const res = await request(app).post('/api/employees').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Email is required' });
  });

  it('fails when employee number is missing', async () => {
    const payload = { name: 'A', username: 'a', password: 'p', email: 'a@example.com' };
    const res = await request(app).post('/api/employees').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Employee number is required' });
  });

  it('gets employee', async () => {
    const employeeId = '507f1f77bcf86cd799439013';
    const fake = { _id: employeeId, name: 'John' };
    mockEmployee.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(fake) });
    const res = await request(app).get(`/api/employees/${employeeId}`);
    expect(res.status).toBe(200);
    expect(mockEmployee.findById).toHaveBeenCalledWith(employeeId);
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
    expect(res.body).toMatchObject({ _id: '1', name: 'Updated', supervisor: 's2' });
  });

  it('fails updating with invalid email or role', async () => {
    mockEmployee.findById.mockResolvedValue({ _id: '1', name: 'John' });
    const res = await request(app).put('/api/employees/1').send({ email: 'bad', role: 'x' });
    expect(res.status).toBe(400);
  });

  it('deletes employee', async () => {
    const mockDeleteOne = jest.fn().mockResolvedValue();
    mockEmployee.findById.mockResolvedValue({ _id: '1', role: 'employee', deleteOne: mockDeleteOne });
    const res = await request(app).delete('/api/employees/1');
    expect(res.status).toBe(200);
    expect(mockEmployee.findById).toHaveBeenCalledWith('1');
    expect(mockDeleteOne).toHaveBeenCalled();
    expect(res.body).toEqual({ success: true });
  });

  it('prevents deletion of admin accounts', async () => {
    const mockDeleteOne = jest.fn();
    mockEmployee.findById.mockResolvedValue({ _id: '1', role: 'admin', deleteOne: mockDeleteOne });
    const res = await request(app).delete('/api/employees/1');
    expect(res.status).toBe(403);
    expect(mockEmployee.findById).toHaveBeenCalledWith('1');
    expect(mockDeleteOne).not.toHaveBeenCalled();
    expect(res.body).toEqual({ error: '管理員帳戶不可刪除' });
  });

  it('sets supervisors in batch', async () => {
    mockEmployee.updateOne.mockResolvedValue();
    const payload = { assignments: [{ employee: 'e1', supervisor: 's1' }] };
    const res = await request(app).post('/api/employees/set-supervisors').send(payload);
    expect(res.status).toBe(200);
    expect(mockEmployee.updateOne).toHaveBeenCalledWith({ _id: 'e1' }, { supervisor: 's1' });
    expect(res.body).toEqual({ success: true });
  });
});

describe('Employee authorization middleware', () => {
  it('allows supervisor to list employees', async () => {
    const { authorizeRoles } = await import('../src/middleware/auth.js');
    const authenticate = (req, res, next) => {
      req.user = { id: 'supervisor1', role: 'supervisor' };
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
    mockEmployee.find.mockReturnValue(makeEmployeeListQuery(Promise.resolve([])));
    const res = await request(appAuth).get('/api/employees');
    expect(res.status).toBe(200);
  });

  it('blocks supervisor from creating employee', async () => {
    const { authorizeRoles } = await import('../src/middleware/auth.js');
    const authenticate = (req, res, next) => {
      req.user = { id: 'supervisor1', role: 'supervisor' };
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
      req.user = { id: 'employee1', role: 'employee' };
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

    mockEmployee.find.mockReturnValue(makeEmployeeListQuery(Promise.resolve([])));
    const resList = await request(appAuth).get('/api/employees');
    expect(resList.status).toBe(200);

    const resCreate = await request(appAuth).post('/api/employees').send({});
    expect(resCreate.status).toBe(403);
  });
});
