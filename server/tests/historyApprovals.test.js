import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockApprovalRequest = { find: jest.fn() }

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => {
      const role = req.headers['x-test-role'] || 'supervisor'
      const id = req.headers['x-test-employee'] || 'sup1'
      req.user = { role, id }
      next()
    },
    authorizeRoles: (...roles) => (req, res, next) => {
      const role = req.headers['x-test-role'] || 'supervisor'
      const id = req.headers['x-test-employee'] || 'sup1'
      req.user = { role, id }
      if (!roles.includes(role)) {
        return res.status(403).json({ error: 'Forbidden' })
      }
      next()
    }
  }))
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', approvalRoutes)
})

beforeEach(() => {
  mockApprovalRequest.find.mockReset()
})

function mockPopulateChain(docs) {
  const populateApplicant = jest.fn().mockResolvedValue(docs)
  const populateForm = jest.fn().mockReturnValue({ populate: populateApplicant })
  const sort = jest.fn().mockReturnValue({ populate: populateForm })
  mockApprovalRequest.find.mockReturnValue({ sort })
  return { sort, populateForm, populateApplicant }
}

describe('GET /api/approvals/history', () => {
  it('returns signed approvals for supervisor with decision metadata', async () => {
    const docs = [{
      _id: 'req1',
      status: 'approved',
      form: { _id: 'form1', name: 'Leave', category: 'HR' },
      applicant_employee: { _id: 'emp2', name: 'Employee', employeeId: 'E002' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      steps: [
        {
          step_order: 1,
          approvers: [
            { approver: 'sup1', decision: 'approved', decided_at: '2024-01-01T12:00:00.000Z', comment: 'OK' },
          ],
        },
        {
          step_order: 2,
          approvers: [
            { approver: 'sup2', decision: 'approved', decided_at: '2024-01-02T08:00:00.000Z' },
          ],
        },
      ],
      toObject() { return this }
    }]

    const { sort, populateForm, populateApplicant } = mockPopulateChain(docs)

    const res = await request(app).get('/api/approvals/history')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        _id: 'req1',
        status: 'approved',
        form: docs[0].form,
        applicant_employee: docs[0].applicant_employee,
        createdAt: docs[0].createdAt,
        updatedAt: docs[0].updatedAt,
        my_approvals: [
          {
            step_order: 1,
            decision: 'approved',
            decided_at: '2024-01-01T12:00:00.000Z',
            comment: 'OK',
          },
        ],
      },
    ])
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 })
    expect(populateForm).toHaveBeenCalledWith('form', 'name category')
    expect(populateApplicant).toHaveBeenCalledWith('applicant_employee', 'name employeeId department organization')
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      steps: {
        $elemMatch: {
          approvers: {
            $elemMatch: { approver: 'sup1', decision: { $ne: 'pending' } },
          },
        },
      },
    })
  })

  it('rejects access when role is not supervisor or admin', async () => {
    const res = await request(app)
      .get('/api/approvals/history')
      .set('x-test-role', 'employee')

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})
