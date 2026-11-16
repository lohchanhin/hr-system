import { getRegimeConfig, __testUtils } from '../src/services/laborRuleValidationService.js';

const { validateRegimePeriodRestAndHours } = __testUtils;

const shiftMap = new Map([
  ['work8', { _id: 'work8', name: '早班8h', startTime: '09:00', endTime: '18:00', breakMinutes: 60, breakDuration: 60 }],
  ['work10', { _id: 'work10', name: '早班10h', startTime: '08:00', endTime: '19:00', breakMinutes: 60, breakDuration: 60 }],
  ['regular_rest', { _id: 'regular_rest', name: '例假', semanticType: 'regular_rest' }],
  ['rest_day', { _id: 'rest_day', name: '休息日', semanticType: 'rest_day' }],
]);

function makeSchedules(startDateStr, types, workShiftId = 'work8') {
  const start = new Date(`${startDateStr}T00:00:00.000Z`);
  return types.map((t, i) => ({
    date: new Date(start.getTime() + i * 86400000),
    shiftId: t === 'work' ? workShiftId : t,
  }));
}

describe('P1 Taiwan Deformed Work Hours (workTimeRegime)', () => {
  it('getRegimeConfig returns statutory parameters for standard, two_week, four_week, eight_week', () => {
    expect(getRegimeConfig('standard')).toMatchObject({
      periodDays: 7,
      dailyRegularMinutes: 480,
      periodRegularMinutes: 2400,
    });
    expect(getRegimeConfig('two_week')).toMatchObject({
      periodDays: 14,
      dailyRegularMinutes: 600,
      periodRegularMinutes: 4800,
      minTotalRestInPeriod: 4,
    });
    expect(getRegimeConfig('four_week')).toMatchObject({
      periodDays: 28,
      dailyRegularMinutes: 600,
      periodRegularMinutes: 9600,
      minTotalRestInPeriod: 8,
    });
    expect(getRegimeConfig('eight_week')).toMatchObject({
      periodDays: 56,
      dailyRegularMinutes: 480,
      periodRegularMinutes: 19200,
      minTotalRestInPeriod: 16,
    });
  });

  it('two_week regime allows 10h daily regular hours and 4 rest/off days per 14-day cycle', () => {
    const types = Array.from({ length: 14 }, (_, i) => {
      if (i === 6 || i === 13) return 'regular_rest';
      if (i === 4 || i === 5 || i === 11 || i === 12) return 'rest_day';
      return 'work';
    });
    const grouped = new Map([['emp1', makeSchedules('2026-01-05', types, 'work10')]]);
    const result = validateRegimePeriodRestAndHours(
      grouped,
      shiftMap,
      {
        strictStart: new Date('2026-01-05T00:00:00.000Z'),
        strictEnd: new Date('2026-01-19T00:00:00.000Z'),
      },
      { workTimeRegimeAnchorDate: '2026-01-05' },
      getRegimeConfig('two_week'),
    );
    expect(result.violations).toHaveLength(0);
  });

  it('four_week regime detects missing 2 regular rest days in 14-day sub-window', () => {
    const types = Array.from({ length: 28 }, (_, i) => {
      if (i === 6) return 'regular_rest';
      if (i === 5 || i === 12 || i === 13) return 'rest_day';
      if (i === 20 || i === 27) return 'regular_rest';
      if (i === 19 || i === 26) return 'rest_day';
      return 'work';
    });
    const grouped = new Map([['emp1', makeSchedules('2026-01-05', types, 'work8')]]);
    const result = validateRegimePeriodRestAndHours(
      grouped,
      shiftMap,
      {
        strictStart: new Date('2026-01-05T00:00:00.000Z'),
        strictEnd: new Date('2026-02-02T00:00:00.000Z'),
      },
      { workTimeRegimeAnchorDate: '2026-01-05' },
      getRegimeConfig('four_week'),
    );
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('defers incomplete cross-month cycles into pendingWeeks instead of false-positive violation', () => {
    const types = Array.from({ length: 28 }, (_, i) => {
      if (i % 7 === 6) return 'regular_rest';
      if (i % 7 === 5) return 'rest_day';
      return 'work';
    });
    const grouped = new Map([['emp1', makeSchedules('2026-02-01', types, 'work8')]]);
    const result = validateRegimePeriodRestAndHours(
      grouped,
      shiftMap,
      {
        strictStart: new Date('2026-02-01T00:00:00.000Z'),
        strictEnd: new Date('2026-03-01T00:00:00.000Z'),
      },
      { workTimeRegimeAnchorDate: '2026-01-05' },
      getRegimeConfig('four_week'),
    );
    expect(result.pendingWeeks.length).toBeGreaterThan(0);
  });
});
