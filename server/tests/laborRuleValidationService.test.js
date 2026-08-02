import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockShiftSchedule = {
  find: jest.fn(),
  findOne: jest.fn(),
};
const mockAttendanceSetting = { findOne: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockFormField = { find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: mockGetLeaveFieldIds,
}));

const {
  assertScheduleRuleCompliance,
  assertApprovalRequestCompliance,
  assertOvertimeApprovalCompliance,
  __testUtils,
} = await import('../src/services/laborRuleValidationService.js');

function leanQuery(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function sortableLeanQuery(value) {
  const chain = {
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

const attendanceSetting = {
  shifts: [
    { _id: 'D', code: 'D', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
    { _id: 'E', code: 'E', name: '晚班', startTime: '16:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
    { _id: 'LONG', code: 'L', name: '長班', startTime: '08:00', endTime: '22:00', breakMinutes: 60 },
    { _id: 'REST', code: '休', name: '休息日' },
    { _id: 'REG', code: '例', name: '例假' },
  ],
};

const overtimeFields = [
  { _id: 'start', label: '開始時間' },
  { _id: 'end', label: '結束時間' },
];

beforeEach(() => {
  mockShiftSchedule.find.mockReset();
  mockShiftSchedule.findOne.mockReset();
  mockAttendanceSetting.findOne.mockReset();
  mockApprovalRequest.find.mockReset();
  mockFormField.find.mockReset();
  mockGetLeaveFieldIds.mockReset();

  mockAttendanceSetting.findOne.mockReturnValue(leanQuery(attendanceSetting));
  mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
  mockShiftSchedule.findOne.mockReturnValue(leanQuery(null));
  mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([]));
  mockFormField.find.mockReturnValue(sortableLeanQuery(overtimeFields));
  mockGetLeaveFieldIds.mockResolvedValue({});
});

describe('assertScheduleRuleCompliance', () => {
  it('normalizes MongoDB ObjectIds without following the self-referencing _id getter', () => {
    const id = new mongoose.Types.ObjectId();
    expect(__testUtils.normalizeId(id)).toBe(id.toHexString());
  });

  it('rejects shift changes with less than 11 hours between shifts', async () => {
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'old1', employee: 'emp1', date: new Date('2024-04-01'), shiftId: 'E' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-02'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'shift-gap' })],
    });
  });

  it('rejects a scheduled workday longer than 12 hours', async () => {
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-01'), shiftId: 'LONG' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'daily-work-hours' })],
    });
  });

  it('rejects seven consecutive days without rest or regular rest', async () => {
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      '2024-04-01',
      '2024-04-02',
      '2024-04-03',
      '2024-04-04',
      '2024-04-05',
      '2024-04-06',
    ].map((date, index) => ({
      _id: `old${index}`,
      employee: 'emp1',
      date: new Date(date),
      shiftId: 'D',
    }))));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-07'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'continuous-work-days' })],
    });
  });

  it('counts approved leave and holidays toward the six-day limit between rest days', async () => {
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'leave-form',
      startId: 'leave-start',
      endId: 'leave-end',
    });
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([
      {
        applicant_employee: 'emp1',
        form_data: { 'leave-start': '2024-04-07', 'leave-end': '2024-04-08' },
      },
      {
        applicant_employee: 'emp1',
        form_data: { 'leave-start': '2024-04-13', 'leave-end': '2024-04-13' },
      },
    ]));
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'regular-rest', employee: 'emp1', date: new Date('2024-04-06'), shiftId: 'REG' },
      { _id: 'work-1', employee: 'emp1', date: new Date('2024-04-09'), shiftId: 'D' },
      { _id: 'work-2', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D' },
      { _id: 'work-3', employee: 'emp1', date: new Date('2024-04-11'), shiftId: 'D' },
      { _id: 'work-4', employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' },
      { _id: 'rest', employee: 'emp1', date: new Date('2024-04-14'), shiftId: 'REST' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({
        rule: 'continuous-work-days',
        dates: [
          '2024-04-07',
          '2024-04-08',
          '2024-04-09',
          '2024-04-10',
          '2024-04-11',
          '2024-04-12',
          '2024-04-13',
        ],
      })],
    });
  });

  it('rejects publish when a Monday-Sunday week misses one regular rest day', async () => {
    const week = [
      ['2024-04-01', 'D'],
      ['2024-04-02', 'D'],
      ['2024-04-03', 'D'],
      ['2024-04-04', 'D'],
      ['2024-04-05', 'D'],
      ['2024-04-06', 'REST'],
      ['2024-04-07', 'D'],
    ].map(([date, shiftId], index) => ({
      _id: `candidate${index}`,
      employee: 'emp1',
      date: new Date(date),
      shiftId,
    }));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: week,
      range: { start: new Date('2024-04-01'), end: new Date('2024-04-08') },
      strictWeeklyRest: true,
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'weekly-one-regular-rest-one-rest-day' })],
    });
  });
});

describe('assertOvertimeApprovalCompliance', () => {
  it('rejects overtime on a regular rest day', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({
      _id: 'sch1',
      employee: 'emp1',
      date: new Date('2024-04-07'),
      shiftId: 'REG',
    }));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-07T02:00:00.000Z',
        end: '2024-04-07T04:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'regular-rest-overtime' })],
    });
  });

  it('rejects overtime when approved month total would exceed 46 hours', async () => {
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([
      {
        _id: 'approved1',
        form_data: {
          start: '2024-04-01T00:00:00.000Z',
          end: '2024-04-02T21:00:00.000Z',
        },
      },
    ]));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-10T00:00:00.000Z',
        end: '2024-04-10T02:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'monthly-overtime-hours' })],
    });
  });
});

describe('assertApprovalRequestCompliance', () => {
  const leaveFields = [
    { _id: 'type', label: '假別', type_1: 'text', required: true },
    { _id: 'reason', label: '事由', type_1: 'textarea' },
    { _id: 'proof', label: '相關證明', type_1: 'file', required: true },
  ];

  it('rejects personal leave without a reason or an uploaded proof', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(leaveFields));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'leave-form', name: '請假' },
      formData: { type: '事假', reason: '', proof: ['proof.pdf'] },
      applicantEmployeeId: 'emp1',
    })).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ rule: 'personal-leave-reason' }),
        expect.objectContaining({ rule: 'leave-proof' }),
      ]),
    });
  });

  it('accepts personal leave with a reason and uploaded proof metadata', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(leaveFields));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'leave-form', name: '請假' },
      formData: {
        type: '事假',
        reason: '家庭事務',
        proof: [{ name: 'proof.pdf', url: '/upload/approvals/proof.pdf' }],
      },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });
});
