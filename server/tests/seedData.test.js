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
  find: jest.fn(async () => mockOrganizations),
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
  find: jest.fn(async () => mockDepartments),
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
  find: jest.fn(async () => mockSubDepartments),
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
  mockOrg.find.mockResolvedValue(mockOrganizations);
  mockDept.find.mockResolvedValue(mockDepartments);
  mockSubDept.find.mockResolvedValue(mockSubDepartments);
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

    mockOrg.find.mockResolvedValue(organizations);
    mockDept.find.mockResolvedValue(departments);
    mockSubDept.find.mockResolvedValue(subDepartments);

    const result = await seedTestUsers();

    expect(result.supervisors).toHaveLength(3);
    expect(result.employees).toHaveLength(6);
    expect(mockEmployee.create).toHaveBeenCalledTimes(9);

    const createdSupervisors = mockEmployees.slice(0, 3);
    const createdEmployees = mockEmployees.slice(3);

    createdSupervisors.forEach((supervisor) => {
      expect(supervisor.role).toBe('supervisor');
      expect(supervisor.signTags.length).toBeGreaterThan(0);
    });

    const supervisorTags = new Set(createdSupervisors.flatMap((item) => item.signTags));
    expect(supervisorTags.has('人資')).toBe(true);
    expect(supervisorTags.has('支援單位主管')).toBe(true);
    expect(supervisorTags.has('業務主管')).toBe(true);

    const orgIds = new Set(organizations.map((org) => org._id.toString()));
    const deptIds = new Set(departments.map((dept) => dept._id.toString()));
    const subDeptIds = new Set(subDepartments.map((sub) => sub._id.toString()));

    for (const user of mockEmployees) {
      expect(orgIds.has(user.organization)).toBe(true);
      expect(deptIds.has(user.department.toString())).toBe(true);
      expect(subDeptIds.has(user.subDepartment.toString())).toBe(true);
      expect(user.email.endsWith('@example.com')).toBe(true);
      expect(user.username).toBe(user.username.toLowerCase());
    }

    const supervisorIds = new Set(createdSupervisors.map((supervisor) => supervisor._id));
    createdEmployees.forEach((employee) => {
      expect(employee.role).toBe('employee');
      expect(employee.signTags).toEqual([]);
      expect(['正職員工', '試用期員工', '留職停薪']).toContain(employee.status);
      expect(supervisorIds.has(employee.supervisor)).toBe(true);
    });

    const usernames = mockEmployees.map((user) => user.username);
    expect(new Set(usernames).size).toBe(usernames.length);

    const emails = mockEmployees.map((user) => user.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('缺少層級資料時拋出錯誤', async () => {
    mockOrg.find.mockResolvedValue([]);
    await expect(seedTestUsers()).rejects.toThrow('Organization not found');
    expect(mockEmployee.create).not.toHaveBeenCalled();
  });
});
