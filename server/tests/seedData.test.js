import { jest } from '@jest/globals';

const mockOrg = { findOne: jest.fn(), create: jest.fn() };
const mockDept = { findOne: jest.fn(), create: jest.fn() };
const mockSubDept = { findOne: jest.fn(), create: jest.fn() };
const mockEmployee = { findOne: jest.fn(), create: jest.fn(), updateMany: jest.fn() };

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
  Object.values(mockEmployee).forEach((fn) => fn.mockReset && fn.mockReset());
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
    mockEmployee.findOne.mockResolvedValue(null);
    mockEmployee.create.mockImplementation(async (data) => ({ _id: data.username, ...data }));
    await seedTestUsers();
    expect(mockEmployee.create).toHaveBeenCalledTimes(8);
    expect(mockEmployee.create).toHaveBeenCalledWith(expect.objectContaining({ username: 'scheduler', signTags: ['排班負責人'] }));
    expect(mockEmployee.create).toHaveBeenCalledWith(expect.objectContaining({ username: 'hr', signTags: ['人資'] }));
    expect(mockEmployee.updateMany).toHaveBeenCalledWith({ role: 'employee' }, { supervisor: 'salesManager' });
  });
});
