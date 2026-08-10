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
} = await import('../src/services/shiftSemanticService.js');

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
