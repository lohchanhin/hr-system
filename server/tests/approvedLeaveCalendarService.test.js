import { jest } from '@jest/globals';

const mockApprovalRequest = { find: jest.fn() };
const mockGetAllLeaveFieldInfos = jest.fn();

jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos }));

const { loadApprovedLeaveCalendar } = await import('../src/services/approvedLeaveCalendarService.js');

const DEFAULT_FORM = { formId: 'leave-form', startId: 'start', endId: 'end', typeId: 'type' };
// 客戶自建的請假表單：欄位 ID 與預設表單不同
const CUSTOM_FORM = { formId: 'custom-form', startId: 'c-start', endId: 'c-end', typeId: 'c-type', daysId: 'c-days' };

function leanQuery(rows) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
}

describe('approved leave calendar', () => {
  beforeEach(() => {
    mockApprovalRequest.find.mockReset();
    mockGetAllLeaveFieldInfos.mockReset();
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM]);
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

  describe('with several leave forms', () => {
    const range = {
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-08-01T00:00:00.000Z'),
    };

    it('queries every leave form with its own field ids and merges them into one calendar', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM, CUSTOM_FORM]);
      const defaultQuery = leanQuery([
        { applicant_employee: 'emp1', form_data: { start: '2026-07-01', end: '2026-07-02', type: '病假' } },
      ]);
      const customQuery = leanQuery([
        { applicant_employee: 'emp1', form_data: { 'c-start': '2026-07-10', 'c-end': '2026-07-11', 'c-type': '特休假', 'c-days': 2 } },
        { applicant_employee: 'emp2', form_data: { 'c-start': '2026-07-20', 'c-end': '2026-07-20', 'c-type': '事假' } },
      ]);
      mockApprovalRequest.find.mockImplementation((filter) => (filter.form === 'leave-form' ? defaultQuery : customQuery));

      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1', 'emp2'], ...range });

      expect(mockApprovalRequest.find).toHaveBeenCalledTimes(2);
      expect(mockApprovalRequest.find).toHaveBeenCalledWith({
        form: 'leave-form', status: 'approved', applicant_employee: { $in: ['emp1', 'emp2'] },
      });
      expect(mockApprovalRequest.find).toHaveBeenCalledWith({
        form: 'custom-form', status: 'approved', applicant_employee: { $in: ['emp1', 'emp2'] },
      });
      // 每張表單只投影自己的欄位
      expect(defaultQuery.select).toHaveBeenCalledWith('applicant_employee form_data.start form_data.end form_data.type');
      expect(customQuery.select).toHaveBeenCalledWith('applicant_employee form_data.c-start form_data.c-end form_data.c-type');
      expect(result.get('emp1')).toEqual(new Map([
        ['2026-07-01', '病假'],
        ['2026-07-02', '病假'],
        ['2026-07-10', '特休假'],
        ['2026-07-11', '特休假'],
      ]));
      expect(result.get('emp2')).toEqual(new Map([['2026-07-20', '事假']]));
    });

    it('keeps one entry per employee and day when two forms cover the same day', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM, CUSTOM_FORM]);
      mockApprovalRequest.find.mockImplementation((filter) => (filter.form === 'leave-form'
        ? leanQuery([{ applicant_employee: 'emp1', form_data: { start: '2026-07-05', end: '2026-07-07', type: '病假' } }])
        : leanQuery([{ applicant_employee: 'emp1', form_data: { 'c-start': '2026-07-06', 'c-end': '2026-07-08', 'c-type': '事假' } }])));

      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

      const days = Array.from(result.get('emp1').keys());
      expect(days).toEqual(['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08']);
      expect(new Set(days).size).toBe(days.length);
    });

    it('shows leave of the customer form even when the default form has none', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM, CUSTOM_FORM]);
      mockApprovalRequest.find.mockImplementation((filter) => (filter.form === 'leave-form'
        ? leanQuery([])
        : leanQuery([{ applicant_employee: 'emp1', form_data: { 'c-start': '2026-06-30T00:00:00.000Z', 'c-end': '2026-07-02', 'c-type': '特休假' } }])));

      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

      // 區間之外的 6/30 被裁掉
      expect(result.get('emp1')).toEqual(new Map([['2026-07-01', '特休假'], ['2026-07-02', '特休假']]));
    });

    it('falls back to the generic label when a form has no type field', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([{ formId: 'no-type', startId: 's', endId: 'e' }]);
      mockApprovalRequest.find.mockReturnValue(leanQuery([
        { applicant_employee: 'emp1', form_data: { s: '2026-07-03', e: '2026-07-03' } },
      ]));

      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

      expect(result.get('emp1')).toEqual(new Map([['2026-07-03', '請假']]));
      expect(mockApprovalRequest.find.mock.results[0].value.select).toHaveBeenCalledWith('applicant_employee form_data.s form_data.e');
    });

    it('does not load the dictionary options for the calendar', async () => {
      mockApprovalRequest.find.mockReturnValue(leanQuery([]));

      await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

      expect(mockGetAllLeaveFieldInfos).toHaveBeenCalledWith({ withTypeOptions: false });
    });

    it('returns an empty calendar without querying approvals when there is no leave form', async () => {
      mockGetAllLeaveFieldInfos.mockResolvedValue([]);

      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

      expect(mockApprovalRequest.find).not.toHaveBeenCalled();
      expect(result.get('emp1')).toEqual(new Map());
    });

    it('does not even look up the forms for an empty employee list or an invalid range', async () => {
      const noEmployees = await loadApprovedLeaveCalendar({ employeeIds: [], ...range });
      const badRange = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], start: range.end, end: range.start });

      expect(noEmployees.size).toBe(0);
      expect(badRange.get('emp1')).toEqual(new Map());
      expect(mockGetAllLeaveFieldInfos).not.toHaveBeenCalled();
      expect(mockApprovalRequest.find).not.toHaveBeenCalled();
    });
  });
});
