import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
} from '../src/services/totpService.js';

const mockEmployees = new Map();
const mockRefreshTokens = new Map();

const mockEmployeeModel = {
  findOne: jest.fn(({ username }) => ({
    select: jest.fn(async () => {
      for (const emp of mockEmployees.values()) {
        if (emp.username === username) return emp;
      }
      return null;
    }),
  })),
  // 跟 mongoose 一樣：可以 .select()，也可以直接 await
  findById: jest.fn((id) => {
    const found = () => mockEmployees.get(String(id)) || null;
    return {
      select: jest.fn(async () => found()),
      then: (resolve, reject) => Promise.resolve(found()).then(resolve, reject),
    };
  }),
};

const mockRefreshTokenModel = {
  create: jest.fn(async (doc) => {
    const record = {
      ...doc,
      _id: crypto.randomUUID(),
      save: async function save() {
        mockRefreshTokens.set(this.tokenHash, this);
        return this;
      },
    };
    mockRefreshTokens.set(doc.tokenHash, record);
    return record;
  }),
  findOne: jest.fn(async ({ tokenHash }) => mockRefreshTokens.get(tokenHash) || null),
  // 比對再改：只有還沒作廢的 token 改得到（兩個請求同時續期只有一個成功）
  findOneAndUpdate: jest.fn(async (filter, update) => {
    for (const token of mockRefreshTokens.values()) {
      if (String(token._id) !== String(filter._id)) continue;
      if (filter.revokedAt === null && token.revokedAt) return null;
      Object.assign(token, update.$set || {});
      return token;
    }
    return null;
  }),
  updateMany: jest.fn(async (filter, update) => {
    for (const token of mockRefreshTokens.values()) {
      if (filter.familyId && token.familyId !== filter.familyId) continue;
      if (filter.employee && String(token.employee) !== String(filter.employee)) continue;
      if (filter.revokedAt === null && token.revokedAt) continue;
      Object.assign(token, update.$set || {});
    }
  }),
};

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }));
jest.unstable_mockModule('../src/models/RefreshToken.js', () => ({ default: mockRefreshTokenModel }));
jest.unstable_mockModule('../src/services/auditService.js', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(null),
  extractRequestMeta: () => ({ ip: '127.0.0.1', userAgent: 'jest' }),
}));
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
  getSettings: jest.fn().mockResolvedValue({
    security: { enforce2FA: false, passwordExpiration: false, passwordExpireDays: 90 },
  }),
}));

const authRoutes = (await import('../src/routes/authRoutes.js')).default;

describe('P1 TOTP 2FA & Refresh Token Rotation', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-2fa';
  });

  beforeEach(() => {
    mockEmployees.clear();
    mockRefreshTokens.clear();
    jest.clearAllMocks();
  });

  it('TOTP service generates, encrypts, verifies codes and hashes backup codes', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);

    const encrypted = encryptTotpSecret(secret);
    expect(decryptTotpSecret(encrypted)).toBe(secret);

    const backups = generateBackupCodes(4);
    expect(backups).toHaveLength(4);
    const hashes = backups.map((c) => hashBackupCode(c));
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rotates HttpOnly refresh tokens and revokes family on reuse detection', async () => {
    const secret = generateTotpSecret();
    const empId = '507f1f77bcf86cd799439011';
    mockEmployees.set(empId, {
      _id: empId,
      username: 'admin1',
      name: 'Admin One',
      role: 'admin',
      authVersion: 1,
      accountEnabled: true,
      status: 'active',
      passwordChangedAt: new Date(),
      twoFactor: {
        enabled: true,
        secretEncrypted: encryptTotpSecret(secret),
        backupCodesHash: [],
      },
      verifyPassword: (pw) => pw === 'Pass1234!',
      save: async () => {},
    });

    const app = express();
    app.use(express.json());
    app.use('/api', authRoutes);

    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: 'admin1', password: 'Pass1234!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2fa).toBe(true);
    expect(loginRes.body.challengeToken).toBeTruthy();

    const code = generateTotp(secret);
    const verifyRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: loginRes.body.challengeToken, code });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeTruthy();

    const setCookie1 = verifyRes.headers['set-cookie']?.[0] || '';
    expect(setCookie1).toContain('HttpOnly');
    const cookieValue1 = setCookie1.split(';')[0];

    // First refresh succeeds and rotates token
    const refreshRes1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieValue1);
    expect(refreshRes1.status).toBe(200);
    expect(refreshRes1.body.token).toBeTruthy();

    // 剛換過又拿舊 cookie 來（另一個分頁同時續期）：回 REFRESH_ROTATED，不整串作廢
    const raceRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieValue1);
    expect(raceRes.status).toBe(401);
    expect(raceRes.body.code).toBe('REFRESH_ROTATED');
    expect(mockRefreshTokenModel.updateMany).not.toHaveBeenCalled();
    const cookieValue2 = (refreshRes1.headers['set-cookie']?.[0] || '').split(';')[0];
    expect([...mockRefreshTokens.values()].filter((token) => !token.revokedAt)).toHaveLength(1);

    // 過了寬限時間還拿舊 cookie 來：當成被盜用，整串作廢（新的也不能用）
    for (const token of mockRefreshTokens.values()) {
      if (token.revokedAt) token.revokedAt = new Date(Date.now() - 5 * 60 * 1000);
    }
    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieValue1);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.code).toBeUndefined();
    expect(mockRefreshTokenModel.updateMany).toHaveBeenCalled();
    const afterReuse = await request(app).post('/api/auth/refresh').set('Cookie', cookieValue2);
    expect(afterReuse.status).toBe(401);
  });

  const makeEmployee = (overrides = {}) => {
    const empId = '507f1f77bcf86cd799439022';
    const employee = {
      _id: empId,
      username: 'staff1',
      name: 'Staff One',
      role: 'employee',
      authVersion: 0,
      accountEnabled: true,
      status: '正職員工',
      passwordChangedAt: new Date(),
      twoFactor: { enabled: false },
      verifyPassword: (pw) => pw === 'Pass1234!',
      save: async () => {},
      ...overrides,
    };
    mockEmployees.set(empId, employee);
    return employee;
  };

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api', authRoutes);
    return app;
  };

  const loginCookie = async (app) => {
    const loginRes = await request(app).post('/api/login').send({ username: 'staff1', password: 'Pass1234!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
    return { token: loginRes.body.token, cookie: (loginRes.headers['set-cookie']?.[0] || '').split(';')[0] };
  };

  // 正式站是 http://：NODE_ENV=production 也不能加 Secure，否則瀏覽器不存 cookie、15 分鐘就被登出
  it('does not mark the refresh cookie Secure over plain HTTP in production', async () => {
    const previous = { env: process.env.NODE_ENV, secure: process.env.COOKIE_SECURE };
    try {
      makeEmployee();
      const app = buildApp();
      process.env.NODE_ENV = 'production';
      delete process.env.COOKIE_SECURE;
      const plainRes = await request(app).post('/api/login').send({ username: 'staff1', password: 'Pass1234!' });
      expect(plainRes.status).toBe(200);
      expect(plainRes.headers['set-cookie'][0]).not.toMatch(/;\s*Secure/i);

      process.env.COOKIE_SECURE = 'true';
      const secureRes = await request(app).post('/api/login').send({ username: 'staff1', password: 'Pass1234!' });
      expect(secureRes.headers['set-cookie'][0]).toMatch(/;\s*Secure/i);
    } finally {
      process.env.NODE_ENV = previous.env;
      if (previous.secure === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = previous.secure;
    }
  });

  it('keeps refreshing while the access token is expired (session survives the 15 minutes)', async () => {
    makeEmployee();
    const app = buildApp();
    let { cookie } = await loginCookie(app);
    for (let round = 0; round < 3; round += 1) {
      const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      cookie = (res.headers['set-cookie']?.[0] || '').split(';')[0];
    }
  });

  // 改了密碼（登入版本加一）：其他裝置的續期 token 不能再換出新的 access token
  it('rejects a refresh token issued before the auth version changed', async () => {
    const employee = makeEmployee();
    const app = buildApp();
    const { cookie } = await loginCookie(app);
    employee.authVersion = 1;
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect([...mockRefreshTokens.values()].every((token) => token.revokedAt)).toBe(true);
  });

  // access token 過期被清掉後才按登出：只帶續期 cookie 也要作廢，不然登出後還能續期回來
  it('logout without a bearer token still revokes the refresh cookie', async () => {
    makeEmployee();
    const app = buildApp();
    const { cookie } = await loginCookie(app);
    const logoutRes = await request(app).post('/api/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);
    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(401);
  });

  it('logout with an expired bearer token still revokes the refresh cookie', async () => {
    makeEmployee();
    const app = buildApp();
    const { cookie } = await loginCookie(app);
    const jwt = (await import('jsonwebtoken')).default;
    const expired = jwt.sign({ id: 'x', role: 'employee' }, process.env.JWT_SECRET, {
      issuer: 'hr-system', audience: 'hr-system-api', expiresIn: -10,
    });
    const logoutRes = await request(app).post('/api/logout').set('Authorization', `Bearer ${expired}`).set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);
    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(401);
  });

  it('logout with neither bearer nor cookie is still 401', async () => {
    const res = await request(buildApp()).post('/api/logout');
    expect(res.status).toBe(401);
  });
});
