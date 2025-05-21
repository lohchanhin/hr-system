import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'

const BlacklistedToken = { create: jest.fn(), findOne: jest.fn() };

jest.mock('../src/models/BlacklistedToken.js', () => ({ default: BlacklistedToken }), { virtual: true });

let blacklistUtils;
let authenticate;

beforeEach(async () => {
  process.env.JWT_SECRET = 'secret';
  jest.resetModules();
  blacklistUtils = await import('../src/utils/tokenBlacklist.js');
  ({ authenticate } = await import('../src/middleware/auth.js'));
  BlacklistedToken.create.mockReset();
  BlacklistedToken.findOne.mockReset();
});

test('blacklisted token rejected after server restart', async () => {
  const token = jwt.sign({ id: 1 }, 'secret', { expiresIn: '1h' });
  BlacklistedToken.create.mockResolvedValue();
  await blacklistUtils.blacklistToken(token);

  jest.resetModules();
  blacklistUtils = await import('../src/utils/tokenBlacklist.js');
  ({ authenticate } = await import('../src/middleware/auth.js'));
  BlacklistedToken.findOne.mockResolvedValue({ token, expiresAt: new Date(Date.now() + 3600000) });

  const app = express();
  app.get('/protected', authenticate, (req, res) => res.sendStatus(200));

  const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
});
