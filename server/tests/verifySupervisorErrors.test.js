import { jest } from '@jest/globals'

// 排班寫入前的範圍檢查：編號格式不對是請求的問題（400）；以前一律回 500，還把資料庫的錯誤訊息原樣回給使用者
const mockEmployee = { findById: jest.fn() }
const mockShiftSchedule = { findById: jest.fn() }
const getScheduleAccessSummaryForRequest = jest.fn()
const isEmployeeInScheduleScope = jest.fn()

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/services/scheduleAccessService.js', () => ({
  getScheduleAccessSummaryForRequest,
  isEmployeeInScheduleScope,
}))

const { verifySupervisor } = await import('../src/middleware/supervisor.js')

const castError = (value, model) => Object.assign(
  new Error(`Cast to ObjectId failed for value "${value}" (type string) at path "_id" for model "${model}"`),
  { name: 'CastError' },
)

function run(req) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
  const next = jest.fn()
  return verifySupervisor({ params: {}, body: {}, ...req }, res, next).then(() => ({ res, next }))
}

let consoleError

beforeEach(() => {
  mockEmployee.findById.mockReset()
  mockShiftSchedule.findById.mockReset()
  getScheduleAccessSummaryForRequest.mockReset().mockResolvedValue({ canSchedule: true, supervisorScope: false })
  isEmployeeInScheduleScope.mockReset().mockReturnValue(true)
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

const scheduler = { _id: 'actor-1', role: 'employee' }

describe('verifySupervisor error handling', () => {
  it('answers 400 for a malformed schedule id, without the database message', async () => {
    mockEmployee.findById.mockResolvedValueOnce(scheduler)
    mockShiftSchedule.findById.mockRejectedValue(castError('zzz', 'ShiftSchedule'))

    const { res, next } = await run({ user: { id: 'actor-1', role: 'employee' }, params: { id: 'zzz' } })

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid employee or schedule id' })
    expect(next).not.toHaveBeenCalled()
  })

  it('answers 400 for a malformed employee id in the body', async () => {
    mockEmployee.findById
      .mockResolvedValueOnce(scheduler)
      .mockRejectedValueOnce(castError('[object Object]', 'Employee'))

    const { res, next } = await run({
      user: { id: 'actor-1', role: 'employee' },
      body: { schedules: [{ employee: { $ne: null }, date: '2031-03-03', shiftId: 'day' }] },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.body)).not.toContain('Cast to')
    expect(next).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when the lookup itself fails', async () => {
    mockEmployee.findById.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:27017'))

    const { res, next } = await run({ user: { id: 'actor-1', role: 'employee' }, body: { employee: 'e1' } })

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Schedule scope check failed' })
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5')
    expect(next).not.toHaveBeenCalled()
  })

  it('still lets an in-scope request through', async () => {
    mockEmployee.findById
      .mockResolvedValueOnce(scheduler)
      .mockResolvedValueOnce({ _id: 'e1', subDepartment: 'u1' })

    const { res, next } = await run({ user: { id: 'actor-1', role: 'employee' }, body: { employee: 'e1' } })

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(200)
  })
})
