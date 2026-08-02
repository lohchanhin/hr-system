import { jest } from '@jest/globals';
import crypto from 'crypto';

const mockEmployee = {
  findOne: jest.fn(),
  create: jest.fn(),
};

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));

let ensureAdminUser;
let createdUser;

beforeEach(async () => {
  jest.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET = 'secret';
  process.env.DEFAULT_ADMIN_USERNAME = 'boss';
  process.env.DEFAULT_ADMIN_EMAIL = 'boss@company.test';
  process.env.DEFAULT_ADMIN_PASSWORD = '7x!Secure-Launch-Key';

  createdUser = undefined;
  mockEmployee.findOne.mockReset();
  mockEmployee.create.mockReset();
  mockEmployee.create.mockImplementation(async (data) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .pbkdf2Sync(data.password, salt, 100000, 64, 'sha512')
      .toString('hex');
    createdUser = { ...data, passwordHash: `${salt}:${hash}` };
    return createdUser;
  });

  ({ ensureAdminUser } = await import('../src/index.js'));
});

test('creates default admin user from env variables when none exists', async () => {
  mockEmployee.findOne.mockResolvedValue(null);
  await ensureAdminUser();
  expect(createdUser).toMatchObject({
    username: 'boss',
    email: 'boss@company.test',
    role: 'admin',
    accountEnabled: true,
  });
  expect(createdUser.passwordHash).toBeDefined();
  expect(createdUser.passwordHash).not.toBe('');
});

test('fails closed when no admin exists and bootstrap variables are missing', async () => {
  mockEmployee.findOne.mockResolvedValue(null);
  delete process.env.DEFAULT_ADMIN_PASSWORD;

  await expect(ensureAdminUser()).rejects.toThrow('DEFAULT_ADMIN_PASSWORD');
  expect(mockEmployee.create).not.toHaveBeenCalled();
});

test('rejects a weak bootstrap password', async () => {
  mockEmployee.findOne.mockResolvedValue(null);
  process.env.DEFAULT_ADMIN_PASSWORD = 'password';

  await expect(ensureAdminUser()).rejects.toThrow('at least 15 characters');
  expect(mockEmployee.create).not.toHaveBeenCalled();
});

test('does not require bootstrap variables when an admin already exists', async () => {
  mockEmployee.findOne.mockResolvedValue({ _id: 'admin-1' });
  delete process.env.DEFAULT_ADMIN_USERNAME;
  delete process.env.DEFAULT_ADMIN_EMAIL;
  delete process.env.DEFAULT_ADMIN_PASSWORD;

  await expect(ensureAdminUser()).resolves.toBeUndefined();
  expect(mockEmployee.create).not.toHaveBeenCalled();
});
