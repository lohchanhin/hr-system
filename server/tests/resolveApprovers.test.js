import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'

const mockEmployeeModel = {
  findById: jest.fn(),
  find: jest.fn(),
}

let resolveApprovers

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }))
  const module = await import('../src/controllers/approvalRequestController.js')
  resolveApprovers = module.resolveApprovers
})

beforeEach(() => {
  mockEmployeeModel.findById.mockReset()
})

describe('resolveApprovers - manager type', () => {
  it('returns applicant supervisor when special value is used', async () => {
    const applicant = { supervisor: 'sup1' }

    const result = await resolveApprovers(
      { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      applicant,
    )

    expect(result).toEqual(['sup1'])
    expect(mockEmployeeModel.findById).not.toHaveBeenCalled()
  })

  it('returns specified supervisor when valid manager id provided', async () => {
    const applicant = { supervisor: 'sup1' }
    mockEmployeeModel.findById.mockResolvedValue({ _id: 'sup2', role: 'supervisor' })

    const result = await resolveApprovers(
      { approver_type: 'manager', approver_value: 'sup2' },
      applicant,
    )

    expect(result).toEqual(['sup2'])
    expect(mockEmployeeModel.findById).toHaveBeenCalledWith('sup2', { _id: 1, role: 1 })
  })
})
