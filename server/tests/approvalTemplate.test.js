import { jest } from '@jest/globals'

const mockApprovalWorkflow = { findOneAndUpdate: jest.fn() }

let setWorkflow

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  const mod = await import('../src/controllers/approvalTemplateController.js')
  setWorkflow = mod.setWorkflow
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
