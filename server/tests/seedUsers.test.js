import { jest } from '@jest/globals';

const mockUserFindOne = jest.fn();
const mockUserCreate = jest.fn();

jest.mock('../src/models/User.js', () => ({ default: { findOne: mockUserFindOne, create: mockUserCreate } }), { virtual: true });

const mockEmpCreate = jest.fn(async (data) => ({ _id: `${data.name}_id`, ...data }));
const mockEmpUpdateMany = jest.fn();

jest.mock('../src/models/Employee.js', () => ({ default: { create: mockEmpCreate, updateMany: mockEmpUpdateMany } }), { virtual: true });

beforeAll(() => {
  process.env.PORT = '3000';
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET = 'secret';
  process.env.NODE_ENV = 'test';
});

describe('seedTestUsers', () => {
  it('creates specialized accounts with signTags', async () => {
    mockUserFindOne.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({});
    const { seedTestUsers } = await import('../src/index.js');
    await seedTestUsers();
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'scheduler', signTags: ['\u6392\u73ed\u8cac\u4efb\u4eba'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'supportHead', signTags: ['\u652f\u63f4\u55ae\u4f4d\u4e3b\u7ba1'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'salesHead', signTags: ['\u696d\u52d9\u4e3b\u7ba1'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'salesManager', signTags: ['\u696d\u52d9\u8cac\u4efb\u4eba'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'hr', signTags: ['\u4eba\u8cc7'] }));
  });
});
