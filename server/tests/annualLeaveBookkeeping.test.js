import { jest } from '@jest/globals'

// 特休餘額的記帳：扣減錯誤資料、核准後撤回的返還、年度總天數的原子更新、使用紀錄查詢
const mockEmployee = { findOneAndUpdate: jest.fn(), findById: jest.fn(), updateOne: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockFormTemplate = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetLeaveFieldIdsForForm = jest.fn()

let deductAnnualLeave
let refundAnnualLeave
let isAnnualLeaveConfigured
let getAnnualLeaveHistory
let setAnnualLeaveQuota

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
    getLeaveFieldIdsForForm: mockGetLeaveFieldIdsForForm,
  }))
  const mod = await import('../src/services/annualLeaveService.js')
  deductAnnualLeave = mod.deductAnnualLeave
  refundAnnualLeave = mod.refundAnnualLeave
  isAnnualLeaveConfigured = mod.isAnnualLeaveConfigured
  getAnnualLeaveHistory = mod.getAnnualLeaveHistory
  setAnnualLeaveQuota = mod.setAnnualLeaveQuota
})

beforeEach(() => {
  for (const mock of [mockEmployee, mockApprovalRequest, mockFormTemplate, mockFormField]) {
    Object.values(mock).forEach(fn => fn.mockReset())
  }
  mockGetLeaveFieldIdsForForm.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('deduction errors', () => {
  it('carry code, remaining and requested so the caller can write a Chinese message', async () => {
    mockEmployee.findOneAndUpdate.mockResolvedValue(null)
    mockEmployee.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ annualLeave: { totalDays: 5, usedDays: 4, appliedApprovalRequestIds: [] } }),
    })

    await expect(deductAnnualLeave('emp1', 3, 'req1')).rejects.toMatchObject({
      name: 'AnnualLeaveError',
      code: 'INSUFFICIENT_BALANCE',
      remaining: 1,
      requested: 3,
    })
  })
})

describe('isAnnualLeaveConfigured', () => {
  it('is false for employees imported without a quota and true once a quota or usage exists', () => {
    expect(isAnnualLeaveConfigured(undefined)).toBe(false)
    expect(isAnnualLeaveConfigured({})).toBe(false)
    expect(isAnnualLeaveConfigured({ annualLeave: { totalDays: 0, usedDays: 0 } })).toBe(false)
    expect(isAnnualLeaveConfigured({ annualLeave: { totalDays: 10, usedDays: 0 } })).toBe(true)
    expect(isAnnualLeaveConfigured({ annualLeave: { totalDays: 0, usedDays: 2 } })).toBe(true)
  })
})

describe('refundAnnualLeave', () => {
  it('gives the days back atomically and removes the applied marker so a second refund is a no-op', async () => {
    mockEmployee.findOneAndUpdate.mockResolvedValue({ annualLeave: { totalDays: 10, usedDays: 3 } })

    const result = await refundAnnualLeave('emp1', 2, 'req1')

    expect(result).toEqual({ refunded: true, days: 2 })
    const [filter, update, options] = mockEmployee.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ _id: 'emp1', 'annualLeave.appliedApprovalRequestIds': 'req1' })
    expect(update).toEqual({
      $inc: { 'annualLeave.usedDays': -2 },
      $pull: { 'annualLeave.appliedApprovalRequestIds': 'req1' },
    })
    expect(options).toEqual({ new: true })
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('does nothing when that approval never deducted anything', async () => {
    mockEmployee.findOneAndUpdate.mockResolvedValue(null)
    expect(await refundAnnualLeave('emp1', 2, 'req1')).toEqual({ refunded: false, days: 0 })
  })

  it('never leaves a negative used-days value behind', async () => {
    mockEmployee.findOneAndUpdate.mockResolvedValue({ annualLeave: { totalDays: 10, usedDays: -1 } })
    await refundAnnualLeave('emp1', 2, 'req1')
    expect(mockEmployee.updateOne).toHaveBeenCalledWith(
      { _id: 'emp1', 'annualLeave.usedDays': { $lt: 0 } },
      { $set: { 'annualLeave.usedDays': 0 } },
    )
  })

  it('validates its parameters', async () => {
    await expect(refundAnnualLeave('emp1', 0, 'req1')).rejects.toThrow('Invalid parameters')
    await expect(refundAnnualLeave('emp1', 1, null)).rejects.toThrow('Invalid parameters')
    expect(mockEmployee.findOneAndUpdate).not.toHaveBeenCalled()
  })
})

describe('setAnnualLeaveQuota', () => {
  it('only changes totalDays within the same year, in one atomic update (usedDays is never overwritten)', async () => {
    const updated = { _id: 'emp1', annualLeave: { totalDays: 14, usedDays: 4, year: 2026 } }
    mockEmployee.findOneAndUpdate.mockResolvedValueOnce(updated)

    const result = await setAnnualLeaveQuota('emp1', 14, 2026)

    expect(result).toBe(updated)
    expect(mockEmployee.findOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(mockEmployee.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'emp1', 'annualLeave.year': 2026 },
      { $set: { 'annualLeave.totalDays': 14 } },
      { new: true },
    )
  })

  it('resets the balance when a new year is set', async () => {
    mockEmployee.findOneAndUpdate.mockResolvedValueOnce(null)
    mockEmployee.findOneAndUpdate.mockResolvedValueOnce({ _id: 'emp1', annualLeave: { totalDays: 10, usedDays: 0, year: 2027 } })

    await setAnnualLeaveQuota('emp1', 10, 2027)

    expect(mockEmployee.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: 'emp1', 'annualLeave.year': { $ne: 2027 } },
      { $set: { annualLeave: { totalDays: 10, usedDays: 0, year: 2027, appliedApprovalRequestIds: [] } } },
      { new: true },
    )
  })

  it('throws when the employee does not exist', async () => {
    mockEmployee.findOneAndUpdate.mockResolvedValue(null)
    await expect(setAnnualLeaveQuota('missing', 10, 2026)).rejects.toThrow('Employee not found')
  })
})

describe('getAnnualLeaveHistory', () => {
  const leaveForm = { _id: 'form1', name: '請假', semanticType: 'leave' }
  const leaveFields = { typeId: 'f-type', startId: 'f-start', endId: 'f-end', daysId: 'f-days', typeOptions: [] }

  function mockRequests(requests) {
    mockFormTemplate.find.mockReturnValue({ lean: async () => [leaveForm] })
    mockGetLeaveFieldIdsForForm.mockResolvedValue(leaveFields)
    mockApprovalRequest.find.mockReturnValue({ sort: () => ({ lean: async () => requests }) })
    mockFormField.find.mockReturnValue({ lean: async () => [{ _id: 'f-reason', label: '事由' }] })
  }

  it('reads the leave data by field id (the old literal leaveType / days keys never existed)', async () => {
    mockRequests([
      {
        _id: 'r1',
        createdAt: '2026-02-20T00:00:00.000Z',
        form_data: { 'f-type': '特休假', 'f-start': '2026-03-02', 'f-end': '2026-03-04', 'f-reason': '旅行' },
      },
      {
        _id: 'r2',
        createdAt: '2026-04-01T00:00:00.000Z',
        form_data: { 'f-type': '病假', 'f-start': '2026-04-02', 'f-end': '2026-04-02' },
      },
      {
        _id: 'r3',
        createdAt: '2026-05-01T00:00:00.000Z',
        form_data: { 'f-type': '特休', 'f-start': '2026-05-04', 'f-end': '2026-05-05', 'f-days': '1.5' },
      },
    ])

    const history = await getAnnualLeaveHistory('emp1')

    expect(mockApprovalRequest.find).toHaveBeenCalledWith({ applicant_employee: 'emp1', status: 'approved', form: 'form1' })
    expect(history).toEqual([
      { requestId: 'r3', formName: '請假', createdAt: '2026-05-01T00:00:00.000Z', days: 1.5, startDate: '2026-05-04', endDate: '2026-05-05', reason: undefined },
      { requestId: 'r1', formName: '請假', createdAt: '2026-02-20T00:00:00.000Z', days: 3, startDate: '2026-03-02', endDate: '2026-03-04', reason: '旅行' },
    ])
  })

  it('prefers the days that were actually deducted and filters by the leave start year', async () => {
    mockRequests([
      {
        _id: 'r1',
        createdAt: '2025-12-20T00:00:00.000Z',
        annual_leave: { state: 'deducted', days: 2 },
        form_data: { 'f-type': '特休假', 'f-start': '2026-01-05', 'f-end': '2026-01-07' },
      },
      {
        _id: 'r2',
        createdAt: '2025-11-01T00:00:00.000Z',
        form_data: { 'f-type': '特休假', 'f-start': '2025-11-10', 'f-end': '2025-11-10' },
      },
    ])

    const in2026 = await getAnnualLeaveHistory('emp1', 2026)
    expect(in2026.map(item => [item.requestId, item.days])).toEqual([['r1', 2]])
    const in2025 = await getAnnualLeaveHistory('emp1', 2025)
    expect(in2025.map(item => item.requestId)).toEqual(['r2'])
  })

  it('lists a request whose type, dates, days and reason sit under replaced (deactivated) fields, per request', async () => {
    mockFormTemplate.find.mockReturnValue({ lean: async () => [leaveForm] })
    // 管理員刪掉（停用）又重建同標籤的欄位：啟用中的新欄位在前，停用的舊欄位在後
    mockGetLeaveFieldIdsForForm.mockResolvedValue({
      typeId: 'n-type',
      startId: 'n-start',
      endId: 'n-end',
      daysId: 'n-days',
      typeIds: ['n-type', 'o-type'],
      startIds: ['n-start', 'o-start'],
      endIds: ['n-end', 'o-end'],
      daysIds: ['n-days', 'o-days'],
      typeOptions: [],
    })
    mockApprovalRequest.find.mockReturnValue({
      sort: () => ({
        lean: async () => [
          { _id: 'r-old', createdAt: '2026-02-20T00:00:00.000Z', form_data: { 'o-type': '特休', 'o-start': '2026-03-02', 'o-end': '2026-03-03', 'o-reason': '舊欄位的事由' } },
          { _id: 'r-new', createdAt: '2026-03-20T00:00:00.000Z', form_data: { 'n-type': '特休假', 'n-start': '2026-04-06', 'n-end': '2026-04-06', 'n-reason': '新欄位的事由' } },
          { _id: 'r-mix', createdAt: '2026-04-20T00:00:00.000Z', form_data: { 'o-type': '特休', 'n-start': '2026-05-04', 'n-end': '2026-05-08', 'o-days': 2.5 } },
          { _id: 'r-sick', createdAt: '2026-05-20T00:00:00.000Z', form_data: { 'o-type': '病假', 'o-start': '2026-06-01', 'o-end': '2026-06-01' } },
        ],
      }),
    })
    mockFormField.find.mockReturnValue({
      lean: async () => [
        { _id: 'o-reason', label: '事由', is_active: false, order: 4 },
        { _id: 'n-reason', label: '事由', order: 9 },
      ],
    })

    const history = await getAnnualLeaveHistory('emp1')

    expect(history.map(item => [item.requestId, item.days, item.startDate, item.endDate, item.reason])).toEqual([
      ['r-mix', 2.5, '2026-05-04', '2026-05-08', undefined],
      ['r-new', 1, '2026-04-06', '2026-04-06', '新欄位的事由'],
      ['r-old', 2, '2026-03-02', '2026-03-03', '舊欄位的事由'],
    ])
  })

  it('skips forms without a leave type field and returns an empty list when nothing matches', async () => {
    mockFormTemplate.find.mockReturnValue({ lean: async () => [leaveForm] })
    mockGetLeaveFieldIdsForForm.mockResolvedValue({})

    expect(await getAnnualLeaveHistory('emp1')).toEqual([])
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})
