// 特休年度的預設值是「台灣現在的年度」：伺服器時區是 UTC 時，台灣 1/1 清晨（UTC 還是 12/31）設定特休不能記成去年
// （原本用 new Date().getFullYear()，結果跟著伺服器的時區走）。
import { jest } from '@jest/globals'

const mockEmployee = { findOneAndUpdate: jest.fn(), findById: jest.fn() }

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: { find: jest.fn() } }))
jest.unstable_mockModule('../src/services/leaveHoursMigration.js', () => ({ ensureAnnualLeaveHours: jest.fn() }))

const { setAnnualLeaveQuota } = await import('../src/services/annualLeaveService.js')

beforeEach(() => {
  mockEmployee.findOneAndUpdate.mockReset()
  mockEmployee.findOneAndUpdate.mockResolvedValue({ _id: 'emp1', annualLeave: {} })
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('setAnnualLeaveQuota 沒帶年度', () => {
  it('台灣 2027-01-01 04:00（UTC 2026-12-31 20:00）：年度是 2027', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-12-31T20:00:00.000Z'))

    await setAnnualLeaveQuota('emp1', 80)

    expect(mockEmployee.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'emp1', 'annualLeave.year': 2027 })
  })

  it('台灣 2026-12-31 23:00（UTC 2026-12-31 15:00）：年度是 2026；有帶年度就用帶的', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-12-31T15:00:00.000Z'))

    await setAnnualLeaveQuota('emp1', 80)
    expect(mockEmployee.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'emp1', 'annualLeave.year': 2026 })

    mockEmployee.findOneAndUpdate.mockClear()
    await setAnnualLeaveQuota('emp1', 80, 2030)
    expect(mockEmployee.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'emp1', 'annualLeave.year': 2030 })
  })
})
