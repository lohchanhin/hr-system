import { jest } from '@jest/globals';

const mockShiftSchedule = {
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  find: jest.fn(),
};
const mockApprovalRequest = { findOne: jest.fn(), find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();
const mockAttendanceSetting = { findOne: jest.fn() };
const mockEmployee = { find: jest.fn() };

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: mockGetLeaveFieldIds,
}));

const { createSchedule, createSchedulesBatch, updateSchedule, listSupervisorSummary } = await import('../src/controllers/scheduleController.js');

describe('createSchedule validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.create.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
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
    expect(json).toHaveBeenCalledWith({ error: 'department overlap' });
  });
});

describe('createSchedulesBatch validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.insertMany.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'form1',
      startId: 's',
      endId: 'e',
      typeId: 't',
      typeOptions: [],
    });
  });

  it('returns leave conflict when batch has approved leave', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue({ _id: 'a1' });
    const req = { body: { schedules: [{ employee: 'e1', date: '2023-01-01', shiftId: 's1' }] } };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    await createSchedulesBatch(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'leave conflict' });
  });

  it('creates multiple schedules when payload is valid', async () => {
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    const insertedDocs = [
      { _id: '1', employee: 'e1', date: new Date('2023-01-01'), shiftId: 's1', department: 'd1', subDepartment: 'sd1' },
      { _id: '2', employee: 'e2', date: new Date('2023-01-02'), shiftId: 's2', department: 'd2', subDepartment: 'sd2' }
    ];
    mockShiftSchedule.insertMany.mockResolvedValue(insertedDocs);
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
    expect(mockShiftSchedule.insertMany).toHaveBeenCalledWith(
      [
        {
          employee: 'e1',
          date: new Date('2023-01-01'),
          shiftId: 's1',
          department: 'd1',
          subDepartment: 'sd1'
        },
        {
          employee: 'e2',
          date: new Date('2023-01-02'),
          shiftId: 's2',
          department: 'd2',
          subDepartment: 'sd2'
        }
      ],
      { ordered: false }
    );
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(insertedDocs);
  });
});

describe('updateSchedule validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.findById.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockReset();
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
    expect(json).toHaveBeenCalledWith({ error: 'department overlap' });
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
    expect(json).toHaveBeenCalledWith([
      { employee: 'emp1', name: 'Emp1', shiftCount: 1, leaveCount: 3, absenceCount: 0 },
    ]);
  });
});
