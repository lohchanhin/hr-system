import { jest } from '@jest/globals'

// 特休以「小時」儲存：扣減、驗證、查詢餘額都是小時（天數只是時數 / 8 的換算）
const mockEmployee = { findOneAndUpdate: jest.fn(), findById: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockEnsureAnnualLeaveHours = jest.fn()

let deductAnnualLeave
let validateAnnualLeaveRequest
let getAnnualLeaveBalance

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/services/leaveHoursMigration.js', () => ({ ensureAnnualLeaveHours: mockEnsureAnnualLeaveHours }))
  const mod = await import('../src/services/annualLeaveService.js')
  deductAnnualLeave = mod.deductAnnualLeave
  validateAnnualLeaveRequest = mod.validateAnnualLeaveRequest
  getAnnualLeaveBalance = mod.getAnnualLeaveBalance
})

beforeEach(() => {
  mockEmployee.findOneAndUpdate.mockReset()
  mockEmployee.findById.mockReset()
  mockApprovalRequest.find.mockReset()
  mockEnsureAnnualLeaveHours.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('annualLeaveService', () => {
  describe('deductAnnualLeave', () => {
    it('rejects non-positive hour counts before touching the database', async () => {
      await expect(deductAnnualLeave('emp1', 0)).rejects.toThrow('Invalid parameters for annual leave deduction')
      await expect(deductAnnualLeave('emp1', -1)).rejects.toThrow('Invalid parameters for annual leave deduction')
      expect(mockEmployee.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('rejects a missing employeeId before touching the database', async () => {
      await expect(deductAnnualLeave('', 1)).rejects.toThrow('Invalid parameters for annual leave deduction')
      expect(mockEmployee.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('performs an atomic increment of usedHours guarded by the remaining balance via $expr', async () => {
      const updated = { _id: 'emp1', annualLeave: { totalHours: 80, usedHours: 32 } }
      mockEmployee.findOneAndUpdate.mockResolvedValue(updated)

      const result = await deductAnnualLeave('emp1', 24, 'req1')

      expect(result).toBe(updated)
      const [filter, update, options] = mockEmployee.findOneAndUpdate.mock.calls[0]
      expect(filter._id).toBe('emp1')
      expect(filter.$expr.$lte[0].$add).toEqual([{ $ifNull: ['$annualLeave.usedHours', 0] }, 24])
      expect(filter.$expr.$lte[1]).toEqual({ $ifNull: ['$annualLeave.totalHours', 0] })
      expect(filter['annualLeave.appliedApprovalRequestIds']).toEqual({ $ne: 'req1' })
      expect(update.$inc).toEqual({ 'annualLeave.usedHours': 24 })
      expect(update.$addToSet).toEqual({ 'annualLeave.appliedApprovalRequestIds': 'req1' })
      expect(options).toEqual({ new: true, runValidators: true })
    })

    it('does not add an idempotency filter or $addToSet when no approvalRequestId is given', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue({ _id: 'emp1' })

      await deductAnnualLeave('emp1', 2)

      const [filter, update] = mockEmployee.findOneAndUpdate.mock.calls[0]
      expect(filter['annualLeave.appliedApprovalRequestIds']).toBeUndefined()
      expect(update.$addToSet).toBeUndefined()
    })

    it('throws an insufficient-balance error naming the remaining hours when the atomic update matches nothing', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      mockEmployee.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          annualLeave: { totalHours: 40, usedHours: 32, appliedApprovalRequestIds: [] },
        }),
      })

      await expect(deductAnnualLeave('emp1', 24, 'req1')).rejects.toMatchObject({
        name: 'AnnualLeaveError',
        code: 'INSUFFICIENT_BALANCE',
        remainingHours: 8,
        requestedHours: 24,
        message: 'Insufficient annual leave balance. Remaining: 8 hours, Requested: 24 hours',
      })
      expect(mockEnsureAnnualLeaveHours).not.toHaveBeenCalled() // 已經是時數格式，不需要轉換
    })

    it('throws "Employee not found" when the id does not resolve to any employee', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      mockEmployee.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) })

      await expect(deductAnnualLeave('missing', 1)).rejects.toThrow('Employee not found')
    })

    it('treats a retried request whose approvalRequestId was already applied as a no-op success (idempotency/race recovery)', async () => {
      // Covers the race where two concurrent requests for the same approval
      // both miss the atomic $ne guard because the first one already applied
      // it between this request's initial attempt and its recovery lookup.
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      const employee = {
        annualLeave: {
          totalHours: 80,
          usedHours: 64,
          appliedApprovalRequestIds: ['req1'],
        },
      }
      mockEmployee.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(employee) })

      const result = await deductAnnualLeave('emp1', 16, 'req1')

      expect(result).toBe(employee)
    })

    it('does not treat an already-applied id as a match when no approvalRequestId was passed this time', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      const employee = {
        annualLeave: {
          totalHours: 80,
          usedHours: 64,
          appliedApprovalRequestIds: ['req1'],
        },
      }
      mockEmployee.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(employee) })

      await expect(deductAnnualLeave('emp1', 16)).rejects.toThrow('Insufficient annual leave balance')
    })

    it('converts a still legacy (days) employee to hours and retries once instead of reporting a false shortage', async () => {
      const updated = { _id: 'emp1', annualLeave: { totalHours: 112, usedHours: 24 } }
      mockEmployee.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(updated)
      mockEmployee.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ annualLeave: { totalDays: 14, usedDays: 2, appliedApprovalRequestIds: [] } }),
      })
      mockEnsureAnnualLeaveHours.mockResolvedValue(true)

      const result = await deductAnnualLeave('emp1', 8, 'req1')

      expect(result).toBe(updated)
      expect(mockEnsureAnnualLeaveHours).toHaveBeenCalledWith('emp1')
      expect(mockEmployee.findOneAndUpdate).toHaveBeenCalledTimes(2)
    })

    it('still reports the shortage (in hours, read from the legacy days) when the converted employee really lacks the balance', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      mockEmployee.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ annualLeave: { totalDays: 2, usedDays: 1, appliedApprovalRequestIds: [] } }),
      })
      mockEnsureAnnualLeaveHours.mockResolvedValue(true)

      await expect(deductAnnualLeave('emp1', 16, 'req1')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', remainingHours: 8, requestedHours: 16 })
    })
  })

  describe('validateAnnualLeaveRequest', () => {
    it('reports invalid with the remaining hours when the request exceeds them', async () => {
      mockEmployee.findById.mockResolvedValue({ annualLeave: { totalHours: 40, usedHours: 32 } })

      const result = await validateAnnualLeaveRequest('emp1', 24)

      expect(result).toEqual({
        valid: false,
        message: '特休餘額不足。剩餘 8 小時，申請 24 小時',
        remainingHours: 8,
        requestedHours: 24,
      })
    })

    it('reports valid exactly at the remaining balance boundary (requested === remaining)', async () => {
      mockEmployee.findById.mockResolvedValue({ annualLeave: { totalHours: 40, usedHours: 16 } })

      const result = await validateAnnualLeaveRequest('emp1', 24)

      expect(result).toEqual({
        valid: true,
        message: 'Valid',
        remainingHours: 24,
        requestedHours: 24,
      })
    })

    it('reads an employee that is still on the days fields as hours', async () => {
      mockEmployee.findById.mockResolvedValue({ annualLeave: { totalDays: 5, usedDays: 2 } })
      expect((await validateAnnualLeaveRequest('emp1', 24)).valid).toBe(true)
      expect((await validateAnnualLeaveRequest('emp1', 24.5)).valid).toBe(false)
    })

    it('returns not-found without throwing when the employee does not exist', async () => {
      mockEmployee.findById.mockResolvedValue(null)

      const result = await validateAnnualLeaveRequest('missing', 1)

      expect(result).toEqual({ valid: false, message: 'Employee not found' })
    })
  })

  describe('getAnnualLeaveBalance', () => {
    it('returns hours as the main figures and days as total / used / remaining hours divided by 8', async () => {
      mockEmployee.findById.mockResolvedValue({
        employeeId: 'A001',
        name: 'Alice',
        annualLeave: { totalHours: 112, usedHours: 44, year: 2026 },
      })

      const result = await getAnnualLeaveBalance('emp1')

      expect(result).toEqual({
        employeeId: 'A001',
        name: 'Alice',
        totalHours: 112,
        usedHours: 44,
        remainingHours: 68,
        totalDays: 14,
        usedDays: 5.5,
        remainingDays: 8.5,
        year: 2026,
      })
    })

    it('reads a document that is not migrated yet exactly like the migration will write it', async () => {
      mockEmployee.findById.mockResolvedValue({
        employeeId: 'A003',
        name: 'Carol',
        annualLeave: { totalDays: 14, usedDays: 6, year: 2026 },
      })

      const result = await getAnnualLeaveBalance('emp1')

      expect(result).toMatchObject({ totalHours: 112, usedHours: 48, remainingHours: 64, remainingDays: 8 })
    })

    it('defaults everything to 0 when annualLeave is entirely unset', async () => {
      mockEmployee.findById.mockResolvedValue({
        employeeId: 'A002',
        name: 'Bob',
        annualLeave: undefined,
      })

      const result = await getAnnualLeaveBalance('emp1')

      expect(result.totalHours).toBe(0)
      expect(result.usedHours).toBe(0)
      expect(result.remainingHours).toBe(0)
      expect(result.remainingDays).toBe(0)
      expect(result.year).toBe(new Date().getFullYear())
    })

    it('throws when the employee does not exist', async () => {
      mockEmployee.findById.mockResolvedValue(null)

      await expect(getAnnualLeaveBalance('missing')).rejects.toThrow('Employee not found')
    })
  })
})
