import { jest } from '@jest/globals';

const mockApprovalRequest = { find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();

jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getLeaveFieldIds: mockGetLeaveFieldIds }));

const { loadApprovedLeaveCalendar } = await import('../src/services/approvedLeaveCalendarService.js');

describe('approved leave calendar', () => {
  beforeEach(() => {
    mockApprovalRequest.find.mockReset();
    mockGetLeaveFieldIds.mockResolvedValue({ formId: 'leave-form', startId: 'start', endId: 'end', typeId: 'type' });
  });

  it('filters ISO-string date ranges in application code and keeps the leave type', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { applicant_employee: 'emp1', form_data: { start: '2026-06-30', end: '2026-07-02', type: '特休' } },
        { applicant_employee: 'emp1', form_data: { start: '2026-08-01', end: '2026-08-02', type: '病假' } },
      ]),
    };
    mockApprovalRequest.find.mockReturnValue(query);

    const result = await loadApprovedLeaveCalendar({
      employeeIds: ['emp1'],
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      form: 'leave-form',
      status: 'approved',
      applicant_employee: { $in: ['emp1'] },
    });
    expect(result.get('emp1')).toEqual(new Map([
      ['2026-07-01', '特休'],
      ['2026-07-02', '特休'],
    ]));
  });
});
