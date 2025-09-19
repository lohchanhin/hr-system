import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockApprovalRequest = { find: jest.fn() }

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
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
})

describe('GET /api/approvals/inbox', () => {
  it('returns pending approvals for supervisor', async () => {
    const docs = [{
      steps: [{ approvers: [{ approver: 'emp1', decision: 'pending' }] }],
      current_step_index: 0,
      form: { name: 'F', category: 'C' }
    }]
    const populate = jest.fn().mockResolvedValue(docs)
    const sort = jest.fn().mockReturnValue({ populate })
    mockApprovalRequest.find.mockReturnValue({ sort })

    const res = await request(app).get('/api/approvals/inbox?employee_id=emp1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(docs)
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      status: 'pending',
      steps: {
        $elemMatch: { approvers: { $elemMatch: { approver: 'emp1', decision: 'pending' } } },
      },
    })
  })

  it('excludes approvals where approver is not pending', async () => {
    const docs = [
      {
        steps: [{ approvers: [{ approver: 'emp1', decision: 'pending' }] }],
        current_step_index: 0,
        form: { name: 'F', category: 'C' },
      },
      {
        steps: [{ approvers: [{ approver: 'emp1', decision: 'approved' }, { approver: 'emp2', decision: 'pending' }] }],
        current_step_index: 0,
        form: { name: 'F2', category: 'C2' },
      },
    ]
    const populate = jest.fn().mockResolvedValue(docs)
    const sort = jest.fn().mockReturnValue({ populate })
    mockApprovalRequest.find.mockReturnValue({ sort })

    const res = await request(app).get('/api/approvals/inbox?employee_id=emp1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([docs[0]])
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      status: 'pending',
      steps: {
        $elemMatch: { approvers: { $elemMatch: { approver: 'emp1', decision: 'pending' } } },
      },
    })
  })

  it('returns approvals sorted by createdAt descending', async () => {
    const docs = [
      {
        _id: 'req1',
        createdAt: '2024-01-01T00:00:00.000Z',
        steps: [{ approvers: [{ approver: 'emp1', decision: 'pending' }] }],
        current_step_index: 0,
        form: { name: 'Old', category: 'Cat' }
      },
      {
        _id: 'req2',
        createdAt: '2024-03-01T00:00:00.000Z',
        steps: [{ approvers: [{ approver: 'emp1', decision: 'pending' }] }],
        current_step_index: 0,
        form: { name: 'New', category: 'Cat' }
      },
      {
        _id: 'req3',
        createdAt: '2024-02-01T00:00:00.000Z',
        steps: [{ approvers: [{ approver: 'emp1', decision: 'pending' }] }],
        current_step_index: 0,
        form: { name: 'Mid', category: 'Cat' }
      }
    ]
    const sortedDocs = [...docs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    const populate = jest.fn().mockResolvedValue(sortedDocs)
    const sort = jest.fn().mockReturnValue({ populate })
    mockApprovalRequest.find.mockReturnValue({ sort })

    const res = await request(app).get('/api/approvals/inbox?employee_id=emp1')

    expect(res.status).toBe(200)
    expect(res.body.map(doc => doc._id)).toEqual(sortedDocs.map(doc => doc._id))
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
  })
})
