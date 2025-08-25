import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'

const compareMock = jest.fn();
const fakeUser = { _id: 'u1', role: 'employee', username: 'john', employee: 'e1', comparePassword: compareMock };
const mockUser = { findOne: jest.fn() };
const mockBlacklistedToken = { create: jest.fn(), findOne: jest.fn() };

jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }));
jest.unstable_mockModule('../src/models/BlacklistedToken.js', () => ({ default: mockBlacklistedToken }));

let app;
let authRoutes;
let isTokenBlacklisted;

beforeAll(async () => {
  process.env.JWT_SECRET = 'secret';
  authRoutes = (await import('../src/routes/authRoutes.js')).default;
  ({ isTokenBlacklisted } = await import('../src/utils/tokenBlacklist.js'));
  app = express();
  app.use(express.json());
  app.use('/api', authRoutes);
});

beforeEach(() => {
  mockUser.findOne.mockReset();
  compareMock.mockReset();
  mockBlacklistedToken.create.mockReset();
  mockBlacklistedToken.findOne.mockReset();
});

describe('Auth API', () => {
  it('logs in with valid credentials', async () => {
    mockUser.findOne.mockResolvedValue(fakeUser);
    compareMock.mockResolvedValue(true);
    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('tok');
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('tok');
    expect(res.body.user).toEqual({ id: 'u1', role: 'employee', username: 'john', employeeId: 'e1' });
    expect(signSpy).toHaveBeenCalledWith(
      { id: 'u1', role: 'employee', employeeId: 'e1' },
      'secret',
      { expiresIn: '1h' }
    );
    signSpy.mockRestore();
  });

  it('fails with invalid credentials', async () => {
    mockUser.findOne.mockResolvedValue(fakeUser);
    compareMock.mockResolvedValue(false);
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('invalidates token on logout', async () => {
    mockBlacklistedToken.create.mockResolvedValue();
    mockBlacklistedToken.findOne.mockResolvedValue({ token: 'tok', expiresAt: new Date(Date.now() + 1000) });
    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    const result = await isTokenBlacklisted('tok')
    expect(result).toBe(true)
  })
});
