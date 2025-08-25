import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockApprovalRequest = { find: jest.fn() }
const mockUser = { findById: jest.fn() }

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = { role: 'supervisor' }; next() },
    authorizeRoles: () => (req, res, next) => next()
  }))
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', approvalRoutes)
})

beforeEach(() => {
  mockApprovalRequest.find.mockReset()
  mockUser.findById.mockReset()
})

describe('GET /api/approvals/inbox', () => {
  it('returns pending approvals for supervisor', async () => {
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
