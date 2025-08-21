import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockApprovalRequest = { find: jest.fn() }
const mockUser = { findById: jest.fn() }

let app
let inboxApprovals

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }))
  ;({ inboxApprovals } = await import('../src/controllers/approvalRequestController.js'))
  app = express()
  app.use(express.json())
  app.get('/api/approvals/inbox', inboxApprovals)
})

beforeEach(() => {
  mockApprovalRequest.find.mockReset()
  mockUser.findById.mockReset()
})

describe('inboxApprovals', () => {
  it('returns pending approvals for employee', async () => {
    const docs = [{
      steps: [{ approvers: [{ approver: 'emp1', decision: 'pending' }] }],
      current_step_index: 0,
      form: { name: 'F', category: 'C' }
    }]
    mockApprovalRequest.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(docs) })

    const res = await request(app).get('/api/approvals/inbox?employee_id=emp1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(docs)
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      status: 'pending',
      'steps.approvers.approver': 'emp1',
      'steps.approvers.decision': 'pending'
    })
  })
})
