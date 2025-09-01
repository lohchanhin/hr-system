import { jest } from '@jest/globals';

const mockOrg = { findOne: jest.fn(), create: jest.fn() };
const mockDept = { findOne: jest.fn(), create: jest.fn() };
const mockSubDept = { findOne: jest.fn(), create: jest.fn() };

const mockEmployees = [];
const mockEmployee = {
  findOne: jest.fn(async ({ username }) => mockEmployees.find((e) => e.username === username) || null),
  create: jest.fn(async (data) => {
    const emp = { _id: data.username, ...data };
    mockEmployees.push(emp);
    return emp;
  }),
  updateMany: jest.fn(async (filter, update) => {
    mockEmployees.forEach((e) => {
      if (e.role === filter.role) e.supervisor = update.supervisor;
    });
  }),
};

let seedSampleData;
let seedTestUsers;

beforeAll(async () => {
  process.env.PORT = '3000';
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET = 'secret';
  process.env.NODE_ENV = 'test';
  await jest.unstable_mockModule('../src/models/Organization.js', () => ({ default: mockOrg }));
  await jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDept }));
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDept }));
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
  const mod = await import('../src/seedUtils.js');
  seedSampleData = mod.seedSampleData;
  seedTestUsers = mod.seedTestUsers;
});

beforeEach(() => {
  Object.values(mockOrg).forEach((fn) => fn.mockReset && fn.mockReset());
  Object.values(mockDept).forEach((fn) => fn.mockReset && fn.mockReset());
  Object.values(mockSubDept).forEach((fn) => fn.mockReset && fn.mockReset());
  Object.values(mockEmployee).forEach((fn) => fn.mockClear());
  mockEmployees.length = 0;
});

describe('seedSampleData', () => {
  it('creates organization, department and sub-department when missing', async () => {
    mockOrg.findOne.mockResolvedValue(null);
    mockDept.findOne.mockResolvedValue(null);
    mockSubDept.findOne.mockResolvedValue(null);
    mockOrg.create.mockResolvedValue({ _id: 'org1' });
    mockDept.create.mockResolvedValue({ _id: 'dept1' });
    mockSubDept.create.mockResolvedValue({ _id: 'sub1' });
    await seedSampleData();
    expect(mockOrg.create).toHaveBeenCalledWith(expect.objectContaining({ name: '示範機構' }));
    expect(mockDept.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'HR' }));
    expect(mockSubDept.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'HR1' }));
  });
});

describe('seedTestUsers', () => {
  it('creates test users and assigns supervisor', async () => {
    const orgId = { toString: () => 'org1' };
    mockOrg.findOne.mockResolvedValue({ _id: orgId });
    mockDept.findOne.mockResolvedValue({ _id: 'dept1' });
    mockSubDept.findOne.mockResolvedValue({ _id: 'sub1' });
    await seedTestUsers();
    expect(mockOrg.findOne).toHaveBeenCalledWith({ name: '示範機構' });
    expect(mockDept.findOne).toHaveBeenCalledWith({ code: 'HR' });
    expect(mockSubDept.findOne).toHaveBeenCalledWith({ code: 'HR1' });
    expect(mockEmployee.create).toHaveBeenCalledTimes(8);
    expect(mockEmployee.create).toHaveBeenCalledWith(expect.objectContaining({
      username: 'scheduler',
      signTags: ['排班負責人'],
      organization: 'org1',
      department: 'dept1',
      subDepartment: 'sub1'
    }));
    expect(mockEmployee.create).toHaveBeenCalledWith(expect.objectContaining({ username: 'hr', signTags: ['人資'] }));
    expect(mockEmployee.updateMany).toHaveBeenCalledWith({ role: 'employee' }, { supervisor: 'supervisor' });
    const user = mockEmployees.find((e) => e.username === 'user');
    expect(user.supervisor).toBe('supervisor');
  });

  it('throws when required data is missing', async () => {
    mockOrg.findOne.mockResolvedValue(null);
    mockDept.findOne.mockResolvedValue({ _id: 'dept1' });
    mockSubDept.findOne.mockResolvedValue({ _id: 'sub1' });
    await expect(seedTestUsers()).rejects.toThrow('Organization not found');
    expect(mockEmployee.create).not.toHaveBeenCalled();
  });
});
