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
      // 登入回應附上排班權限（前台決定要不要顯示排班頁）：沒有被指定為排班人員的員工不能排班
      scheduleAccess: {
        canSchedule: false,
        supervisorScope: false,
        subDepartmentIds: [],
        departmentIds: [],
        wholeDepartmentIds: [],
      },
    });
    expect(signSpy).toHaveBeenCalledWith(
      { id: '1', sub: '1', role: 'employee', ver: 0 },
      'secret',
      { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h', jwtid: expect.any(String) }
    );
    signSpy.mockRestore();
  });

  it('同一帳號同一秒內登入兩次拿到不同的 token', async () => {
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
    const [first, second] = await Promise.all([
      request(app).post('/api/login').send({ username: 'john', password: 'pass' }),
      request(app).post('/api/login').send({ username: 'john', password: 'pass' })
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.token).not.toBe(second.body.token);
    expect(jwt.decode(first.body.token).jti).toBeTruthy();
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

  // 2026/11 起登入頁不再讓使用者選角色：role 可以不帶，以帳號本身的角色登入
  describe('不帶 role 登入', () => {
    const account = (overrides = {}) => ({
      _id: '7',
      role: 'supervisor',
      authVersion: 3,
      username: 'boss',
      name: 'Boss',
      verifyPassword: (pwd) => pwd === 'pass',
      ...overrides,
    });
    const mockAccount = (overrides) => {
      mockEmployee.findOne.mockReturnValue({ select: () => Promise.resolve(account(overrides)) });
    };

    it.each(['employee', 'supervisor', 'admin'])('以帳號本身的角色（%s）登入並簽發同角色的 token', async (role) => {
      mockAccount({ role });
      const res = await request(app).post('/api/login').send({ username: 'boss', password: 'pass' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe(role);
      const payload = jwt.verify(res.body.token, 'secret', { issuer: 'hr-system', audience: 'hr-system-api' });
      expect(payload).toMatchObject({ id: '7', sub: '7', role, ver: 3 });
    });

    it('密碼錯誤仍回 401', async () => {
      mockAccount();
      const res = await request(app).post('/api/login').send({ username: 'norole-wrong-password', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it.each([
      ['帳號已停用', { accountEnabled: false }],
      ['離職員工', { status: '離職員工' }],
      ['留職停薪', { status: '留職停薪' }],
    ])('%s 仍回 401，訊息與密碼錯誤相同', async (_label, overrides) => {
      mockAccount(overrides);
      const res = await request(app).post('/api/login').send({ username: 'norole-inactive', password: 'pass' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('帳號的角色不是系統角色時不能登入', async () => {
      mockAccount({ role: 'hr' });
      const res = await request(app).post('/api/login').send({ username: 'norole-legacy-role', password: 'pass' });
      expect(res.status).toBe(401);
    });

    it.each([['空字串', ''], ['null', null], ['不存在的角色', 'root'], ['物件', { $ne: null }]])(
      '有帶 role 但不是有效角色（%s）時照舊拒絕，不查資料庫',
      async (_label, role) => {
        mockAccount();
        const res = await request(app).post('/api/login').send({ username: 'norole-invalid-role', password: 'pass', role });
        expect(res.status).toBe(401);
        expect(mockEmployee.findOne).not.toHaveBeenCalled();
      }
    );

    it('有帶 role 且與帳號相符時照舊可以登入（舊版前端）', async () => {
      mockAccount();
      const res = await request(app).post('/api/login').send({ username: 'boss', password: 'pass', role: 'supervisor' });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('supervisor');
    });

    it('登入失敗的次數限制不變：同一帳號第 6 次失敗回 429，之後即使密碼正確也被擋下', async () => {
      mockAccount();
      const attempt = (password) => request(app).post('/api/login').send({ username: 'norole-rate-limited', password });

      for (let count = 0; count < 5; count += 1) {
        expect((await attempt('wrong')).status).toBe(401);
      }
      const limited = await attempt('wrong');
      expect(limited.status).toBe(429);
      expect(limited.headers['ratelimit-policy']).toBeDefined();
      expect((await attempt('pass')).status).toBe(429);
    });

    it('登入成功不計入失敗次數', async () => {
      mockAccount();
      for (let count = 0; count < 8; count += 1) {
        const res = await request(app).post('/api/login').send({ username: 'norole-success', password: 'pass' });
        expect(res.status).toBe(200);
      }
    });
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
