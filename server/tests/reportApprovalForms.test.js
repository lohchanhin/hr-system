import { jest } from '@jest/globals'

// 部門報表（請假、特休、加班、補簽）讀簽核單：form_data 以欄位 ID 為鍵，要靠欄位標籤找到欄位；
// 日期時間以台灣時間顯示與歸屬月份。

const mockEmployee = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockFormTemplate = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: { findById: jest.fn() } }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}))

let getDepartmentReportData

beforeAll(async () => {
  ;({ getDepartmentReportData } = await import('../src/services/reportMetricsService.js'))
})

const ADMIN = { role: 'admin', id: 'admin1' }
const EMPLOYEES = [{ _id: 'emp1', name: '員工1' }, { _id: 'emp2', name: '員工2' }]

function report(type, month = '2026-10') {
  return getDepartmentReportData({ type, month, departmentId: 'dept1', actor: ADMIN })
}

function lean(rows) {
  return { populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) }
}

// 依表單 ID 回傳各自的核准單
function approvalsByForm(rowsByForm) {
  mockApprovalRequest.find.mockImplementation((filter) => lean(rowsByForm[filter.form] ?? []))
}

const owner = (id) => EMPLOYEES.find((employee) => employee._id === id)

beforeEach(() => {
  mockEmployee.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockFormTemplate.find.mockReset()
  mockFormField.find.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockEmployee.find.mockResolvedValue(EMPLOYEES)
})

describe('請假統計', () => {
  const DEFAULT_FORM = {
    formId: 'leave-form',
    startId: 'start',
    endId: 'end',
    typeId: 'type',
    typeOptions: [],
  }
  const CUSTOMER_FORM = {
    formId: 'customer-form',
    startId: 'c-start',
    endId: 'c-end',
    typeId: 'c-type',
    daysId: 'c-days',
    typeOptions: [{ value: '特休假', label: '特休假' }, { value: '事假', label: '事假' }],
  }

  beforeEach(() => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM, CUSTOMER_FORM])
  })

  it('reads every leave form by its own field ids and takes the days from the 天數 field', async () => {
    approvalsByForm({
      'customer-form': [
        { _id: 'a1', applicant_employee: owner('emp1'), form_data: { 'c-type': '特休假', 'c-start': '2026-10-05', 'c-end': '2026-10-06', 'c-days': 2 } },
        { _id: 'a2', applicant_employee: owner('emp2'), form_data: { 'c-type': '事假', 'c-start': '2026-10-12', 'c-end': '2026-10-12', 'c-days': 0.5 } },
      ],
      'leave-form': [
        { _id: 'a3', applicant_employee: owner('emp1'), form_data: { type: '病假', start: '2026-10-20', end: '2026-10-22' } },
      ],
    })

    const result = await report('leave')

    expect(result.records).toEqual([
      expect.objectContaining({ approvalId: 'a3', leaveType: '病假', startDate: '2026-10-20', endDate: '2026-10-22', days: 3 }),
      expect.objectContaining({ approvalId: 'a1', leaveType: '特休假', days: 2 }),
      expect.objectContaining({ approvalId: 'a2', leaveType: '事假', days: 0.5 }),
    ])
    expect(result.summary.totalLeaves).toBe(3)
    expect(result.summary.totalDays).toBe(5.5)
    expect(result.summary.byType).toEqual([
      expect.objectContaining({ leaveType: '病假', count: 1, days: 3 }),
      expect.objectContaining({ leaveType: '特休假', count: 1, days: 2 }),
      expect.objectContaining({ leaveType: '事假', count: 1, days: 0.5 }),
    ])
  })

  it('does not filter the approvals by their filing date', async () => {
    approvalsByForm({})

    await report('leave')

    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      form: 'customer-form', status: 'approved', applicant_employee: { $in: ['emp1', 'emp2'] },
    })
  })

  it('files a leave under the month of the leave days, not the month it was filed', async () => {
    approvalsByForm({
      'customer-form': [
        // 9 月送簽、10 月請假
        { _id: 'a1', createdAt: new Date('2026-09-20T03:00:00.000Z'), applicant_employee: owner('emp1'), form_data: { 'c-type': '事假', 'c-start': '2026-10-12', 'c-end': '2026-10-12', 'c-days': 1 } },
        // 10 月送簽、11 月請假
        { _id: 'a2', createdAt: new Date('2026-10-20T03:00:00.000Z'), applicant_employee: owner('emp1'), form_data: { 'c-type': '事假', 'c-start': '2026-11-02', 'c-end': '2026-11-02', 'c-days': 1 } },
      ],
    })

    const october = await report('leave', '2026-10')

    expect(october.records.map((record) => record.approvalId)).toEqual(['a1'])
  })

  it('counts only the days inside the month for a leave that crosses a month end', async () => {
    approvalsByForm({
      'customer-form': [
        { _id: 'a1', applicant_employee: owner('emp1'), form_data: { 'c-type': '事假', 'c-start': '2026-10-30', 'c-end': '2026-11-03', 'c-days': 5 } },
      ],
    })

    const october = await report('leave', '2026-10')
    const november = await report('leave', '2026-11')

    expect(october.records[0]).toMatchObject({ days: 2, startDate: '2026-10-30', endDate: '2026-11-03' })
    expect(november.records[0]).toMatchObject({ days: 3 })
  })

  it('reads picker values as Taipei days (10/9 picked as 10/8 16:00 UTC)', async () => {
    approvalsByForm({
      'customer-form': [
        { _id: 'a1', applicant_employee: owner('emp1'), form_data: { 'c-type': '特休假', 'c-start': '2026-10-08T16:00:00.000Z', 'c-end': '2026-10-09T16:00:00.000Z' } },
      ],
    })

    const result = await report('leave')

    expect(result.records[0]).toMatchObject({ startDate: '2026-10-09', endDate: '2026-10-10', days: 2 })
  })

  it('returns the empty structure when nothing falls in the month', async () => {
    approvalsByForm({})

    expect(await report('leave')).toEqual({ records: [], summary: { totalLeaves: 0, totalDays: 0, byType: [] } })
  })

  it('returns the empty structure when there is no leave form at all', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([])

    expect(await report('leave')).toEqual({ records: [], summary: { totalLeaves: 0, totalDays: 0, byType: [] } })
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })

  it('lists 特休 and 特休假 of every leave form in the 特休統計', async () => {
    approvalsByForm({
      'customer-form': [
        { _id: 'a1', applicant_employee: owner('emp1'), form_data: { 'c-type': '特休假', 'c-start': '2026-10-05', 'c-end': '2026-10-06', 'c-days': 2 } },
        { _id: 'a2', applicant_employee: owner('emp1'), form_data: { 'c-type': '事假', 'c-start': '2026-10-07', 'c-end': '2026-10-07', 'c-days': 1 } },
      ],
      'leave-form': [
        { _id: 'a3', applicant_employee: owner('emp2'), form_data: { type: '特休', start: '2026-10-19', end: '2026-10-19' } },
      ],
    })

    const result = await report('specialLeave')

    expect(result.records.map((record) => [record.approvalId, record.days])).toEqual([['a3', 1], ['a1', 2]])
    expect(result.summary).toEqual({ totalRequests: 2, totalDays: 3 })
  })
})

describe('加班申請統計', () => {
  // 預設的「加班申請」範本：開始時間、結束時間、是否跨日、事由，沒有時數與日期欄位
  const DEFAULT_OT_FIELDS = [
    { _id: 'f-start', form: 'ot-form', label: '開始時間', type_1: 'datetime', order: 1 },
    { _id: 'f-end', form: 'ot-form', label: '結束時間', type_1: 'datetime', order: 2 },
    { _id: 'f-cross', form: 'ot-form', label: '是否跨日', type_1: 'checkbox', order: 3 },
    { _id: 'f-reason', form: 'ot-form', label: '事由', type_1: 'textarea', order: 4 },
  ]

  function useForms(forms, fieldsByForm) {
    mockFormTemplate.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(forms) })
    mockFormField.find.mockImplementation((filter) => ({
      lean: jest.fn().mockResolvedValue(fieldsByForm[String(filter.form)] ?? []),
    }))
  }

  it('computes hours from the start / end times, dates it by the start time and fills the reason', async () => {
    useForms([{ _id: 'ot-form', name: '加班申請', semanticType: 'overtime' }], { 'ot-form': DEFAULT_OT_FIELDS })
    approvalsByForm({
      'ot-form': [{
        _id: 'o1',
        createdAt: new Date('2026-10-08T02:00:00.000Z'),
        applicant_employee: owner('emp1'),
        // 台灣 10/5 18:00-21:30（UTC 10/5 10:00-13:30），10/8 送簽
        form_data: { 'f-start': '2026-10-05T10:00:00.000Z', 'f-end': '2026-10-05T13:30:00.000Z', 'f-reason': '月底結帳' },
      }],
    })

    const result = await report('overtime')

    expect(result.records).toEqual([{
      approvalId: 'o1',
      employee: 'emp1',
      name: '員工1',
      date: '2026-10-05',
      startTime: '18:00',
      endTime: '21:30',
      hours: 3.5,
      reason: '月底結帳',
    }])
    expect(result.summary).toEqual({ totalRequests: 1, totalHours: 3.5 })
  })

  it('shows early-morning times in Taipei time (06:00 is 06:00, not 22:00)', async () => {
    useForms([{ _id: 'ot-form', name: '加班申請', semanticType: 'overtime' }], { 'ot-form': DEFAULT_OT_FIELDS })
    approvalsByForm({
      'ot-form': [{
        _id: 'o1',
        applicant_employee: owner('emp1'),
        // 台灣 10/17 06:00-09:00 = UTC 10/16 22:00 - 10/17 01:00
        form_data: { 'f-start': '2026-10-16T22:00:00.000Z', 'f-end': '2026-10-17T01:00:00.000Z' },
      }],
    })

    const result = await report('overtime')

    expect(result.records[0]).toMatchObject({ date: '2026-10-17', startTime: '06:00', endTime: '09:00', hours: 3 })
  })

  it('adds a day for an end time before the start when the cross-day box is ticked', async () => {
    useForms([{ _id: 'ot-form', name: '加班申請', semanticType: 'overtime' }], { 'ot-form': DEFAULT_OT_FIELDS })
    approvalsByForm({
      'ot-form': [{
        _id: 'o1',
        applicant_employee: owner('emp1'),
        // 台灣 10/5 22:00 到 10/6 01:00，結束時間欄位被填成同一天的 01:00
        form_data: { 'f-start': '2026-10-05T14:00:00.000Z', 'f-end': '2026-10-05T17:00:00.000Z', 'f-cross': true },
      }, {
        _id: 'o2',
        applicant_employee: owner('emp1'),
        form_data: { 'f-start': '2026-10-06T14:00:00.000Z', 'f-end': '2026-10-06T01:00:00.000Z', 'f-cross': true },
      }],
    })

    const result = await report('overtime')

    expect(result.records.map((record) => record.hours)).toEqual([3, 11])
  })

  it('files an overtime under the month of the overtime date, not the filing month', async () => {
    useForms([{ _id: 'ot-form', name: '加班申請', semanticType: 'overtime' }], { 'ot-form': DEFAULT_OT_FIELDS })
    approvalsByForm({
      'ot-form': [{
        _id: 'o1',
        createdAt: new Date('2026-10-02T02:00:00.000Z'),
        applicant_employee: owner('emp1'),
        // 台灣 11/1 06:00 的加班（UTC 10/31 22:00）是 11 月的
        form_data: { 'f-start': '2026-10-31T22:00:00.000Z', 'f-end': '2026-11-01T01:00:00.000Z' },
      }],
    })

    expect((await report('overtime', '2026-10')).records).toEqual([])
    expect((await report('overtime', '2026-11')).records).toHaveLength(1)
  })

  it('still reads templates that have hours / date / reason fields, and finds a form that was renamed', async () => {
    const fields = [
      { _id: 'h', form: 'renamed', label: '加班時數', type_1: 'number' },
      { _id: 'd', form: 'renamed', label: '加班日期', type_1: 'date' },
      { _id: 'r', form: 'renamed', label: '加班原因', type_1: 'text' },
    ]
    useForms([{ _id: 'renamed', name: '延長工時單', semanticType: 'overtime' }], { renamed: fields })
    approvalsByForm({
      renamed: [{
        _id: 'o1',
        applicant_employee: owner('emp2'),
        form_data: { h: '2.5', d: '2026-10-09T16:00:00.000Z', r: '設備維修' },
      }],
    })

    const result = await report('overtime')

    expect(result.records[0]).toMatchObject({ date: '2026-10-10', hours: 2.5, reason: '設備維修', name: '員工2' })
  })

  it('looks the forms up by form type (and by name only for templates without a type)', async () => {
    useForms([], {})

    await report('overtime')

    expect(mockFormTemplate.find).toHaveBeenCalledWith({
      $or: [
        { semanticType: 'overtime' },
        { semanticType: null, name: { $in: ['加班', '加班申請', '加班單'] } },
      ],
    })
  })

  it('leaves out a form that was explicitly marked 一般 even when its name looks like overtime', async () => {
    useForms([{ _id: 'money', name: '加班單', semanticType: 'general' }], { money: DEFAULT_OT_FIELDS })
    approvalsByForm({ money: [{ _id: 'x', applicant_employee: owner('emp1'), form_data: {} }] })

    expect(await report('overtime')).toEqual({ summary: {}, records: [] })
  })

  it('merges the approvals of several overtime forms', async () => {
    useForms(
      [{ _id: 'ot-form', name: '加班申請', semanticType: 'overtime' }, { _id: 'ot-2', name: '假日加班單', semanticType: 'overtime' }],
      {
        'ot-form': DEFAULT_OT_FIELDS,
        'ot-2': DEFAULT_OT_FIELDS.map((field) => ({ ...field, _id: `${field._id}-2`, form: 'ot-2' })),
      },
    )
    approvalsByForm({
      'ot-form': [{ _id: 'o1', applicant_employee: owner('emp1'), form_data: { 'f-start': '2026-10-05T02:00:00.000Z', 'f-end': '2026-10-05T04:00:00.000Z' } }],
      'ot-2': [{ _id: 'o2', applicant_employee: owner('emp2'), form_data: { 'f-start-2': '2026-10-06T02:00:00.000Z', 'f-end-2': '2026-10-06T05:00:00.000Z' } }],
    })

    const result = await report('overtime')

    expect(result.records.map((record) => [record.approvalId, record.hours])).toEqual([['o1', 2], ['o2', 3]])
    expect(result.summary).toEqual({ totalRequests: 2, totalHours: 5 })
  })
})

describe('補簽申請統計', () => {
  it('finds the seeded 補簽申請 template, dates it by the start time and uses the 事由 as the note', async () => {
    mockFormTemplate.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'mk', name: '補簽申請' }]) })
    mockFormField.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: 'm-start', form: 'mk', label: '開始時間', type_1: 'datetime' },
        { _id: 'm-end', form: 'mk', label: '結束時間', type_1: 'datetime' },
        { _id: 'm-reason', form: 'mk', label: '事由', type_1: 'textarea' },
      ]),
    })
    approvalsByForm({
      mk: [{
        _id: 'k1',
        applicant_employee: owner('emp1'),
        form_data: { 'm-start': '2026-10-08T16:00:00.000Z', 'm-end': '2026-10-09T01:00:00.000Z', 'm-reason': '忘記打卡' },
      }],
    })

    const result = await report('makeUp')

    expect(mockFormTemplate.find).toHaveBeenCalledWith({ name: { $in: expect.arrayContaining(['補簽申請', '補打卡']) } })
    expect(result.records).toEqual([expect.objectContaining({ approvalId: 'k1', date: '2026-10-09', category: '未分類', note: '忘記打卡' })])
    expect(result.summary).toEqual({ totalRequests: 1, byCategory: [{ label: '未分類', count: 1 }] })
  })
})

// 已停用的表單與被停用 / 換成同標籤新欄位的欄位：已核准的舊單據在報表裡照常出現
describe('retired forms and retired fields in the reports', () => {
  it('lists the approved leave of a retired (inactive) leave form in the 請假統計 and the 特休統計', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      formId: 'retired-form', isActive: false, startId: 'start', endId: 'end', typeId: 'type', typeOptions: [],
    }])
    approvalsByForm({
      'retired-form': [
        { _id: 'a1', applicant_employee: owner('emp1'), form_data: { type: '事假', start: '2026-10-05', end: '2026-10-06' } },
        { _id: 'a2', applicant_employee: owner('emp2'), form_data: { type: '特休假', start: '2026-10-12', end: '2026-10-12' } },
      ],
    })

    const leave = await report('leave')
    const special = await report('specialLeave')

    expect(leave.records.map((record) => [record.approvalId, record.leaveType, record.days])).toEqual([['a1', '事假', 2], ['a2', '特休假', 1]])
    expect(special.records.map((record) => record.approvalId)).toEqual(['a2'])
  })

  it('reads a leave answered under the retired same-label fields and one answered under the replacement fields', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      formId: 'leave-form', isActive: true,
      startId: 'new-start', endId: 'new-end', typeId: 'type', daysId: 'new-days',
      startIds: ['new-start', 'old-start'], endIds: ['new-end', 'old-end'], typeIds: ['type'], daysIds: ['new-days', 'old-days'],
      typeOptions: [],
    }])
    approvalsByForm({
      'leave-form': [
        { _id: 'old', applicant_employee: owner('emp1'), form_data: { type: '事假', 'old-start': '2026-10-05', 'old-end': '2026-10-06', 'old-days': 2 } },
        { _id: 'new', applicant_employee: owner('emp2'), form_data: { type: '特休假', 'new-start': '2026-10-12', 'new-end': '2026-10-12', 'new-days': 0.5 } },
      ],
    })

    const result = await report('leave')

    expect(result.records.map((record) => [record.approvalId, record.startDate, record.days])).toEqual([
      ['old', '2026-10-05', 2],
      ['new', '2026-10-12', 0.5],
    ])
  })

  describe('overtime / comp-time / make-up reports', () => {
    function useForms(forms, fields) {
      mockFormTemplate.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(forms) })
      mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(fields) })
    }
    const OT_FORM = { _id: 'ot-form', name: '加班申請', semanticType: 'overtime' }

    it('still reports an overtime whose 開始時間 / 結束時間 fields were deactivated', async () => {
      useForms([OT_FORM], [
        { _id: 'f-start', form: 'ot-form', label: '開始時間', is_active: false, order: 1 },
        { _id: 'f-end', form: 'ot-form', label: '結束時間', is_active: false, order: 2 },
        { _id: 'f-reason', form: 'ot-form', label: '事由', order: 3 },
      ])
      approvalsByForm({
        'ot-form': [{
          _id: 'o1',
          applicant_employee: owner('emp1'),
          form_data: { 'f-start': '2026-10-05T10:00:00.000Z', 'f-end': '2026-10-05T13:00:00.000Z', 'f-reason': '月底結帳' },
        }],
      })

      const result = await report('overtime')

      expect(result.records).toEqual([expect.objectContaining({ approvalId: 'o1', date: '2026-10-05', startTime: '18:00', endTime: '21:00', hours: 3 })])
    })

    it('reads old requests from the retired fields and new requests from the replacement fields', async () => {
      useForms([OT_FORM], [
        { _id: 'old-start', form: 'ot-form', label: '開始時間', is_active: false, order: 1 },
        { _id: 'old-end', form: 'ot-form', label: '結束時間', is_active: false, order: 2 },
        { _id: 'new-start', form: 'ot-form', label: '開始時間', order: 3 },
        { _id: 'new-end', form: 'ot-form', label: '結束時間', order: 4 },
      ])
      approvalsByForm({
        'ot-form': [
          { _id: 'old', applicant_employee: owner('emp1'), form_data: { 'old-start': '2026-10-05T10:00:00.000Z', 'old-end': '2026-10-05T13:00:00.000Z' } },
          { _id: 'new', applicant_employee: owner('emp2'), form_data: { 'new-start': '2026-10-06T10:00:00.000Z', 'new-end': '2026-10-06T12:00:00.000Z' } },
          // 新舊欄位都有答案：以啟用中的新欄位為準
          { _id: 'both', applicant_employee: owner('emp2'), form_data: { 'old-start': '2026-10-07T10:00:00.000Z', 'old-end': '2026-10-07T13:00:00.000Z', 'new-start': '2026-10-08T10:00:00.000Z', 'new-end': '2026-10-08T11:00:00.000Z' } },
        ],
      })

      const result = await report('overtime')

      expect(result.records.map((record) => [record.approvalId, record.date, record.hours])).toEqual([
        ['old', '2026-10-05', 3],
        ['new', '2026-10-06', 2],
        ['both', '2026-10-08', 1],
      ])
      expect(result.summary).toEqual({ totalRequests: 3, totalHours: 6 })
    })

    it('reads the comp-time hours from a retired field', async () => {
      mockFormTemplate.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'ct', name: '補休申請' }]) })
      mockFormField.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'old-hours', form: 'ct', label: '補休時數', is_active: false },
          { _id: 'new-hours', form: 'ct', label: '補休時數' },
          { _id: 'date', form: 'ct', label: '補休日期' },
        ]),
      })
      approvalsByForm({
        ct: [
          { _id: 'c1', applicant_employee: owner('emp1'), form_data: { 'old-hours': 4, date: '2026-10-09' } },
          { _id: 'c2', applicant_employee: owner('emp1'), form_data: { 'new-hours': 2, date: '2026-10-10' } },
        ],
      })

      const result = await report('compTime')

      expect(result.records.map((record) => [record.approvalId, record.hours])).toEqual([['c1', 4], ['c2', 2]])
      expect(result.summary.totalHours).toBe(6)
    })
  })
})
