import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import { oid, queryResult } from './helpers/approvalTestKit.js'

const EMP = oid(1)
const OTHER = oid(2)

const mockApprovalRequest = { find: jest.fn(), countDocuments: jest.fn() }

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = { id: EMP, role: 'supervisor' }; next() },
    authorizeRoles: () => (req, res, next) => { req.user = { id: EMP, role: 'supervisor' }; next() }
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

function mockInbox(docs, total = docs.length) {
  const query = queryResult(docs)
  mockApprovalRequest.find.mockReturnValue(query)
  mockApprovalRequest.countDocuments.mockResolvedValue(total)
  return query
}

describe('GET /api/approvals/inbox', () => {
  it('returns pending approvals for the signed-in approver, populated, newest first', async () => {
    const docs = [{
      _id: oid(10),
      steps: [{ approvers: [{ approver: { _id: EMP, name: '我' }, decision: 'pending' }] }],
      current_step_index: 0,
      form: { name: 'F', category: 'C' },
    }]
    const query = mockInbox(docs)

    const res = await request(app).get(`/api/approvals/inbox?employee_id=${EMP}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(docs)
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(query.populate).toHaveBeenCalledWith('form', 'name category semanticType')
    expect(query.populate).toHaveBeenCalledWith('applicant_employee', 'name employeeId department organization')
    expect(query.populate).toHaveBeenCalledWith('steps.approvers.approver', 'name')
    expect(res.headers['x-total-count']).toBe('1')
  })

  it('filters by the CURRENT step in the database, so paging and totals are right', async () => {
    mockInbox([])

    await request(app).get('/api/approvals/inbox')

    const filter = mockApprovalRequest.find.mock.calls[0][0]
    expect(filter.status).toBe('pending')
    expect(filter.steps.$elemMatch.approvers.$elemMatch).toMatchObject({ decision: 'pending' })
    expect(String(filter.steps.$elemMatch.approvers.$elemMatch.approver)).toBe(EMP)
    // $expr 取目前關卡（steps[current_step_index]）裡我仍是 pending
    const expr = filter.$expr.$let
    expect(expr.vars.step).toEqual({ $arrayElemAt: ['$steps', '$current_step_index'] })
    const cond = expr.in.$gt[0].$size.$filter.cond.$and
    expect(cond[1]).toEqual({ $eq: ['$$candidate.decision', 'pending'] })
    expect(String(cond[0].$eq[1])).toBe(EMP)
    expect(mockApprovalRequest.countDocuments).toHaveBeenCalledWith(filter)
  })

  it('paginates with ?page and ?limit and returns { items, total, page, limit }', async () => {
    const query = mockInbox([{ _id: oid(11) }], 61)

    const res = await request(app).get('/api/approvals/inbox?page=3&limit=20')

    expect(res.body).toEqual({ items: [{ _id: oid(11) }], total: 61, page: 3, limit: 20 })
    expect(query.skip).toHaveBeenCalledWith(40)
    expect(query.limit).toHaveBeenCalledWith(20)
  })

  it('applies a safety cap to the plain array form and reports the real total in a header', async () => {
    const query = mockInbox([], 900)

    const res = await request(app).get('/api/approvals/inbox')

    expect(query.limit).toHaveBeenCalledWith(500)
    expect(query.skip).toHaveBeenCalledWith(0)
    expect(res.body).toEqual([])
    expect(res.headers['x-total-count']).toBe('900')
  })

  it('uses sane defaults for bad paging input', async () => {
    const query = mockInbox([])

    const res = await request(app).get('/api/approvals/inbox?page=-4&limit=abc')

    expect(res.body).toMatchObject({ page: 1, limit: 50 })
    expect(query.limit).toHaveBeenCalledWith(50)
  })

  it('rejects querying another employee inbox', async () => {
    const res = await request(app).get(`/api/approvals/inbox?employee_id=${OTHER}`)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: '只能查看自己的待簽核事項' })
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})

describe('GET /api/approvals (my requests)', () => {
  it('returns the applicant requests populated with the form, applicant and approver names', async () => {
    const docs = [{ _id: oid(20), form: { _id: oid(100), name: '請假', semanticType: 'leave' } }]
    const query = mockInbox(docs)

    const res = await request(app).get('/api/approvals')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(docs)
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({ applicant_employee: EMP })
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(query.populate).toHaveBeenCalledWith('form', 'name category semanticType')
    expect(query.populate).toHaveBeenCalledWith('applicant_employee', 'name employeeId department organization')
    expect(query.populate).toHaveBeenCalledWith('steps.approvers.approver', 'name')
  })

  it('paginates', async () => {
    const query = mockInbox([{ _id: oid(21) }], 7)

    const res = await request(app).get('/api/approvals?page=1&limit=5')

    expect(res.body).toEqual({ items: [{ _id: oid(21) }], total: 7, page: 1, limit: 5 })
    expect(query.limit).toHaveBeenCalledWith(5)
  })

  it('rejects querying another employee requests', async () => {
    const res = await request(app).get(`/api/approvals?employee_id=${OTHER}`)
    expect(res.status).toBe(403)
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})
