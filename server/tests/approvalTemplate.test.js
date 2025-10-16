import { jest } from '@jest/globals'

const mockApprovalWorkflow = { findOneAndUpdate: jest.fn() }

let setWorkflow
let getSignRoles
let getSignLevels

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  const mod = await import('../src/controllers/approvalTemplateController.js')
  setWorkflow = mod.setWorkflow
  getSignRoles = mod.getSignRoles
  getSignLevels = mod.getSignLevels
})

beforeEach(() => {
  mockApprovalWorkflow.findOneAndUpdate.mockReset()
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

describe('setWorkflow', () => {
  it('keeps existing policy when none provided', async () => {
    const existingPolicy = { allowDelegate: true }
    mockApprovalWorkflow.findOneAndUpdate.mockResolvedValue({ steps: [], policy: existingPolicy })
    const req = { params: { formId: 'f1' }, body: { steps: [] } }
    const res = makeRes()

    await setWorkflow(req, res)

    expect(mockApprovalWorkflow.findOneAndUpdate).toHaveBeenCalledWith(
      { form: 'f1' },
      { $set: { steps: [] } },
      { new: true, upsert: true }
    )
    expect(res.json).toHaveBeenCalledWith({ steps: [], policy: existingPolicy })
  })

  it('updates policy when provided', async () => {
    const newPolicy = { allowDelegate: false }
    mockApprovalWorkflow.findOneAndUpdate.mockResolvedValue({ steps: [], policy: newPolicy })
    const req = { params: { formId: 'f1' }, body: { steps: [], policy: newPolicy } }
    const res = makeRes()

    await setWorkflow(req, res)

    expect(mockApprovalWorkflow.findOneAndUpdate).toHaveBeenCalledWith(
      { form: 'f1' },
      { $set: { steps: [], policy: newPolicy } },
      { new: true, upsert: true }
    )
    expect(res.json).toHaveBeenCalledWith({ steps: [], policy: newPolicy })
  })
})

describe('sign dictionaries', () => {
  it('returns sign roles list', async () => {
    const res = makeRes()
    await getSignRoles({}, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: 'R001', label: '填報' }),
        expect.objectContaining({ value: 'R007', label: '人資覆核' }),
      ])
    )
  })

  it('returns sign levels list', async () => {
    const res = makeRes()
    await getSignLevels({}, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: 'U001', label: 'L1' }),
        expect.objectContaining({ value: 'U005', label: 'L5' }),
      ])
    )
  })
})
