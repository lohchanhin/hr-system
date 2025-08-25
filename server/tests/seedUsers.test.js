import { jest } from '@jest/globals';

const mockUserFindOne = jest.fn();
const mockUserCreate = jest.fn();

jest.unstable_mockModule('../src/models/User.js', () => ({ default: { findOne: mockUserFindOne, create: mockUserCreate } }));

const mockEmpCreate = jest.fn(async (data) => ({ _id: `${data.name}_id`, ...data }));
const mockEmpUpdateMany = jest.fn();

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: { create: mockEmpCreate, updateMany: mockEmpUpdateMany } }));

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
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'scheduler', signTags: ['\u6392\u73ed\u8ca0\u8cac\u4eba'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'supportHead', signTags: ['\u652f\u63f4\u55ae\u4f4d\u4e3b\u7ba1'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'salesHead', signTags: ['\u696d\u52d9\u4e3b\u7ba1'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'salesManager', signTags: ['\u696d\u52d9\u8ca0\u8cac\u4eba'] }));
    expect(mockEmpCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'hr', signTags: ['\u4eba\u8cc7'] }));
    expect(mockEmpUpdateMany).toHaveBeenCalledWith({ role: 'employee' }, { supervisor: expect.any(String) });
  });
});
