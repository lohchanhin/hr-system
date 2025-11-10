import { jest } from '@jest/globals';
import crypto from 'crypto';

const mockEmployee = {
  findOne: jest.fn(),
  create: jest.fn(),
};

const authenticateMock = jest.fn((req, res, next) => next());
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: authenticateMock,
  authorizeRoles: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  },
}));

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
  process.env.DEFAULT_ADMIN_PASSWORD = 'secret';

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
  authenticateMock.mockReset();
});

test('creates default admin user from env variables when none exists', async () => {
  mockEmployee.findOne.mockResolvedValue(null);
  await ensureAdminUser();
  expect(createdUser).toMatchObject({
    username: 'boss',
    email: 'boss@example.com',
    role: 'admin',
  });
  expect(createdUser.passwordHash).toBeDefined();
  expect(createdUser.passwordHash).not.toBe('');
});
