import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockApprovalRequest = { findById: jest.fn() }
const mockFormField = { find: jest.fn() }

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = { role: 'employee' }; next() },
    authorizeRoles: () => (req, res, next) => next()
  }))
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', approvalRoutes)
})

beforeEach(() => {
  mockApprovalRequest.findById.mockReset()
  mockFormField.find.mockReset()
})

describe('GET /api/approvals/:id', () => {
  it('returns approval request with form fields', async () => {
    const doc = {
      _id: 'req1',
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
})
