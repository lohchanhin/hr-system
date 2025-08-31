import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const findOne = jest.fn().mockResolvedValue({ shifts: [{ name: '日班' }] });

jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({
  default: { findOne }
}));

let app;
let authorizeRoles;
let attendanceShiftRoutes;

beforeAll(async () => {
  ({ authorizeRoles } = await import('../src/middleware/auth.js'));
  attendanceShiftRoutes = (await import('../src/routes/attendanceShiftRoutes.js')).default;

  app = express();
  app.use(express.json());
  // 模擬已驗證的員工使用者
  app.use((req, res, next) => {
    req.user = { role: 'employee' };
    next();
  });
  app.use(
    '/api/attendance-settings',
    (req, res, next) => {
      if (req.method === 'GET') {
        return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
      }
      return authorizeRoles('admin')(req, res, next);
    },
    attendanceShiftRoutes
  );
});

afterEach(() => {
  findOne.mockClear();
});

describe('Attendance settings access', () => {
  it('允許員工取得班別資料', async () => {
    const res = await request(app).get('/api/attendance-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: '日班' }]);
    expect(findOne).toHaveBeenCalled();
  });
});
