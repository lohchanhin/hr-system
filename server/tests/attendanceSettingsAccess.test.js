import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const sort = jest.fn();
const find = jest.fn();
const findById = jest.fn();
const findByIdAndUpdate = jest.fn();

jest.unstable_mockModule('../src/models/AttendanceManagementSetting.js', () => ({
  default: {
    find,
    findById,
    findByIdAndUpdate,
    findByIdAndDelete: jest.fn(),
  },
}));

let app;
let authorizeRoles;
let attendanceSettingRoutes;

beforeAll(async () => {
  ({ authorizeRoles } = await import('../src/middleware/auth.js'));
  attendanceSettingRoutes = (await import('../src/routes/attendanceSettingRoutes.js')).default;

  app = express();
  app.use(express.json());
  // 模擬已驗證的管理員
  app.use((req, res, next) => {
    req.user = { role: 'admin' };
    next();
  });
  app.use('/api/attendance-settings', authorizeRoles('admin'), attendanceSettingRoutes);
});

beforeEach(() => {
  find.mockImplementation(() => ({ sort }));
  sort.mockResolvedValue([
    {
      _id: '65f9e8a5f5d2c2a1b1234567',
      enableImport: true,
    },
  ]);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Attendance management settings routes', () => {
  it('允許管理員取得考勤管理設定列表', async () => {
    const res = await request(app).get('/api/attendance-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        _id: '65f9e8a5f5d2c2a1b1234567',
        enableImport: true,
      },
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('允許管理員更新指定設定', async () => {
    const payload = { enableImport: false };
    const updated = { _id: '65f9e8a5f5d2c2a1b1234567', enableImport: false };
    findByIdAndUpdate.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/attendance-settings/65f9e8a5f5d2c2a1b1234567')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      '65f9e8a5f5d2c2a1b1234567',
      payload,
      expect.objectContaining({ new: true, runValidators: true })
    );
  });

  it('回報不正確的編號格式', async () => {
    const res = await request(app).get('/api/attendance-settings/not-a-valid-id');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '設定編號格式不正確' });
    expect(findById).not.toHaveBeenCalled();
  });
});
