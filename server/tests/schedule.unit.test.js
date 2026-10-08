import { jest } from '@jest/globals';
import { buildLeaveFieldServiceMock } from './helpers/leaveFieldServiceMock.js';

const mockShiftSchedule = {
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  bulkWrite: jest.fn(),
  find: jest.fn(),
};
const mockApprovalRequest = { findOne: jest.fn(), find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();
const mockAttendanceSetting = { findOne: jest.fn() };
const mockEmployee = { find: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockScheduleDayMemo = { find: jest.fn(), findOneAndUpdate: jest.fn(), findOneAndDelete: jest.fn() };
const mockAssertScheduleRuleCompliance = jest.fn();
const mockIsLaborRuleValidationError = jest.fn((error) => Array.isArray(error?.violations));

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/ScheduleDayMemo.js', () => ({ default: mockScheduleDayMemo }));
jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
  assertScheduleRuleCompliance: mockAssertScheduleRuleCompliance,
  isLaborRuleValidationError: mockIsLaborRuleValidationError,
}));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => buildLeaveFieldServiceMock(mockGetLeaveFieldIds));

const { createSchedule, createSchedulesBatch, updateSchedule, listSupervisorSummary, exportSchedules } = await import('../src/controllers/scheduleController.js');

describe('createSchedule validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.create.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
    mockAssertScheduleRuleCompliance.mockReset();
    mockAssertScheduleRuleCompliance.mockResolvedValue({ ok: true, violations: [] });
    mockIsLaborRuleValidationError.mockClear();
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'form1',
      startId: 's',
      endId: 'e',
      typeId: 't',
      typeOptions: [],
    });
  });

  it('returns department overlap when existing schedule in other dept', async () => {
    mockShiftSchedule.findOne.mockResolvedValue({ department: 'd1' });
    const req = { body: { employee: 'e1', date: '2023-01-01', shiftId: 's1', department: 'd2' } };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    await createSchedule(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: 'department overlap',
      conflict: expect.objectContaining({
        employee: 'e1',
        date: '2023-01-01T00:00:00.000Z',
        requestedShiftId: 's1',
      }),
    });
  });

  it('omits blank optional department references when creating a schedule', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockShiftSchedule.create.mockResolvedValue({ _id: 'schedule-1' });
    const req = {
      body: {
        employee: 'e1',
        date: '2023-01-01',
        shiftId: 's1',
        department: ' ',
        subDepartment: '',
      },
    };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };

    await createSchedule(req, res);

    expect(mockShiftSchedule.create).toHaveBeenCalledWith({
      employee: 'e1',
      date: new Date('2023-01-01'),
      shiftId: 's1',
      department: undefined,
      subDepartment: undefined,
      needsReconfirm: true,
    });
    expect(mockAssertScheduleRuleCompliance).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(201);
  });
});

describe('createSchedulesBatch validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.insertMany.mockReset();
    mockShiftSchedule.bulkWrite.mockReset();
    mockShiftSchedule.find.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
    mockAssertScheduleRuleCompliance.mockReset();
    mockAssertScheduleRuleCompliance.mockResolvedValue({ ok: true, violations: [] });
    mockIsLaborRuleValidationError.mockClear();
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'form1',
      startId: 's',
      endId: 'e',
      typeId: 't',
      typeOptions: [],
    });
    mockApprovalRequest.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    mockShiftSchedule.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    mockShiftSchedule.bulkWrite.mockResolvedValue({ acknowledged: true });
  });

  it('returns leave conflict when batch has approved leave', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        applicant_employee: 'e1',
        form_data: { s: '2023-01-01', e: '2023-01-01', t: '特休' },
      }]),
    });
    const req = { body: { schedules: [{ employee: 'e1', date: '2023-01-01', shiftId: 's1' }] } };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    await createSchedulesBatch(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'leave conflict' });
  });

  it('creates multiple schedules when payload is valid', async () => {
    const insertedDocs = [
      { _id: '1', employee: 'e1', date: new Date('2023-01-01'), shiftId: 's1', department: 'd1', subDepartment: 'sd1' },
      { _id: '2', employee: 'e2', date: new Date('2023-01-02'), shiftId: 's2', department: 'd2', subDepartment: 'sd2' }
    ];
    mockShiftSchedule.find
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(insertedDocs) });
    const req = {
      body: {
        schedules: [
          { employee: 'e1', date: '2023-01-01', shiftId: 's1', department: 'd1', subDepartment: 'sd1' },
          { employee: 'e2', date: '2023-01-02', shiftId: 's2', department: 'd2', subDepartment: 'sd2' }
        ]
      }
    };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    await createSchedulesBatch(req, res);
    expect(mockShiftSchedule.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({ updateOne: expect.objectContaining({
        filter: { employee: 'e1', date: new Date('2023-01-01') },
        upsert: true,
      }) }),
      expect.objectContaining({ updateOne: expect.objectContaining({
        filter: { employee: 'e2', date: new Date('2023-01-02') },
        upsert: true,
      }) }),
    ], { ordered: false });
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(insertedDocs);
  });

  it('omits blank optional department references before inserting schedules', async () => {
    const insertedDocs = [{ _id: '1', employee: 'e1', date: new Date('2023-01-01'), shiftId: 's1' }];
    mockShiftSchedule.find
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(insertedDocs) });
    const req = {
      body: {
        schedules: [{
          employee: 'e1',
          date: '2023-01-01',
          shiftId: 's1',
          department: '  ',
          subDepartment: '',
        }],
      },
    };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };

    await createSchedulesBatch(req, res);

    const operation = mockShiftSchedule.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.update.$set).toEqual(expect.objectContaining({
      employee: 'e1',
      date: new Date('2023-01-01'),
      shiftId: 's1',
      department: undefined,
      subDepartment: undefined,
      needsReconfirm: true,
    }));
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(insertedDocs);
  });

  it('keeps batch query count constant for 23 employees across 30 days', async () => {
    const schedules = Array.from({ length: 23 }, (_, employeeIndex) => (
      Array.from({ length: 30 }, (_, dayIndex) => ({
        employee: `e${employeeIndex + 1}`,
        date: `2023-01-${String(dayIndex + 1).padStart(2, '0')}`,
        shiftId: 's1',
      }))
    )).flat();
    const written = schedules.map((schedule, index) => ({
      ...schedule,
      _id: `schedule-${index + 1}`,
      date: new Date(schedule.date),
    }));
    mockShiftSchedule.find
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(written) });
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();

    await createSchedulesBatch({ body: { schedules } }, { status, json });

    expect(status).toHaveBeenCalledWith(201);
    expect(mockShiftSchedule.find).toHaveBeenCalledTimes(2);
    expect(mockShiftSchedule.bulkWrite).toHaveBeenCalledTimes(1);
    expect(mockShiftSchedule.bulkWrite.mock.calls[0][0]).toHaveLength(690);
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);
  });

  it('stores a batch as draft without running blocking labor validation', async () => {
    const error = new Error('排班規範檢核未通過');
    error.status = 400;
    error.violations = [{ rule: 'shift-gap', message: '班與班之間需間隔11小時' }];
    mockAssertScheduleRuleCompliance.mockRejectedValue(error);
    const written = [{ _id: '1', employee: 'e1', date: new Date('2023-01-01'), shiftId: 's1' }];
    mockShiftSchedule.find
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(written) });

    const req = {
      body: {
        schedules: [{ employee: 'e1', date: '2023-01-01', shiftId: 's1' }],
      },
    };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };

    await createSchedulesBatch(req, res);

    expect(mockAssertScheduleRuleCompliance).not.toHaveBeenCalled();
    expect(mockShiftSchedule.bulkWrite).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(written);
  });
});

describe('updateSchedule validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.findById.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
    mockAssertScheduleRuleCompliance.mockReset();
    mockAssertScheduleRuleCompliance.mockResolvedValue({ ok: true, violations: [] });
    mockIsLaborRuleValidationError.mockClear();
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'form1',
      startId: 's',
      endId: 'e',
      typeId: 't',
      typeOptions: [],
    });
  });

  it('returns department overlap when updating to other dept with existing schedule', async () => {
    mockShiftSchedule.findById.mockResolvedValue({
      _id: '1',
      employee: 'e1',
      date: new Date('2023-01-01'),
      department: 'd1',
      subDepartment: 'sd1',
    });
    mockShiftSchedule.findOne.mockResolvedValue({
      _id: '2',
      department: 'd3',
      subDepartment: 'sd3',
    });
    const req = {
      params: { id: '1' },
      body: { department: 'd2', subDepartment: 'sd2' },
    };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    await updateSchedule(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: 'department overlap',
      conflict: expect.objectContaining({
        employee: 'e1',
        date: '2023-01-01T00:00:00.000Z',
        existingScheduleId: '2',
      }),
    });
  });

  it('updates schedule with new department when no conflict', async () => {
    const saved = {
      _id: '1',
      employee: 'e1',
      date: new Date('2023-01-01'),
      shiftId: 's1',
      department: 'd2',
      subDepartment: 'sd2',
    };
    mockShiftSchedule.findById.mockResolvedValue({
      _id: '1',
      employee: 'e1',
      date: new Date('2023-01-01'),
      shiftId: 's1',
      department: 'd1',
      subDepartment: 'sd1',
      save: jest.fn().mockResolvedValue(saved),
    });
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);

    const req = {
      params: { id: '1' },
      body: { department: 'd2', subDepartment: 'sd2' },
    };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    await updateSchedule(req, res);
    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(saved);
    expect(mockAssertScheduleRuleCompliance).not.toHaveBeenCalled();
  });
});

describe('listSupervisorSummary leave handling', () => {
  beforeEach(() => {
    mockEmployee.find.mockReset();
    mockAttendanceSetting.findOne.mockReset();
    mockShiftSchedule.find.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'leaveForm',
      startId: 'start',
      endId: 'end',
      typeId: 'type',
    });
  });

  it('excludes leave days from shift count and counts leave days', async () => {
    const req = { query: { month: '2023-06' }, user: { id: 'sup1' } };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };

    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'emp1', name: 'Emp1' }]),
    });

    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ shifts: [{ _id: 'shift1', name: '早班' }] }),
    });

    mockShiftSchedule.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { employee: 'emp1', shiftId: 'shift1', date: new Date('2023-06-05') },
        { employee: 'emp1', shiftId: 'shift1', date: new Date('2023-06-06') },
      ]),
    });

    mockApprovalRequest.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          applicant_employee: 'emp1',
          form_data: { start: '2023-06-06', end: '2023-06-08' },
        },
      ]),
    });

    await listSupervisorSummary(req, res);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      employees: [
        { employee: 'emp1', name: 'Emp1', shiftCount: 1, leaveCount: 3, absenceCount: 0 },
      ],
      stats: expect.objectContaining({
        onLeave: 1,
      }),
    });
  });
});

describe('exportSchedules excel matrix', () => {
  beforeEach(() => {
    mockShiftSchedule.find.mockReset();
    mockAttendanceSetting.findOne.mockReset();
    mockEmployee.find.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'leaveForm',
      startId: 'start',
      endId: 'end',
      typeId: 'type',
    });
    mockHoliday.find.mockReset();
    mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([
      {
        date: new Date('2024-02-02T00:00:00.000Z'),
        name: '有班假日',
      },
      {
        date: new Date('2024-02-03T00:00:00.000Z'),
        name: '請假假日',
      },
      {
        date: new Date('2024-02-04T00:00:00.000Z'),
        name: '無班假日',
      },
    ]) });
    mockScheduleDayMemo.find.mockReset();
    mockScheduleDayMemo.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
  });

  it('exports matrix headers and day value by employee/date', async () => {
    const employeeRows = [
      {
        _id: 'emp1',
        employeeId: 'A001',
        name: '王小明',
        title: '護理師',
        practiceTitle: 'RN',
        subDepartment: { name: '內科' },
      },
      {
        _id: 'emp2',
        employeeId: 'A002',
        name: '李小華',
        title: '藥師',
        practiceTitle: '',
        subDepartment: { name: '藥局' },
      },
    ];

    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(employeeRows),
        }),
      }),
    });

    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { employee: { _id: 'emp1', name: '王小明' }, date: new Date('2024-02-01'), shiftId: 'shift1' },
          { employee: { _id: 'emp1', name: '王小明' }, date: new Date('2024-02-02'), shiftId: 'shift2' },
        ]),
      }),
    });

    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        shifts: [
          { _id: 'shift1', name: '早班', code: 'D' },
          { _id: 'shift2', name: '晚班', code: 'N' },
        ],
      }),
    });

    mockApprovalRequest.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { applicant_employee: 'emp1', form_data: { start: '2024-02-03', end: '2024-02-03', type: '特休' } },
        ]),
      }),
    });
    mockScheduleDayMemo.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{
          date: new Date('2024-02-02T00:00:00.000Z'),
          content: 'CODEX_TEST 日期備忘錄',
        }]),
      }),
    });

    const req = {
      user: { id: 'admin1', role: 'admin' },
      query: {
        month: '2024-02',
        department: 'dep1',
        subDepartment: 'sub1',
        format: 'excel',
      },
    };
    const res = {
      headers: {},
      setHeader: jest.fn((k, v) => { res.headers[k] = v; }),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await exportSchedules(req, res);
    expect(res.send).toHaveBeenCalledTimes(1);

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.send.mock.calls[0][0]);
    const sheet = workbook.getWorksheet('工作表1');

    const headerValues = sheet.getRow(5).values.slice(1, 9);
    expect(headerValues).toEqual(['員工代號', '姓名', '單位', '職稱／職位', '四', '五', '六', '日']);

    expect(sheet.columnCount).toBe(33); // 4 fixed columns + 29 days in 2024/02
    expect(sheet.views[0]).toEqual(expect.objectContaining({ state: 'frozen', xSplit: 4, ySplit: 5 }));
    expect(sheet.getRow(2).getCell(6).value).toBe('CODEX_TEST 日期備忘錄');
    expect(sheet.getRow(3).getCell(6).value).toBe('有班假日');
    expect(sheet.getRow(3).getCell(7).value).toBe('請假假日');
    expect(sheet.getRow(3).getCell(8).value).toBe('無班假日');
    expect(sheet.getRow(6).getCell(1).value).toBe('A001');
    expect(sheet.getRow(6).getCell(2).value).toBe('王小明');
    expect(sheet.getRow(6).getCell(3).value).toBe('內科');
    expect(sheet.getRow(6).getCell(4).value).toBe('RN');
    expect(sheet.getRow(6).getCell(5).value).toBe('D');
    expect(sheet.getRow(6).getCell(6).value).toBe('N');
    expect(sheet.getRow(6).getCell(7).value).toBe('特');
    expect(sheet.getRow(6).getCell(8).value).toBe('');
    expect(sheet.getCell('E9').value).toEqual({ formula: 'COUNTIF(E6:E7,"D")' });
  });
});
