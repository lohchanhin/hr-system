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

// 00:00 開始、勾了跨日的大夜班（前一晚 23:00 起就開放簽到）
const MIDNIGHT_SHIFT = {
  _id: 'midnight',
  code: 'MN',
  name: '大夜班(00:00)',
  startTime: '00:00',
  endTime: '08:00',
  crossDay: true,
  breakDuration: 60,
};

function baseContext(schedules, attendanceRecords) {
  return {
    employee: { _id: 'emp123' },
    attendanceSetting: { shifts: [NIGHT_SHIFT, MIDNIGHT_SHIFT] },
    schedules,
    attendanceRecords,
  };
}

// These tests exercise the real `calculateWorkHours` production function end
// to end (via its context-injection seams for employee/attendanceSetting/
// schedules/attendanceRecords), rather than re-deriving the previous/next-day
// clock-matching algorithm inline in the test. A hand-copied reimplementation
// would keep passing even if the real matching logic in this file regressed.
// 打卡時間是真實的 UTC（台灣時間 = UTC+8）：班別時間以台灣時間計算，台灣 22:00 = 14:00Z、台灣 06:00 = 前一天 22:00Z。
// （這些測試原本把 UTC 當成台灣時間寫，班別改以台灣時間比對、依日期比對的打卡必須落在這一班的範圍內之後，改成真實的時間。）
describe('Work Hours Calculation - Cross-Day Night Shift Fix', () => {
  it('finds a clock-in on the previous day for a cross-day night shift', async () => {
    // 12/02 00:00-08:00 的大夜班，前一天（12/01）晚上 23:50 簽到
    const employeeId = 'emp123';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'midnight' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-01T15:50:00.000Z'), action: 'clockIn' }, // 台灣 12/01 23:50
      { employee: employeeId, timestamp: new Date('2025-12-02T00:00:00.000Z'), action: 'clockOut' }, // 台灣 12/02 08:00
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.workDays).toBe(1);
    expect(result.dailyDetails).toEqual([expect.objectContaining({
      date: '2025-12-02',
      // 8 小時 10 分鐘扣休息 60 分鐘
      workedHours: 7.17,
      hasAttendance: true,
      clockInTime: '2025-12-01T15:50:00.000Z',
      clockOutTime: '2025-12-02T00:00:00.000Z',
    })]);
  });

  it('still works for the normal case where clock-in is on the schedule date', async () => {
    const employeeId = 'emp456';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-02T14:00:00.000Z'), action: 'clockIn' }, // 台灣 12/02 22:00
      { employee: employeeId, timestamp: new Date('2025-12-02T22:00:00.000Z'), action: 'clockOut' }, // 台灣 12/03 06:00
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.workDays).toBe(1);
    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      workedHours: 7,
      hasAttendance: true,
      clockInTime: '2025-12-02T14:00:00.000Z',
      clockOutTime: '2025-12-02T22:00:00.000Z',
    }));
  });

  it('uses the LAST of multiple previous-day clock-ins, ignoring an earlier unrelated shift', async () => {
    // 12/02 00:00-08:00 的大夜班遲到超過簽到緩衝（04:30 才簽到，簽到時段外），依日期比對：
    // 前一天（UTC 日期）有兩筆簽到，取最晚的一筆，不拿前一天下午另一班的簽到
    const employeeId = 'emp789';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'midnight' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-01T06:00:00.000Z'), action: 'clockIn' }, // earlier, unrelated shift（台灣 12/01 14:00）
      { employee: employeeId, timestamp: new Date('2025-12-01T10:00:00.000Z'), action: 'clockOut' }, // 台灣 12/01 18:00
      { employee: employeeId, timestamp: new Date('2025-12-01T20:30:00.000Z'), action: 'clockIn' }, // actual night-shift clock-in（台灣 12/02 04:30）
      { employee: employeeId, timestamp: new Date('2025-12-02T00:00:00.000Z'), action: 'clockOut' }, // 台灣 12/02 08:00
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      // 04:30-08:00 扣休息 60 分鐘
      workedHours: 2.5,
      clockInTime: '2025-12-01T20:30:00.000Z',
      clockOutTime: '2025-12-02T00:00:00.000Z',
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
    // Regression guard for the same-day clock-out search (the date-based fallback,
    // now in services/attendancePunchService.js): it must pick the first clock-out AFTER
    // the clock-in, not just the first clock-out of the day.
    const employeeId = 'empA';
    const schedules = [{ employee: employeeId, date: new Date('2025-12-02T00:00:00.000Z'), shiftId: 'night' }];
    const attendanceRecords = [
      { employee: employeeId, timestamp: new Date('2025-12-02T00:00:00.000Z'), action: 'clockOut' }, // stray clock-out from the prior shift, before the real clock-in（台灣 12/02 08:00）
      { employee: employeeId, timestamp: new Date('2025-12-02T14:00:00.000Z'), action: 'clockIn' }, // 台灣 12/02 22:00
      // 台灣 12/03 01:30 提早下班（比簽退時段早），時段內找不到簽退，依日期比對：同一個 UTC 日期、晚於簽到的第一筆
      { employee: employeeId, timestamp: new Date('2025-12-02T17:30:00.000Z'), action: 'clockOut' },
    ];

    const result = await calculateWorkHours(employeeId, '2025-12-01', baseContext(schedules, attendanceRecords));

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      // 22:00-01:30 扣休息 60 分鐘
      workedHours: 2.5,
      clockInTime: '2025-12-02T14:00:00.000Z',
      clockOutTime: '2025-12-02T17:30:00.000Z',
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
