import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const findOneAndUpdateMock = jest.fn();
const mockPayrollRecord = jest.fn().mockImplementation((data = {}) => ({
  ...data,
  save: saveMock
}));
mockPayrollRecord.find = jest.fn(() => ({ 
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockResolvedValue([])
}));
mockPayrollRecord.findOneAndUpdate = findOneAndUpdateMock;

const mockEmployee = {
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};
const mockApprovalRequest = { find: jest.fn() };

const mockLaborInsuranceRate = {
  find: jest.fn().mockReturnThis(),
  findOne: jest.fn().mockReturnThis(),
  findOneAndUpdate: jest.fn(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn()
};

const mockCalculateEmployeePayroll = jest.fn();
const mockCalculateBatchPayroll = jest.fn();
const mockSavePayrollRecord = jest.fn();
const mockGetEmployeePayrollRecords = jest.fn();
const mockCalculateCompleteWorkData = jest.fn();
const mockCalculateWorkHours = jest.fn();
const mockCalculateLeaveImpact = jest.fn();
const mockCalculateOvertimePay = jest.fn();

jest.unstable_mockModule('../src/models/PayrollRecord.js', () => ({ default: mockPayrollRecord }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/LaborInsuranceRate.js', () => ({ default: mockLaborInsuranceRate }));
jest.unstable_mockModule('../src/services/payrollService.js', () => ({
  calculateEmployeePayroll: mockCalculateEmployeePayroll,
  calculateBatchPayroll: mockCalculateBatchPayroll,
  savePayrollRecord: mockSavePayrollRecord,
  getEmployeePayrollRecords: mockGetEmployeePayrollRecords,
  extractRecurringAllowance: (employee) => ({
    total: 0,
    breakdown: [],
  }),
}));
jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
  calculateWorkHours: mockCalculateWorkHours,
  calculateLeaveImpact: mockCalculateLeaveImpact,
  calculateOvertimePay: mockCalculateOvertimePay,
  calculateCompleteWorkData: mockCalculateCompleteWorkData,
}));

let app;
let payrollRoutes;

beforeAll(async () => {
  payrollRoutes = (await import('../src/routes/payrollRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/payroll', payrollRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockPayrollRecord.find.mockReset();
  findOneAndUpdateMock.mockReset();
  mockEmployee.findById.mockReset();
  mockEmployee.find.mockReset();
  mockEmployee.countDocuments.mockReset();
  mockApprovalRequest.find.mockReset();
  mockLaborInsuranceRate.find.mockReset();
  mockLaborInsuranceRate.findOne.mockReset();
  mockLaborInsuranceRate.findOneAndUpdate.mockReset();
  mockLaborInsuranceRate.sort.mockReset();
  mockLaborInsuranceRate.limit.mockReset();
  mockCalculateEmployeePayroll.mockReset();
  mockCalculateBatchPayroll.mockReset();
  mockSavePayrollRecord.mockReset();
  mockGetEmployeePayrollRecords.mockReset();
  mockCalculateCompleteWorkData.mockReset();
  mockCalculateWorkHours.mockReset();
  mockCalculateLeaveImpact.mockReset();
  mockCalculateOvertimePay.mockReset();

  // Reset chaining
  mockPayrollRecord.find.mockReturnValue({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockResolvedValue([])
  });
  mockLaborInsuranceRate.find.mockReturnValue(mockLaborInsuranceRate);
  mockLaborInsuranceRate.findOne.mockReturnValue(mockLaborInsuranceRate);
  mockLaborInsuranceRate.sort.mockReturnValue(mockLaborInsuranceRate);
  mockLaborInsuranceRate.limit.mockReturnValue(mockLaborInsuranceRate);

  mockCalculateEmployeePayroll.mockResolvedValue({
    baseSalary: 45600,
    netPay: 42142,
    laborInsuranceFee: 1145,
    laborPensionSelf: 0,
    employeeAdvance: 0
  });
  mockCalculateBatchPayroll.mockResolvedValue([]);
  mockSavePayrollRecord.mockResolvedValue({ _id: 'payroll-record', netPay: 42142 });
  mockGetEmployeePayrollRecords.mockResolvedValue([]);
  mockEmployee.countDocuments.mockResolvedValue(0);
  mockCalculateCompleteWorkData.mockResolvedValue({
    workDays: 0,
    scheduledHours: 0,
    actualWorkHours: 0,
    overtimeHours: 0,
    overtimePay: 0,
    baseSalary: 0,
    nightShiftDays: 0,
    nightShiftHours: 0,
    nightShiftAllowance: 0,
    nightShiftBreakdown: [],
    nightShiftConfigurationIssues: [],
  });
});

function makeEmployeeOverviewQuery(employees) {
  const query = {
    populate: jest.fn(),
    select: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    then: undefined,
  };
  query.populate.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.limit.mockResolvedValue(employees);
  return query;
}

function makePayrollOverviewQuery(records) {
  return { lean: jest.fn().mockResolvedValue(records) };
}

describe('Payroll API', () => {
  it('lists payroll records', async () => {
    const fakeRecords = [{ amount: 100 }];
    mockPayrollRecord.find.mockReturnValue({ 
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue(fakeRecords)
    });
    const res = await request(app).get('/api/payroll');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRecords);
  });

  it('returns 500 if listing fails', async () => {
    mockPayrollRecord.find.mockReturnValue({ 
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockRejectedValue(new Error('fail'))
    });
    const res = await request(app).get('/api/payroll');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates payroll record', async () => {
    const payload = { amount: 100 };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/payroll').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });

  describe('Payroll Calculation', () => {
    it('calculates payroll for an employee', async () => {
      const employeeId = 'emp123';
      const month = '2025-11-01';
      
      mockEmployee.findById.mockResolvedValue({
        _id: employeeId,
        name: 'Test Employee',
        salaryAmount: 45600,
        laborPensionSelf: 2748,
        employeeAdvance: 0,
        salaryAccountA: { bank: 'Taiwan Bank', acct: '12345' },
        salaryAccountB: { bank: 'Taichung Bank', acct: '67890' }
      });
      
      mockLaborInsuranceRate.limit.mockResolvedValue({
        level: 28,
        workerFee: 1145,
        employerFee: 4008,
        insuredSalary: 45800
      });
      
      const res = await request(app)
        .post('/api/payroll/calculate')
        .send({
          employeeId,
          month,
          customData: {
            healthInsuranceFee: 710
          }
        });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('baseSalary');
      expect(res.body).toHaveProperty('netPay');
      expect(res.body).toHaveProperty('laborInsuranceFee');
    });

    it('returns 400 if employeeId or month is missing', async () => {
      const res = await request(app)
        .post('/api/payroll/calculate')
        .send({ employeeId: 'emp123' });
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('calculates and saves payroll', async () => {
      const employeeId = 'emp123';
      const month = '2025-11-01';
      
      mockEmployee.findById.mockResolvedValue({
        _id: employeeId,
        name: 'Test Employee',
        salaryAmount: 45600,
        laborPensionSelf: 2748,
        employeeAdvance: 0,
        salaryAccountA: { bank: 'Taiwan Bank', acct: '12345' },
        salaryAccountB: { bank: 'Taichung Bank', acct: '67890' }
      });
      
      mockLaborInsuranceRate.limit.mockResolvedValue({
        level: 28,
        workerFee: 1145,
        employerFee: 4008,
        insuredSalary: 45800
      });
      
      findOneAndUpdateMock.mockResolvedValue({
        employee: employeeId,
        month: new Date(month),
        baseSalary: 45600,
        netPay: 42142
      });
      
      const res = await request(app)
        .post('/api/payroll/calculate/save')
        .send({
          employeeId,
          month,
          customData: {
            healthInsuranceFee: 710
          }
        });

      expect(res.status).toBe(201);
      expect(mockSavePayrollRecord).toHaveBeenCalled();
    });
  });

  describe('Labor Insurance Rates', () => {
    it('gets labor insurance rates', async () => {
      const rates = [
        { level: 1, insuredSalary: 11100, workerFee: 277 },
        { level: 2, insuredSalary: 12540, workerFee: 313 }
      ];
      
      mockLaborInsuranceRate.limit.mockResolvedValue(rates);
      
      const res = await request(app).get('/api/payroll/insurance/rates');
      expect(res.status).toBe(200);
    });

    it('initializes labor insurance rates', async () => {
      const res = await request(app).post('/api/payroll/insurance/initialize');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('Excel Export', () => {
    it('returns 400 if month is missing', async () => {
      const res = await request(app)
        .post('/api/payroll/export?bankType=taiwan')
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 if bankType is invalid', async () => {
      const res = await request(app)
        .post('/api/payroll/export?month=2025-11-01&bankType=invalid')
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Monthly Payroll Overview', () => {
    it('returns 400 if month is missing', async () => {
      const res = await request(app).get('/api/payroll/overview/monthly');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 if month format is invalid', async () => {
      const res = await request(app).get('/api/payroll/overview/monthly?month=invalid-date');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Invalid month format');
    });

    it('paginates employees and escapes search input before querying', async () => {
      const employeeQuery = makeEmployeeOverviewQuery([{
        _id: 'emp1',
        employeeId: 'E001',
        name: '[Payroll User]',
        salaryAmount: 45000,
      }]);
      mockEmployee.find.mockReturnValue(employeeQuery);
      mockEmployee.countDocuments.mockResolvedValue(25);
      mockPayrollRecord.find.mockReturnValue(makePayrollOverviewQuery([]));

      const res = await request(app)
        .get('/api/payroll/overview/monthly?month=2025-11-01&q=%5B&page=2&pageSize=10');

      expect(res.status).toBe(200);
      const filter = mockEmployee.find.mock.calls[0][0];
      expect(filter.$or[0].name.source).toBe('\\[');
      expect(employeeQuery.skip).toHaveBeenCalledWith(10);
      expect(employeeQuery.limit).toHaveBeenCalledWith(10);
      expect(res.body.pagination).toEqual({ total: 25, page: 2, pageSize: 10, totalPages: 3 });
    });

    it('loads approved bonus forms once for the current employee page', async () => {
      const employees = [
        { _id: '507f1f77bcf86cd799439041', employeeId: 'E001', name: 'A', salaryAmount: 45000 },
        { _id: '507f1f77bcf86cd799439042', employeeId: 'E002', name: 'B', salaryAmount: 46000 },
      ];
      mockEmployee.find.mockReturnValue(makeEmployeeOverviewQuery(employees));
      mockEmployee.countDocuments.mockResolvedValue(2);
      mockPayrollRecord.find.mockReturnValue(makePayrollOverviewQuery([]));
      const approvalLean = jest.fn().mockResolvedValue([]);
      const approvalPopulate = jest.fn().mockReturnValue({ lean: approvalLean });
      mockApprovalRequest.find.mockReturnValue({ populate: approvalPopulate });

      const res = await request(app).get('/api/payroll/overview/monthly?month=2025-11-01');

      expect(res.status).toBe(200);
      expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);
      expect(approvalPopulate).toHaveBeenCalledWith('form');
      expect(mockCalculateEmployeePayroll).toHaveBeenCalledTimes(2);
      expect(mockCalculateEmployeePayroll.mock.calls[0][3]).toMatchObject({
        employee: employees[0],
        workData: expect.any(Object),
      });
    });

    it('returns overview with month filter', async () => {
      const fakeEmployees = [
        {
          _id: 'emp1',
          employeeId: 'E001',
          name: '王小明',
          department: { _id: 'dept1', name: '人資部' },
          subDepartment: null,
          organization: 'org1',
          salaryAmount: 45000,
          salaryType: '月薪'
        }
      ];

      mockEmployee.find.mockReturnValue(makeEmployeeOverviewQuery(fakeEmployees));
      mockEmployee.countDocuments.mockResolvedValue(1);

      mockPayrollRecord.find.mockReturnValue(makePayrollOverviewQuery([]));

      const res = await request(app).get('/api/payroll/overview/monthly?month=2025-11-01');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.pagination).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('includes night shift fields in overview response', async () => {
      const fakeEmployees = [
        {
          _id: 'emp1',
          employeeId: 'E001',
          name: '王小明',
          department: { _id: 'dept1', name: '人資部' },
          subDepartment: null,
          organization: 'org1',
          salaryAmount: 45000,
          salaryType: '月薪'
        }
      ];

      const fakePayrollRecords = [
        {
          employee: {
            _id: 'emp1',
            employeeId: 'E001',
            name: '王小明'
          },
          nightShiftDays: 8,
          nightShiftHours: 56,
          nightShiftAllowance: 3920,
          nightShiftCalculationMethod: 'calculated',
          nightShiftBreakdown: [
            {
              shiftName: '夜班',
              shiftCode: 'NIGHT',
              allowanceType: '固定津貼',
              workHours: 7,
              allowanceAmount: 490,
              calculationDetail: '固定津貼: NT$ 490 / 班',
              hasIssue: false
            }
          ],
          nightShiftConfigurationIssues: []
        }
      ];

      mockEmployee.find.mockReturnValue(makeEmployeeOverviewQuery(fakeEmployees));
      mockEmployee.countDocuments.mockResolvedValue(1);

      mockPayrollRecord.find.mockReturnValue(makePayrollOverviewQuery(fakePayrollRecords));
      mockCalculateCompleteWorkData.mockResolvedValue({
        nightShiftDays: 8,
        nightShiftHours: 56,
        nightShiftAllowance: 3920,
        nightShiftCalculationMethod: 'calculated',
        nightShiftBreakdown: fakePayrollRecords[0].nightShiftBreakdown,
        nightShiftConfigurationIssues: [],
      });

      const res = await request(app).get('/api/payroll/overview/monthly?month=2025-11-01');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
      
      const employeeData = res.body.items[0];
      expect(employeeData).toHaveProperty('nightShiftDays', 8);
      expect(employeeData).toHaveProperty('nightShiftHours', 56);
      expect(employeeData).toHaveProperty('nightShiftAllowance', 3920);
      expect(employeeData).toHaveProperty('nightShiftCalculationMethod', 'calculated');
      expect(employeeData).toHaveProperty('nightShiftBreakdown');
      expect(Array.isArray(employeeData.nightShiftBreakdown)).toBe(true);
      expect(employeeData).toHaveProperty('nightShiftConfigurationIssues');
      expect(Array.isArray(employeeData.nightShiftConfigurationIssues)).toBe(true);
    });

    it('includes annual leave fields in overview response', async () => {
      const fakeEmployees = [
        {
          _id: 'emp1',
          employeeId: 'E001',
          name: '王小明',
          department: { _id: 'dept1', name: '人資部' },
          subDepartment: null,
          organization: 'org1',
          salaryAmount: 45000,
          salaryType: '月薪',
          annualLeave: {
            totalDays: 14,
            usedDays: 3,
            year: 2025,
            expiryDate: new Date('2025-12-31'),
            accumulatedLeave: 2,
            notes: '特休測試備註'
          }
        }
      ];

      mockEmployee.find.mockReturnValue(makeEmployeeOverviewQuery(fakeEmployees));
      mockEmployee.countDocuments.mockResolvedValue(1);

      mockPayrollRecord.find.mockReturnValue(makePayrollOverviewQuery([]));

      const res = await request(app).get('/api/payroll/overview/monthly?month=2025-11-01');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
      
      const employeeData = res.body.items[0];
      expect(employeeData).toHaveProperty('annualLeave');
      expect(employeeData.annualLeave).toHaveProperty('totalDays', 14);
      expect(employeeData.annualLeave).toHaveProperty('totalHours', 112); // 14 days * 8 hours
      expect(employeeData.annualLeave).toHaveProperty('usedDays', 3);
      expect(employeeData.annualLeave).toHaveProperty('accumulatedLeave', 2);
      expect(employeeData.annualLeave).toHaveProperty('notes', '特休測試備註');
      expect(employeeData.annualLeave).toHaveProperty('expiryDate');
    });
  });
});
