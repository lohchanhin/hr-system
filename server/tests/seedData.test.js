import { jest } from '@jest/globals';

const mockOrganizations = [];
const mockDepartments = [];
const mockSubDepartments = [];
const mockEmployees = [];

const matchDocument = (doc, filter) =>
  Object.entries(filter).every(([key, value]) => doc[key] === value);

const buildFindOne = (collection) =>
  async (filter = {}) => {
    if (!filter || Object.keys(filter).length === 0) {
      return collection[0] ?? null;
    }
    return collection.find((doc) => matchDocument(doc, filter)) ?? null;
  };

const orgFindOneDefault = buildFindOne(mockOrganizations);
const deptFindOneDefault = buildFindOne(mockDepartments);
const subDeptFindOneDefault = buildFindOne(mockSubDepartments);

const mockOrg = {
  deleteMany: jest.fn(async () => {
    mockOrganizations.length = 0;
  }),
  create: jest.fn(async (data) => {
    const document = { _id: `org-${mockOrganizations.length + 1}`, ...data };
    mockOrganizations.push(document);
    return document;
  }),
  findOne: jest.fn(orgFindOneDefault),
};

const mockDept = {
  deleteMany: jest.fn(async () => {
    mockDepartments.length = 0;
  }),
  create: jest.fn(async (data) => {
    const document = { _id: `dept-${mockDepartments.length + 1}`, ...data };
    mockDepartments.push(document);
    return document;
  }),
  findOne: jest.fn(deptFindOneDefault),
};

const mockSubDept = {
  deleteMany: jest.fn(async () => {
    mockSubDepartments.length = 0;
  }),
  create: jest.fn(async (data) => {
    const document = { _id: `sub-${mockSubDepartments.length + 1}`, ...data };
    mockSubDepartments.push(document);
    return document;
  }),
  findOne: jest.fn(subDeptFindOneDefault),
};

const mockEmployee = {
  findOne: jest.fn(async ({ username }) => mockEmployees.find((e) => e.username === username) || null),
  create: jest.fn(async (data) => {
    const employee = { _id: data.username, ...data };
    mockEmployees.push(employee);
    return employee;
  }),
  updateMany: jest.fn(async (filter, update) => {
    mockEmployees.forEach((employee) => {
      if (employee.role === filter.role) {
        employee.supervisor = update.supervisor;
      }
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

  const module = await import('../src/seedUtils.js');
  seedSampleData = module.seedSampleData;
  seedTestUsers = module.seedTestUsers;
});

beforeEach(() => {
  mockOrganizations.length = 0;
  mockDepartments.length = 0;
  mockSubDepartments.length = 0;
  mockEmployees.length = 0;

  jest.clearAllMocks();

  mockOrg.findOne.mockImplementation(orgFindOneDefault);
  mockDept.findOne.mockImplementation(deptFindOneDefault);
  mockSubDept.findOne.mockImplementation(subDeptFindOneDefault);
});

const countBy = (list, key) =>
  list.reduce((acc, item) => {
    const value = item[key];
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

describe('seedSampleData', () => {
  it('建立多層機構資料並維持唯一代碼', async () => {
    const result = await seedSampleData();

    expect(mockOrg.deleteMany).toHaveBeenCalledWith({});
    expect(mockDept.deleteMany).toHaveBeenCalledWith({});
    expect(mockSubDept.deleteMany).toHaveBeenCalledWith({});

    expect(result.organizations).toHaveLength(2);
    expect(result.departments).toHaveLength(4);
    expect(result.subDepartments).toHaveLength(12);

    expect(new Set(result.organizations.map((org) => org.systemCode)).size).toBe(2);
    expect(new Set(result.departments.map((dept) => dept.code)).size).toBe(4);
    expect(new Set(result.subDepartments.map((sub) => sub.code)).size).toBe(12);

    const deptCounts = countBy(result.departments, 'organization');
    expect(Object.values(deptCounts).sort()).toEqual([2, 2]);

    const subDeptCounts = countBy(result.subDepartments, 'department');
    Object.values(subDeptCounts).forEach((count) => expect(count).toBe(3));
  });
});

describe('seedTestUsers', () => {
  it('使用最新的組織層級建立測試帳號', async () => {
    const { organizations, departments, subDepartments } = await seedSampleData();

    mockOrg.findOne.mockResolvedValue(organizations[0]);
    mockDept.findOne.mockImplementation(async ({ organization }) =>
      departments.find((dept) => dept.organization === organization) ?? null,
    );
    mockSubDept.findOne.mockImplementation(async ({ department }) =>
      subDepartments.find((sub) => sub.department === department) ?? null,
    );

    await seedTestUsers();

    expect(mockEmployee.create).toHaveBeenCalledTimes(8);
    const createdUser = mockEmployee.create.mock.calls[0][0];
    expect(createdUser.organization).toBe(organizations[0]._id.toString());
    expect(createdUser.department).toBe(departments[0]._id);
    expect(createdUser.subDepartment).toBe(subDepartments[0]._id);
    expect(mockEmployee.updateMany).toHaveBeenCalledWith({ role: 'employee' }, { supervisor: 'supervisor' });
  });

  it('缺少層級資料時拋出錯誤', async () => {
    mockOrg.findOne.mockResolvedValue(null);
    await expect(seedTestUsers()).rejects.toThrow('Organization not found');
    expect(mockEmployee.create).not.toHaveBeenCalled();
  });
});
