import { jest } from '@jest/globals';
import path from 'path';

test('seed script loads env from server/.env', async () => {
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.DEFAULT_ADMIN_USERNAME = 'admin';
  process.env.DEFAULT_ADMIN_PASSWORD = 'admin-secret';
  const configMock = jest.fn();
  const writeFileMock = jest.fn().mockResolvedValue();
  const mockSignConfig = {
    supervisor: { signRole: 'R003', signLevel: 'U003', permissionGrade: 'L3' },
    employee: { signRole: 'R001', signLevel: 'U001', permissionGrade: 'L1' },
    admin: { signRole: 'R004', signLevel: 'U005', permissionGrade: 'L5' },
  };
  const supervisors = [
    { username: 'sup-01', name: '主管甲', title: '部門主管', role: 'supervisor', signTags: ['人資'] },
  ];
  const employees = [
    { username: 'emp-01', name: '員工甲', title: '專員', role: 'employee', signTags: [] },
  ];

  await jest.unstable_mockModule('fs/promises', () => ({ writeFile: writeFileMock }));
  await jest.unstable_mockModule('dotenv', () => ({ default: { config: configMock } }));
  await jest.unstable_mockModule('../src/config/db.js', () => ({ connectDB: jest.fn() }));
  await jest.unstable_mockModule('../src/seedUtils.js', () => ({
    seedSampleData: jest.fn(),
    seedTestUsers: jest.fn().mockResolvedValue({ supervisors, employees }),
    seedApprovalTemplates: jest.fn(),
    seedApprovalRequests: jest.fn(),
    SEED_TEST_PASSWORD: 'mocked-password',
    SEED_SIGN_CONFIG: mockSignConfig,
  }));
  await jest.unstable_mockModule('../src/services/supervisorReportSeed.js', () => ({
    ensureDefaultSupervisorReports: jest.fn().mockResolvedValue(),
  }));
  class MockSchema {
    constructor() {}
  }
  MockSchema.Types = { Mixed: class {} };
  const mockMongoose = {
    disconnect: jest.fn(),
    Schema: MockSchema,
    model: jest.fn(),
  };
  await jest.unstable_mockModule('mongoose', () => ({ default: mockMongoose }));

  await import('../scripts/seed.js');

  expect(configMock).toHaveBeenCalledWith({ path: path.resolve(process.cwd(), '.env') });
  expect(writeFileMock).toHaveBeenCalledWith(
    expect.stringContaining('seed-accounts.json'),
    expect.any(String),
    'utf8',
  );

  const [, accountJson] = writeFileMock.mock.calls[0];
  const accounts = JSON.parse(accountJson);
  expect(accounts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        username: 'admin',
        password: 'admin-secret',
        role: 'admin',
        signRole: mockSignConfig.admin.signRole,
        signLevel: mockSignConfig.admin.signLevel,
        permissionGrade: mockSignConfig.admin.permissionGrade,
      }),
      expect.objectContaining({
        username: 'sup-01',
        password: 'mocked-password',
        role: 'supervisor',
        signTags: ['人資'],
        signRole: mockSignConfig.supervisor.signRole,
        signLevel: mockSignConfig.supervisor.signLevel,
        permissionGrade: mockSignConfig.supervisor.permissionGrade,
      }),
      expect.objectContaining({
        username: 'emp-01',
        password: 'mocked-password',
        role: 'employee',
        signRole: mockSignConfig.employee.signRole,
        signLevel: mockSignConfig.employee.signLevel,
        permissionGrade: mockSignConfig.employee.permissionGrade,
      }),
    ]),
  );

  delete process.env.DEFAULT_ADMIN_USERNAME;
  delete process.env.DEFAULT_ADMIN_PASSWORD;
});
