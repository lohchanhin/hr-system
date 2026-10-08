import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import { oid, queryResult } from './helpers/approvalTestKit.js'

const SUP = oid(2)
const SUP2 = oid(3)
const ADMIN = oid(6)
const EMP = oid(1)

const mockApprovalRequest = { find: jest.fn(), countDocuments: jest.fn() }

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => {
      const role = req.headers['x-test-role'] || 'supervisor'
      const id = req.headers['x-test-employee'] || SUP
      req.user = { role, id }
      next()
    },
    authorizeRoles: (...roles) => (req, res, next) => {
      const role = req.headers['x-test-role'] || 'supervisor'
      const id = req.headers['x-test-employee'] || SUP
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
  mockApprovalRequest.countDocuments.mockReset()
})

function mockHistory(docs, total = docs.length) {
  const query = queryResult(docs)
  mockApprovalRequest.find.mockReturnValue(query)
  mockApprovalRequest.countDocuments.mockResolvedValue(total)
  return query
}

const decidedApprover = (approver, extra = {}) => ({
  approver, decision: 'approved', decided_at: '2024-01-01T12:00:00.000Z', comment: 'OK', ...extra,
})

const sampleDoc = (overrides = {}) => ({
  _id: oid(500),
  status: 'approved',
  form: { _id: oid(100), name: 'Leave', category: 'HR' },
  applicant_employee: { _id: EMP, name: 'Employee', employeeId: 'E002' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  current_step_index: 1,
  steps: [
    { step_order: 1, approvers: [decidedApprover(SUP)] },
    { step_order: 2, approvers: [decidedApprover(SUP2, { decided_at: '2024-01-02T08:00:00.000Z', comment: undefined })] },
  ],
  ...overrides,
})

describe('GET /api/approvals/history', () => {
  it('returns signed approvals for a supervisor with decision metadata', async () => {
    const docs = [sampleDoc()]
    const query = mockHistory(docs)

    const res = await request(app).get('/api/approvals/history')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        _id: docs[0]._id,
        status: 'approved',
        form: docs[0].form,
        applicant_employee: docs[0].applicant_employee,
        createdAt: docs[0].createdAt,
        updatedAt: docs[0].updatedAt,
        my_approvals: [
          { step_order: 1, decision: 'approved', decided_at: '2024-01-01T12:00:00.000Z', comment: 'OK' },
        ],
      },
    ])
    expect(query.sort).toHaveBeenCalledWith({ updatedAt: -1 })
    expect(query.populate).toHaveBeenCalledWith('form', 'name category semanticType')
    expect(query.populate).toHaveBeenCalledWith('applicant_employee', 'name employeeId department organization')
    const filter = mockApprovalRequest.find.mock.calls[0][0]
    expect(filter).toEqual({
      steps: {
        $elemMatch: {
          approvers: {
            $elemMatch: {
              approver: SUP,
              $or: [
                { decision: { $in: ['rejected', 'returned'] } },
                { decision: 'approved', decided_at: { $type: 'date' } },
              ],
            },
          },
        },
      },
    })
    // 沒帶分頁參數：純陣列，附上總筆數標頭
    expect(res.headers['x-total-count']).toBe('1')
  })

  it('lets a plain employee approver read the history of what they signed (not only supervisors)', async () => {
    mockHistory([sampleDoc({ steps: [{ step_order: 1, approvers: [decidedApprover(EMP)] }] })])

    const res = await request(app)
      .get('/api/approvals/history')
      .set('x-test-role', 'employee')
      .set('x-test-employee', EMP)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(mockApprovalRequest.find.mock.calls[0][0].steps.$elemMatch.approvers.$elemMatch.approver).toBe(EMP)
  })

  it('does not list skipped approvals or the legacy phantom approvals (approved without a time)', async () => {
    const docs = [sampleDoc({
      steps: [{
        step_order: 1,
        approvers: [
          { approver: SUP, decision: 'skipped', decided_at: '2024-01-01T12:00:00.000Z' },
          { approver: SUP2, decision: 'approved' },
        ],
      }],
    })]
    mockHistory(docs)

    const res = await request(app).get('/api/approvals/history')

    expect(res.body).toEqual([]) // 這些不是 SUP 簽的
  })

  it('shows a returned request to the approver who returned it, with the reason', async () => {
    mockHistory([sampleDoc({
      status: 'returned',
      steps: [{ step_order: 1, approvers: [{ approver: SUP, decision: 'returned', decided_at: '2024-01-03T00:00:00.000Z', comment: '請補件' }] }],
    })])

    const res = await request(app).get('/api/approvals/history')

    expect(res.body[0].my_approvals).toEqual([
      { step_order: 1, decision: 'returned', decided_at: '2024-01-03T00:00:00.000Z', comment: '請補件' },
    ])
  })

  it('paginates and returns the envelope when page or limit is given', async () => {
    const query = mockHistory([sampleDoc()], 120)

    const res = await request(app).get('/api/approvals/history?page=2&limit=1000')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 120, page: 2, limit: 200 })
    expect(res.body.items).toHaveLength(1)
    expect(query.skip).toHaveBeenCalledWith(200)
    expect(query.limit).toHaveBeenCalledWith(200)
  })

  it('shows an administrator every request, including pending ones, with who is blocking', async () => {
    const pendingDoc = sampleDoc({
      _id: oid(501),
      status: 'pending',
      current_step_index: 0,
      steps: [{ step_order: 1, approvers: [{ approver: { _id: SUP2, name: '離職主管' }, decision: 'pending' }] }],
    })
    const query = mockHistory([pendingDoc, sampleDoc()])

    const res = await request(app)
      .get('/api/approvals/history?status=pending')
      .set('x-test-role', 'admin')
      .set('x-test-employee', ADMIN)

    expect(res.status).toBe(200)
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({ status: 'pending' })
    expect(query.populate).toHaveBeenCalledWith('steps.approvers.approver', 'name')
    expect(res.body[0]).toMatchObject({
      _id: oid(501),
      status: 'pending',
      oversight: true,
      pending_approvers: [{ _id: SUP2, name: '離職主管' }],
    })
    // 其他人簽過的單：顯示他們的簽核動作
    expect(res.body[1].oversight).toBe(true)
    expect(res.body[1].my_approvals.map(item => String(item.approver))).toEqual([SUP, SUP2])
  })

  it('ignores an unknown status filter for administrators', async () => {
    mockHistory([])
    await request(app).get('/api/approvals/history?status=evil').set('x-test-role', 'admin').set('x-test-employee', ADMIN)
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({})
  })

  it('rejects querying another approver history', async () => {
    const res = await request(app)
      .get(`/api/approvals/history?employee_id=${SUP2}`)
      .set('x-test-employee', SUP)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: '只能查看自己的簽核紀錄' })
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})
