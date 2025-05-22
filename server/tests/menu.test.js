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
    expect(res.body.find(i => i.name === 'Attendance')).toBeDefined();
  });

  it('menu names exist in frontend routes', async () => {
    const res = await request(app).get('/api/menu');
    const fs = await import('fs');
    const path = await import('path');
    const routerPath = path.resolve(__dirname, '../../client/src/router/index.js');
    const content = fs.readFileSync(routerPath, 'utf-8');
    const matches = Array.from(content.matchAll(/name:\s*'([^']+)'/g)).map(m => m[1]);
    res.body.forEach(item => {
      expect(matches).toContain(item.name);
    });
  });
});
