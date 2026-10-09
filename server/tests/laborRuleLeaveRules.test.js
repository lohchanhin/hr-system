import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

// 請假與加班檢核的新規則：附件必須是真的上傳檔案、停用欄位不擋送簽、請假時間順序與重複申請、
// 表單性質決定套用哪組規則、加班與請假的日期以台灣時間判斷。

const mockShiftSchedule = { find: jest.fn(), findOne: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockFormField = { find: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockGetAllLeaveFieldInfos = jest.fn();

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}));

const {
  assertScheduleRuleCompliance,
  assertApprovalRequestCompliance,
  assertOvertimeApprovalCompliance,
  __testUtils,
} = await import('../src/services/laborRuleValidationService.js');

// 附件檢查看的是簽核附件資料夾：用暫存資料夾放測試檔案，不碰真正的上傳資料夾
const PROOF_FILENAME = 'labor-rule-leave-rules-proof.pdf';
const REAL_ATTACHMENT = { name: 'proof.pdf', url: `/upload/approvals/${PROOF_FILENAME}`, size: 14, type: 'application/pdf' };
let tempUploadDir;
let previousUploadDir;

beforeAll(() => {
  tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labor-rule-leave-rules-'));
  fs.writeFileSync(path.join(tempUploadDir, PROOF_FILENAME), '%PDF-1.4\n%%EOF\n');
  previousUploadDir = __testUtils.setApprovalUploadDir(tempUploadDir);
});

afterAll(() => {
  __testUtils.setApprovalUploadDir(previousUploadDir);
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

function leanQuery(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortableLeanQuery(value) {
  const chain = { sort: jest.fn(() => chain), lean: jest.fn().mockResolvedValue(value) };
  return chain;
}

// 可以 select 的查詢（請假重疊檢查會投影欄位）
function selectableLeanQuery(value) {
  const chain = { select: jest.fn(() => chain), lean: jest.fn().mockResolvedValue(value) };
  return chain;
}

const attendanceSetting = {
  shifts: [
    { _id: 'D', code: 'D', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
    { _id: 'REST', code: '休', name: '休息日' },
    { _id: 'REG', code: '例', name: '例假' },
  ],
};

beforeEach(() => {
  mockShiftSchedule.find.mockReset();
  mockShiftSchedule.findOne.mockReset();
  mockAttendanceSetting.findOne.mockReset();
  mockApprovalRequest.find.mockReset();
  mockFormField.find.mockReset();
  mockHoliday.find.mockReset();
  mockHolidayMoveSetting.find.mockReset();
  mockGetAllLeaveFieldInfos.mockReset();

  mockAttendanceSetting.findOne.mockReturnValue(leanQuery(attendanceSetting));
  mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
  mockShiftSchedule.findOne.mockReturnValue(leanQuery(null));
  mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([]));
  mockFormField.find.mockReturnValue(sortableLeanQuery([]));
  mockHoliday.find.mockReturnValue(leanQuery([]));
  mockHolidayMoveSetting.find.mockReturnValue(leanQuery([]));
  mockGetAllLeaveFieldInfos.mockResolvedValue([]);
});

async function violationsOf(args) {
  try {
    await assertApprovalRequestCompliance(args);
    return [];
  } catch (error) {
    if (Array.isArray(error?.violations)) return error.violations;
    throw error;
  }
}

describe('leave proof must be a file the upload endpoint really stored', () => {
  const form = { _id: 'leave-form', name: '請假', semanticType: 'leave' };
  const fields = [
    { _id: 'type', label: '假別', type_1: 'text', required: true },
    { _id: 'proof', label: '相關證明', type_1: 'file', required: true },
  ];
  const run = (proof) => violationsOf({
    form,
    formData: { type: '特休', proof },
    applicantEmployeeId: 'emp1',
  });

  beforeEach(() => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(fields));
  });

  it('accepts the array of { name, url, size, type } the real client sends', async () => {
    expect(await run([REAL_ATTACHMENT])).toEqual([]);
  });

  it('accepts a single attachment object and the path property', async () => {
    expect(await run(REAL_ATTACHMENT)).toEqual([]);
    expect(await run([{ name: 'proof.pdf', path: REAL_ATTACHMENT.url }])).toEqual([]);
  });

  it.each([
    ['a made-up path that has no file', [{ name: 'x.pdf', url: '/upload/approvals/does-not-exist-fake.pdf' }]],
    ['a bare string even when it names a real file', [REAL_ATTACHMENT.url]],
    ['a bare string that names nothing', '/upload/approvals/x'],
    ['a path outside the approval upload folder', [{ name: 'x.pdf', url: '/upload/employees/photo.png' }]],
    ['a path traversal attempt', [{ name: 'x.pdf', url: '/upload/approvals/../../package.json' }]],
    ['a nested path', [{ name: 'x.pdf', url: `/upload/approvals/sub/${PROOF_FILENAME}` }]],
    ['a directory', [{ name: 'x.pdf', url: '/upload/approvals/.' }]],
    ['a real attachment mixed with a made-up one', [REAL_ATTACHMENT, { name: 'y.pdf', url: '/upload/approvals/nope.pdf' }]],
    ['an object without any url', [{ name: 'proof.pdf' }]],
  ])('rejects %s', async (_label, proof) => {
    expect(await run(proof)).toEqual([
      { rule: 'leave-proof', message: '請假申請必須附上相關證明', fieldId: 'proof' },
    ]);
  });
});

describe('required fields', () => {
  it('ignores inactive required fields, so a deactivated field cannot block every submission', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'note', label: '備註', type_1: 'text' },
      { _id: 'old', label: '舊必填欄位', type_1: 'text', required: true, is_active: false },
    ]));

    expect(await violationsOf({
      form: { _id: 'general-form', name: '在職證明', semanticType: 'general' },
      formData: {},
      applicantEmployeeId: 'emp1',
    })).toEqual([]);
  });

  it('still enforces the required fields that are active', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'old', label: '舊必填欄位', type_1: 'text', required: true, is_active: false },
      { _id: 'purpose', label: '用途', type_1: 'text', required: true },
    ]));

    expect(await violationsOf({
      form: { _id: 'general-form', name: '在職證明', semanticType: 'general' },
      formData: {},
      applicantEmployeeId: 'emp1',
    })).toEqual([
      { rule: 'required-form-field', message: '必填欄位不可空白：用途', fieldId: 'purpose', label: '用途' },
    ]);
  });

  describe('requiredFieldsAsOf (re-checking a request that was already filed)', () => {
    const filedAt = new Date('2026-10-01T00:00:00.000Z');
    const form = { _id: 'general-form', name: '在職證明', semanticType: 'general' };

    it('does not apply a field that was added or changed after the request was filed', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery([
        { _id: 'purpose', label: '用途', type_1: 'text', required: true, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01') },
        { _id: 'agent', label: '代理人', type_1: 'text', required: true, createdAt: new Date('2026-10-05'), updatedAt: new Date('2026-10-05') },
        { _id: 'flipped', label: '備註', type_1: 'text', required: true, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-10-06') },
      ]));

      expect(await violationsOf({
        form, formData: { purpose: '信貸' }, applicantEmployeeId: 'emp1', requiredFieldsAsOf: filedAt,
      })).toEqual([]);
    });

    it('still enforces a field that already existed when the request was filed', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery([
        { _id: 'purpose', label: '用途', type_1: 'text', required: true, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01') },
      ]));

      expect(await violationsOf({
        form, formData: {}, applicantEmployeeId: 'emp1', requiredFieldsAsOf: filedAt,
      })).toEqual([expect.objectContaining({ rule: 'required-form-field', label: '用途' })]);
    });

    it('checks every required field when no date is given (new submission)', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery([
        { _id: 'agent', label: '代理人', type_1: 'text', required: true, createdAt: new Date('2026-10-05'), updatedAt: new Date('2026-10-05') },
      ]));

      expect(await violationsOf({ form, formData: {}, applicantEmployeeId: 'emp1' }))
        .toEqual([expect.objectContaining({ rule: 'required-form-field', label: '代理人' })]);
    });
  });
});

describe('leave time order and duplicate requests', () => {
  const leaveForm = { _id: 'leave-form', name: '請假', semanticType: 'leave' };
  const defaultFields = [
    { _id: 'type', label: '假別', type_1: 'text', required: true },
    { _id: 'start', label: '開始時間', type_1: 'datetime', required: true },
    { _id: 'end', label: '結束時間', type_1: 'datetime', required: true },
    { _id: 'reason', label: '事由', type_1: 'textarea' },
  ];
  const customerForm = { _id: 'customer-form', name: '休假/事假/公假申請單', semanticType: 'leave' };
  const customerFields = [
    { _id: 'c-type', label: '假別類別 (C12)', type_1: 'select', required: true },
    { _id: 'c-start', label: '日期(起)', type_1: 'date', required: true },
    { _id: 'c-end', label: '日期(迄)', type_1: 'date', required: true },
    { _id: 'c-days', label: '天數', type_1: 'number', required: true },
  ];
  const DEFAULT_INFO = { formId: 'leave-form', startId: 'start', endId: 'end', typeId: 'type' };
  const CUSTOMER_INFO = { formId: 'customer-form', startId: 'c-start', endId: 'c-end', typeId: 'c-type', daysId: 'c-days' };

  // 2026-10-05 09:00-13:00 台灣時間
  const morning = { type: '事假', reason: '家庭事務', start: '2026-10-05T01:00:00.000Z', end: '2026-10-05T05:00:00.000Z' };

  const fileLeave = (extra = {}) => violationsOf({
    form: leaveForm,
    formData: { ...morning, ...extra },
    applicantEmployeeId: 'emp1',
    checkLeaveConflicts: true,
  });

  beforeEach(() => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(defaultFields));
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_INFO]);
  });

  describe('time order', () => {
    it('rejects an end time before the start time with a Chinese message', async () => {
      const violations = await violationsOf({
        form: leaveForm,
        formData: { ...morning, start: '2026-10-05T05:00:00.000Z', end: '2026-10-05T01:00:00.000Z' },
        applicantEmployeeId: 'emp1',
      });

      expect(violations).toEqual([
        { rule: 'leave-time-range', message: '請假結束時間必須晚於開始時間', fieldId: 'end' },
      ]);
    });

    it('rejects a leave whose end equals its start', async () => {
      const violations = await violationsOf({
        form: leaveForm,
        formData: { ...morning, end: morning.start },
        applicantEmployeeId: 'emp1',
      });

      expect(violations).toEqual([expect.objectContaining({ rule: 'leave-time-range' })]);
    });

    it('rejects a reversed date range on a date-type form', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery(customerFields));

      const violations = await violationsOf({
        form: customerForm,
        formData: { 'c-type': '事假', 'c-start': '2026-10-07', 'c-end': '2026-10-05', 'c-days': 1 },
        applicantEmployeeId: 'emp1',
      });

      expect(violations).toEqual([
        { rule: 'leave-time-range', message: '請假結束日期不可早於開始日期', fieldId: 'c-end' },
      ]);
    });

    it('accepts a one-day date-type leave whose start and end are the same day', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery(customerFields));

      expect(await violationsOf({
        form: customerForm,
        formData: { 'c-type': '特休假', 'c-start': '2026-10-05', 'c-end': '2026-10-05', 'c-days': 1 },
        applicantEmployeeId: 'emp1',
      })).toEqual([]);
    });

    it('reads date-picker values (UTC instants of Taipei midnight) as Taipei days', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery(customerFields));

      // 台灣 6/19 00:00 到 6/19 00:00：同一天，不是顛倒
      expect(await violationsOf({
        form: customerForm,
        formData: { 'c-type': '特休假', 'c-start': '2026-06-18T16:00:00.000Z', 'c-end': '2026-06-18T16:00:00.000Z', 'c-days': 1 },
        applicantEmployeeId: 'emp1',
      })).toEqual([]);
    });

    it('rejects values that cannot be read as dates', async () => {
      const violations = await violationsOf({
        form: leaveForm,
        formData: { ...morning, start: '亂填', end: '亂填' },
        applicantEmployeeId: 'emp1',
      });

      expect(violations).toEqual([expect.objectContaining({ rule: 'leave-time-range' })]);
    });

    it('leaves empty dates to the required-field check', async () => {
      const violations = await violationsOf({
        form: leaveForm,
        formData: { type: '特休', start: '', end: '' },
        applicantEmployeeId: 'emp1',
      });

      expect(violations.map((item) => item.rule)).toEqual(['required-form-field', 'required-form-field']);
    });

    it('does not run for a leave form that has no recognisable start / end field', async () => {
      mockFormField.find.mockReturnValue(sortableLeanQuery([{ _id: 'type', label: '假別', type_1: 'text' }]));

      expect(await violationsOf({
        form: leaveForm, formData: { type: '特休' }, applicantEmployeeId: 'emp1', checkLeaveConflicts: true,
      })).toEqual([]);
      expect(mockApprovalRequest.find).not.toHaveBeenCalled();
    });
  });

  describe('overlapping and duplicate requests', () => {
    function existing(rows) {
      mockApprovalRequest.find.mockImplementation(() => selectableLeanQuery(rows));
    }

    it('rejects an identical request of the same employee that is still pending', async () => {
      existing([{ _id: 'r1', status: 'pending', form_data: { start: morning.start, end: morning.end } }]);

      const violations = await fileLeave();

      expect(violations).toEqual([
        {
          rule: 'leave-overlap',
          message: '請假時間與已申請的假單重疊（簽核中：2026-10-05 09:00 ~ 2026-10-05 13:00），請勿重複申請',
          fieldId: 'end',
          status: 'pending',
        },
      ]);
    });

    it('rejects a request that overlaps an approved leave only in part', async () => {
      existing([{ _id: 'r1', status: 'approved', form_data: { start: '2026-10-05T04:00:00.000Z', end: '2026-10-05T09:00:00.000Z' } }]);

      const violations = await fileLeave();

      expect(violations).toEqual([expect.objectContaining({ rule: 'leave-overlap', status: 'approved' })]);
      expect(violations[0].message).toContain('已核准');
    });

    it('allows a different part of the same day (morning leave after afternoon leave)', async () => {
      existing([{ _id: 'r1', status: 'approved', form_data: { start: '2026-10-05T05:00:00.000Z', end: '2026-10-05T09:00:00.000Z' } }]);

      expect(await fileLeave()).toEqual([]);
    });

    it('allows the day after an approved leave', async () => {
      existing([{ _id: 'r1', status: 'approved', form_data: { start: '2026-10-04T01:00:00.000Z', end: '2026-10-04T09:00:00.000Z' } }]);

      expect(await fileLeave()).toEqual([]);
    });

    it('treats a date-type whole-day leave of another form as covering the whole day', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_INFO, CUSTOMER_INFO]);
      mockApprovalRequest.find.mockImplementation((filter) => selectableLeanQuery(filter.form === 'customer-form'
        ? [{ _id: 'c1', status: 'approved', form_data: { 'c-start': '2026-10-05', 'c-end': '2026-10-06' } }]
        : []));

      const violations = await fileLeave();

      expect(violations).toEqual([expect.objectContaining({ rule: 'leave-overlap' })]);
      expect(violations[0].message).toContain('2026-10-05 ~ 2026-10-06');
    });

    it('compares against the pending and approved requests of this employee in every leave form', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_INFO, CUSTOMER_INFO]);
      existing([]);

      await fileLeave();

      expect(mockApprovalRequest.find).toHaveBeenCalledTimes(2);
      expect(mockApprovalRequest.find).toHaveBeenCalledWith({
        form: 'leave-form', status: { $in: ['pending', 'approved'] }, applicant_employee: 'emp1',
      });
      expect(mockApprovalRequest.find).toHaveBeenCalledWith({
        form: 'customer-form', status: { $in: ['pending', 'approved'] }, applicant_employee: 'emp1',
      });
      expect(mockGetAllLeaveFieldInfos).toHaveBeenCalledWith({ withTypeOptions: false });
    });

    it('does not count the request being re-checked against itself (ignoreRequestId)', async () => {
      existing([{ _id: 'r1', status: 'pending', form_data: { start: morning.start, end: morning.end } }]);

      expect(await violationsOf({
        form: leaveForm,
        formData: morning,
        applicantEmployeeId: 'emp1',
        checkLeaveConflicts: true,
        ignoreRequestId: 'r1',
      })).toEqual([]);
    });

    it('does not look for overlaps unless the caller asks (approving a pending request must not conflict with itself)', async () => {
      existing([{ _id: 'r1', status: 'pending', form_data: { start: morning.start, end: morning.end } }]);

      expect(await violationsOf({ form: leaveForm, formData: morning, applicantEmployeeId: 'emp1' })).toEqual([]);
      expect(mockApprovalRequest.find).not.toHaveBeenCalled();
    });

    it('ignores rows whose dates cannot be read', async () => {
      existing([{ _id: 'r1', status: 'pending', form_data: {} }]);

      expect(await fileLeave()).toEqual([]);
    });
  });
});

describe('the form type decides which rules apply, not the form name', () => {
  const moneyFields = [{ _id: 'amount', label: '金額', type_1: 'number', required: true }];

  it('does not apply the overtime rules to a 加班費申請 form that is marked 一般', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(moneyFields));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'money', name: '加班費申請', semanticType: 'general' },
      formData: { amount: 1200 },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'money', name: '加班費申請', semanticType: 'general' },
      formData: { amount: 1200 },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('does not apply the leave rules to a 請假 form that is marked 一般', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'proof', label: '相關證明', type_1: 'file', required: false },
      { _id: 'type', label: '假別', type_1: 'text' },
    ]));

    expect(await violationsOf({
      form: { _id: 'f', name: '請假 但不需要證明', semanticType: 'general' },
      formData: { type: '事假', proof: 'whatever' },
      applicantEmployeeId: 'emp1',
      checkLeaveConflicts: true,
    })).toEqual([]);
  });

  it('applies the overtime rules to a form marked 加班 whatever its name', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'start', label: '開始時間', type_1: 'datetime' },
      { _id: 'end', label: '結束時間', type_1: 'datetime' },
    ]));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'ot', name: '延長工時申請', semanticType: 'overtime' },
      formData: {},
      applicantEmployeeId: 'emp1',
    })).rejects.toMatchObject({ violations: [expect.objectContaining({ rule: 'overtime-time-range' })] });
  });

  it('still infers the type from the name when the template has no type at all', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'start', label: '開始時間', type_1: 'datetime' },
      { _id: 'end', label: '結束時間', type_1: 'datetime' },
    ]));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'ot', name: '加班申請' },
      formData: {},
      applicantEmployeeId: 'emp1',
    })).rejects.toMatchObject({ violations: [expect.objectContaining({ rule: 'overtime-time-range' })] });
  });
});

describe('dates are read in Taiwan time', () => {
  const overtimeForm = { _id: 'ot-form', name: '加班申請', semanticType: 'overtime' };
  const otFields = [
    { _id: 'start', label: '開始時間', type_1: 'datetime', required: true },
    { _id: 'end', label: '結束時間', type_1: 'datetime', required: true },
  ];

  beforeEach(() => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(otFields));
  });

  it('formDay turns the UTC instant of Taipei 00:00 into that Taipei day', () => {
    expect(__testUtils.formDay('2026-06-18T16:00:00.000Z').toISOString()).toBe('2026-06-19T00:00:00.000Z');
    expect(__testUtils.formDay('2026-06-19').toISOString()).toBe('2026-06-19T00:00:00.000Z');
    expect(__testUtils.formDay('不是日期')).toBeNull();
  });

  it('attaches early-morning overtime (local 06:00-08:00 on 11/10) to the schedule of 11/10, not 11/09', async () => {
    mockShiftSchedule.findOne.mockImplementation((filter) => leanQuery(
      filter.date.toISOString() === '2026-11-10T00:00:00.000Z'
        ? { _id: 'sch', employee: 'emp1', date: filter.date, shiftId: 'D' }
        : null,
    ));

    await expect(assertOvertimeApprovalCompliance({
      form: overtimeForm,
      applicantEmployeeId: 'emp1',
      // 台灣 11/10 06:00-08:00
      formData: { start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T00:00:00.000Z' },
    })).resolves.toEqual({ ok: true, violations: [] });
    expect(mockShiftSchedule.findOne).toHaveBeenCalledWith({
      employee: 'emp1',
      date: new Date('2026-11-10T00:00:00.000Z'),
    });
  });

  it('names the Taipei day in the missing-schedule message', async () => {
    await expect(assertOvertimeApprovalCompliance({
      form: overtimeForm,
      applicantEmployeeId: 'emp1',
      formData: { start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T00:00:00.000Z' },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({
        rule: 'overtime-schedule-required',
        date: '2026-11-10',
        message: '加班申請必須先有當日班表：2026-11-10',
      })],
    });
  });

  it('keeps the evening overtime of the same Taipei day on the same schedule', async () => {
    mockShiftSchedule.findOne.mockImplementation((filter) => leanQuery(
      filter.date.toISOString() === '2026-11-10T00:00:00.000Z'
        ? { _id: 'sch', employee: 'emp1', date: filter.date, shiftId: 'D' }
        : null,
    ));

    await expect(assertOvertimeApprovalCompliance({
      form: overtimeForm,
      applicantEmployeeId: 'emp1',
      // 台灣 11/10 19:00-21:00
      formData: { start: '2026-11-10T11:00:00.000Z', end: '2026-11-10T13:00:00.000Z' },
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('adds approved overtime to the Taipei day it falls on when checking the 4 hour daily limit', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({ _id: 'sch', employee: 'emp1', date: new Date('2026-11-10T00:00:00.000Z'), shiftId: 'D' }));
    // 已核准：台灣 11/10 06:00-09:00（UTC 11/09 22:00-11/10 01:00），舊程式算成 11/09
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
      _id: 'approved',
      form_data: { start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T01:00:00.000Z' },
    }]));

    await expect(assertOvertimeApprovalCompliance({
      form: overtimeForm,
      applicantEmployeeId: 'emp1',
      // 台灣 11/10 19:00-21:00，合計 5 小時
      formData: { start: '2026-11-10T11:00:00.000Z', end: '2026-11-10T13:00:00.000Z' },
    })).rejects.toMatchObject({
      violations: expect.arrayContaining([expect.objectContaining({ rule: 'daily-overtime-hours', date: '2026-11-10', minutes: 300 })]),
    });
  });

  it('reads a date + hours overtime from 00:00 Taipei time of that day', () => {
    const fields = [
      { _id: 'date', label: '加班日期', type_1: 'date' },
      { _id: 'hours', label: '加班時數', type_1: 'number' },
    ];

    // 日期選擇器的台灣 11/10 00:00 = UTC 11/09 16:00
    const payload = __testUtils.parseOvertimePayload({ date: '2026-11-09T16:00:00.000Z', hours: 2 }, fields);

    expect(payload.start.toISOString()).toBe('2026-11-09T16:00:00.000Z');
    expect(payload.end.toISOString()).toBe('2026-11-09T18:00:00.000Z');
    expect(payload.minutes).toBe(120);
  });

  it('ignores a deactivated duplicate when reading the overtime fields', () => {
    const fields = [
      { _id: 'old-start', label: '開始時間', type_1: 'datetime', is_active: false },
      { _id: 'start', label: '開始時間', type_1: 'datetime' },
      { _id: 'end', label: '結束時間', type_1: 'datetime' },
    ];

    const payload = __testUtils.parseOvertimePayload(
      { 'old-start': '2026-11-01T00:00:00.000Z', start: '2026-11-10T01:00:00.000Z', end: '2026-11-10T03:00:00.000Z' },
      fields,
    );

    expect(payload.minutes).toBe(120);
  });

  it('marks approved leave on the Taipei day: a leave from 6/19 00:00 does not block 6/18', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{ formId: 'leave-form', startId: 'leave-start', endId: 'leave-end' }]);
    // 台灣 6/19 00:00-18:00 的核准假單，UTC 是 6/18 16:00 到 6/19 10:00
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
      applicant_employee: 'emp1',
      form_data: { 'leave-start': '2026-06-18T16:00:00.000Z', 'leave-end': '2026-06-19T10:00:00.000Z' },
    }]));
    // 6/12-6/17 連續六天上班，6/18 沒有排班也沒有請假；若請假被誤算到 6/18，就會連成第七天
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(
      ['12', '13', '14', '15', '16', '17'].map((day) => ({
        _id: `s${day}`, employee: 'emp1', date: new Date(`2026-06-${day}T00:00:00.000Z`), shiftId: 'D',
      })),
    ));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2026-06-12T00:00:00.000Z'), shiftId: 'D' }],
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('still counts the leave day itself (6/19) toward the six-day limit', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{ formId: 'leave-form', startId: 'leave-start', endId: 'leave-end' }]);
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
      applicant_employee: 'emp1',
      form_data: { 'leave-start': '2026-06-18T16:00:00.000Z', 'leave-end': '2026-06-19T10:00:00.000Z' },
    }]));
    // 6/13-6/18 六天上班，6/19 請假：第七天
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(
      ['13', '14', '15', '16', '17', '18'].map((day) => ({
        _id: `s${day}`, employee: 'emp1', date: new Date(`2026-06-${day}T00:00:00.000Z`), shiftId: 'D',
      })),
    ));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2026-06-13T00:00:00.000Z'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({
        rule: 'continuous-work-days',
        dates: ['2026-06-13', '2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'],
      })],
    });
  });
});

// 加班單的開始 / 結束 / 事由欄位被刪除（有申請單的欄位只是停用）又重建同標籤的新欄位後，
// 舊的已核准加班仍在舊欄位 ID 底下：每日、每月、連續三個月的加班上限不能把它們漏掉
describe('approved overtime whose answers sit under replaced (deactivated) fields still counts toward the caps', () => {
  const overtimeForm = { _id: 'ot-form', name: '加班申請', semanticType: 'overtime' };
  const replacedFields = [
    { _id: 'old-start', label: '開始時間', type_1: 'datetime', is_active: false, order: 1 },
    { _id: 'old-end', label: '結束時間', type_1: 'datetime', is_active: false, order: 2 },
    { _id: 'old-reason', label: '事由', type_1: 'text', is_active: false, order: 3 },
    { _id: 'start', label: '開始時間', type_1: 'datetime', required: true, order: 4 },
    { _id: 'end', label: '結束時間', type_1: 'datetime', required: true, order: 5 },
    { _id: 'reason', label: '事由', type_1: 'text', order: 6 },
  ];
  // 台灣 11/04 19:00-22:00（3 小時）已核准，答案在舊欄位
  const approvedOld = {
    _id: 'approved-old',
    form_data: { 'old-start': '2026-11-04T11:00:00.000Z', 'old-end': '2026-11-04T14:00:00.000Z', 'old-reason': '趕工' },
  };
  const workday = () => mockShiftSchedule.findOne.mockReturnValue(leanQuery({
    _id: 'sch', employee: 'emp1', date: new Date('2026-11-04T00:00:00.000Z'), shiftId: 'D',
  }));
  const fileMore = (formData) => assertOvertimeApprovalCompliance({
    form: overtimeForm,
    applicantEmployeeId: 'emp1',
    formData,
  });

  beforeEach(() => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(replacedFields));
    workday();
  });

  it('control: a further 2 hours the same day is refused when the approved overtime sits under the active fields', async () => {
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
      _id: 'approved-new',
      form_data: { start: '2026-11-04T11:00:00.000Z', end: '2026-11-04T14:00:00.000Z' },
    }]));

    await expect(fileMore({ start: '2026-11-04T14:00:00.000Z', end: '2026-11-04T16:00:00.000Z' })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'daily-overtime-hours', minutes: 300 })],
    });
  });

  it('refuses the same further 2 hours when the approved overtime sits under the deactivated fields (daily limit)', async () => {
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([approvedOld]));

    await expect(fileMore({ start: '2026-11-04T14:00:00.000Z', end: '2026-11-04T16:00:00.000Z' })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'daily-overtime-hours', date: '2026-11-04', minutes: 300 })],
    });
  });

  it('counts the old-field overtime toward the monthly limit too', async () => {
    // 46 小時上限：先放一筆舊欄位的 45 小時（跨多天，不計入單日）
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
      _id: 'approved-month',
      form_data: { 'old-start': '2026-11-01T00:00:00.000Z', 'old-end': '2026-11-02T21:00:00.000Z' },
    }]));

    await expect(fileMore({ start: '2026-11-04T11:00:00.000Z', end: '2026-11-04T13:00:00.000Z' })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'monthly-overtime-hours' })],
    });
  });

  it('counts the old-field overtime toward the three-month limit when extended overtime is enabled', async () => {
    mockAttendanceSetting.findOne.mockReturnValue(leanQuery({
      ...attendanceSetting,
      laborRules: { extendedOvertimeEnabled: true, overtimeApprovalReference: '文號', monthlyOvertimeHours: 54, threeMonthOvertimeHours: 138 },
    }));
    // 前兩個月各 54 小時（舊欄位），本月 30 小時之後再申請 2 小時會超過 138 小時
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([
      { _id: 'a1', form_data: { 'old-start': '2026-09-01T00:00:00.000Z', 'old-end': '2026-09-03T06:00:00.000Z' } },
      { _id: 'a2', form_data: { 'old-start': '2026-10-01T00:00:00.000Z', 'old-end': '2026-10-03T06:00:00.000Z' } },
      { _id: 'a3', form_data: { 'old-start': '2026-11-01T00:00:00.000Z', 'old-end': '2026-11-02T06:00:00.000Z' } },
    ]));

    await expect(fileMore({ start: '2026-11-04T11:00:00.000Z', end: '2026-11-04T13:00:00.000Z' })).rejects.toMatchObject({
      violations: expect.arrayContaining([expect.objectContaining({ rule: 'three-month-overtime-hours' })]),
    });
  });

  it('uses the first field that holds an answer for each request (old, new or mixed) and ignores requests with no answer', async () => {
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([
      approvedOld,
      { _id: 'approved-mixed', form_data: { 'old-start': '2026-11-05T11:00:00.000Z', end: '2026-11-05T14:00:00.000Z' } },
      { _id: 'approved-empty', form_data: { reason: '沒有時間' } },
    ]));

    // 11/04 已有 3 小時（舊欄位）；11/05 的 3 小時一半在舊、一半在新，不影響 11/04
    await expect(fileMore({ start: '2026-11-04T14:00:00.000Z', end: '2026-11-04T15:00:00.000Z' })).resolves.toEqual({ ok: true, violations: [] });
    await expect(fileMore({ start: '2026-11-04T14:00:00.000Z', end: '2026-11-04T16:00:00.000Z' })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'daily-overtime-hours', minutes: 300 })],
    });
  });

  it('re-checking an already filed request at approval reads its answers under the deactivated fields too', async () => {
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([]));
    const pending = { 'old-start': '2026-11-04T11:00:00.000Z', 'old-end': '2026-11-04T14:00:00.000Z', 'old-reason': '趕工' };

    // 新送件只看啟用中的欄位：舊欄位的答案讀不到
    await expect(fileMore(pending)).rejects.toMatchObject({ message: '加班申請時間無法判讀' });
    // 核准時重新檢核（includeInactive）：欄位在送出後被停用取代，單仍可以核准
    await expect(assertOvertimeApprovalCompliance({
      form: overtimeForm,
      applicantEmployeeId: 'emp1',
      formData: pending,
      includeInactive: true,
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('parseOvertimePayload keeps the active-only behaviour for the request being filed, and reads the old fields only on request', () => {
    const oldOnly = { 'old-start': '2026-11-04T11:00:00.000Z', 'old-end': '2026-11-04T14:00:00.000Z' };

    expect(__testUtils.parseOvertimePayload(oldOnly, replacedFields)).toBeNull();
    expect(__testUtils.parseOvertimePayload(oldOnly, replacedFields, { includeInactive: true }).minutes).toBe(180);
    // 啟用中的欄位有填就優先用它
    expect(__testUtils.parseOvertimePayload(
      { ...oldOnly, start: '2026-11-04T11:00:00.000Z', end: '2026-11-04T12:00:00.000Z' },
      replacedFields,
      { includeInactive: true },
    ).minutes).toBe(60);
  });

  it('reads a date + hours overtime and the 跨日 flag from deactivated fields of an approved request', () => {
    const fields = [
      { _id: 'o-date', label: '加班日期', type_1: 'date', is_active: false },
      { _id: 'o-hours', label: '加班時數', type_1: 'number', is_active: false },
      { _id: 'date', label: '加班日期', type_1: 'date' },
      { _id: 'hours', label: '加班時數', type_1: 'number' },
      { _id: 'o-start', label: '開始時間', type_1: 'datetime', is_active: false },
      { _id: 'o-end', label: '結束時間', type_1: 'datetime', is_active: false },
      { _id: 'o-cross', label: '是否跨日', type_1: 'checkbox', is_active: false },
    ];

    const byHours = __testUtils.parseOvertimePayload({ 'o-date': '2026-11-09T16:00:00.000Z', 'o-hours': 2 }, fields, { includeInactive: true });
    expect(byHours.minutes).toBe(120);
    expect(byHours.start.toISOString()).toBe('2026-11-09T16:00:00.000Z');

    const crossDay = __testUtils.parseOvertimePayload(
      { 'o-start': '2026-11-04T14:00:00.000Z', 'o-end': '2026-11-04T01:00:00.000Z', 'o-cross': true },
      fields,
      { includeInactive: true },
    );
    expect(crossDay.minutes).toBe(11 * 60);
  });
});

// 請假的開始 / 結束欄位被停用或換成同標籤的新欄位後，已核准（或簽核中）的舊假單仍在舊欄位 ID 底下：
// 重疊檢查與排班規則（連續上班、假日）都要看得到它們，和假勤日曆、薪資一致
describe('leave overlap and the schedule leave days read the replaced (deactivated) start / end fields', () => {
  const leaveForm = { _id: 'leave-form', name: '請假', semanticType: 'leave' };
  const fields = [
    { _id: 'old-type', label: '假別', type_1: 'text', is_active: false, order: 1 },
    { _id: 'old-start', label: '開始時間', type_1: 'datetime', is_active: false, order: 2 },
    { _id: 'old-end', label: '結束時間', type_1: 'datetime', is_active: false, order: 3 },
    { _id: 'type', label: '假別', type_1: 'text', required: true, order: 4 },
    { _id: 'start', label: '開始時間', type_1: 'datetime', required: true, order: 5 },
    { _id: 'end', label: '結束時間', type_1: 'datetime', required: true, order: 6 },
  ];
  const INFO = {
    formId: 'leave-form',
    startId: 'start',
    endId: 'end',
    typeId: 'type',
    startIds: ['start', 'old-start'],
    endIds: ['end', 'old-end'],
    typeIds: ['type', 'old-type'],
  };

  beforeEach(() => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(fields));
    mockGetAllLeaveFieldInfos.mockResolvedValue([INFO]);
  });

  describe('overlap check when filing', () => {
    // 台灣 11/10 全天（UTC 11/09 16:00 起）
    const fileOnTenth = () => violationsOf({
      form: leaveForm,
      formData: { type: '病假', start: '2026-11-09T16:00:00.000Z', end: '2026-11-10T10:00:00.000Z' },
      applicantEmployeeId: 'emp1',
      checkLeaveConflicts: true,
    });

    it('refuses a filing that overlaps an approved leave whose dates sit under the deactivated fields', async () => {
      // 已核准的事假 11/09-11/10，答案在舊欄位
      mockApprovalRequest.find.mockImplementation(() => selectableLeanQuery([{
        _id: 'old-leave',
        status: 'approved',
        form_data: { 'old-start': '2026-11-08T16:00:00.000Z', 'old-end': '2026-11-10T10:00:00.000Z' },
      }]));

      const violations = await fileOnTenth();

      expect(violations).toEqual([expect.objectContaining({ rule: 'leave-overlap', status: 'approved' })]);
    });

    it('also sees a pending request that was filed under the old fields', async () => {
      mockApprovalRequest.find.mockImplementation(() => selectableLeanQuery([{
        _id: 'old-pending',
        status: 'pending',
        form_data: { 'old-start': '2026-11-09T16:00:00.000Z', 'old-end': '2026-11-10T10:00:00.000Z' },
      }]));

      expect(await fileOnTenth()).toEqual([expect.objectContaining({ rule: 'leave-overlap', status: 'pending' })]);
    });

    it('selects every candidate start / end field of the form, not just the active ones', async () => {
      const query = selectableLeanQuery([]);
      mockApprovalRequest.find.mockImplementation(() => query);

      await fileOnTenth();

      expect(query.select).toHaveBeenCalledWith('status form_data.start form_data.old-start form_data.end form_data.old-end');
    });

    it('takes the first candidate that holds a value per request (mixed old and new fields)', async () => {
      mockApprovalRequest.find.mockImplementation(() => selectableLeanQuery([
        // 開始在舊欄位、結束在新欄位
        { _id: 'mixed', status: 'approved', form_data: { 'old-start': '2026-11-09T16:00:00.000Z', end: '2026-11-10T10:00:00.000Z' } },
      ]));

      expect(await fileOnTenth()).toEqual([expect.objectContaining({ rule: 'leave-overlap' })]);
    });

    it('does not report an overlap with a request that does not touch the day, whichever field set holds it', async () => {
      mockApprovalRequest.find.mockImplementation(() => selectableLeanQuery([
        { _id: 'earlier', status: 'approved', form_data: { 'old-start': '2026-11-01T16:00:00.000Z', 'old-end': '2026-11-02T10:00:00.000Z' } },
        { _id: 'later', status: 'approved', form_data: { start: '2026-11-19T16:00:00.000Z', end: '2026-11-20T10:00:00.000Z' } },
      ]));

      expect(await fileOnTenth()).toEqual([]);
    });
  });

  describe('schedule rules (approved leave days)', () => {
    it('counts an approved leave stored under the deactivated fields toward the six-day limit', async () => {
      // 台灣 6/19 全天的核准假單，答案在舊欄位
      mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
        applicant_employee: 'emp1',
        form_data: { 'old-start': '2026-06-18T16:00:00.000Z', 'old-end': '2026-06-19T10:00:00.000Z' },
      }]));
      // 6/13-6/18 六天上班，6/19 請假：第七天
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(
        ['13', '14', '15', '16', '17', '18'].map((day) => ({
          _id: `s${day}`, employee: 'emp1', date: new Date(`2026-06-${day}T00:00:00.000Z`), shiftId: 'D',
        })),
      ));

      await expect(assertScheduleRuleCompliance({
        candidateSchedules: [{ employee: 'emp1', date: new Date('2026-06-13T00:00:00.000Z'), shiftId: 'D' }],
      })).rejects.toMatchObject({
        violations: [expect.objectContaining({
          rule: 'continuous-work-days',
          dates: ['2026-06-13', '2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'],
        })],
      });
    });

    it('selects the candidate fields so the old answers are fetched', async () => {
      const query = { select: jest.fn(() => query), lean: jest.fn().mockResolvedValue([]) };
      mockApprovalRequest.find.mockReturnValue(query);
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));

      await assertScheduleRuleCompliance({
        candidateSchedules: [{ employee: 'emp1', date: new Date('2026-06-13T00:00:00.000Z'), shiftId: 'D' }],
      });

      expect(query.select).toHaveBeenCalledWith('applicant_employee form_data.start form_data.old-start form_data.end form_data.old-end');
    });
  });
});
