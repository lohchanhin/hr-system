// 排班權限（scheduleAccessService）：管理員、主管（排班權限模式允許時）、小單位的排班人員（任何角色）、
// 部門的「排班管理者」（舊欄位 deptManager，整個部門）；範圍取聯集；小單位的「使用班別」。
import { jest } from '@jest/globals';
import { createFakeOtherControlSettingModel } from './helpers/fakeOtherControlSettingModel.js';

const oid = (n) => n.toString(16).padStart(24, '0');
const ID = {
  admin: oid(1), boss: oid(2), nurseA: oid(3), nurseB: oid(4), nurseC: oid(5), clerk: oid(6), scheduler: oid(7), lonely: oid(8),
  deptA: oid(100), deptB: oid(101), deptC: oid(102),
  unitA1: oid(200), unitA2: oid(201), unitB1: oid(202), unitC1: oid(203),
};

// 員工：nurseA／nurseB 在 A1（主管 boss）、nurseC 在 B1、clerk 在 C 部門沒有小單位、scheduler 是員工角色、在 A2
const EMPLOYEES = [
  { _id: ID.boss, department: ID.deptA, subDepartment: ID.unitA1 },
  { _id: ID.nurseA, department: ID.deptA, subDepartment: ID.unitA1, supervisor: ID.boss },
  { _id: ID.nurseB, department: ID.deptA, subDepartment: ID.unitA1, supervisor: ID.boss },
  { _id: ID.nurseC, department: ID.deptB, subDepartment: ID.unitB1 },
  { _id: ID.clerk, department: ID.deptC, subDepartment: null },
  { _id: ID.scheduler, department: ID.deptA, subDepartment: ID.unitA2 },
];
let units;
let departments;

const chain = (rows) => {
  const query = { select: jest.fn(() => query), lean: jest.fn(async () => rows) };
  return query;
};
const matchesIn = (value, condition) => (condition?.$in ? condition.$in.map(String).includes(String(value)) : String(value) === String(condition));
const mockSubDepartment = {
  find: jest.fn((query = {}) => chain(units.filter((unit) => (
    (query.schedulers === undefined || (unit.schedulers || []).map(String).includes(String(query.schedulers)))
    && (query.department === undefined || matchesIn(unit.department, query.department))
    && (query._id === undefined || matchesIn(unit._id, query._id))
  )))),
  distinct: jest.fn(async (field) => units.flatMap((unit) => unit[field] || [])),
};
const mockDepartment = {
  find: jest.fn((query = {}) => chain(departments.filter((dept) => dept.deptManager === query.deptManager))),
  countDocuments: jest.fn(async () => departments.filter((dept) => dept.deptManager).length),
  distinct: jest.fn(async (field) => departments.map((dept) => dept[field])),
};
const mockEmployee = {
  find: jest.fn((query = {}) => {
    const clauses = query.$or || [query];
    return chain(EMPLOYEES.filter((employee) => clauses.some((clause) => Object.entries(clause)
      .every(([key, condition]) => matchesIn(employee[key], condition)))));
  }),
  countDocuments: jest.fn(async () => 0),
};
const fakeSettings = createFakeOtherControlSettingModel();

jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: fakeSettings }));

const service = await import('../src/services/scheduleAccessService.js');
const { resetSettings } = await import('../src/services/otherControlSettingsStore.js');

beforeEach(async () => {
  jest.clearAllMocks();
  await resetSettings();
  units = [
    { _id: ID.unitA1, name: 'A1 病房', department: ID.deptA, schedulers: [], allowedShiftIds: [] },
    { _id: ID.unitA2, name: 'A2 病房', department: ID.deptA, schedulers: [], allowedShiftIds: ['day', 'rest'] },
    { _id: ID.unitB1, name: 'B1 病房', department: ID.deptB, schedulers: [], allowedShiftIds: ['night'] },
    { _id: ID.unitC1, name: 'C1 門診', department: ID.deptC, schedulers: [] },
  ];
  departments = [
    { _id: ID.deptA, deptManager: '' },
    { _id: ID.deptB, deptManager: '' },
    { _id: ID.deptC, deptManager: '' },
  ];
});

const sorted = (list) => [...list].map(String).sort();

describe('getScheduleAccess', () => {
  it('gives an administrator everything without asking the database', async () => {
    const access = await service.getScheduleAccess({ id: ID.admin, role: 'admin' });
    expect(access).toMatchObject({ canSchedule: true, isAdmin: true, employeeIds: [] });
    expect(mockSubDepartment.find).not.toHaveBeenCalled();
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });

  it('gives an employee without an assignment no schedule access (they still only see themselves elsewhere)', async () => {
    const access = await service.getScheduleAccess({ id: ID.lonely, role: 'employee' });
    expect(access).toMatchObject({ canSchedule: false, supervisorScope: false, employeeIds: [], subDepartmentIds: [] });
  });

  it('lets an employee-role scheduler of two units in different departments schedule exactly those employees', async () => {
    units[0].schedulers = [ID.scheduler];
    units[2].schedulers = [ID.scheduler];
    const access = await service.getScheduleAccess({ id: ID.scheduler, role: 'employee' });
    expect(access.canSchedule).toBe(true);
    expect(access.supervisorScope).toBe(false);
    expect(sorted(access.subDepartmentIds)).toEqual(sorted([ID.unitA1, ID.unitB1]));
    expect(sorted(access.departmentIds)).toEqual(sorted([ID.deptA, ID.deptB]));
    expect(access.wholeDepartmentIds).toEqual([]);
    // 自己在 A2，不是被指定的小單位，所以不在可以排的範圍內
    expect(sorted(access.employeeIds)).toEqual(sorted([ID.boss, ID.nurseA, ID.nurseB, ID.nurseC]));
  });

  it('treats the legacy department schedule manager (deptManager) as a scheduler of the whole department, including employees without a unit', async () => {
    departments[2].deptManager = ID.scheduler;
    const access = await service.getScheduleAccess({ id: ID.scheduler, role: 'employee' });
    expect(access.canSchedule).toBe(true);
    expect(access.wholeDepartmentIds).toEqual([ID.deptC]);
    expect(access.subDepartmentIds).toEqual([ID.unitC1]);
    expect(access.departmentIds).toEqual([ID.deptC]);
    expect(access.employeeIds).toEqual([ID.clerk]);
  });

  // 2026/11 起的預設（以前的預設是 supervisor_and_scheduler，這個案例原本測「預設維持主管範圍」，改成要明確存成那個模式）
  it('keeps the supervisor scope (self and direct reports) when supervisor_and_scheduler is saved, and adds assigned units on top', async () => {
    await service.setScheduleAccessMode('supervisor_and_scheduler');
    const plain = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(plain).toMatchObject({ canSchedule: true, supervisorScope: true, mode: 'supervisor_and_scheduler' });
    expect(sorted(plain.employeeIds)).toEqual(sorted([ID.boss, ID.nurseA, ID.nurseB]));

    units[2].schedulers = [ID.boss];
    const withUnit = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(sorted(withUnit.employeeIds)).toEqual(sorted([ID.boss, ID.nurseA, ID.nurseB, ID.nurseC]));
    expect(withUnit.subDepartmentIds).toEqual([ID.unitB1]);
  });

  it('by default (nothing saved) a supervisor without an assignment cannot schedule; with an assignment only the units count', async () => {
    const cut = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(cut).toMatchObject({ canSchedule: false, supervisorScope: false, mode: 'scheduler_only', employeeIds: [] });

    units[2].schedulers = [ID.boss];
    const scheduler = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(scheduler).toMatchObject({ canSchedule: true, supervisorScope: false });
    expect(scheduler.employeeIds).toEqual([ID.nurseC]);
  });

  it('cuts supervisors off in scheduler_only mode: only their scheduler assignments count', async () => {
    await service.setScheduleAccessMode('scheduler_only');
    const cut = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(cut).toMatchObject({ canSchedule: false, supervisorScope: false, mode: 'scheduler_only', employeeIds: [] });

    units[2].schedulers = [ID.boss];
    const scheduler = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(scheduler.canSchedule).toBe(true);
    expect(scheduler.supervisorScope).toBe(false);
    expect(scheduler.employeeIds).toEqual([ID.nurseC]);
  });

  it('refuses unknown roles and missing users', async () => {
    expect((await service.getScheduleAccess({ id: ID.boss, role: 'guest' })).canSchedule).toBe(false);
    expect((await service.getScheduleAccess(null)).canSchedule).toBe(false);
  });
});

describe('schedule access mode setting', () => {
  // 預設從 supervisor_and_scheduler 改成 scheduler_only（2026/11 客戶：主管帳號與排班功能切開）
  it('defaults to scheduler_only, respects an explicitly saved supervisor_and_scheduler, normalises unknown values and rejects bad input', async () => {
    expect(service.DEFAULT_SCHEDULE_ACCESS_MODE).toBe('scheduler_only');
    expect(await service.getScheduleAccessMode()).toBe('scheduler_only');
    expect(await service.getScheduleAccessModeState()).toEqual({ mode: 'scheduler_only', saved: false });
    expect(service.normalizeScheduleAccessMode('anything')).toBe('scheduler_only');
    expect(service.normalizeScheduleAccessMode('supervisor_and_scheduler')).toBe('supervisor_and_scheduler');
    expect(await service.setScheduleAccessMode('supervisor_and_scheduler')).toBe('supervisor_and_scheduler');
    expect(await service.getScheduleAccessModeState()).toEqual({ mode: 'supervisor_and_scheduler', saved: true });
    expect(await service.setScheduleAccessMode('scheduler_only')).toBe('scheduler_only');
    expect(await service.getScheduleAccessModeState()).toEqual({ mode: 'scheduler_only', saved: true });
    await expect(service.setScheduleAccessMode('nobody')).rejects.toBeInstanceOf(service.ScheduleAccessSettingError);
    expect(await service.getScheduleAccessMode()).toBe('scheduler_only');
  });

  it('describes the effective mode for the startup log, counting the supervisors without a scheduler assignment', async () => {
    mockEmployee.countDocuments.mockResolvedValueOnce(3);
    units[0].schedulers = [ID.scheduler];
    departments[1].deptManager = ID.boss;
    expect(await service.describeScheduleAccessForStartup()).toEqual({ mode: 'scheduler_only', saved: false, supervisorsWithoutAssignment: 3 });
    expect(mockEmployee.countDocuments).toHaveBeenCalledWith({ role: 'supervisor', _id: { $nin: [ID.scheduler, ID.boss] } });

    await service.setScheduleAccessMode('supervisor_and_scheduler');
    mockEmployee.countDocuments.mockClear();
    expect(await service.describeScheduleAccessForStartup()).toEqual({ mode: 'supervisor_and_scheduler', saved: true, supervisorsWithoutAssignment: null });
    expect(mockEmployee.countDocuments).not.toHaveBeenCalled();
  });
});

// 資料庫斷線時一律取最嚴格的結果（以前斷線時當作預設的「主管與排班人員」、沒有指派、小單位不限班別：fail open）
describe('while the database is disconnected', () => {
  afterEach(() => {
    delete fakeSettings.db;
    delete mockSubDepartment.db;
    delete mockDepartment.db;
  });

  it('fails closed: a saved supervisor_and_scheduler is not used, assignments count as none, and shift checks refuse to run', async () => {
    await service.setScheduleAccessMode('supervisor_and_scheduler');
    units[2].schedulers = [ID.scheduler];
    fakeSettings.db = { readyState: 0 };
    mockSubDepartment.db = { readyState: 0 };
    mockDepartment.db = { readyState: 0 };

    const boss = await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' });
    expect(boss).toMatchObject({ canSchedule: false, supervisorScope: false, mode: 'scheduler_only' });
    expect((await service.getScheduleAccess({ id: ID.scheduler, role: 'employee' })).canSchedule).toBe(false);
    expect(mockSubDepartment.find).not.toHaveBeenCalled();

    await expect(service.findDisallowedShiftAssignments([{ employee: ID.nurseC, shiftId: 'day' }]))
      .rejects.toMatchObject({ status: 503, code: 'SCHEDULE_ACCESS_UNAVAILABLE' });
    await expect(service.loadUnitShiftRules([ID.unitB1])).rejects.toBeInstanceOf(service.ScheduleAccessUnavailableError);

    // 連線回來就照常
    delete fakeSettings.db;
    delete mockSubDepartment.db;
    delete mockDepartment.db;
    expect((await service.getScheduleAccess({ id: ID.boss, role: 'supervisor' })).canSchedule).toBe(true);
    expect(await service.findDisallowedShiftAssignments([{ employee: ID.nurseC, shiftId: 'day' }])).toHaveLength(1);
  });
});

describe('buildScheduleViewEmployeeFilter (schedule page list and its 排班員工數)', () => {
  it('builds the same filter for the list and the summary card', () => {
    const none = { canSchedule: false };
    expect(service.buildScheduleViewEmployeeFilter(none, ID.lonely, 'employee')).toEqual({ _id: ID.lonely });
    const boss = { canSchedule: true, supervisorScope: true, subDepartmentIds: [], wholeDepartmentIds: [] };
    expect(service.buildScheduleViewEmployeeFilter(boss, ID.boss, 'supervisor')).toEqual({ supervisor: ID.boss });
    expect(service.buildScheduleViewEmployeeFilter(boss, ID.boss, 'supervisor', true)).toEqual({ $or: [{ _id: ID.boss }, { supervisor: ID.boss }] });
    const scheduler = { canSchedule: true, supervisorScope: false, subDepartmentIds: [ID.unitA1], wholeDepartmentIds: [ID.deptC] };
    expect(service.buildScheduleViewEmployeeFilter(scheduler, ID.scheduler, 'employee')).toEqual({
      $or: [{ subDepartment: { $in: [ID.unitA1] } }, { department: { $in: [ID.deptC] } }],
    });
    expect(service.buildScheduleViewEmployeeFilter(scheduler, ID.boss, 'supervisor')).toEqual({
      $and: [{ $or: [{ subDepartment: { $in: [ID.unitA1] } }, { department: { $in: [ID.deptC] } }] }, { _id: { $ne: ID.boss } }],
    });
  });
});

describe('request memo and per-employee checks', () => {
  it('asks the database once per request even when the scope is checked several times', async () => {
    units[0].schedulers = [ID.scheduler];
    const req = { user: { id: ID.scheduler, role: 'employee' } };
    const [first, second] = await Promise.all([service.getScheduleAccessForRequest(req), service.getScheduleAccessForRequest(req)]);
    await service.getScheduleAccessSummaryForRequest(req);
    expect(first).toBe(second);
    expect(mockSubDepartment.find).toHaveBeenCalledTimes(1);
  });

  it('checks one employee record against the scope without listing everybody', async () => {
    await service.setScheduleAccessMode('supervisor_and_scheduler');
    units[2].schedulers = [ID.scheduler];
    const access = await service.getScheduleAccessSummary({ id: ID.scheduler, role: 'employee' });
    expect(service.isEmployeeInScheduleScope(access, ID.scheduler, EMPLOYEES[3])).toBe(true);
    expect(service.isEmployeeInScheduleScope(access, ID.scheduler, EMPLOYEES[1])).toBe(false);
    const boss = await service.getScheduleAccessSummary({ id: ID.boss, role: 'supervisor' });
    expect(service.isEmployeeInScheduleScope(boss, ID.boss, EMPLOYEES[1])).toBe(true);
    expect(service.isEmployeeInScheduleScope(boss, ID.boss, EMPLOYEES[0])).toBe(true);
    expect(service.isEmployeeInScheduleScope(boss, ID.boss, EMPLOYEES[3])).toBe(false);
  });
});

describe('使用班別 of a unit', () => {
  it('returns the union of the units, or everything (empty) as soon as one unit has no selection', async () => {
    expect(await service.getAllowedShiftIdsFor({ subDepartmentIds: [ID.unitA2] })).toEqual(['day', 'rest']);
    expect(sorted(await service.getAllowedShiftIdsFor({ subDepartmentIds: [ID.unitA2, ID.unitB1] }))).toEqual(['day', 'night', 'rest']);
    expect(await service.getAllowedShiftIdsFor({ subDepartmentIds: [ID.unitA2, ID.unitA1] })).toEqual([]);
    expect(await service.getAllowedShiftIdsFor({ subDepartmentIds: [ID.unitC1] })).toEqual([]);
    expect(await service.getAllowedShiftIdsFor({ subDepartmentIds: [] })).toEqual([]);
  });

  it('finds schedules whose shift is not open for the unit: the schedule unit wins, otherwise the employee unit', async () => {
    const disallowed = await service.findDisallowedShiftAssignments([
      { employee: ID.scheduler, shiftId: 'night' },
      { employee: ID.scheduler, shiftId: 'day' },
      { employee: ID.nurseA, shiftId: 'night' },
      { employee: ID.nurseA, shiftId: 'day', subDepartment: ID.unitB1 },
      { employee: ID.nurseC, shiftId: '' },
    ]);
    expect(disallowed).toEqual([
      { employee: ID.scheduler, shiftId: 'night', subDepartment: ID.unitA2, subDepartmentName: 'A2 病房' },
      { employee: ID.nurseA, shiftId: 'day', subDepartment: ID.unitB1, subDepartmentName: 'B1 病房' },
    ]);
  });
});

describe('startup log', () => {
  it('counts the departments with a schedule manager', async () => {
    departments[1].deptManager = ID.boss;
    expect(await service.countLegacyDeptManagers()).toBe(1);
  });
});
