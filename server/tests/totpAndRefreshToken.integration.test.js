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
  findById: jest.fn((id) => ({
    select: jest.fn(async () => mockEmployees.get(String(id)) || null),
  })),
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
  updateMany: jest.fn(async (filter, update) => {
    for (const token of mockRefreshTokens.values()) {
      if (filter.familyId && token.familyId !== filter.familyId) continue;
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

    // Reusing the old cookie triggers reuse detection and revokes the whole family
    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieValue1);
    expect(reuseRes.status).toBe(401);
    expect(mockRefreshTokenModel.updateMany).toHaveBeenCalled();
  });
});
