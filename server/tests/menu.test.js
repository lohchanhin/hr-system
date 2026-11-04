import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import { createFakeOtherControlSettingModel } from './helpers/fakeOtherControlSettingModel.js';

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
// 排班權限模式存在其他控制設定：用記憶體版的 model，才能切換「主管與排班人員」與預設的「只有排班人員」
const fakeSettings = createFakeOtherControlSettingModel();
jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: fakeSettings }));

let app;
let menuRoutes;
let authenticate;
let scheduleAccessService;
let settingsStore;

beforeAll(async () => {
  ({ authenticate } = await import('../src/middleware/auth.js'));
  menuRoutes = (await import('../src/routes/menuRoutes.js')).default;
  scheduleAccessService = await import('../src/services/scheduleAccessService.js');
  settingsStore = await import('../src/services/otherControlSettingsStore.js');
  app = express();
  app.use('/api/menu', authenticate, menuRoutes);
});

beforeEach(async () => {
  mockUser = { role: 'employee', id: 'emp-1' };
  findByIdMock.mockReset();
  fakeSettings.__clear();
  await settingsStore.resetSettings();
});

const supervisorPreference = (includeSelf) => findByIdMock.mockReturnValue({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue({ schedulePreferences: { includeSelf } })
  })
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

  // 下面兩個是「主管與排班人員都能排班」模式（2026/11 以前的預設，現在要由管理員明確存成這個模式）：主管有排班管理，
  // 「我的排班」依排班頁的「包含自己」決定
  it('supervisor includeSelf=true 時會顯示 MySchedule', async () => {
    await scheduleAccessService.setScheduleAccessMode('supervisor_and_scheduler');
    mockUser = { role: 'supervisor', id: 'sup-1' };
    supervisorPreference(true);

    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(res.body.find(i => i.name === 'Schedule')).toBeDefined();
    expect(res.body.filter(i => i.name === 'MySchedule')).toHaveLength(1);
  });

  it('supervisor includeSelf=false 時不顯示 MySchedule', async () => {
    await scheduleAccessService.setScheduleAccessMode('supervisor_and_scheduler');
    mockUser = { role: 'supervisor', id: 'sup-1' };
    supervisorPreference(false);

    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(res.body.find(i => i.name === 'Schedule')).toBeDefined();
    expect(res.body.find(i => i.name === 'MySchedule')).toBeUndefined();
  });

  it('預設（只有排班人員能排班）：沒被指定的主管沒有排班管理，改有我的排班，部門報表與簽核照舊', async () => {
    mockUser = { role: 'supervisor', id: 'sup-1' };
    supervisorPreference(false);

    const res = await request(app).get('/api/menu');
    expect(res.status).toBe(200);
    expect(res.body.map(i => i.name)).toEqual([
      'Attendance', 'MySchedule', 'FrontDepartmentReports', 'Approval', 'FrontChangePassword'
    ]);

    // 排班頁勾過「包含自己」的舊設定也不會多一個我的排班
    supervisorPreference(true);
    const again = await request(app).get('/api/menu');
    expect(again.body.filter(i => i.name === 'MySchedule')).toHaveLength(1);
  });

  it('讀不到排班權限時主管不顯示排班管理（fail closed），仍看得到自己的班表', async () => {
    await scheduleAccessService.setScheduleAccessMode('supervisor_and_scheduler');
    fakeSettings.__breakReads(new Error('db down'));
    mockUser = { role: 'supervisor', id: 'sup-1' };
    supervisorPreference(false);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/menu');
    spy.mockRestore();
    fakeSettings.__clear();
    expect(res.status).toBe(200);
    expect(res.body.map(i => i.name)).not.toContain('Schedule');
    expect(res.body.map(i => i.name)).toContain('MySchedule');
  });

  it('menu names exist in frontend routes', async () => {
    const res = await request(app).get('/api/menu');
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const routerPath = path.resolve(__dirname, '../../client/src/router/index.js');
    const content = fs.readFileSync(routerPath, 'utf-8');
    const matches = Array.from(content.matchAll(/name:\s*'([^']+)'/g)).map(m => m[1]);
    res.body.forEach(item => {
      expect(matches).toContain(item.name);
    });
  });
});
