import { describe, it, expect } from '@jest/globals';
import { calculateWorkHours, __testUtils } from '../src/services/workHoursCalculationService.js';

const { minutesBetween, buildDateKey, groupAttendanceRecords } = __testUtils;

const NIGHT_SHIFT = {
  _id: 'night',
  code: 'N',
  name: '大夜班',
  startTime: '22:00',
  endTime: '06:00',
  crossDay: true,
  breakDuration: 60,
};

function baseContext(schedules, attendanceRecords) {
  return {
    employee: { _id: 'emp123' },
    attendanceSetting: { shifts: [NIGHT_SHIFT] },
    schedules,
    attendanceRecords,
  };
}

// These tests exercise the real `calculateWorkHours` production function end
// to end (via its context-injection seams for employee/attendanceSetting/
// schedules/attendanceRecords), rather than re-deriving the previous/next-day
// clock-matching algorithm inline in the test. A hand-copied reimplementation
// would keep passing even if the real matching logic in this file regressed.
describe('Work Hours Calculation - Cross-Day Night Shift Fix', () => {
  it('finds a clock-in on the previous day for a cross-day night shift', async () => {
    const employeeId = 'emp123';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-01T22:00:00.000Z'), action: 'clockIn' },
      { employee: employeeId, timestamp: new Date('2025-12-02T06:00:00.000Z'), action: 'clockOut' },
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.workDays).toBe(1);
    expect(result.dailyDetails).toEqual([expect.objectContaining({
      date: '2025-12-02',
      workedHours: 7,
      hasAttendance: true,
      clockInTime: '2025-12-01T22:00:00.000Z',
      clockOutTime: '2025-12-02T06:00:00.000Z',
    })]);
  });

  it('still works for the normal case where clock-in is on the schedule date', async () => {
    const employeeId = 'emp456';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-02T22:00:00.000Z'), action: 'clockIn' },
      { employee: employeeId, timestamp: new Date('2025-12-03T06:00:00.000Z'), action: 'clockOut' },
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.workDays).toBe(1);
    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      workedHours: 7,
      hasAttendance: true,
      clockInTime: '2025-12-02T22:00:00.000Z',
      clockOutTime: '2025-12-03T06:00:00.000Z',
    }));
  });

  it('uses the LAST of multiple previous-day clock-ins, ignoring an earlier unrelated shift', async () => {
    const employeeId = 'emp789';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-01T14:00:00.000Z'), action: 'clockIn' }, // earlier, unrelated shift
      { employee: employeeId, timestamp: new Date('2025-12-01T18:00:00.000Z'), action: 'clockOut' },
      { employee: employeeId, timestamp: new Date('2025-12-01T22:00:00.000Z'), action: 'clockIn' }, // actual night-shift clock-in
      { employee: employeeId, timestamp: new Date('2025-12-02T06:00:00.000Z'), action: 'clockOut' },
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      workedHours: 7,
      clockInTime: '2025-12-01T22:00:00.000Z',
      clockOutTime: '2025-12-02T06:00:00.000Z',
    }));
  });

  it('reports zero worked hours and no attendance when there is no clock-in on either day', async () => {
    const employeeId = 'emp999';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-02T06:00:00.000Z'), action: 'clockOut' },
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.workDays).toBe(0);
    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      workedHours: 0,
      hasAttendance: false,
      clockInTime: null,
      clockOutTime: null,
    }));
  });

  it('does not match a clock-out on the clock-in day if it happened before the clock-in', async () => {
    // Regression guard for the same-day clock-out search at
    // workHoursCalculationService.js: it must pick the first clock-out AFTER
    // the clock-in, not just the first clock-out of the day.
    const employeeId = 'empA';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-02T08:00:00.000Z'), action: 'clockOut' }, // stray clock-out from the prior shift, before the real clock-in
      { employee: employeeId, timestamp: new Date('2025-12-02T22:00:00.000Z'), action: 'clockIn' },
      { employee: employeeId, timestamp: new Date('2025-12-03T06:00:00.000Z'), action: 'clockOut' },
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      workedHours: 7,
      clockInTime: '2025-12-02T22:00:00.000Z',
      clockOutTime: '2025-12-03T06:00:00.000Z',
    }));
  });
});

describe('cross-day helper primitives', () => {
  it('groupAttendanceRecords sorts clock-ins/outs chronologically per employee-day', () => {
    const map = groupAttendanceRecords([
      { employee: 'e1', timestamp: new Date('2025-12-01T22:00:00.000Z'), action: 'clockIn' },
      { employee: 'e1', timestamp: new Date('2025-12-01T14:00:00.000Z'), action: 'clockIn' },
    ]);
    const entry = map.get(`e1::${buildDateKey(new Date('2025-12-01T00:00:00.000Z'))}`);
    expect(entry.clockIns.map((d) => d.toISOString())).toEqual([
      '2025-12-01T14:00:00.000Z',
      '2025-12-01T22:00:00.000Z',
    ]);
  });

  it('minutesBetween returns 0 for missing endpoints instead of NaN', () => {
    expect(minutesBetween(null, new Date())).toBe(0);
    expect(minutesBetween(new Date(), null)).toBe(0);
  });
});
