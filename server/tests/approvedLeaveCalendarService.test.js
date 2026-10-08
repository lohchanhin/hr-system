import { jest } from '@jest/globals';

const mockApprovalRequest = { find: jest.fn() };
const mockGetAllLeaveFieldInfos = jest.fn();

jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos }));

const { loadApprovedLeaveCalendar, loadApprovedLeaveIntervals } = await import('../src/services/approvedLeaveCalendarService.js');

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

  // 前端日期選擇器送出 UTC ISO 字串：台灣 6/19 00:00 是 2026-06-18T16:00:00.000Z，日期要依台灣時間判斷
  describe('days are Taipei days', () => {
    const june = { start: new Date('2026-06-01T00:00:00.000Z'), end: new Date('2026-07-01T00:00:00.000Z') };

    async function daysOf(startValue, endValue, extra = {}) {
      mockApprovalRequest.find.mockReturnValue(leanQuery([
        { applicant_employee: 'emp1', form_data: { start: startValue, end: endValue, type: '特休假' } },
      ]));
      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...june, ...extra });
      return Array.from(result.get('emp1').keys());
    }

    it('marks only 6/19 for a leave from 6/19 00:00 to 18:00 Taipei time (stored 06-18T16:00Z to 06-19T10:00Z)', async () => {
      expect(await daysOf('2026-06-18T16:00:00.000Z', '2026-06-19T10:00:00.000Z')).toEqual(['2026-06-19']);
    });

    it.each([
      ['00:00', '2026-06-18T16:00:00.000Z'],
      ['06:00', '2026-06-18T22:00:00.000Z'],
      ['07:30', '2026-06-18T23:30:00.000Z'],
      ['08:00', '2026-06-19T00:00:00.000Z'],
      ['09:00', '2026-06-19T01:00:00.000Z'],
    ])('does not shift a leave that starts at %s Taipei time to the day before', async (_label, startValue) => {
      expect(await daysOf(startValue, '2026-06-19T10:00:00.000Z')).toEqual(['2026-06-19']);
    });

    it('keeps a date-type leave picked as 10/09 to 10/10 on exactly those two days', async () => {
      mockApprovalRequest.find.mockReturnValue(leanQuery([
        { applicant_employee: 'emp1', form_data: { start: '2026-10-08T16:00:00.000Z', end: '2026-10-09T16:00:00.000Z', type: '事假' } },
      ]));

      const result = await loadApprovedLeaveCalendar({
        employeeIds: ['emp1'],
        start: new Date('2026-10-01T00:00:00.000Z'),
        end: new Date('2026-11-01T00:00:00.000Z'),
      });

      expect(Array.from(result.get('emp1').keys())).toEqual(['2026-10-09', '2026-10-10']);
    });

    it('clips to the range by Taipei day, also when the range comes as the UTC instants of Taipei midnight', async () => {
      const days = await daysOf('2026-06-29T16:00:00.000Z', '2026-07-02T16:00:00.000Z', {
        // 台灣 7/1 00:00 到 8/1 00:00
        start: new Date('2026-06-30T16:00:00.000Z'),
        end: new Date('2026-07-31T16:00:00.000Z'),
      });

      // 台灣 6/30 00:00 到 7/3 00:00：只剩 7/1 之後的日子
      expect(days).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    });

    it('uses the label of an option object as the leave type', async () => {
      mockApprovalRequest.find.mockReturnValue(leanQuery([
        { applicant_employee: 'emp1', form_data: { start: '2026-06-19', end: '2026-06-19', type: { label: '公假', value: 'PUB' } } },
      ]));

      const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...june });

      expect(result.get('emp1')).toEqual(new Map([['2026-06-19', '公假']]));
    });
  });
});

describe('approved leave intervals (for the late / early check)', () => {
  const september = { start: new Date('2026-09-01T00:00:00.000Z'), end: new Date('2026-10-01T00:00:00.000Z') };

  beforeEach(() => {
    mockApprovalRequest.find.mockReset();
    mockGetAllLeaveFieldInfos.mockReset();
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM]);
  });

  it('keeps the hours of a datetime leave and the whole days of a date leave', async () => {
    mockApprovalRequest.find.mockReturnValue(leanQuery([
      // 台灣 9/10 09:00-13:00
      { applicant_employee: 'emp1', form_data: { start: '2026-09-10T01:00:00.000Z', end: '2026-09-10T05:00:00.000Z', type: '事假' } },
      // 台灣 9/15 到 9/16 整天
      { applicant_employee: 'emp1', form_data: { start: '2026-09-14T16:00:00.000Z', end: '2026-09-15T16:00:00.000Z', type: { label: '特休假' } } },
    ]));

    const result = await loadApprovedLeaveIntervals({ employeeIds: ['emp1'], ...september });

    expect(result.get('emp1')).toEqual([
      { startMs: Date.parse('2026-09-10T01:00:00.000Z'), endMs: Date.parse('2026-09-10T05:00:00.000Z'), allDay: false, leaveType: '事假' },
      { startMs: Date.parse('2026-09-14T16:00:00.000Z'), endMs: Date.parse('2026-09-16T16:00:00.000Z'), allDay: true, leaveType: '特休假' },
    ]);
  });

  it('drops leave far outside the range, reversed ranges and unreadable rows', async () => {
    mockApprovalRequest.find.mockReturnValue(leanQuery([
      { applicant_employee: 'emp1', form_data: { start: '2026-07-01', end: '2026-07-02', type: '事假' } },
      { applicant_employee: 'emp1', form_data: { start: '2026-09-05', end: '2026-09-02', type: '事假' } },
      { applicant_employee: 'emp1', form_data: {} },
      { applicant_employee: 'emp2', form_data: { start: '2026-09-05', end: '2026-09-05', type: '事假' } },
    ]));

    const result = await loadApprovedLeaveIntervals({ employeeIds: ['emp1'], ...september });

    expect(result.get('emp1')).toEqual([]);
    expect(result.has('emp2')).toBe(false);
  });

  it('keeps a leave on the day just before the range (a shift may cross midnight)', async () => {
    mockApprovalRequest.find.mockReturnValue(leanQuery([
      { applicant_employee: 'emp1', form_data: { start: '2026-08-31', end: '2026-08-31', type: '事假' } },
    ]));

    const result = await loadApprovedLeaveIntervals({ employeeIds: ['emp1'], ...september });

    expect(result.get('emp1')).toHaveLength(1);
  });

  it('returns empty lists without querying when there is no leave form or no employee', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([]);

    expect((await loadApprovedLeaveIntervals({ employeeIds: ['emp1'], ...september })).get('emp1')).toEqual([]);
    expect((await loadApprovedLeaveIntervals({ employeeIds: [], ...september })).size).toBe(0);
    expect(mockApprovalRequest.find).not.toHaveBeenCalled();
  });
});

// 欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位 ID 底下：逐張假單用第一個有填值的同標籤欄位
describe('same-label field candidates (retired and replaced fields)', () => {
  const range = { start: new Date('2026-11-01T00:00:00.000Z'), end: new Date('2026-12-01T00:00:00.000Z') };
  // 預設的「請假」：開始時間欄位被刪除（停用）後又新增了同標籤的欄位；已核准的舊假單答案在 old-start / old-end 底下
  const REPLACED_FORM = {
    formId: 'leave-form',
    isActive: true,
    startId: 'new-start', endId: 'new-end', typeId: 'type',
    startIds: ['new-start', 'old-start'], endIds: ['new-end', 'old-end'], typeIds: ['type'],
  };

  beforeEach(() => {
    mockApprovalRequest.find.mockReset();
    mockGetAllLeaveFieldInfos.mockReset();
    mockGetAllLeaveFieldInfos.mockResolvedValue([REPLACED_FORM]);
  });

  it('counts a leave answered under the retired field and one answered under the new field', async () => {
    const query = leanQuery([
      { applicant_employee: 'emp1', form_data: { 'old-start': '2026-11-01T16:00:00.000Z', 'old-end': '2026-11-02T16:00:00.000Z', type: '事假' } },
      { applicant_employee: 'emp1', form_data: { 'new-start': '2026-11-10', 'new-end': '2026-11-10', type: '特休假' } },
      // 新舊欄位都有答案時以啟用中的新欄位為準
      { applicant_employee: 'emp2', form_data: { 'new-start': '2026-11-20', 'new-end': '2026-11-20', 'old-start': '2026-11-05', 'old-end': '2026-11-05', type: '病假' } },
      // 兩邊都沒有答案的假單讀不到日期，略過
      { applicant_employee: 'emp2', form_data: { type: '事假' } },
    ]);
    mockApprovalRequest.find.mockReturnValue(query);

    const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1', 'emp2'], ...range });

    expect(result.get('emp1')).toEqual(new Map([
      ['2026-11-02', '事假'],
      ['2026-11-03', '事假'],
      ['2026-11-10', '特休假'],
    ]));
    expect(result.get('emp2')).toEqual(new Map([['2026-11-20', '病假']]));
    // 查詢要把新舊欄位都投影出來
    expect(query.select).toHaveBeenCalledWith(
      'applicant_employee form_data.new-start form_data.old-start form_data.new-end form_data.old-end form_data.type',
    );
  });

  it('reads the leave type from the retired field too', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{ ...REPLACED_FORM, typeId: 'new-type', typeIds: ['new-type', 'old-type'] }]);
    mockApprovalRequest.find.mockReturnValue(leanQuery([
      { applicant_employee: 'emp1', form_data: { 'old-start': '2026-11-04', 'old-end': '2026-11-04', 'old-type': '特休假' } },
    ]));

    const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

    expect(result.get('emp1')).toEqual(new Map([['2026-11-04', '特休假']]));
  });

  it('keeps the approved leave of a retired (inactive) form on the calendar', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{ ...DEFAULT_FORM, isActive: false }]);
    mockApprovalRequest.find.mockReturnValue(leanQuery([
      { applicant_employee: 'emp1', form_data: { start: '2026-11-02', end: '2026-11-03', type: '事假' } },
    ]));

    const result = await loadApprovedLeaveCalendar({ employeeIds: ['emp1'], ...range });

    expect(result.get('emp1')).toEqual(new Map([['2026-11-02', '事假'], ['2026-11-03', '事假']]));
  });

  it('gives the late / early check the intervals of the retired field and the retired form', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([REPLACED_FORM, { ...DEFAULT_FORM, formId: 'retired-form', isActive: false }]);
    mockApprovalRequest.find.mockImplementation((filter) => leanQuery(filter.form === 'leave-form'
      ? [{ applicant_employee: 'emp1', form_data: { 'old-start': '2026-11-02T01:00:00.000Z', 'old-end': '2026-11-02T05:00:00.000Z', type: '事假' } }]
      : [{ applicant_employee: 'emp1', form_data: { start: '2026-11-09', end: '2026-11-09', type: '特休假' } }]));

    const result = await loadApprovedLeaveIntervals({ employeeIds: ['emp1'], ...range });

    expect(result.get('emp1').map((item) => [item.leaveType, item.allDay])).toEqual([['事假', false], ['特休假', true]]);
  });
});
