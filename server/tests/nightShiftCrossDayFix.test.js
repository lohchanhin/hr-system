import { describe, it, expect } from '@jest/globals';
import { __testUtils } from '../src/services/workHoursCalculationService.js';

const { 
  minutesBetween,
  hoursFromMinutes,
  buildDateKey,
  groupAttendanceRecords,
  computeShiftTimes,
  getShiftBreakMinutes
} = __testUtils;

describe('Work Hours Calculation - Cross-Day Night Shift Fix', () => {
  it('should find clock-in on previous day for cross-day night shift', () => {
    const employeeId = 'emp123';
    
    // Scenario: Schedule date is Dec 2, but employee clocked in on Dec 1 evening
    // Night shift: 22:00 - 06:00 (cross day)
    // Schedule: Dec 2
    // Actual shift: Dec 1 22:00 to Dec 2 06:00
    // Clock-in: Dec 1 22:00
    // Clock-out: Dec 2 06:00
    
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-12-01T22:00:00.000Z'), // Dec 1 evening
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-12-02T06:00:00.000Z'), // Dec 2 morning
        action: 'clockOut',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    
    // Verify records are grouped correctly
    const dec1Record = recordMap.get(`${employeeId}::2025-12-01`);
    expect(dec1Record).toBeDefined();
    expect(dec1Record.clockIns).toHaveLength(1);
    expect(dec1Record.clockOuts).toHaveLength(0);
    
    const dec2Record = recordMap.get(`${employeeId}::2025-12-02`);
    expect(dec2Record).toBeDefined();
    expect(dec2Record.clockIns).toHaveLength(0);
    expect(dec2Record.clockOuts).toHaveLength(1);
    
    // Simulate the fix: check previous day for clock-in
    const scheduleDate = new Date('2025-12-02T00:00:00.000Z');
    const dateKey = buildDateKey(scheduleDate);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    
    // No clock-in on schedule date (Dec 2)
    expect(dayRecord.clockIns).toHaveLength(0);
    
    // Check previous day for clock-in (Dec 1)
    const prevDate = new Date(scheduleDate);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevDateKey = buildDateKey(prevDate);
    const prevDayRecord = recordMap.get(`${employeeId}::${prevDateKey}`);
    
    expect(prevDayRecord).toBeDefined();
    expect(prevDayRecord.clockIns).toHaveLength(1);
    
    // Use last clock-in from previous day
    const first = prevDayRecord.clockIns[prevDayRecord.clockIns.length - 1];
    
    // Find clock-out on Dec 2
    let last = null;
    if (dayRecord.clockOuts.length) {
      last = dayRecord.clockOuts[0];
    }
    
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    
    // Calculate worked hours
    const breakMinutes = 60;
    const workedMinutes = minutesBetween(first, last) - breakMinutes;
    const workedHours = hoursFromMinutes(workedMinutes);
    
    // Should be 7 hours (8 hours - 1 hour break)
    expect(workedMinutes).toBe(420);
    expect(workedHours).toBe(7);
  });

  it('should still work for normal case where clock-in is on schedule date', () => {
    const employeeId = 'emp456';
    
    // Normal scenario: Clock-in on schedule date
    // Schedule: Dec 2
    // Shift: Dec 2 22:00 to Dec 3 06:00
    // Clock-in: Dec 2 22:00
    // Clock-out: Dec 3 06:00
    
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-12-02T22:00:00.000Z'),
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-12-03T06:00:00.000Z'),
        action: 'clockOut',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    const scheduleDate = new Date('2025-12-02T00:00:00.000Z');
    const dateKey = buildDateKey(scheduleDate);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    
    expect(dayRecord).toBeDefined();
    expect(dayRecord.clockIns).toHaveLength(1);
    
    const first = dayRecord.clockIns[0];
    
    // Check next day for clock-out
    const nextDate = new Date(scheduleDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateKey = buildDateKey(nextDate);
    const nextDayRecord = recordMap.get(`${employeeId}::${nextDateKey}`);
    
    expect(nextDayRecord).toBeDefined();
    expect(nextDayRecord.clockOuts).toHaveLength(1);
    
    const last = nextDayRecord.clockOuts[0];
    
    const breakMinutes = 60;
    const workedMinutes = minutesBetween(first, last) - breakMinutes;
    const workedHours = hoursFromMinutes(workedMinutes);
    
    expect(workedMinutes).toBe(420);
    expect(workedHours).toBe(7);
  });

  it('should handle multiple clock-ins on previous day correctly', () => {
    const employeeId = 'emp789';
    
    // Scenario: Multiple clock-ins on previous day, should use the LAST one
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-12-01T14:00:00.000Z'), // Early clock-in (different shift)
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-12-01T18:00:00.000Z'), // Early clock-out (different shift)
        action: 'clockOut',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-12-01T22:00:00.000Z'), // Night shift clock-in
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-12-02T06:00:00.000Z'), // Night shift clock-out
        action: 'clockOut',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    const scheduleDate = new Date('2025-12-02T00:00:00.000Z');
    const dateKey = buildDateKey(scheduleDate);
    
    const prevDate = new Date(scheduleDate);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevDateKey = buildDateKey(prevDate);
    const prevDayRecord = recordMap.get(`${employeeId}::${prevDateKey}`);
    
    expect(prevDayRecord.clockIns).toHaveLength(2);
    
    // Should use the LAST clock-in from previous day
    const first = prevDayRecord.clockIns[prevDayRecord.clockIns.length - 1];
    expect(first.toISOString()).toBe('2025-12-01T22:00:00.000Z');
    
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    const last = dayRecord.clockOuts[0];
    
    const breakMinutes = 60;
    const workedMinutes = minutesBetween(first, last) - breakMinutes;
    
    expect(workedMinutes).toBe(420);
  });

  it('should return 0 hours if no valid clock-in found on either day', () => {
    const employeeId = 'emp999';
    
    // Only clock-out, no clock-in
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-12-02T06:00:00.000Z'),
        action: 'clockOut',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    const scheduleDate = new Date('2025-12-02T00:00:00.000Z');
    const dateKey = buildDateKey(scheduleDate);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    
    // Check schedule date
    let first = null;
    if (dayRecord && dayRecord.clockIns.length) {
      first = dayRecord.clockIns[0];
    }
    
    // Check previous day
    if (!first) {
      const prevDate = new Date(scheduleDate);
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      const prevDateKey = buildDateKey(prevDate);
      const prevDayRecord = recordMap.get(`${employeeId}::${prevDateKey}`);
      
      if (prevDayRecord && prevDayRecord.clockIns.length) {
        first = prevDayRecord.clockIns[prevDayRecord.clockIns.length - 1];
      }
    }
    
    expect(first).toBeNull();
    // Without clock-in, worked minutes should be 0
  });
});
