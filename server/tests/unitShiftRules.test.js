// 小單位的「使用班別」限制所有班別：客戶 2026/11/11 要求「全部都呈現，都要能管控」，休息日、例假、國定假日、請假
// 等不用上班的班別也一樣要選了才能用（之前的規則是這些班別一律可以用）。舊設定在啟動時一次性補上不用上班的班別
// （migrateUnitRestShiftsOnce），維持原本能排的班別。
// 新增、批次、修改班表（findDisallowedShiftAssignments）與匯入（loadUnitShiftRules + isShiftAllowedByRules）都用同一套規則。
import { jest } from '@jest/globals';

const oid = (n) => n.toString(16).padStart(24, '0');
const ID = { unitNight: oid(200), unitLegacy: oid(201), unitAll: oid(202), nurse: oid(3), legacyNurse: oid(4) };
const SHIFT = {
  day: oid(400), night: oid(401), rest: oid(402), regular: oid(403), holiday: oid(404), personal: oid(405), legacyOff: oid(406), zero: oid(407),
};
const NON_WORK = [SHIFT.rest, SHIFT.regular, SHIFT.holiday, SHIFT.personal, SHIFT.legacyOff, SHIFT.zero];

// 班別設定（AttendanceSetting.shifts）的樣子
const SHIFTS = [
  { _id: SHIFT.day, code: 'D', name: '白班', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
  { _id: SHIFT.night, code: 'N', name: '大夜', semanticType: 'work', startTime: '00:00', endTime: '08:00' },
  { _id: SHIFT.rest, code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: SHIFT.regular, code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
  { _id: SHIFT.holiday, code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
  { _id: SHIFT.personal, code: '事', name: '事假', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
  // 舊資料沒有班別性質：依代碼推斷
  { _id: SHIFT.legacyOff, code: 'OFF', name: '休假' },
  // 標成工作班卻沒有工作時間：一律當成不用上班
  { _id: SHIFT.zero, code: 'Z', name: '待命', semanticType: 'work', startTime: '00:00', endTime: '00:00' },
];
const EMPLOYEES = [
  { _id: ID.nurse, subDepartment: ID.unitNight },
  { _id: ID.legacyNurse, subDepartment: ID.unitLegacy },
];
let units;
let setting;

const chain = (rows) => {
  const query = { select: jest.fn(() => query), lean: jest.fn(async () => rows) };
  return query;
};
const inIds = (condition, value) => !condition?.$in || condition.$in.map(String).includes(String(value));
const mockSubDepartment = { find: jest.fn((query = {}) => chain(units.filter((unit) => inIds(query._id, unit._id)))) };
const mockEmployee = { find: jest.fn((query = {}) => chain(EMPLOYEES.filter((employee) => inIds(query._id, employee._id)))) };
const mockAttendanceSetting = { findOne: jest.fn(() => chain(setting)) };

jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));

const service = await import('../src/services/scheduleAccessService.js');

beforeEach(() => {
  jest.clearAllMocks();
  delete mockAttendanceSetting.db;
  setting = { shifts: SHIFTS };
  units = [
    // 只選了大夜（沒有任何休息類班別）
    { _id: ID.unitNight, name: 'B1 病房', allowedShiftIds: [SHIFT.night] },
    // 舊設定：選了白班與休息日
    { _id: ID.unitLegacy, name: 'A2 病房', allowedShiftIds: [SHIFT.day, SHIFT.rest] },
    // 沒有設定：全部
    { _id: ID.unitAll, name: 'C1 門診', allowedShiftIds: [] },
  ];
});

describe('isShiftAllowedByRules / loadUnitShiftRules', () => {
  it('allows only the selected shifts, rest-type shifts included (they are controlled too)', async () => {
    const rules = await service.loadUnitShiftRules([ID.unitNight]);
    expect(service.isShiftAllowedByRules(rules, ID.unitNight, SHIFT.night)).toBe(true);
    // 沒選的不用上班的班別也不允許
    for (const shiftId of NON_WORK) {
      expect(service.isShiftAllowedByRules(rules, ID.unitNight, shiftId)).toBe(false);
    }
    expect(service.isShiftAllowedByRules(rules, ID.unitNight, SHIFT.day)).toBe(false);
    // 規則只看小單位的設定，不必讀班別設定
    expect(mockAttendanceSetting.findOne).not.toHaveBeenCalled();
  });

  it('allows a selected rest shift and refuses the unselected ones', async () => {
    const rules = await service.loadUnitShiftRules([ID.unitLegacy, ID.unitNight]);
    expect(service.isShiftAllowedByRules(rules, ID.unitLegacy, SHIFT.day)).toBe(true);
    expect(service.isShiftAllowedByRules(rules, ID.unitLegacy, SHIFT.rest)).toBe(true);
    expect(service.isShiftAllowedByRules(rules, ID.unitLegacy, SHIFT.regular)).toBe(false);
    expect(service.isShiftAllowedByRules(rules, ID.unitLegacy, SHIFT.night)).toBe(false);
  });

  it('does not read the shift settings when no unit has a selection (everything is allowed anyway)', async () => {
    const rules = await service.loadUnitShiftRules([ID.unitAll]);
    expect(rules.size).toBe(0);
    expect(service.isShiftAllowedByRules(rules, ID.unitAll, SHIFT.day)).toBe(true);
    expect(mockAttendanceSetting.findOne).not.toHaveBeenCalled();
  });

  it('only uses the unit selection while the shift settings cannot be read (database not connected)', async () => {
    mockAttendanceSetting.db = { readyState: 0 };
    const rules = await service.loadUnitShiftRules([ID.unitNight]);
    expect(mockAttendanceSetting.findOne).not.toHaveBeenCalled();
    expect(service.isShiftAllowedByRules(rules, ID.unitNight, SHIFT.night)).toBe(true);
    expect(service.isShiftAllowedByRules(rules, ID.unitNight, SHIFT.rest)).toBe(false);
  });

  it('ignores a missing shift settings document', async () => {
    setting = null;
    const rules = await service.loadUnitShiftRules([ID.unitNight]);
    expect(service.isShiftAllowedByRules(rules, ID.unitNight, SHIFT.night)).toBe(true);
    expect(service.isShiftAllowedByRules(rules, ID.unitNight, SHIFT.day)).toBe(false);
  });
});

describe('findDisallowedShiftAssignments (create, batch and update of schedules)', () => {
  it('reports every unselected shift, rest-type shifts included', async () => {
    const disallowed = await service.findDisallowedShiftAssignments([
      { employee: ID.nurse, shiftId: SHIFT.night },
      { employee: ID.nurse, shiftId: SHIFT.rest },
      { employee: ID.nurse, shiftId: SHIFT.day },
      { employee: ID.legacyNurse, shiftId: SHIFT.rest },
      { employee: ID.legacyNurse, shiftId: SHIFT.regular },
    ]);
    expect(disallowed).toEqual([
      { employee: ID.nurse, shiftId: SHIFT.rest, subDepartment: ID.unitNight, subDepartmentName: 'B1 病房' },
      { employee: ID.nurse, shiftId: SHIFT.day, subDepartment: ID.unitNight, subDepartmentName: 'B1 病房' },
      { employee: ID.legacyNurse, shiftId: SHIFT.regular, subDepartment: ID.unitLegacy, subDepartmentName: 'A2 病房' },
    ]);
  });
});

describe('getAllowedShiftIdsFor', () => {
  it('returns exactly the selection, and stays empty (everything) without one', async () => {
    expect(await service.getAllowedShiftIdsFor({ subDepartmentIds: [ID.unitNight] })).toEqual([SHIFT.night]);
    expect(await service.getAllowedShiftIdsFor({ subDepartmentIds: [ID.unitNight, ID.unitAll] })).toEqual([]);
  });
});
