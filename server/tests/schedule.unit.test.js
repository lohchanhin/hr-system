import { jest } from '@jest/globals';

const mockShiftSchedule = {
  findOne: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
};
const mockApprovalRequest = { findOne: jest.fn() };
const mockFormTemplate = { findOne: jest.fn() };
const mockFormField = { find: jest.fn() };

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));

const { createSchedule, createSchedulesBatch } = await import('../src/controllers/scheduleController.js');

describe('createSchedule validations', () => {
  beforeEach(() => {
    mockShiftSchedule.findOne.mockReset();
    mockShiftSchedule.create.mockReset();
    mockApprovalRequest.findOne.mockReset();
    mockFormTemplate.findOne.mockResolvedValue({ _id: 'form1' });
    mockFormField.find.mockResolvedValue([
      { _id: 's', label: '開始日期' },
      { _id: 'e', label: '結束日期' },
    ]);
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
    mockFormTemplate.findOne.mockResolvedValue({ _id: 'form1' });
    mockFormField.find.mockResolvedValue([
      { _id: 's', label: '開始日期' },
      { _id: 'e', label: '結束日期' },
    ]);
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
});

