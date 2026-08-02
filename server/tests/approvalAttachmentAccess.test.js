import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { jest } from '@jest/globals'

const mockApprovalRequest = { findById: jest.fn() }

let downloadApprovalAttachment
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadDir = path.join(__dirname, '../../upload/approvals')
const filename = 'authorization-test.pdf'
const filePath = path.join(uploadDir, filename)

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  const controller = await import('../src/controllers/approvalRequestController.js')
  downloadApprovalAttachment = controller.downloadApprovalAttachment
  fs.mkdirSync(uploadDir, { recursive: true })
  fs.writeFileSync(filePath, '%PDF-1.4\n%%EOF\n')
})

afterAll(() => {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // Ignore cleanup errors for an already removed fixture.
  }
})

beforeEach(() => {
  mockApprovalRequest.findById.mockReset()
})

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    set: jest.fn(),
    download: jest.fn(),
    headersSent: false,
  }
}

function mockApproval(doc) {
  mockApprovalRequest.findById.mockReturnValue({
    lean: jest.fn().mockResolvedValue(doc),
  })
}

describe('approval attachment access', () => {
  it('hides an attachment from a non-participant', async () => {
    mockApproval({
      applicant_employee: 'other-employee',
      steps: [],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    const res = makeRes()

    await downloadApprovalAttachment({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'req1', filename },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.download).not.toHaveBeenCalled()
  })

  it('allows a request approver to download a referenced attachment', async () => {
    mockApproval({
      applicant_employee: 'other-employee',
      steps: [{ approvers: [{ approver: 'sup1' }] }],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    const res = makeRes()

    await downloadApprovalAttachment({
      user: { id: 'sup1', role: 'supervisor' },
      params: { id: 'req1', filename },
    }, res)

    expect(res.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff')
    expect(res.download).toHaveBeenCalledWith(filePath, 'proof.pdf', expect.any(Function))
  })

  it('does not serve a file that is not referenced by the request', async () => {
    mockApproval({
      applicant_employee: 'emp1',
      steps: [],
      form_data: {},
    })
    const res = makeRes()

    await downloadApprovalAttachment({
      user: { id: 'emp1', role: 'employee' },
      params: { id: 'req1', filename },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.download).not.toHaveBeenCalled()
  })
})
