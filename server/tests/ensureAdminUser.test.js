import { jest } from '@jest/globals';

const mockFindOne = jest.fn();
const mockCreate = jest.fn();

jest.unstable_mockModule('../src/models/User.js', () => ({
  default: { findOne: mockFindOne, create: mockCreate },
}));

beforeAll(() => {
  process.env.PORT = '3000';
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET = 'secret';
  process.env.NODE_ENV = 'test';
});

describe('ensureAdminUser', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockCreate.mockReset();
    delete process.env.DEFAULT_ADMIN_USERNAME;
    delete process.env.DEFAULT_ADMIN_PASSWORD;
  });

  it('skips creation when admin exists', async () => {
    mockFindOne.mockResolvedValue({ username: 'admin' });
    const { ensureAdminUser } = await import('../src/index.js');
    await ensureAdminUser();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates default admin using env variables', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
    process.env.DEFAULT_ADMIN_USERNAME = 'root';
    process.env.DEFAULT_ADMIN_PASSWORD = 'secret';
    const { ensureAdminUser } = await import('../src/index.js');
    await ensureAdminUser();
    expect(mockCreate).toHaveBeenCalledWith({ username: 'root', password: 'secret', role: 'admin' });
  });
});

