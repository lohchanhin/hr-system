// 「使用班別」改成全部班別都受限制（2026/11/11）：啟動時一次性把不用上班的班別補進已有設定的小單位，
// 維持原本能排的班別；做過一次就記在其他控制設定（unitRestShiftsMigratedAt），不再重做
import { jest } from '@jest/globals';

const oid = (n) => n.toString(16).padStart(24, '0');
const SHIFT = { day: oid(400), night: oid(401), rest: oid(402), regular: oid(403) };
const SHIFTS = [
  { _id: SHIFT.day, code: 'D', name: '白班', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
  { _id: SHIFT.night, code: 'N', name: '大夜', semanticType: 'work', startTime: '00:00', endTime: '08:00' },
  { _id: SHIFT.rest, code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: SHIFT.regular, code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
];
let units;
let settings;

const chain = (rows) => {
  const query = { select: jest.fn(() => query), lean: jest.fn(async () => rows) };
  return query;
};
const mockSubDepartment = {
  find: jest.fn(() => chain(units.filter((unit) => unit.allowedShiftIds.length))),
  bulkWrite: jest.fn(async (operations) => {
    operations.forEach(({ updateOne }) => {
      const unit = units.find((item) => item._id === updateOne.filter._id);
      updateOne.update.$addToSet.allowedShiftIds.$each.forEach((id) => {
        if (!unit.allowedShiftIds.includes(id)) unit.allowedShiftIds.push(id);
      });
    });
  }),
};
const mockAttendanceSetting = { findOne: jest.fn(() => chain({ shifts: SHIFTS })) };
const mockStore = {
  getSettings: jest.fn(async () => settings),
  updateSettings: jest.fn(async (mutator) => { mutator(settings); return settings; }),
};

jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => mockStore);

const { migrateUnitRestShiftsOnce } = await import('../src/services/scheduleAccessService.js');

beforeEach(() => {
  jest.clearAllMocks();
  settings = {};
  units = [
    { _id: 'u1', allowedShiftIds: [SHIFT.night] },
    { _id: 'u2', allowedShiftIds: [SHIFT.day, SHIFT.rest] },
    { _id: 'u3', allowedShiftIds: [] },
  ];
});

it('adds the rest-type shifts to units that have a selection, once', async () => {
  expect(await migrateUnitRestShiftsOnce()).toEqual({ skipped: false, updated: 2 });
  expect([...units[0].allowedShiftIds].sort()).toEqual([SHIFT.night, SHIFT.rest, SHIFT.regular].sort());
  expect([...units[1].allowedShiftIds].sort()).toEqual([SHIFT.day, SHIFT.rest, SHIFT.regular].sort());
  // 沒有設定的小單位（全部班別）不動
  expect(units[2].allowedShiftIds).toEqual([]);
  expect(settings.unitRestShiftsMigratedAt).toBeTruthy();

  // 第二次啟動不再補（管理員之後取消的休息類班別不會被加回去）
  units[0].allowedShiftIds = [SHIFT.night];
  expect(await migrateUnitRestShiftsOnce()).toEqual({ skipped: true, updated: 0 });
  expect(units[0].allowedShiftIds).toEqual([SHIFT.night]);
  expect(mockSubDepartment.bulkWrite).toHaveBeenCalledTimes(1);
});
