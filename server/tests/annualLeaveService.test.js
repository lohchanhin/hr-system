import { jest } from '@jest/globals'

const mockEmployee = { findOneAndUpdate: jest.fn(), findById: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }

let deductAnnualLeave
let validateAnnualLeaveRequest
let getAnnualLeaveBalance

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  const mod = await import('../src/services/annualLeaveService.js')
  deductAnnualLeave = mod.deductAnnualLeave
  validateAnnualLeaveRequest = mod.validateAnnualLeaveRequest
  getAnnualLeaveBalance = mod.getAnnualLeaveBalance
})

beforeEach(() => {
  mockEmployee.findOneAndUpdate.mockReset()
  mockEmployee.findById.mockReset()
  mockApprovalRequest.find.mockReset()
})

describe('annualLeaveService', () => {
  describe('deductAnnualLeave', () => {
    it('rejects non-positive day counts before touching the database', async () => {
      await expect(deductAnnualLeave('emp1', 0)).rejects.toThrow('Invalid parameters for annual leave deduction')
      await expect(deductAnnualLeave('emp1', -1)).rejects.toThrow('Invalid parameters for annual leave deduction')
      expect(mockEmployee.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('rejects a missing employeeId before touching the database', async () => {
      await expect(deductAnnualLeave('', 1)).rejects.toThrow('Invalid parameters for annual leave deduction')
      expect(mockEmployee.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('performs an atomic increment guarded by remaining balance via $expr', async () => {
      const updated = { _id: 'emp1', annualLeave: { totalDays: 10, usedDays: 4 } }
      mockEmployee.findOneAndUpdate.mockResolvedValue(updated)

      const result = await deductAnnualLeave('emp1', 3, 'req1')

      expect(result).toBe(updated)
      const [filter, update, options] = mockEmployee.findOneAndUpdate.mock.calls[0]
      expect(filter._id).toBe('emp1')
      expect(filter.$expr.$lte[0].$add).toEqual([{ $ifNull: ['$annualLeave.usedDays', 0] }, 3])
      expect(filter.$expr.$lte[1]).toEqual({ $ifNull: ['$annualLeave.totalDays', 0] })
      expect(filter['annualLeave.appliedApprovalRequestIds']).toEqual({ $ne: 'req1' })
      expect(update.$inc).toEqual({ 'annualLeave.usedDays': 3 })
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

    it('throws an insufficient-balance error naming the remaining days when the atomic update matches nothing', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      mockEmployee.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          annualLeave: { totalDays: 5, usedDays: 4, appliedApprovalRequestIds: [] },
        }),
      })

      await expect(deductAnnualLeave('emp1', 3, 'req1')).rejects.toThrow(
        'Insufficient annual leave balance. Remaining: 1 days, Requested: 3 days'
      )
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
          totalDays: 10,
          usedDays: 8,
          appliedApprovalRequestIds: ['req1'],
        },
      }
      mockEmployee.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(employee) })

      const result = await deductAnnualLeave('emp1', 2, 'req1')

      expect(result).toBe(employee)
    })

    it('does not treat an already-applied id as a match when no approvalRequestId was passed this time', async () => {
      mockEmployee.findOneAndUpdate.mockResolvedValue(null)
      const employee = {
        annualLeave: {
          totalDays: 10,
          usedDays: 8,
          appliedApprovalRequestIds: ['req1'],
        },
      }
      mockEmployee.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(employee) })

      await expect(deductAnnualLeave('emp1', 2)).rejects.toThrow('Insufficient annual leave balance')
    })
  })

  describe('validateAnnualLeaveRequest', () => {
    it('reports invalid with the remaining balance when the request exceeds it', async () => {
      const employee = {
        annualLeave: { totalDays: 5, usedDays: 4 },
        canDeductAnnualLeave: (days) => (5 - 4) >= days,
      }
      mockEmployee.findById.mockResolvedValue(employee)

      const result = await validateAnnualLeaveRequest('emp1', 3)

      expect(result).toEqual({
        valid: false,
        message: '特休餘額不足。剩餘 1 天，申請 3 天',
        remaining: 1,
        requested: 3,
      })
    })

    it('reports valid exactly at the remaining balance boundary (requested === remaining)', async () => {
      const employee = {
        annualLeave: { totalDays: 5, usedDays: 2 },
        canDeductAnnualLeave: (days) => (5 - 2) >= days,
      }
      mockEmployee.findById.mockResolvedValue(employee)

      const result = await validateAnnualLeaveRequest('emp1', 3)

      expect(result).toEqual({
        valid: true,
        message: 'Valid',
        remaining: 3,
        requested: 3,
      })
    })

    it('returns not-found without throwing when the employee does not exist', async () => {
      mockEmployee.findById.mockResolvedValue(null)

      const result = await validateAnnualLeaveRequest('missing', 1)

      expect(result).toEqual({ valid: false, message: 'Employee not found' })
    })
  })

  describe('getAnnualLeaveBalance', () => {
    it('computes remainingDays from totalDays minus usedDays', async () => {
      mockEmployee.findById.mockResolvedValue({
        employeeId: 'A001',
        name: 'Alice',
        annualLeave: { totalDays: 14, usedDays: 6, year: 2026 },
      })

      const result = await getAnnualLeaveBalance('emp1')

      expect(result).toEqual({
        employeeId: 'A001',
        name: 'Alice',
        totalDays: 14,
        usedDays: 6,
        remainingDays: 8,
        year: 2026,
      })
    })

    it('defaults totalDays/usedDays to 0 when annualLeave is entirely unset', async () => {
      mockEmployee.findById.mockResolvedValue({
        employeeId: 'A002',
        name: 'Bob',
        annualLeave: undefined,
      })

      const result = await getAnnualLeaveBalance('emp1')

      expect(result.totalDays).toBe(0)
      expect(result.usedDays).toBe(0)
      expect(result.remainingDays).toBe(0)
      expect(result.year).toBe(new Date().getFullYear())
    })

    it('throws when the employee does not exist', async () => {
      mockEmployee.findById.mockResolvedValue(null)

      await expect(getAnnualLeaveBalance('missing')).rejects.toThrow('Employee not found')
    })
  })
})
