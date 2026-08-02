import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

const ok = (req, res) => res.json({ ok: true })

jest.unstable_mockModule('../src/controllers/approvalTemplateController.js', () => ({
  listFormTemplates: ok,
  createFormTemplate: ok,
  getFormTemplate: ok,
  updateFormTemplate: ok,
  deleteFormTemplate: ok,
  addField: ok,
  updateField: ok,
  deleteField: ok,
  listFields: ok,
  getWorkflow: ok,
  setWorkflow: ok,
  getSignRoles: ok,
  getSignLevels: ok,
  ensureLeaveForm: ok,
  restoreDefaultTemplates: ok,
}))

jest.unstable_mockModule('../src/controllers/approvalRequestController.js', () => ({
  createApprovalRequest: ok,
  getApprovalRequest: ok,
  myApprovalRequests: ok,
  inboxApprovals: ok,
  actOnApproval: ok,
  historyApprovals: ok,
  uploadApprovalAttachments: ok,
  downloadApprovalAttachment: ok,
  cancelApprovalRequest: ok,
  resubmitApprovalRequest: ok,
}))

jest.unstable_mockModule('../src/middleware/approvalAttachmentUpload.js', () => ({
  uploadApprovalAttachmentFiles: (req, res, next) => next(),
}))

let app
let currentUser

beforeAll(async () => {
  const routes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = currentUser
    next()
  })
  app.use('/api/approvals', routes)
})

describe('approval template mutation authorization', () => {
  it.each(['employee', 'supervisor'])(
    'does not let %s auto-create or modify the global leave form',
    async (role) => {
      currentUser = { id: `${role}-1`, role }

      const res = await request(app).post('/api/approvals/ensure-leave-form')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    }
  )

  it('allows an administrator to explicitly ensure the leave form', async () => {
    currentUser = { id: 'admin-1', role: 'admin' }

    const res = await request(app).post('/api/approvals/ensure-leave-form')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
