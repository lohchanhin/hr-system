import { jest } from '@jest/globals';

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  exists: jest.fn(),
};

const mockDepartment = {
  findById: jest.fn(),
};

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));

let resolveDepartmentEmployees;
let ReportAccessError;

beforeAll(async () => {
  ({ resolveDepartmentEmployees, ReportAccessError } = await import(
    '../src/services/reportMetricsService.js'
  ));
});

beforeEach(() => {
  mockEmployee.find.mockReset();
  mockEmployee.findById.mockReset();
  mockEmployee.exists.mockReset();
  mockDepartment.findById.mockReset();
});

describe('resolveDepartmentEmployees', () => {
  it('允許主管取得自身部門員工，即使部屬未標記 supervisor', async () => {
    const departmentId = 'deptA';
    const supervisorId = 'sup1';
    const employeesInDepartment = [{ _id: 'emp1' }, { _id: 'emp2' }];

    mockEmployee.findById.mockResolvedValue({ _id: supervisorId, department: departmentId });
    mockEmployee.find.mockImplementation((query) => {
      if ('supervisor' in query) {
        return Promise.resolve([]);
      }
      if (query.department === departmentId) {
        return Promise.resolve(employeesInDepartment);
      }
      return Promise.resolve([]);
    });

    const result = await resolveDepartmentEmployees(departmentId, {
      role: 'supervisor',
      id: supervisorId,
    });

    expect(result).toEqual(employeesInDepartment);
    expect(mockEmployee.findById).toHaveBeenCalledWith(supervisorId);
    expect(mockEmployee.find).toHaveBeenCalledWith({ department: departmentId });
    expect(mockDepartment.findById).not.toHaveBeenCalled();
    expect(mockEmployee.exists).not.toHaveBeenCalled();
  });

  it('拒絕主管越權查詢其他部門', async () => {
    const supervisorId = 'sup1';
    const requestedDepartment = 'deptB';

    mockEmployee.findById.mockResolvedValue({ _id: supervisorId, department: 'deptA' });
    mockDepartment.findById.mockResolvedValue({ _id: requestedDepartment, deptManager: 'other' });
    mockEmployee.find.mockImplementation((query) => {
      if ('supervisor' in query) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    mockEmployee.exists.mockResolvedValue(true);

    await expect(
      resolveDepartmentEmployees(requestedDepartment, {
        role: 'supervisor',
        id: supervisorId,
      })
    ).rejects.toMatchObject({ status: 403, message: 'Forbidden' });

    expect(mockDepartment.findById).toHaveBeenCalledWith(requestedDepartment);
    expect(mockEmployee.exists).toHaveBeenCalledWith({ department: requestedDepartment });
  });
});
