import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

let currentRole = 'employee';
let currentUserId = 'employee-id';
const shiftExistsMock = jest.fn();

jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { role: currentRole, id: currentUserId };
    next();
  },
  authorizeRoles: () => (req, res, next) => next()
}));

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({
  default: { exists: shiftExistsMock }
}));

let app;
let menuRoutes;
let authenticate;

beforeAll(async () => {
  ({ authenticate } = await import('../src/middleware/auth.js'));
  menuRoutes = (await import('../src/routes/menuRoutes.js')).default;
  app = express();
  app.use('/api/menu', authenticate, menuRoutes);
});

describe('Menu API', () => {
  beforeEach(() => {
    shiftExistsMock.mockReset();
    currentRole = 'employee';
    currentUserId = 'employee-id';
  });

  it('returns nested menu for employee role', async () => {
    currentRole = 'employee';
    shiftExistsMock.mockResolvedValue(false);
    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('group');
    const flat = res.body.flatMap(group => group.children || []);
    expect(flat.find(i => i.name === 'Attendance')).toBeDefined();
    expect(flat.find(i => i.name === 'MySchedule')).toBeDefined();
    expect(flat.find(i => i.name === 'Approval')).toBeDefined();
  });

  it('menu names exist in frontend routes', async () => {
    currentRole = 'employee';
    shiftExistsMock.mockResolvedValue(false);
    const res = await request(app).get('/api/menu');
    const fs = await import('fs');
    const path = await import('path');
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const routerPath = path.resolve(__dirname, '../../client/src/router/index.js');
    const content = fs.readFileSync(routerPath, 'utf-8');
    const matches = Array.from(content.matchAll(/name:\s*'([^']+)'/g)).map(m => m[1]);
    res.body.forEach(group => {
      group.children.forEach(item => {
        expect(matches).toContain(item.name);
      });
    });
  });

  it('adds supervisor self schedule when applicable', async () => {
    currentRole = 'supervisor';
    currentUserId = 'supervisor-id';
    shiftExistsMock.mockResolvedValue(true);
    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    const scheduleGroup = res.body.find(group => group.group === '排班管理');
    expect(scheduleGroup).toBeDefined();
    const names = scheduleGroup.children.map(item => item.name);
    expect(names).toContain('Schedule');
    expect(names).toContain('MySchedule');
  });

  it('returns admin menu groups', async () => {
    currentRole = 'admin';
    shiftExistsMock.mockResolvedValue(false);
    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(1);
    res.body.forEach(group => {
      expect(Array.isArray(group.children)).toBe(true);
      group.children.forEach(item => {
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('label');
      });
    });
  });
});
