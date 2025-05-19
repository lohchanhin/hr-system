import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

jest.mock('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => { req.user = { role: 'employee' }; next(); },
  authorizeRoles: () => (req, res, next) => next()
}), { virtual: true });

let app;
let menuRoutes;

beforeAll(async () => {
  menuRoutes = (await import('../src/routes/menuRoutes.js')).default;
  app = express();
  app.use('/api/menu', menuRoutes);
});

describe('Menu API', () => {
  it('returns menu for employee role', async () => {
    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(i => i.name === 'attendance')).toBeDefined();
  });
});
