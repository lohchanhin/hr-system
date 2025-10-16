import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'

const mockEmployeeModel = {
  findById: jest.fn(),
  find: jest.fn(),
}
const mockSubDepartmentModel = {
  find: jest.fn(),
}

let resolveApprovers

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartmentModel }))
  const module = await import('../src/controllers/approvalRequestController.js')
  resolveApprovers = module.resolveApprovers
})

beforeEach(() => {
  mockEmployeeModel.findById.mockReset()
  mockEmployeeModel.find.mockReset()
  mockSubDepartmentModel.find.mockReset()
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

describe('resolveApprovers - group type', () => {
  it('returns employees within selected sub-departments', async () => {
    const subDeptId = '507f1f77bcf86cd799439011'
    mockSubDepartmentModel.find.mockResolvedValue([{ _id: subDeptId }])
    mockEmployeeModel.find.mockResolvedValue([{ _id: 'e1' }, { _id: 'e2' }])

    const result = await resolveApprovers({ approver_type: 'group', approver_value: [subDeptId] }, {})

    expect(mockSubDepartmentModel.find).toHaveBeenCalledWith({ _id: { $in: [subDeptId] } }, { _id: 1 })
    expect(mockEmployeeModel.find).toHaveBeenCalledWith({ subDepartment: { $in: [subDeptId] } }, { _id: 1 })
    expect(result).toEqual(['e1', 'e2'])
  })
})
