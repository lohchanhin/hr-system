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
  it('使用正確帳密與角色登入', async () => {
    mockEmployee.findOne.mockReturnValue({
      select: () =>
        Promise.resolve({
          _id: '1',
          role: 'employee',
          authVersion: 0,
          username: 'john',
          name: 'John Doe',
          verifyPassword: (pwd) => pwd === 'pass'
        })
    });
    const signSpy = jest.spyOn(jwt, 'sign');
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass', role: 'employee' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toEqual({
      id: '1',
      employeeId: '1',
      employeeNumber: '',
      role: 'employee',
      username: 'john',
      name: 'John Doe',
      photo: '',
      organizationName: '',
      departmentName: '',
      subDepartmentName: '',
    });
    expect(signSpy).toHaveBeenCalledWith(
      { id: '1', sub: '1', role: 'employee', ver: 0 },
      'secret',
      { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' }
    );
    signSpy.mockRestore();
  });

  it('角色不符登入失敗', async () => {
    mockEmployee.findOne.mockReturnValue({
      select: () =>
        Promise.resolve({
          _id: '1',
          role: 'employee',
          username: 'john',
          verifyPassword: (pwd) => pwd === 'pass'
        })
    });
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass', role: 'admin' });
    expect(res.status).toBe(401);
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
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'wrong', role: 'employee' });
    expect(res.status).toBe(401);
  });

  it('登出後將 token 加入黑名單', async () => {
    const token = jwt.sign(
      { id: '1', sub: '1', role: 'employee', ver: 0 },
      'secret',
      { expiresIn: '1h', issuer: 'hr-system', audience: 'hr-system-api' }
    );
    const res = await request(app).post('/api/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(blacklistToken).toHaveBeenCalledWith(token);
    const result = await isTokenBlacklisted(token);
    expect(result).toBe(true);
  });

  it('拒絕 NoSQL 形式的帳號輸入', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: { $ne: null }, password: 'pass', role: 'employee' });

    expect(res.status).toBe(401);
    expect(mockEmployee.findOne).not.toHaveBeenCalled();
  });

  it('拒絕停用帳號登入', async () => {
    mockEmployee.findOne.mockReturnValue({
      select: () => Promise.resolve({
        _id: '2',
        role: 'employee',
        username: 'disabled-user',
        accountEnabled: false,
        verifyPassword: () => true,
      })
    });

    const res = await request(app)
      .post('/api/login')
      .send({ username: 'disabled-user', password: 'pass', role: 'employee' });

    expect(res.status).toBe(401);
  });

  it('登入失敗達上限後回傳 429', async () => {
    mockEmployee.findOne.mockReturnValue({ select: () => Promise.resolve(null) });

    let res;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      res = await request(app)
        .post('/api/login')
        .send({ username: 'rate-limited-user', password: 'wrong', role: 'employee' });
    }

    expect(res.status).toBe(429);
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('不接受未經驗證的登出 token', async () => {
    const res = await request(app)
      .post('/api/logout')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(blacklistToken).not.toHaveBeenCalled();
  });
});
