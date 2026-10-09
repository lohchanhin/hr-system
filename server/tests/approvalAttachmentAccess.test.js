import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { jest } from '@jest/globals'
import { oid } from './helpers/approvalTestKit.js'

const EMP = oid(1)
const SUP = oid(2)
const OTHER_EMP = oid(3)
const REQ = oid(200)

const mockApprovalRequest = { findById: jest.fn() }
const mockApprovalAttachment = { findOne: jest.fn(), find: jest.fn(), insertMany: jest.fn(), updateMany: jest.fn() }
// 排班範圍：主管的直屬部屬（getAllowedScheduleEmployeeIds 用 Employee.find({ supervisor }).select().lean()）
const mockEmployee = { find: jest.fn() }

let downloadApprovalAttachment
let uploadApprovalAttachments
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadDir = path.join(__dirname, '../../upload/approvals')
const filename = 'authorization-test.pdf'
const filePath = path.join(uploadDir, filename)

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/approval_attachment.js', () => ({ default: mockApprovalAttachment }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  const controller = await import('../src/controllers/approvalRequestController.js')
  downloadApprovalAttachment = controller.downloadApprovalAttachment
  uploadApprovalAttachments = controller.uploadApprovalAttachments
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
  mockApprovalAttachment.findOne.mockReset()
  mockApprovalAttachment.insertMany.mockReset()
  mockEmployee.find.mockReset()
  mockEmployee.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) })
  // 預設：沒有上傳紀錄（舊資料），不算綁定到別張單
  mockApprovalAttachment.findOne.mockReturnValue({ lean: async () => null })
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
    lean: jest.fn().mockResolvedValue({ _id: REQ, ...doc }),
  })
}

describe('approval attachment access', () => {
  it('hides an attachment from a non-participant', async () => {
    mockApproval({
      applicant_employee: OTHER_EMP,
      steps: [],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    const res = makeRes()

    await downloadApprovalAttachment({
      user: { id: EMP, role: 'employee' },
      params: { id: REQ, filename },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.download).not.toHaveBeenCalled()
  })

  it('lets a supervisor download the attachment of a direct report even though the supervisor is not an approver (read-only schedule scope)', async () => {
    mockEmployee.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: OTHER_EMP }]) }) })
    mockApproval({
      applicant_employee: OTHER_EMP,
      steps: [{ approvers: [{ approver: oid(77) }] }],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    const res = makeRes()

    await downloadApprovalAttachment({ user: { id: SUP, role: 'supervisor' }, params: { id: REQ, filename } }, res)

    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: SUP })
    expect(res.download).toHaveBeenCalledWith(filePath, 'proof.pdf', expect.any(Function))
  })

  it('still hides the attachment from a supervisor whose reports do not include the applicant', async () => {
    mockEmployee.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: oid(9) }]) }) })
    mockApproval({
      applicant_employee: OTHER_EMP,
      steps: [{ approvers: [{ approver: oid(77) }] }],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    const res = makeRes()

    await downloadApprovalAttachment({ user: { id: SUP, role: 'supervisor' }, params: { id: REQ, filename } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.download).not.toHaveBeenCalled()
  })

  it('allows a request approver to download a referenced attachment', async () => {
    mockApproval({
      applicant_employee: OTHER_EMP,
      steps: [{ approvers: [{ approver: SUP }] }],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    const res = makeRes()

    await downloadApprovalAttachment({
      user: { id: SUP, role: 'supervisor' },
      params: { id: REQ, filename },
    }, res)

    expect(res.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff')
    expect(res.download).toHaveBeenCalledWith(filePath, 'proof.pdf', expect.any(Function))
  })

  it('does not serve a file that is not referenced by the request', async () => {
    mockApproval({
      applicant_employee: EMP,
      steps: [],
      form_data: {},
    })
    const res = makeRes()

    await downloadApprovalAttachment({
      user: { id: EMP, role: 'employee' },
      params: { id: REQ, filename },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.download).not.toHaveBeenCalled()
  })

  it('does not serve a file that was registered to a different request', async () => {
    mockApproval({
      applicant_employee: EMP,
      steps: [],
      form_data: { proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    })
    mockApprovalAttachment.findOne.mockReturnValue({ lean: async () => ({ filename, request: oid(999) }) })
    const res = makeRes()

    await downloadApprovalAttachment({ user: { id: EMP, role: 'employee' }, params: { id: REQ, filename } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.download).not.toHaveBeenCalled()
  })

  it('serves a file registered to this very request', async () => {
    mockApproval({
      applicant_employee: EMP,
      steps: [],
      form_data: { proof: [{ name: '請假證明.pdf', url: `/upload/approvals/${filename}` }] },
    })
    mockApprovalAttachment.findOne.mockReturnValue({ lean: async () => ({ filename, request: REQ }) })
    const res = makeRes()

    await downloadApprovalAttachment({ user: { id: EMP, role: 'employee' }, params: { id: REQ, filename } }, res)

    expect(res.download).toHaveBeenCalledWith(filePath, '請假證明.pdf', expect.any(Function))
  })

  it('rejects a malformed request id and a traversal-looking file name', async () => {
    const badId = makeRes()
    await downloadApprovalAttachment({ user: { id: EMP, role: 'employee' }, params: { id: 'abc', filename } }, badId)
    expect(badId.status).toHaveBeenCalledWith(400)

    mockApproval({ applicant_employee: EMP, steps: [], form_data: {} })
    const traversal = makeRes()
    await downloadApprovalAttachment({ user: { id: EMP, role: 'employee' }, params: { id: REQ, filename: '../secret.txt' } }, traversal)
    expect(traversal.status).toHaveBeenCalledWith(404)
    expect(traversal.download).not.toHaveBeenCalled()
  })
})

describe('upload registration', () => {
  it('records who uploaded each file and returns the usual file list', async () => {
    mockApprovalAttachment.insertMany.mockResolvedValue([])
    const res = makeRes()

    await uploadApprovalAttachments({
      user: { id: EMP, role: 'employee' },
      files: [{ originalname: '請假證明.pdf', filename: '1700000000000-aaaaaaaaaaaaaaaa.pdf', size: 12, mimetype: 'application/pdf', path: 'x' }],
    }, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      files: [{ name: '請假證明.pdf', url: '/upload/approvals/1700000000000-aaaaaaaaaaaaaaaa.pdf', size: 12, type: 'application/pdf' }],
    })
    expect(mockApprovalAttachment.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ filename: '1700000000000-aaaaaaaaaaaaaaaa.pdf', uploader: EMP, original_name: '請假證明.pdf', request: null }),
    ])
  })

  it('asks for a file when none was sent', async () => {
    const res = makeRes()
    await uploadApprovalAttachments({ user: { id: EMP, role: 'employee' }, files: [] }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '請選擇附件' })
  })

  it('removes the stored files when the upload cannot be registered', async () => {
    const stray = path.join(uploadDir, 'stray-registration-failure.pdf')
    fs.writeFileSync(stray, '%PDF-1.4\n')
    mockApprovalAttachment.insertMany.mockRejectedValue(new Error('db down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = makeRes()

    await uploadApprovalAttachments({
      user: { id: EMP, role: 'employee' },
      files: [{ originalname: 'a.pdf', filename: 'stray-registration-failure.pdf', size: 1, mimetype: 'application/pdf', path: stray }],
    }, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(fs.existsSync(stray)).toBe(false)
    jest.restoreAllMocks()
  })
})
