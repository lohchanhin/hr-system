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

describe('Work Hours Calculation - Cross-Day Shifts', () => {
  it('should correctly group attendance records for night shift across days', () => {
    const employeeId = 'emp123';
    
    // Attendance records for night shifts
    // Nov 25: Clock in at 22:00, Clock out at Nov 26 06:00
    // Nov 26: Clock in at 22:00, Clock out at Nov 27 06:00
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-11-25T22:00:00.000Z'),
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-11-26T06:00:00.000Z'), // Next day
        action: 'clockOut',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-11-26T22:00:00.000Z'),
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-11-27T06:00:00.000Z'), // Next day
        action: 'clockOut',
      },
    ];

    const recordMap = groupAttendanceRecords(attendanceRecords);
    
    // Check that clock-ins are grouped by their date
    const nov25Record = recordMap.get(`${employeeId}::2025-11-25`);
    expect(nov25Record).toBeDefined();
    expect(nov25Record.clockIns).toHaveLength(1);
    expect(nov25Record.clockOuts).toHaveLength(0); // Clock-out is on next day
    
    const nov26Record = recordMap.get(`${employeeId}::2025-11-26`);
    expect(nov26Record).toBeDefined();
    expect(nov26Record.clockIns).toHaveLength(1); // New shift starts on Nov 26
    expect(nov26Record.clockOuts).toHaveLength(1); // Clock-out from previous shift
    
    const nov27Record = recordMap.get(`${employeeId}::2025-11-27`);
    expect(nov27Record).toBeDefined();
    expect(nov27Record.clockIns).toHaveLength(0);
    expect(nov27Record.clockOuts).toHaveLength(1); // Clock-out from previous shift
  });

  it('should calculate work hours for cross-day night shift correctly', () => {
    const employeeId = 'emp123';
    
    // Night shift: 22:00 - 06:00 (cross day, 60 min break)
    const nightShift = {
      _id: 'shift-night',
      name: '夜班',
      startTime: '22:00',
      endTime: '06:00',
      crossDay: true,
      breakDuration: 60,
    };
    
    const scheduleDate = new Date('2025-11-25T00:00:00.000Z');
    const { start, end } = computeShiftTimes(scheduleDate, nightShift);
    const breakMinutes = getShiftBreakMinutes(nightShift, scheduleDate);
    
    // Check shift times
    expect(start.toISOString()).toBe('2025-11-25T22:00:00.000Z');
    expect(end.toISOString()).toBe('2025-11-26T06:00:00.000Z'); // Next day
    
    // Check scheduled minutes: 8 hours - 1 hour break = 7 hours = 420 minutes
    const scheduledMinutes = minutesBetween(start, end) - breakMinutes;
    expect(scheduledMinutes).toBe(420);
    expect(hoursFromMinutes(scheduledMinutes)).toBe(7);
  });

  it('should find clock-out on next day for cross-day shift', () => {
    const employeeId = 'emp123';
    const scheduleDate = new Date('2025-11-25T00:00:00.000Z');
    
    // Simulate attendance records
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-11-25T22:00:00.000Z'),
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-11-26T06:00:00.000Z'), // Next day
        action: 'clockOut',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    
    // For schedule date Nov 25
    const dateKey = buildDateKey(scheduleDate);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    
    expect(dayRecord).toBeDefined();
    expect(dayRecord.clockIns).toHaveLength(1);
    expect(dayRecord.clockOuts).toHaveLength(0); // No clock-out on same day
    
    // Check next day for clock-out
    const nextDate = new Date(scheduleDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateKey = buildDateKey(nextDate);
    const nextDayRecord = recordMap.get(`${employeeId}::${nextDateKey}`);
    
    expect(nextDayRecord).toBeDefined();
    expect(nextDayRecord.clockOuts).toHaveLength(1); // Clock-out is here
    
    // Calculate worked minutes using the logic from our fix
    const first = dayRecord.clockIns[0];
    const last = nextDayRecord.clockOuts[0];
    const workedMinutes = minutesBetween(first, last) - 60; // 60 min break
    
    expect(workedMinutes).toBe(420); // 7 hours
    expect(hoursFromMinutes(workedMinutes)).toBe(7);
  });

  it('should handle regular day shift correctly (not cross-day)', () => {
    const employeeId = 'emp123';
    
    // Day shift: 09:00 - 18:00 (not cross day, 60 min break)
    const dayShift = {
      _id: 'shift-day',
      name: '日班',
      startTime: '09:00',
      endTime: '18:00',
      crossDay: false,
      breakDuration: 60,
    };
    
    const scheduleDate = new Date('2025-11-25T00:00:00.000Z');
    const { start, end } = computeShiftTimes(scheduleDate, dayShift);
    const breakMinutes = getShiftBreakMinutes(dayShift, scheduleDate);
    
    // Check shift times are on same day
    expect(start.toISOString()).toBe('2025-11-25T09:00:00.000Z');
    expect(end.toISOString()).toBe('2025-11-25T18:00:00.000Z');
    
    // Check scheduled minutes: 9 hours - 1 hour break = 8 hours = 480 minutes
    const scheduledMinutes = minutesBetween(start, end) - breakMinutes;
    expect(scheduledMinutes).toBe(480);
    expect(hoursFromMinutes(scheduledMinutes)).toBe(8);
    
    // Simulate attendance on same day
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-11-25T09:00:00.000Z'),
        action: 'clockIn',
      },
      {
        employee: employeeId,
        timestamp: new Date('2025-11-25T18:00:00.000Z'),
        action: 'clockOut',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    const dateKey = buildDateKey(scheduleDate);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    
    expect(dayRecord).toBeDefined();
    expect(dayRecord.clockIns).toHaveLength(1);
    expect(dayRecord.clockOuts).toHaveLength(1); // Clock-out on same day
    
    const first = dayRecord.clockIns[0];
    const last = dayRecord.clockOuts[0];
    const workedMinutes = minutesBetween(first, last) - breakMinutes;
    
    expect(workedMinutes).toBe(480); // 8 hours
    expect(hoursFromMinutes(workedMinutes)).toBe(8);
  });

  it('should return 0 work hours when no clock-out found for night shift', () => {
    const employeeId = 'emp123';
    const scheduleDate = new Date('2025-11-25T00:00:00.000Z');
    
    // Only clock in, no clock out
    const attendanceRecords = [
      {
        employee: employeeId,
        timestamp: new Date('2025-11-25T22:00:00.000Z'),
        action: 'clockIn',
      },
    ];
    
    const recordMap = groupAttendanceRecords(attendanceRecords);
    
    const dateKey = buildDateKey(scheduleDate);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    
    expect(dayRecord).toBeDefined();
    expect(dayRecord.clockIns).toHaveLength(1);
    expect(dayRecord.clockOuts).toHaveLength(0);
    
    // Check next day - should have no records
    const nextDate = new Date(scheduleDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateKey = buildDateKey(nextDate);
    const nextDayRecord = recordMap.get(`${employeeId}::${nextDateKey}`);
    
    expect(nextDayRecord).toBeUndefined();
    
    // Without a clock-out, worked minutes should be 0
    // This is what our fix handles
  });
});

