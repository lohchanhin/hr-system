// 排班人員（R1）：小單位設定的「排班人員」任何角色都能排該單位的班，主管欄位只作為簽核；
// 其他控制設定 scheduleAccessMode 可以把主管切開；小單位的「使用班別」（R3）限制非管理員排的班別；
// 部門的「使用簽核表單」（R2）存檔；選單、個人資料（K3）帶出排班權限。
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createFakeOtherControlSettingModel } from './helpers/fakeOtherControlSettingModel.js';
import { buildLeaveFieldServiceMock } from './helpers/leaveFieldServiceMock.js';

const oid = (n) => n.toString(16).padStart(24, '0');
const ID = {
  admin: oid(1), boss: oid(2), nurseA: oid(3), nurseB: oid(4), nurseC: oid(5), outsider: oid(6), scheduler: oid(7), plain: oid(8),
  deptA: oid(100), deptB: oid(101), unitA1: oid(200), unitA2: oid(201), unitB1: oid(202),
  formLeave: oid(300), formOvertime: oid(301),
};
const SHIFT = { day: oid(400), night: oid(401), rest: oid(402) };

/* ------------------------------ 記憶體資料 ------------------------------ */
let employees;
let units;
let departments;
let schedules;

const resetData = () => {
  employees = [
    { _id: ID.admin, name: '管理員', role: 'admin', department: null, subDepartment: null },
    { _id: ID.boss, name: '主管', role: 'supervisor', department: ID.deptA, subDepartment: ID.unitA1 },
    { _id: ID.nurseA, name: '護理甲', role: 'employee', department: ID.deptA, subDepartment: ID.unitA1, supervisor: ID.boss },
    { _id: ID.nurseB, name: '護理乙', role: 'employee', department: ID.deptA, subDepartment: ID.unitA2, supervisor: ID.boss },
    { _id: ID.nurseC, name: '護理丙', role: 'employee', department: ID.deptB, subDepartment: ID.unitB1 },
    { _id: ID.outsider, name: '外人', role: 'employee', department: ID.deptB, subDepartment: null },
    // 排班人員：員工角色，自己屬於 A2，被指定為 A1 與 B1（不同部門）的排班人員
    { _id: ID.scheduler, name: '排班員', role: 'employee', department: ID.deptA, subDepartment: ID.unitA2 },
    { _id: ID.plain, name: '一般員工', role: 'employee', department: ID.deptA, subDepartment: ID.unitA1, status: '離職員工' },
  ];
  units = [
    { _id: ID.unitA1, name: 'A1 病房', department: ID.deptA, schedulers: [ID.scheduler], allowedShiftIds: [] },
    { _id: ID.unitA2, name: 'A2 病房', department: ID.deptA, schedulers: [], allowedShiftIds: [] },
    { _id: ID.unitB1, name: 'B1 病房', department: ID.deptB, schedulers: [ID.scheduler], allowedShiftIds: [SHIFT.night, SHIFT.rest] },
  ];
  departments = [
    { _id: ID.deptA, name: 'A 部門', deptManager: '' },
    { _id: ID.deptB, name: 'B 部門', deptManager: '' },
  ];
  schedules = [];
};

const valueMatches = (value, condition) => {
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    if (condition.$in) return condition.$in.map(String).includes(String(value));
    if (condition.$ne !== undefined) return String(value) !== String(condition.$ne);
    if (condition.$nin) return !condition.$nin.map((item) => (item === null ? 'null' : String(item))).includes(String(value ?? 'null'));
  }
  if (condition instanceof RegExp) return condition.test(String(value ?? ''));
  if (Array.isArray(value)) return value.map(String).includes(String(condition));
  return String(value ?? '') === String(condition ?? '');
};
const matches = (doc, filter = {}) => Object.entries(filter).every(([key, condition]) => {
  if (key === '$or') return condition.some((clause) => matches(doc, clause));
  if (key === '$and') return condition.every((clause) => matches(doc, clause));
  return valueMatches(doc[key], condition);
});
const query = (rows) => {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => rows),
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
};

const mockEmployee = {
  find: jest.fn((filter) => query(employees.filter((employee) => matches(employee, filter)))),
  findById: jest.fn((id) => {
    const found = employees.find((employee) => String(employee._id) === String(id));
    const doc = found ? { ...found, populate: async () => doc, toObject: () => ({ ...found }) } : null;
    return query(doc);
  }),
  exists: jest.fn(async (filter) => employees.some((employee) => matches(employee, filter))),
  countDocuments: jest.fn(async (filter) => employees.filter((employee) => matches(employee, filter)).length),
};
const mockSubDepartment = Object.assign(
  jest.fn((data) => ({ ...data, save: jest.fn(async () => undefined), toObject: () => ({ ...data }) })),
  {
    find: jest.fn((filter) => query(units.filter((unit) => matches(unit, filter)))),
    findByIdAndUpdate: jest.fn(async (id, update) => {
      const unit = units.find((item) => item._id === id);
      if (!unit) return null;
      Object.assign(unit, update);
      return { ...unit };
    }),
  },
);
const mockDepartment = Object.assign(
  jest.fn((data) => ({ ...data, save: jest.fn(async () => undefined) })),
  {
    find: jest.fn((filter) => query(departments.filter((dept) => matches(dept, filter)))),
    findOne: jest.fn(async () => null),
    findByIdAndUpdate: jest.fn(async (id, update) => {
      const dept = departments.find((item) => item._id === id);
      if (!dept) return null;
      Object.assign(dept, Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)));
      return { ...dept };
    }),
  },
);
const mockFormTemplate = {
  find: jest.fn((filter) => query([{ _id: ID.formLeave }, { _id: ID.formOvertime }].filter((form) => matches(form, filter)))),
};
const mockShiftSchedule = {
  find: jest.fn((filter) => query(schedules.filter((schedule) => matches(schedule, filter)))),
  findOne: jest.fn(async () => null),
  findById: jest.fn(async () => null),
  create: jest.fn(async (data) => ({ _id: oid(900), ...data })),
  bulkWrite: jest.fn(async () => ({ acknowledged: true })),
};
const mockAttendanceSetting = {
  findOne: jest.fn(() => query({
    shifts: [
      { _id: SHIFT.day, code: 'D', name: '白班', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
      { _id: SHIFT.night, code: 'N', name: '大夜', semanticType: 'work', startTime: '00:00', endTime: '08:00' },
      { _id: SHIFT.rest, code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
    ],
  })),
};
const mockApprovalRequest = { find: jest.fn(() => query([])), findOne: jest.fn(async () => null), exists: jest.fn(async () => null) };
const fakeSettings = createFakeOtherControlSettingModel();
const mockGetLeaveFieldIds = jest.fn(async () => null);

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: fakeSettings }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => buildLeaveFieldServiceMock(mockGetLeaveFieldIds));
jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
  assertScheduleRuleCompliance: jest.fn(async () => ({ ok: true, violations: [] })),
  isLaborRuleValidationError: jest.fn(() => false),
}));

let currentUser;
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { ...currentUser };
    return next();
  },
  authorizeRoles: (...roles) => (req, res, next) => (
    req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' })
  ),
}));

const { authenticate, authorizeRoles } = await import('../src/middleware/auth.js');
const { requireScheduleAccess } = await import('../src/middleware/scheduleAccess.js');
const { default: scheduleRoutes } = await import('../src/routes/scheduleRoutes.js');
const { default: employeeRoutes } = await import('../src/routes/employeeRoutes.js');
const { default: subDepartmentRoutes } = await import('../src/routes/subDepartmentRoutes.js');
const { default: departmentRoutes } = await import('../src/routes/departmentRoutes.js');
const { default: deptManagerRoutes } = await import('../src/routes/deptManagerRoutes.js');
const { default: menuRoutes } = await import('../src/routes/menuRoutes.js');
const { default: authRoutes } = await import('../src/routes/authRoutes.js');
const { default: otherControlSettingRoutes } = await import('../src/routes/otherControlSettingRoutes.js');
const { resetSettings } = await import('../src/services/otherControlSettingsStore.js');

// 與 src/index.js 相同的掛載方式（排班的寫入看排班權限、小單位清單排班人員可以讀）
const app = express();
app.use(express.json());
app.use('/api', authRoutes);
app.use('/api/schedules', authenticate, (req, res, next) => (
  req.method === 'GET' ? next() : requireScheduleAccess()(req, res, next)
), scheduleRoutes);
app.use('/api/employees', authenticate, employeeRoutes);
app.use('/api/sub-departments', authenticate, (req, res, next) => (
  req.method === 'GET'
    ? requireScheduleAccess({ allowRoles: ['admin', 'supervisor'] })(req, res, next)
    : authorizeRoles('admin')(req, res, next)
), subDepartmentRoutes);
app.use('/api/departments', authenticate, departmentRoutes);
app.use('/api/dept-managers', authenticate, authorizeRoles('admin'), deptManagerRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/other-control-settings', authenticate, authorizeRoles('admin'), otherControlSettingRoutes);

const loginAs = (key) => {
  const employee = employees.find((item) => item._id === ID[key]);
  currentUser = { id: employee._id, role: employee.role };
};
const namesOf = (list) => list.map((employee) => employee.name).sort();
const monthUrl = (query) => `/api/schedules/monthly?month=2026-11&${query}`;

beforeEach(async () => {
  resetData();
  jest.clearAllMocks();
  await resetSettings();
  loginAs('admin');
});

describe('an employee-role scheduler of two units in different departments', () => {
  it('sees exactly the employees of those units on the schedule page', async () => {
    loginAs('scheduler');
    const a1 = await request(app).get(`/api/employees/schedule?department=${ID.deptA}&subDepartment=${ID.unitA1}`);
    expect(a1.status).toBe(200);
    expect(namesOf(a1.body)).toEqual(['一般員工', '主管', '護理甲']);

    const b1 = await request(app).get(`/api/employees/schedule?department=${ID.deptB}&subDepartment=${ID.unitB1}`);
    expect(namesOf(b1.body)).toEqual(['護理丙']);

    // 自己的小單位（A2）沒有被指定：不列出，也不會看到 A2 的同事
    const a2 = await request(app).get(`/api/employees/schedule?department=${ID.deptA}&subDepartment=${ID.unitA2}`);
    expect(a2.body).toEqual([]);
    const all = await request(app).get('/api/employees/schedule');
    expect(namesOf(all.body)).toEqual(['一般員工', '主管', '護理丙', '護理甲']);
  });

  it('reads the monthly roster of the scope and is refused for anyone else', async () => {
    loginAs('scheduler');
    expect((await request(app).get(monthUrl(`employee=${ID.nurseC}`))).status).toBe(200);
    expect((await request(app).get(monthUrl(`employeeIds=${ID.nurseA},${ID.nurseC}`))).status).toBe(200);
    expect((await request(app).get(monthUrl(`employee=${ID.nurseB}`))).status).toBe(403);
    expect((await request(app).get(monthUrl(`employee=${ID.outsider}`))).status).toBe(403);
    // 自己的班表一律看得到（我的排班）
    expect((await request(app).get(monthUrl(`employee=${ID.scheduler}`))).status).toBe(200);
  });

  it('creates schedules inside the units only, and never for themselves outside them', async () => {
    loginAs('scheduler');
    const create = (employee, shiftId = SHIFT.day) => request(app)
      .post('/api/schedules')
      .send({ employee, date: '2026-11-02', shiftId });
    expect((await create(ID.nurseA)).status).toBe(201);
    expect((await create(ID.nurseB)).status).toBe(403);
    expect((await create(ID.scheduler)).status).toBe(403);
    expect((await create(ID.outsider)).status).toBe(403);
    expect(mockShiftSchedule.create).toHaveBeenCalledTimes(1);
  });

  it('lists the sub departments for the schedule filters, while a plain employee may not', async () => {
    loginAs('scheduler');
    expect((await request(app).get('/api/sub-departments')).status).toBe(200);
    loginAs('nurseA');
    expect((await request(app).get('/api/sub-departments')).status).toBe(403);
  });

  it('gets the 排班管理 menu entry and the schedule access in the profile', async () => {
    loginAs('scheduler');
    const menu = await request(app).get('/api/menu');
    expect(menu.body.map((item) => item.name)).toContain('Schedule');
    const profile = await request(app).get('/api/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.scheduleAccess).toMatchObject({ canSchedule: true, supervisorScope: false });
    expect([...profile.body.scheduleAccess.subDepartmentIds].sort()).toEqual([ID.unitA1, ID.unitB1].sort());
    expect([...profile.body.scheduleAccess.departmentIds].sort()).toEqual([ID.deptA, ID.deptB].sort());

    loginAs('nurseA');
    expect((await request(app).get('/api/menu')).body.map((item) => item.name)).not.toContain('Schedule');
    expect((await request(app).get('/api/profile')).body.scheduleAccess).toMatchObject({ canSchedule: false });
  });

  it('cannot publish or delete without an assignment (plain employee), but can with one', async () => {
    loginAs('nurseA');
    expect((await request(app).post('/api/schedules/publish').send({ month: '2026-11' })).status).toBe(403);
    expect((await request(app).post('/api/schedules/batch-delete').send({ ids: [oid(901)] })).status).toBe(403);
    loginAs('scheduler');
    expect((await request(app).post('/api/schedules/batch-delete').send({ ids: [oid(901)] })).status).toBe(200);
  });
});

describe('supervisors and administrators', () => {
  it('keeps the supervisor scope (direct reports) by default', async () => {
    loginAs('boss');
    const list = await request(app).get('/api/employees/schedule');
    expect(namesOf(list.body)).toEqual(['護理乙', '護理甲']);
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseB, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(201);
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseC, date: '2026-11-02', shiftId: SHIFT.night })).status).toBe(403);
  });

  it('removes supervisor-only access in scheduler_only mode (menu, page APIs, writes)', async () => {
    loginAs('admin');
    const saved = await request(app).put('/api/other-control-settings/schedule-access').send({ mode: 'scheduler_only' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ mode: 'scheduler_only', defaultMode: 'supervisor_and_scheduler' });
    expect((await request(app).put('/api/other-control-settings/schedule-access').send({ mode: 'everyone' })).status).toBe(400);
    expect((await request(app).get('/api/other-control-settings/schedule-access')).body.mode).toBe('scheduler_only');

    loginAs('boss');
    expect((await request(app).get('/api/menu')).body.map((item) => item.name)).not.toContain('Schedule');
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseB, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(403);
    expect((await request(app).get('/api/employees/schedule')).body.map((employee) => employee.name)).toEqual(['主管']);
    expect((await request(app).get(monthUrl(`employee=${ID.nurseB}`))).status).toBe(403);

    // 被指定為排班人員的主管照樣可以排被指定的小單位
    units[1].schedulers = [ID.boss];
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseB, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(201);
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseA, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(403);
  });

  it('lets an administrator see and schedule everyone', async () => {
    loginAs('admin');
    const list = await request(app).get('/api/employees/schedule');
    expect(list.body).toHaveLength(employees.length);
    expect((await request(app).post('/api/schedules').send({ employee: ID.outsider, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(201);
  });
});

describe('使用班別 of a unit (R3)', () => {
  it('refuses a shift the unit does not use for schedulers, but not for an administrator', async () => {
    loginAs('scheduler');
    const refused = await request(app).post('/api/schedules').send({ employee: ID.nurseC, date: '2026-11-02', shiftId: SHIFT.day });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'SHIFT_NOT_ALLOWED' });
    expect(refused.body.error).toContain('B1 病房');
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseC, date: '2026-11-02', shiftId: SHIFT.night })).status).toBe(201);
    // 沒有設定使用班別的小單位不限制
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseA, date: '2026-11-02', shiftId: SHIFT.night })).status).toBe(201);

    const batch = await request(app).post('/api/schedules/batch').send({
      schedules: [
        { employee: ID.nurseC, date: '2026-11-03', shiftId: SHIFT.rest },
        { employee: ID.nurseC, date: '2026-11-04', shiftId: SHIFT.day },
      ],
    });
    expect(batch.status).toBe(400);
    expect(batch.body.code).toBe('SHIFT_NOT_ALLOWED');
    expect(mockShiftSchedule.bulkWrite).not.toHaveBeenCalled();

    loginAs('admin');
    expect((await request(app).post('/api/schedules').send({ employee: ID.nurseC, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(201);
  });

  it('saves the schedulers and the shifts of a unit, checking that they exist', async () => {
    loginAs('admin');
    const saved = await request(app)
      .put(`/api/sub-departments/${ID.unitA2}`)
      .send({ name: 'A2 病房', department: ID.deptA, schedulers: [ID.nurseC, ID.nurseC, ID.boss], allowedShiftIds: [SHIFT.day] });
    expect(saved.status).toBe(200);
    expect(mockSubDepartment.findByIdAndUpdate).toHaveBeenCalledWith(
      ID.unitA2,
      expect.objectContaining({ schedulers: [ID.nurseC, ID.boss], allowedShiftIds: [SHIFT.day] }),
      { new: true },
    );
    expect((await request(app).put(`/api/sub-departments/${ID.unitA2}`).send({ schedulers: [oid(999)] })).status).toBe(400);
    expect((await request(app).put(`/api/sub-departments/${ID.unitA2}`).send({ schedulers: 'nurse' })).status).toBe(400);
    expect((await request(app).put(`/api/sub-departments/${ID.unitA2}`).send({ allowedShiftIds: ['ghost'] })).status).toBe(400);

    // 沒送的欄位不動：舊畫面只改名稱時不會清掉設定
    await request(app).put(`/api/sub-departments/${ID.unitA2}`).send({ name: 'A2' });
    expect(mockSubDepartment.findByIdAndUpdate.mock.calls.at(-1)[1]).not.toHaveProperty('schedulers');
  });
});

describe('部門設定', () => {
  it('saves the 使用簽核表單 selection and refuses unknown forms (R2)', async () => {
    loginAs('admin');
    const saved = await request(app).put(`/api/departments/${ID.deptA}`).send({ name: 'A 部門', allowedFormIds: [ID.formLeave] });
    expect(saved.status).toBe(200);
    expect(saved.body.allowedFormIds).toEqual([ID.formLeave]);
    expect((await request(app).put(`/api/departments/${ID.deptA}`).send({ allowedFormIds: [oid(998)] })).status).toBe(400);
    expect((await request(app).put(`/api/departments/${ID.deptA}`).send({ allowedFormIds: 'all' })).status).toBe(400);

    const cleared = await request(app).put(`/api/departments/${ID.deptA}`).send({ name: 'A 部門', allowedFormIds: [] });
    expect(cleared.body.allowedFormIds).toEqual([]);
  });

  it('treats the legacy 排班管理者 (deptManager) as a scheduler of the whole department', async () => {
    departments[1].deptManager = ID.nurseA;
    loginAs('nurseA');
    const list = await request(app).get('/api/employees/schedule');
    expect(namesOf(list.body)).toEqual(['外人', '護理丙']);
    expect((await request(app).post('/api/schedules').send({ employee: ID.outsider, date: '2026-11-02', shiftId: SHIFT.day })).status).toBe(201);
  });

  it('lists any employee (any role) for the 排班管理者／排班人員 pickers, flagging inactive ones', async () => {
    loginAs('admin');
    const res = await request(app).get('/api/dept-managers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(employees.length);
    expect(res.body.find((item) => item.value === ID.nurseA)).toMatchObject({ label: '護理甲', role: 'employee', active: true });
    expect(res.body.find((item) => item.value === ID.plain)).toMatchObject({ active: false });
  });
});
