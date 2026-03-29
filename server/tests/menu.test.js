import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

let mockUser = { role: 'employee', id: 'emp-1' };
const findByIdMock = jest.fn();

jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { ...mockUser };
    next();
  },
  authorizeRoles: () => (req, res, next) => next()
}));

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: {
    findById: (...args) => findByIdMock(...args)
  }
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

beforeEach(() => {
  mockUser = { role: 'employee', id: 'emp-1' };
  findByIdMock.mockReset();
});

describe('Menu API', () => {
  it('returns menu for employee role', async () => {
    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(i => i.name === 'Attendance')).toBeDefined();
    expect(res.body.find(i => i.name === 'MySchedule')).toBeDefined();
    expect(res.body.find(i => i.name === 'Approval')).toBeDefined();
    expect(res.body.find(i => i.name === 'FrontChangePassword')).toBeDefined();
  });

  it('supervisor includeSelf=true 時會顯示 MySchedule', async () => {
    mockUser = { role: 'supervisor', id: 'sup-1' };
    findByIdMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          schedulePreferences: { includeSelf: true }
        })
      })
    });

    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(res.body.find(i => i.name === 'MySchedule')).toBeDefined();
  });

  it('supervisor includeSelf=false 時不顯示 MySchedule', async () => {
    mockUser = { role: 'supervisor', id: 'sup-1' };
    findByIdMock.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          schedulePreferences: { includeSelf: false }
        })
      })
    });

    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(res.body.find(i => i.name === 'MySchedule')).toBeUndefined();
  });

  it('menu names exist in frontend routes', async () => {
    const res = await request(app).get('/api/menu');
    const fs = await import('fs');
    const path = await import('path');
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const routerPath = path.resolve(__dirname, '../../client/src/router/index.js');
    const content = fs.readFileSync(routerPath, 'utf-8');
    const matches = Array.from(content.matchAll(/name:\s*'([^']+)'/g)).map(m => m[1]);
    res.body.forEach(item => {
      expect(matches).toContain(item.name);
    });
  });
});
