import { calculateNightShiftAllowance } from '../src/services/nightShiftAllowanceService.js';

function buildShift({
  id = 'shift1',
  name = '大夜班',
  code = 'N1',
  startTime = '23:00',
  endTime = '07:00',
  crossDay = true,
  breakDuration = 60,
  isNightShift = true,
  hasAllowance = true,
  fixedAllowanceAmount,
} = {}) {
  return {
    _id: { toString: () => id },
    name,
    code,
    startTime,
    endTime,
    crossDay,
    breakDuration,
    isNightShift,
    hasAllowance,
    fixedAllowanceAmount,
  };
}

function buildSchedule(shiftId) {
  return { shiftId: { toString: () => shiftId } };
}

describe('Night Shift Allowance Service', () => {
  describe('calculateNightShiftAllowance', () => {
    it('returns no_shifts when there is no attendance setting', async () => {
      // `context.attendanceSetting` is read via `??`, so `false` (not `null`/
      // `undefined`) is what actually short-circuits the DB lookup here.
      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting: false,
      });

      expect(result).toEqual({
        nightShiftDays: 0,
        nightShiftHours: 0,
        allowanceAmount: 0,
        calculationMethod: 'no_shifts',
        shiftBreakdown: [],
        configurationIssues: [],
      });
    });

    it('returns no_schedules when the employee has no schedules that month', async () => {
      const attendanceSetting = { shifts: [buildShift()] };
      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules: [],
      });

      expect(result.calculationMethod).toBe('no_schedules');
      expect(result.allowanceAmount).toBe(0);
    });

    it('ignores shifts that are not flagged as night shift or have no allowance', async () => {
      const dayShift = buildShift({ id: 'day1', isNightShift: false, hasAllowance: true, fixedAllowanceAmount: 200 });
      const noAllowanceShift = buildShift({ id: 'night-no-allow', isNightShift: true, hasAllowance: false, fixedAllowanceAmount: 200 });
      const attendanceSetting = { shifts: [dayShift, noAllowanceShift] };
      const schedules = [buildSchedule('day1'), buildSchedule('night-no-allow')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.nightShiftDays).toBe(0);
      expect(result.allowanceAmount).toBe(0);
      expect(result.calculationMethod).toBe('not_calculated');
      expect(result.shiftBreakdown).toEqual([]);
    });

    it('calculates a fixed allowance for a properly configured night shift', async () => {
      const shift = buildShift({ fixedAllowanceAmount: 300 });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.calculationMethod).toBe('calculated');
      expect(result.nightShiftDays).toBe(1);
      expect(result.allowanceAmount).toBe(300);
      expect(result.configurationIssues).toEqual([]);
      expect(result.shiftBreakdown).toEqual([{
        shiftName: '大夜班',
        shiftCode: 'N1',
        allowanceType: '固定津貼',
        workHours: 7, // 23:00-07:00 crosses midnight => 8h span - 1h break
        allowanceAmount: 300,
        calculationDetail: '固定津貼: NT$ 300 / 班',
        hasIssue: false,
        hasCrossDayIssue: false,
      }]);
    });

    it('sums the allowance across multiple night-shift days in the month', async () => {
      const shift = buildShift({ fixedAllowanceAmount: 250 });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1'), buildSchedule('shift1'), buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.nightShiftDays).toBe(3);
      expect(result.allowanceAmount).toBe(750);
      expect(result.nightShiftHours).toBe(21);
    });

    it('flags configuration_error when a night shift has no fixedAllowanceAmount set', async () => {
      const shift = buildShift({ fixedAllowanceAmount: undefined });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.calculationMethod).toBe('configuration_error');
      expect(result.allowanceAmount).toBe(0);
      expect(result.configurationIssues).toEqual([
        '班別「大夜班」(N1) 已啟用夜班津貼但金額未設定',
      ]);
      expect(result.shiftBreakdown[0]).toMatchObject({
        hasIssue: true,
        allowanceAmount: 0,
        calculationDetail: '固定津貼未設定 (請設定固定津貼金額)',
      });
    });

    it('treats a zero or negative fixedAllowanceAmount the same as unset', async () => {
      const zeroShift = buildShift({ id: 'z1', fixedAllowanceAmount: 0 });
      const negativeShift = buildShift({ id: 'n1', fixedAllowanceAmount: -50 });
      const attendanceSetting = { shifts: [zeroShift, negativeShift] };
      const schedules = [buildSchedule('z1'), buildSchedule('n1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.calculationMethod).toBe('configuration_error');
      expect(result.allowanceAmount).toBe(0);
      expect(result.configurationIssues).toHaveLength(2);
    });

    it('still reports calculated overall when only some shifts in the month are misconfigured', async () => {
      // Current behavior: calculationMethod only looks at whether ANY allowance
      // was computed (totalAllowance > 0), so a mix of good + broken shift
      // configs is reported as "calculated" even though configurationIssues
      // is non-empty. Locking this in so a future change to this precedence
      // is a deliberate decision, not an accidental regression.
      const goodShift = buildShift({ id: 'good', fixedAllowanceAmount: 300 });
      const brokenShift = buildShift({ id: 'broken', name: '小夜班', code: 'N2', fixedAllowanceAmount: 0 });
      const attendanceSetting = { shifts: [goodShift, brokenShift] };
      const schedules = [buildSchedule('good'), buildSchedule('broken')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.calculationMethod).toBe('calculated');
      expect(result.allowanceAmount).toBe(300);
      expect(result.configurationIssues).toEqual([
        '班別「小夜班」(N2) 已啟用夜班津貼但金額未設定',
      ]);
    });

    it('rounds a fractional total allowance to the nearest integer', async () => {
      const shiftA = buildShift({ id: 'a', fixedAllowanceAmount: 33.33 });
      const shiftB = buildShift({ id: 'b', fixedAllowanceAmount: 33.33 });
      const attendanceSetting = { shifts: [shiftA, shiftB] };
      const schedules = [buildSchedule('a'), buildSchedule('b')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.allowanceAmount).toBe(67); // 66.66 rounds up
    });

    it('handles a non-cross-day shift without adjusting for midnight wraparound', async () => {
      const shift = buildShift({
        startTime: '20:00',
        endTime: '23:30',
        crossDay: false,
        breakDuration: 30,
        fixedAllowanceAmount: 300,
      });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.nightShiftHours).toBe(3); // 3.5h span - 0.5h break
    });

    it('flags a suspected missing crossDay flag instead of silently zeroing work hours', async () => {
      // A shift whose end time is numerically before its start time (e.g.
      // 23:00-07:00) but is NOT marked crossDay used to silently produce 0
      // work hours. It now surfaces a configurationIssue and a per-shift
      // hasCrossDayIssue flag so the mistake is visible instead of hidden.
      const shift = buildShift({
        startTime: '23:00',
        endTime: '07:00',
        crossDay: false,
        breakDuration: 60,
        fixedAllowanceAmount: 300,
      });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.nightShiftHours).toBe(0);
      // The allowance itself is fixed-per-shift, so it is unaffected by the
      // work-hour miscalculation above.
      expect(result.allowanceAmount).toBe(300);
      expect(result.configurationIssues).toEqual([
        '班別「大夜班」(N1) 時間為 23:00-07:00，疑似跨日班別但未勾選「跨日」，工時已被算為 0，請檢查班別設定',
      ]);
      expect(result.shiftBreakdown[0]).toMatchObject({ hasCrossDayIssue: true });
    });

    it('does not duplicate the crossDay warning across multiple scheduled days for the same shift', async () => {
      const shift = buildShift({
        startTime: '23:00',
        endTime: '07:00',
        crossDay: false,
        breakDuration: 60,
        fixedAllowanceAmount: 300,
      });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1'), buildSchedule('shift1'), buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.configurationIssues).toHaveLength(1);
      expect(result.shiftBreakdown.every((entry) => entry.hasCrossDayIssue)).toBe(true);
    });

    it('does not flag a shift correctly marked crossDay even though it wraps midnight', async () => {
      const shift = buildShift({ startTime: '23:00', endTime: '07:00', crossDay: true, fixedAllowanceAmount: 300 });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('shift1')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.configurationIssues).toEqual([]);
      expect(result.shiftBreakdown[0]).toMatchObject({ hasCrossDayIssue: false });
    });

    it('falls back to error_fallback and records the error message when a schedule entry is malformed', async () => {
      const shift = buildShift({ fixedAllowanceAmount: 300 });
      const attendanceSetting = { shifts: [shift] };
      const malformedSchedules = [{ shiftId: undefined }];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules: malformedSchedules,
      });

      expect(result.calculationMethod).toBe('error_fallback');
      expect(result.allowanceAmount).toBe(0);
      expect(result.configurationIssues).toHaveLength(1);
      expect(result.configurationIssues[0]).toMatch(/^計算錯誤: /);
    });

    it('skips schedules referencing a shiftId that no longer exists in attendance settings', async () => {
      const shift = buildShift({ fixedAllowanceAmount: 300 });
      const attendanceSetting = { shifts: [shift] };
      const schedules = [buildSchedule('deleted-shift')];

      const result = await calculateNightShiftAllowance('emp1', '2026-01-01', {}, {
        attendanceSetting,
        schedules,
      });

      expect(result.calculationMethod).toBe('not_calculated');
      expect(result.nightShiftDays).toBe(0);
      expect(result.allowanceAmount).toBe(0);
    });
  });
});
