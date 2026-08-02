import dotenv from 'dotenv'
import express from 'express'
import mongoose from 'mongoose'
import request from 'supertest'

import approvalRoutes from '../src/routes/approvalRoutes.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import employeeRoutes from '../src/routes/employeeRoutes.js'
import scheduleRoutes from '../src/routes/scheduleRoutes.js'
import ApprovalRequest from '../src/models/approval_request.js'
import ApprovalWorkflow from '../src/models/approval_workflow.js'
import AttendanceRecord from '../src/models/AttendanceRecord.js'
import Employee from '../src/models/Employee.js'
import FormTemplate from '../src/models/form_template.js'
import ShiftSchedule from '../src/models/ShiftSchedule.js'
import { deductAnnualLeave } from '../src/services/annualLeaveService.js'

dotenv.config()

const runIntegration = process.env.RUN_SECURITY_INTEGRATION === '1'
const describeIntegration = runIntegration ? describe : describe.skip

function isolatedMongoUri() {
  const configured = process.env.MONGODB_URI
  if (!configured) throw new Error('MONGODB_URI is required for the security integration test')

  const uri = new URL(configured)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!localHosts.has(uri.hostname)) {
    throw new Error('Security integration tests only run against a loopback MongoDB host')
  }

  uri.pathname = `/hr_security_test_${process.pid}_${Date.now()}`
  return uri.toString()
}

function buildApp(routePath, routes, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: user._id.toString(), role: user.role }
    next()
  })
  app.use(routePath, routes)
  return app
}

describeIntegration('security authorization with isolated MongoDB', () => {
  let attacker
  let supervisor
  let outsider
  let approval
  let outsiderSchedule
  let form
  let workflow

  beforeAll(async () => {
    await mongoose.connect(isolatedMongoUri())
    await ApprovalRequest.syncIndexes()

    attacker = await Employee.create({
      name: 'Security Test Employee',
      email: `attacker-${process.pid}@example.test`,
      username: `attacker-${process.pid}`,
      role: 'employee',
      idNumber: 'SECRET-ATTACKER',
    })
    supervisor = await Employee.create({
      name: 'Security Test Supervisor',
      email: `supervisor-${process.pid}@example.test`,
      username: `supervisor-${process.pid}`,
      role: 'supervisor',
    })
    const otherSupervisor = await Employee.create({
      name: 'Other Supervisor',
      email: `other-supervisor-${process.pid}@example.test`,
      username: `other-supervisor-${process.pid}`,
      role: 'supervisor',
    })
    outsider = await Employee.create({
      name: 'Outside Employee',
      email: `outsider-${process.pid}@example.test`,
      username: `outsider-${process.pid}`,
      role: 'employee',
      supervisor: otherSupervisor._id,
      idNumber: 'SECRET-OUTSIDER',
    })

    form = await FormTemplate.create({ name: `Security Form ${process.pid}`, is_active: true })
    workflow = await ApprovalWorkflow.create({
      form: form._id,
      steps: [{ step_order: 1, approver_type: 'user', approver_value: [supervisor._id] }],
    })
    approval = await ApprovalRequest.create({
      form: form._id,
      workflow: workflow._id,
      applicant_employee: attacker._id,
      status: 'pending',
      current_step_index: 0,
      steps: [{
        step_order: 1,
        approvers: [{ approver: supervisor._id, decision: 'pending' }],
        all_must_approve: true,
      }],
    })
    outsiderSchedule = await ShiftSchedule.create({
      employee: outsider._id,
      date: new Date('2035-01-15T00:00:00.000Z'),
      shiftId: new mongoose.Types.ObjectId(),
    })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('rejects an employee impersonating an approver without changing the request', async () => {
    const app = buildApp('/api/approvals', approvalRoutes, attacker)
    const response = await request(app)
      .post(`/api/approvals/${approval._id}/act`)
      .send({ employee_id: supervisor._id.toString(), decision: 'approve' })

    expect(response.status).toBe(403)
    const persisted = await ApprovalRequest.findById(approval._id).lean()
    expect(persisted.status).toBe('pending')
    expect(persisted.steps[0].approvers[0].decision).toBe('pending')
  })

  it('rejects attendance written for another employee without persisting a record', async () => {
    const app = buildApp('/api/attendance', attendanceRoutes, attacker)
    const response = await request(app)
      .post('/api/attendance')
      .send({ employee: outsider._id.toString(), action: 'outing' })

    expect(response.status).toBe(403)
    expect(await AttendanceRecord.countDocuments()).toBe(0)
  })

  it('rejects a supervisor deleting a schedule outside their scope', async () => {
    const app = buildApp('/api/schedules', scheduleRoutes, supervisor)
    const response = await request(app).delete(`/api/schedules/${outsiderSchedule._id}`)

    expect(response.status).toBe(403)
    expect(await ShiftSchedule.exists({ _id: outsiderSchedule._id })).toBeTruthy()
  })

  it('hides other employee profiles and limits employee lists to self', async () => {
    const app = buildApp('/api/employees', employeeRoutes, attacker)
    const detailResponse = await request(app).get(`/api/employees/${outsider._id}`)
    const listResponse = await request(app).get('/api/employees')

    expect(detailResponse.status).toBe(404)
    expect(listResponse.status).toBe(200)
    expect(listResponse.body.employees.map((employee) => employee._id)).toEqual([attacker._id.toString()])
    expect(JSON.stringify(listResponse.body)).not.toContain('SECRET-OUTSIDER')
  })

  it('limits schedule reads to the authenticated employee', async () => {
    const app = buildApp('/api/schedules', scheduleRoutes, attacker)
    const response = await request(app).get('/api/schedules')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
  })

  it('rejects leave calendar queries for another employee', async () => {
    const app = buildApp('/api/schedules', scheduleRoutes, attacker)
    const response = await request(app)
      .get(`/api/schedules/leave-approvals?month=2035-01&employee=${outsider._id}`)

    expect(response.status).toBe(403)
  })

  it('rejects approval list identity overrides', async () => {
    const app = buildApp('/api/approvals', approvalRoutes, attacker)
    const response = await request(app)
      .get(`/api/approvals?employee_id=${supervisor._id}`)

    expect(response.status).toBe(403)
  })

  it('allows only one of two concurrent approval actions to commit', async () => {
    const concurrentApproval = await ApprovalRequest.create({
      form: form._id,
      workflow: workflow._id,
      applicant_employee: attacker._id,
      status: 'pending',
      current_step_index: 0,
      steps: [{
        step_order: 1,
        approvers: [{ approver: supervisor._id, decision: 'pending' }],
        all_must_approve: true,
      }],
    })
    const app = buildApp('/api/approvals', approvalRoutes, supervisor)

    const responses = await Promise.all([
      request(app).post(`/api/approvals/${concurrentApproval._id}/act`).send({ decision: 'approve' }),
      request(app).post(`/api/approvals/${concurrentApproval._id}/act`).send({ decision: 'approve' }),
    ])

    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const persisted = await ApprovalRequest.findById(concurrentApproval._id).lean()
    expect(persisted.status).toBe('approved')
    expect(persisted.logs.filter(log => log.action === 'approve')).toHaveLength(1)
    expect(persisted.logs.filter(log => log.action === 'finish')).toHaveLength(1)
  })

  it('creates only one request for concurrent submissions with the same idempotency key', async () => {
    const app = buildApp('/api/approvals', approvalRoutes, attacker)
    const payload = { form_id: form._id.toString(), form_data: { reason: 'same request' } }
    const key = `security-create-${process.pid}`

    const responses = await Promise.all([
      request(app).post('/api/approvals').set('Idempotency-Key', key).send(payload),
      request(app).post('/api/approvals').set('Idempotency-Key', key).send(payload),
    ])

    expect(responses.map(response => response.status).sort()).toEqual([200, 201])
    expect(responses[0].body._id).toBe(responses[1].body._id)
    expect(await ApprovalRequest.countDocuments({
      applicant_employee: attacker._id,
      idempotency_key: key,
    })).toBe(1)
  })

  it('deducts annual leave once for the same approval request', async () => {
    await Employee.updateOne(
      { _id: attacker._id },
      { $set: { annualLeave: { totalDays: 10, usedDays: 0, year: 2035 } } },
    )
    const requestId = new mongoose.Types.ObjectId().toString()

    await Promise.all([
      deductAnnualLeave(attacker._id, 2, requestId),
      deductAnnualLeave(attacker._id, 2, requestId),
    ])

    const persisted = await Employee.findById(attacker._id)
      .select('+annualLeave.appliedApprovalRequestIds')
      .lean()
    expect(persisted.annualLeave.usedDays).toBe(2)
    expect(persisted.annualLeave.appliedApprovalRequestIds).toEqual([requestId])
  })

  it('resubmits a returned request once and makes cancellation idempotent', async () => {
    const returned = await ApprovalRequest.create({
      form: form._id,
      workflow: workflow._id,
      applicant_employee: attacker._id,
      status: 'returned',
      current_step_index: 0,
      steps: [{
        step_order: 1,
        approvers: [{ approver: supervisor._id, decision: 'returned' }],
        all_must_approve: true,
      }],
    })
    const app = buildApp('/api/approvals', approvalRoutes, attacker)

    const resubmit = await request(app).post(`/api/approvals/${returned._id}/resubmit`).send({})
    const duplicateResubmit = await request(app).post(`/api/approvals/${returned._id}/resubmit`).send({})
    const cancel = await request(app).post(`/api/approvals/${returned._id}/cancel`).send({})
    const duplicateCancel = await request(app).post(`/api/approvals/${returned._id}/cancel`).send({})

    expect(resubmit.status).toBe(200)
    expect(duplicateResubmit.status).toBe(409)
    expect(cancel.status).toBe(200)
    expect(duplicateCancel.status).toBe(200)
    const persisted = await ApprovalRequest.findById(returned._id).lean()
    expect(persisted.status).toBe('canceled')
    expect(persisted.logs.filter(log => log.action === 'resubmit')).toHaveLength(1)
    expect(persisted.logs.filter(log => log.action === 'cancel')).toHaveLength(1)
  })
})
