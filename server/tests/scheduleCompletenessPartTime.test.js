// 兼職人員只免「排班規範」檢核（一例一休、工時、班間隔）；「每天都有班表」的完整性檢查
// （GET /api/schedules/validate、/incomplete、/can-finalize 用的 scheduleValidationService）照常計入。
// 這個測試把客戶確認前的決定固定下來，之後要改成免檢核時會先在這裡被看見。
import { jest } from '@jest/globals';

const mockEmployee = { find: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockLoadApprovedLeaveCalendar = jest.fn();
const mockLoadApprovedLeaveIntervals = jest.fn();
const mockLeaveDaysFromCalendar = jest.fn();

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
  loadApprovedLeaveCalendar: mockLoadApprovedLeaveCalendar,
  loadApprovedLeaveIntervals: mockLoadApprovedLeaveIntervals,
  leaveDaysFromCalendar: mockLeaveDaysFromCalendar,
}));

const { validateMonthSchedules, canFinalizeSchedules } = await import('../src/services/scheduleValidationService.js');

const leanQuery = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const DAY_MS = 24 * 60 * 60 * 1000;
const ids = { fullTime: 'f'.repeat(24), partTime: 'a'.repeat(24), excludedSupervisor: 'b'.repeat(24) };

// 2026-09 共 30 天
function septemberRows(employeeId, days) {
  const start = Date.UTC(2026, 8, 1);
  return Array.from({ length: days }, (_, index) => ({
    employee: employeeId,
    date: new Date(start + index * DAY_MS),
    shiftId: 'day',
  }));
}

beforeEach(() => {
  [mockEmployee.find, mockShiftSchedule.find, mockAttendanceSetting.findOne, mockLoadApprovedLeaveCalendar, mockLoadApprovedLeaveIntervals, mockLeaveDaysFromCalendar]
    .forEach((fn) => fn.mockReset());
  mockEmployee.find.mockReturnValue(leanQuery([
    { _id: ids.fullTime, name: '正職', role: 'employee', partTime: false },
    { _id: ids.partTime, name: '兼職', role: 'employee', partTime: true },
    { _id: ids.excludedSupervisor, name: '不排班主管', role: 'supervisor', requiresScheduling: false },
  ]));
  mockAttendanceSetting.findOne.mockReturnValue(leanQuery({ shifts: [{ _id: 'day', code: '日', name: '日班', startTime: '08:00', endTime: '17:00' }] }));
  mockShiftSchedule.find.mockImplementation((filter) => leanQuery(
    String(filter.employee) === ids.partTime ? septemberRows(ids.partTime, 3) : septemberRows(ids.fullTime, 30),
  ));
  mockLoadApprovedLeaveCalendar.mockResolvedValue({});
  mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map());
  mockLeaveDaysFromCalendar.mockReturnValue(new Set());
});

describe('schedule completeness check and part-time staff', () => {
  it('still counts a part-time employee without a row on every day as incomplete, next to a complete full-time employee', async () => {
    const validation = await validateMonthSchedules('2026-09');

    expect(validation.totalEmployees).toBe(2);
    expect(validation.completeCount).toBe(1);
    expect(validation.incompleteCount).toBe(1);
    expect(validation.incompleteEmployees).toEqual([
      expect.objectContaining({ employeeId: ids.partTime, employeeName: '兼職', actualScheduledDays: 3, isComplete: false }),
    ]);
    expect(validation.incompleteEmployees[0].missingDays).toHaveLength(27);
  });

  it('keeps skipping only the supervisors who do not take part in scheduling', async () => {
    const validation = await validateMonthSchedules('2026-09');
    expect(validation.results.map((item) => item.employeeId)).not.toContain(ids.excludedSupervisor);
  });

  it('therefore the part-time employee still blocks can-finalize until the month is filled in', async () => {
    const result = await canFinalizeSchedules('2026-09');
    expect(result.canFinalize).toBe(false);
    expect(result.reason).toBe('1 employee(s) have incomplete schedules');

    mockShiftSchedule.find.mockImplementation((filter) => leanQuery(septemberRows(String(filter.employee), 30)));
    expect((await canFinalizeSchedules('2026-09')).canFinalize).toBe(true);
  });
});
