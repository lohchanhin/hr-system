import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockApprovalRequest = { findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetAnnualLeaveBalance = jest.fn()

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/services/annualLeaveService.js', () => ({
    deductAnnualLeave: jest.fn(),
    getAnnualLeaveBalance: mockGetAnnualLeaveBalance,
  }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = { id: 'emp1', role: 'employee' }; next() },
    authorizeRoles: () => (req, res, next) => { req.user = { id: 'emp1', role: 'employee' }; next() }
  }))
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', approvalRoutes)
})

beforeEach(() => {
  mockApprovalRequest.findById.mockReset()
  mockFormField.find.mockReset()
  mockGetAnnualLeaveBalance.mockReset()
})

describe('GET /api/approvals/:id', () => {
  it('returns approval request with form fields', async () => {
    const doc = {
      _id: 'req1',
      applicant_employee: { _id: 'emp1', name: 'Employee' },
      form: { _id: 'form1', name: 'F', category: 'C' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    const fields = [{ _id: 'field1', label: 'Field 1', order: 1 }]
    const populate3 = jest.fn().mockResolvedValue(doc)
    const populate2 = jest.fn().mockReturnValue({ populate: populate3 })
    const populate1 = jest.fn().mockReturnValue({ populate: populate2 })
    mockApprovalRequest.findById.mockReturnValue({ populate: populate1 })

    const sort = jest.fn().mockResolvedValue(fields)
    mockFormField.find.mockReturnValue({ sort })

    const res = await request(app).get('/api/approvals/req1')

    expect(res.status).toBe(200)
    expect(res.body.form.fields).toEqual(fields)
    expect(Object.keys(res.body.form_data)).toEqual(fields.map(f => f._id))
    expect(mockFormField.find).toHaveBeenCalledWith({ form: 'form1' })
    expect(sort).toHaveBeenCalledWith({ order: 1 })
  })

  it('attaches the applicant\'s annual leave balance when the form is a leave-type approval', async () => {
    const doc = {
      _id: 'req3',
      applicant_employee: { _id: 'emp1', name: 'Employee' },
      form: { _id: 'form1', name: '請假申請', category: 'C', semanticType: 'leave' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    const populate3 = jest.fn().mockResolvedValue(doc)
    const populate2 = jest.fn().mockReturnValue({ populate: populate3 })
    const populate1 = jest.fn().mockReturnValue({ populate: populate2 })
    mockApprovalRequest.findById.mockReturnValue({ populate: populate1 })
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    const balance = { employeeId: 'A001', name: 'Employee', totalDays: 14, usedDays: 6, remainingDays: 8, year: 2026 }
    mockGetAnnualLeaveBalance.mockResolvedValue(balance)

    const res = await request(app).get('/api/approvals/req3')

    expect(res.status).toBe(200)
    expect(res.body.leave_balance).toEqual(balance)
    expect(mockGetAnnualLeaveBalance).toHaveBeenCalledWith('emp1')
  })

  it('does not attach a leave balance (or call the balance lookup) for a non-leave-type approval', async () => {
    const doc = {
      _id: 'req4',
      applicant_employee: { _id: 'emp1', name: 'Employee' },
      form: { _id: 'form1', name: '加班申請', category: 'C', semanticType: 'overtime' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    const populate3 = jest.fn().mockResolvedValue(doc)
    const populate2 = jest.fn().mockReturnValue({ populate: populate3 })
    const populate1 = jest.fn().mockReturnValue({ populate: populate2 })
    mockApprovalRequest.findById.mockReturnValue({ populate: populate1 })
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })

    const res = await request(app).get('/api/approvals/req4')

    expect(res.status).toBe(200)
    expect(res.body.leave_balance).toBeUndefined()
    expect(mockGetAnnualLeaveBalance).not.toHaveBeenCalled()
  })

  it('falls back to a null leave balance instead of failing the whole request when the balance lookup errors', async () => {
    const doc = {
      _id: 'req5',
      applicant_employee: { _id: 'emp1', name: 'Employee' },
      form: { _id: 'form1', name: '請假申請', category: 'C', semanticType: 'leave' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    const populate3 = jest.fn().mockResolvedValue(doc)
    const populate2 = jest.fn().mockReturnValue({ populate: populate3 })
    const populate1 = jest.fn().mockReturnValue({ populate: populate2 })
    mockApprovalRequest.findById.mockReturnValue({ populate: populate1 })
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    mockGetAnnualLeaveBalance.mockRejectedValue(new Error('boom'))

    const res = await request(app).get('/api/approvals/req5')

    expect(res.status).toBe(200)
    expect(res.body.leave_balance).toBeNull()
  })

  it('returns not found when the employee is not a request participant', async () => {
    const doc = {
      _id: 'req2',
      applicant_employee: { _id: 'other-employee' },
      form: { _id: 'form1', name: 'F', category: 'C' },
      steps: [{ approvers: [{ approver: { _id: 'other-supervisor' } }] }],
    }
    const populate3 = jest.fn().mockResolvedValue(doc)
    const populate2 = jest.fn().mockReturnValue({ populate: populate3 })
    const populate1 = jest.fn().mockReturnValue({ populate: populate2 })
    mockApprovalRequest.findById.mockReturnValue({ populate: populate1 })

    const res = await request(app).get('/api/approvals/req2')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
    expect(mockFormField.find).not.toHaveBeenCalled()
  })
})
