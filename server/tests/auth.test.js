import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'

const verifyMock = jest.fn();
const fakeEmployee = { _id: 'e1', role: 'employee', username: 'john', verifyPassword: verifyMock };
const mockEmployee = { findOne: jest.fn() };
const mockBlacklistedToken = { create: jest.fn(), findOne: jest.fn() };

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
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
  mockEmployee.findOne.mockReset();
  verifyMock.mockReset();
  mockBlacklistedToken.create.mockReset();
  mockBlacklistedToken.findOne.mockReset();
});

describe('Auth API', () => {
  it('logs in with valid credentials', async () => {
    mockEmployee.findOne.mockResolvedValue(fakeEmployee);
    verifyMock.mockReturnValue(true);
    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('tok');
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('tok');
    expect(res.body.user).toEqual({ id: 'e1', role: 'employee', username: 'john' });
    expect(signSpy).toHaveBeenCalledWith(
      { id: 'e1', role: 'employee' },
      'secret',
      { expiresIn: '1h' }
    );
    signSpy.mockRestore();
  });

  it('fails with invalid credentials', async () => {
    mockEmployee.findOne.mockResolvedValue(fakeEmployee);
    verifyMock.mockReturnValue(false);
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
