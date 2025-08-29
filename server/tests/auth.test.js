import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

// 使用記憶體集合模擬資料庫
const mockEmployee = { findOne: jest.fn() };
const blacklisted = new Set();

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: mockEmployee
}));

jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  blacklistToken: jest.fn((token) => {
    blacklisted.add(token);
  }),
  isTokenBlacklisted: jest.fn((token) => Promise.resolve(blacklisted.has(token)))
}));

let app;
let authRoutes;
let blacklistToken;
let isTokenBlacklisted;

beforeAll(async () => {
  process.env.JWT_SECRET = 'secret';
  authRoutes = (await import('../src/routes/authRoutes.js')).default;
  ({ blacklistToken, isTokenBlacklisted } = await import('../src/utils/tokenBlacklist.js'));
  app = express();
  app.use(express.json());
  app.use('/api', authRoutes);
});

afterEach(() => {
  mockEmployee.findOne.mockReset();
  blacklistToken.mockClear();
});

describe('Auth API', () => {
  it('使用正確帳密登入', async () => {
    mockEmployee.findOne.mockReturnValue({
      select: () =>
        Promise.resolve({
          _id: '1',
          role: 'employee',
          username: 'john',
          verifyPassword: (pwd) => pwd === 'pass'
        })
    });
    const signSpy = jest.spyOn(jwt, 'sign');
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toEqual({ id: '1', role: 'employee', username: 'john' });
    expect(signSpy).toHaveBeenCalledWith({ id: '1', role: 'employee' }, 'secret', { expiresIn: '1h' });
    signSpy.mockRestore();
  });

  it('使用錯誤密碼登入失敗', async () => {
    mockEmployee.findOne.mockReturnValue({
      select: () =>
        Promise.resolve({
          _id: '1',
          role: 'employee',
          username: 'john',
          verifyPassword: () => false
        })
    });
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('登出後將 token 加入黑名單', async () => {
    const token = jwt.sign({ id: '1', role: 'employee' }, 'secret', { expiresIn: '1h' });
    const res = await request(app).post('/api/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(blacklistToken).toHaveBeenCalledWith(token);
    const result = await isTokenBlacklisted(token);
    expect(result).toBe(true);
  });
});
