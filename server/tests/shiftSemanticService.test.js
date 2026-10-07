import { jest } from '@jest/globals';

const collection = {
  findOne: jest.fn(),
  updateOne: jest.fn(),
};

jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({
  default: { collection },
}));

const {
  inferLegacyShiftSemanticType,
  resolveShiftSemanticType,
  migrateMissingShiftSemantics,
  isNonWorkShift,
  hasNoWorkingTime,
  LEAVE_SHIFT_CODES,
  LEAVE_SHIFT_NAMES,
} = await import('../src/services/shiftSemanticService.js');

// 客戶「班表公版」的 17 個休假/請假班別（皆為 00:00-00:00、休息 0 分鐘）
const CUSTOMER_OFF_SHIFTS = [
  ['休', '休假', 'rest_day'],
  ['例', '例假', 'regular_rest'],
  ['國', '國定假日', 'holiday'],
  ['事', '事假', 'leave'],
  ['特', '特休', 'leave'],
  ['補', '補休', 'leave'],
  ['原', '原民假', 'leave'],
  ['病', '病假', 'leave'],
  ['公', '公假', 'leave'],
  ['公傷', '公傷假', 'leave'],
  ['婚', '婚假', 'leave'],
  ['喪', '喪假', 'leave'],
  ['生', '生理假', 'leave'],
  ['檢', '產檢假', 'leave'],
  ['陪', '陪產檢假', 'leave'],
  ['產', '分娩假', 'leave'],
  ['家', '家庭照顧假', 'leave'],
];

// 客戶公版裡要上班的班別（含休息日出勤的 休D/休E/休N/休支4）
const CUSTOMER_WORK_SHIFTS = [
  { code: '日', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
  { code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', breakMinutes: 0, crossDay: true },
  { code: 'E', name: '晚班', startTime: '16:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
  { code: '彈', name: '彈性班', startTime: '00:00', endTime: '23:59', breakMinutes: 60 },
  { code: '休D', name: '休息日出勤日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
  { code: '休E', name: '休息日出勤晚班', startTime: '16:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
  { code: '休N', name: '休息日出勤夜班', startTime: '00:00', endTime: '08:00', breakMinutes: 0, crossDay: true },
  { code: '休支4', name: '休息日支援4小時', startTime: '08:00', endTime: '12:00', breakMinutes: 0 },
  { code: '0630-1830', name: '0630-1830', startTime: '06:30', endTime: '18:30', breakMinutes: 120 },
  { code: '1830-0630', name: '1830-0630', startTime: '18:30', endTime: '06:30', breakMinutes: 120, crossDay: true },
  { code: '0800-2000', name: '0800-2000', startTime: '08:00', endTime: '20:00', breakMinutes: 120 },
  { code: '2000-0800', name: '2000-0800', startTime: '20:00', endTime: '08:00', breakMinutes: 120, crossDay: true },
];

beforeEach(() => {
  collection.findOne.mockReset();
  collection.updateOne.mockReset();
});

describe('shift semantic classification', () => {
  it('does not mistake a work shift break label for a rest day', () => {
    expect(inferLegacyShiftSemanticType({
      code: '日', name: '08-17(休1)', startTime: '08:00', endTime: '17:00',
    })).toBe('work');
  });

  it('classifies zero-time legacy codes without overriding explicit semantics', () => {
    expect(inferLegacyShiftSemanticType({ code: '休', name: '休假', startTime: '00:00', endTime: '00:00' })).toBe('rest_day');
    expect(inferLegacyShiftSemanticType({ code: '例', name: '例假', startTime: '00:00', endTime: '00:00' })).toBe('regular_rest');
    expect(inferLegacyShiftSemanticType({ code: '國', name: '國定假日', startTime: '00:00', endTime: '00:00' })).toBe('holiday');
    expect(inferLegacyShiftSemanticType({ code: '特', name: '特休', startTime: '00:00', endTime: '00:00' })).toBe('leave');
    expect(resolveShiftSemanticType({ semanticType: 'work', code: '休', name: '休假' })).toBe('work');
  });

  it('migrates missing and unsafe legacy defaults while preserving work shifts', async () => {
    collection.findOne.mockResolvedValue({
      _id: 'setting-1',
      shifts: [
        { _id: 'a', code: '休', name: '休假', startTime: '00:00', endTime: '00:00' },
        { _id: 'b', code: '日', name: '08-17(休1)', startTime: '08:00', endTime: '17:00' },
        { _id: 'c', code: '例', name: '例假', startTime: '00:00', endTime: '00:00', semanticType: 'work' },
        { _id: 'd', code: 'D', name: '日班', startTime: '08:00', endTime: '17:00', semanticType: 'work' },
      ],
    });
    collection.updateOne.mockResolvedValue({ acknowledged: true });

    await expect(migrateMissingShiftSemantics()).resolves.toBe(3);
    const shifts = collection.updateOne.mock.calls[0][1].$set.shifts;
    expect(shifts.map((shift) => shift.semanticType)).toEqual([
      'rest_day', 'work', 'regular_rest', 'work',
    ]);
  });
});

describe('customer shift table (班表公版)', () => {
  const offShift = (code, name) => ({ code, name, startTime: '00:00', endTime: '00:00', breakMinutes: 0 });

  it.each(CUSTOMER_OFF_SHIFTS)('classifies day-off code %s (%s) as %s', (code, name, expected) => {
    const shift = offShift(code, name);
    expect(inferLegacyShiftSemanticType(shift)).toBe(expected);
    expect(resolveShiftSemanticType(shift)).toBe(expected);
    expect(isNonWorkShift(shift)).toBe(true);
    // 只用代碼或只用名稱也要分得出來
    expect(inferLegacyShiftSemanticType({ ...shift, name: '' })).toBe(expected);
    expect(inferLegacyShiftSemanticType({ ...shift, code: '' })).toBe(expected);
  });

  it('knows exactly 17 day-off codes in the customer table', () => {
    expect(CUSTOMER_OFF_SHIFTS).toHaveLength(17);
  });

  it.each(CUSTOMER_WORK_SHIFTS.map((shift) => [shift.code, shift]))(
    'keeps working shift %s as work',
    (_code, shift) => {
      expect(inferLegacyShiftSemanticType(shift)).toBe('work');
      expect(resolveShiftSemanticType(shift)).toBe('work');
      expect(isNonWorkShift(shift)).toBe(false);
    },
  );

  it('still treats an explicit non-work type on a shift with working time as non-work', () => {
    expect(isNonWorkShift({ code: 'X', startTime: '08:00', endTime: '12:00', semanticType: 'leave' })).toBe(true);
    expect(isNonWorkShift({ code: 'X', startTime: '08:00', endTime: '12:00', semanticType: 'holiday' })).toBe(true);
  });

  it('exports leave codes and names that all infer as leave and cover the customer table', () => {
    for (const code of LEAVE_SHIFT_CODES) {
      expect(inferLegacyShiftSemanticType({ code, name: '', startTime: '08:00', endTime: '17:00' })).toBe('leave');
    }
    for (const name of LEAVE_SHIFT_NAMES) {
      expect(inferLegacyShiftSemanticType({ code: 'ZZ', name, startTime: '08:00', endTime: '17:00' })).toBe('leave');
    }
    const leaveRows = CUSTOMER_OFF_SHIFTS.filter(([, , type]) => type === 'leave');
    for (const [code, name] of leaveRows) {
      expect(LEAVE_SHIFT_CODES).toContain(code);
      expect(LEAVE_SHIFT_NAMES).toContain(name);
    }
  });

  it('never infers work for a shift without working time, whatever its code is', () => {
    expect(inferLegacyShiftSemanticType(offShift('X1', '特殊假'))).toBe('leave');
    expect(isNonWorkShift({ ...offShift('X1', '特殊假'), semanticType: 'work' })).toBe(true);
    // 8:00 與 08:00:00 是同一個時間
    expect(hasNoWorkingTime({ startTime: '8:00', endTime: '08:00:00' })).toBe(true);
  });

  it('keeps a 24 hour cross-day shift (start equals end with crossDay) as work', () => {
    const full = { code: 'FULL', name: '24小時班', startTime: '00:00', endTime: '00:00', crossDay: true };
    expect(hasNoWorkingTime(full)).toBe(false);
    expect(inferLegacyShiftSemanticType(full)).toBe('work');
    expect(isNonWorkShift(full)).toBe(false);
  });

  it('does not treat shifts with missing times as day-off shifts', () => {
    expect(inferLegacyShiftSemanticType({ code: 'D', name: '日班' })).toBe('work');
    expect(isNonWorkShift({ code: 'D', name: '日班' })).toBe(false);
  });
});

describe('migrateMissingShiftSemantics for the customer table', () => {
  it('fixes every stored zero-time work/missing shift, leaves working shifts alone and is idempotent', async () => {
    const stored = [
      ...CUSTOMER_OFF_SHIFTS.map(([code, name], index) => ({
        _id: `off-${index}`,
        code,
        name,
        startTime: '00:00',
        endTime: '00:00',
        // 管理者沒改預設值：一半被存成 work，一半根本沒有班別性質
        semanticType: index % 2 ? 'work' : undefined,
      })),
      { _id: 'odd', code: 'X1', name: '特殊假', startTime: '00:00', endTime: '00:00', semanticType: 'work' },
      ...CUSTOMER_WORK_SHIFTS.map((shift, index) => ({ _id: `work-${index}`, ...shift, semanticType: 'work' })),
      { _id: 'full', code: 'FULL', name: '24小時班', startTime: '00:00', endTime: '00:00', crossDay: true, semanticType: 'work' },
    ];
    let current = { _id: 'setting-1', shifts: stored };
    collection.findOne.mockImplementation(async () => current);
    collection.updateOne.mockImplementation(async (_filter, update) => {
      current = { ...current, shifts: update.$set.shifts };
      return { acknowledged: true };
    });

    // 17 個休假班 + 1 個沒對應樣式的 00:00-00:00 班都要被修正
    await expect(migrateMissingShiftSemantics()).resolves.toBe(18);
    const migrated = collection.updateOne.mock.calls[0][1].$set.shifts;
    CUSTOMER_OFF_SHIFTS.forEach(([, , expected], index) => {
      expect(migrated[index].semanticType).toBe(expected);
    });
    expect(migrated[CUSTOMER_OFF_SHIFTS.length].semanticType).toBe('leave');
    // 有工作時間的班（含 24 小時跨日班）不動
    migrated.slice(CUSTOMER_OFF_SHIFTS.length + 1).forEach((shift) => {
      expect(shift.semanticType).toBe('work');
    });

    collection.updateOne.mockClear();
    await expect(migrateMissingShiftSemantics()).resolves.toBe(0);
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('does not touch an explicit non-work type or a shift that has working time', async () => {
    collection.findOne.mockResolvedValue({
      _id: 'setting-1',
      shifts: [
        { _id: 'a', code: 'X1', name: '特殊假', startTime: '00:00', endTime: '00:00', semanticType: 'holiday' },
        { _id: 'b', code: '病', name: '病假', startTime: '08:00', endTime: '17:00', semanticType: 'work' },
      ],
    });
    await expect(migrateMissingShiftSemantics()).resolves.toBe(0);
    expect(collection.updateOne).not.toHaveBeenCalled();
  });
});
