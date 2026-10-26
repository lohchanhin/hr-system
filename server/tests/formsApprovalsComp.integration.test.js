// 2026/10「迦南人資系統-重大調整」簽核相關項目的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
//  R2 部門的「使用簽核表單」：員工只看得到、只能送出自己部門開放的表單（403）；部門沒有勾選 = 全部；管理員全部。
//  R5 避免主管沒辦法當自己主管：必簽的主管關卡找不到主管時改送最高層簽核人（設定的人，空白 = 系統管理員），申請人永遠不簽自己的單。
//  R4 移休：「移休」從調休存摺扣用；管理員可以在員工的存摺填備註，員工唯讀看得到。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27602 npm test -- tests/formsApprovalsComp.integration.test.js
// 只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import request from 'supertest'

const configured = process.env.APPROVAL_ENGINE_TEST_MONGODB_URI
const describeIntegration = configured ? describe : describe.skip

function isolatedMongoUri() {
  const uri = new URL(configured)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!localHosts.has(uri.hostname)) {
    throw new Error('Forms / approvals integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_forms_approvals_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('部門表單、無上級主管改送、移休 against a real MongoDB through the real app', () => {
  jest.setTimeout(90000)
  let app
  let models
  const people = {}
  const secret = 'integration-test-secret-integration-test-secret'
  let leave
  let overtime
  let nursing
  let office

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const get = (key, url) => request(app).get(url).set(as(key))
  const post = (key, url, body) => request(app).post(url).set(as(key)).send(body ?? {})
  const put = (key, url, body) => request(app).put(url).set(as(key)).send(body ?? {})
  const id = (key) => String(people[key]._id)
  const fieldOf = (made, label) => String(made.fields.find(field => field.label === label)._id)
  const leaveData = (type, date = '2026-11-16', hours = 8) => ({
    [fieldOf(leave, '假別')]: type,
    [fieldOf(leave, '開始日期')]: date,
    [fieldOf(leave, '結束日期')]: date,
    [fieldOf(leave, '時數')]: hours,
    [fieldOf(leave, '事由')]: '家中有事',
  })
  const fileLeave = (key, type, date, hours) => post(key, '/api/approvals', { form_id: String(leave.form._id), form_data: leaveData(type, date, hours) })
  const fileOvertime = (key) => post(key, '/api/approvals', { form_id: String(overtime.form._id), form_data: { [fieldOf(overtime, '事由')]: '盤點' } })
  const load = (requestId) => models.ApprovalRequest.findById(requestId).lean()
  const approversOf = (doc, index = 0) => doc.steps[index].approvers.map(item => String(item.approver)).sort()
  const formNames = (res) => res.body.map(form => form.name).sort()

  async function addPerson(key, patch = {}) {
    people[key] = await models.Employee.create({
      name: key, email: `${key}@example.test`, username: key, role: 'employee', organization: 'org-1', ...patch,
    })
    return people[key]
  }

  async function makeForm(name, semanticType, fieldSpecs, steps) {
    const form = await models.FormTemplate.create({ name, semanticType, is_active: true })
    const fields = []
    for (const [index, field] of fieldSpecs.entries()) fields.push(await models.FormField.create({ form: form._id, order: index + 1, ...field }))
    await models.ApprovalWorkflow.create({ form: form._id, steps: steps.map((step, index) => ({ step_order: index + 1, is_required: true, can_return: true, all_must_approve: true, ...step })) })
    return { form, fields }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.PORT = process.env.PORT || '0'
    process.env.JWT_SECRET = secret
    process.env.MONGODB_URI = isolatedMongoUri()
    process.env.API_RATE_LIMIT_MAX = '100000'
    process.env.API_MUTATION_RATE_LIMIT_MAX = '100000'
    ;({ app } = await import('../src/index.js'))
    models = {
      Employee: (await import('../src/models/Employee.js')).default,
      Department: (await import('../src/models/Department.js')).default,
      FormTemplate: (await import('../src/models/form_template.js')).default,
      FormField: (await import('../src/models/form_field.js')).default,
      ApprovalWorkflow: (await import('../src/models/approval_workflow.js')).default,
      ApprovalRequest: (await import('../src/models/approval_request.js')).default,
      CompensatoryCredit: (await import('../src/models/CompensatoryCredit.js')).default,
      CompensatoryLeaveState: (await import('../src/models/CompensatoryLeaveState.js')).default,
      OtherControlSetting: (await import('../src/models/OtherControlSetting.js')).default,
    }
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(models).map(model => model.syncIndexes()))

    leave = await makeForm('請假', 'leave', [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number', required: true },
      { label: '事由', type_1: 'text' },
    ], [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }])
    overtime = await makeForm('加班申請', 'general', [{ label: '事由', type_1: 'text', required: true }], [{ approver_type: 'tag', approver_value: '人資' }])
    resetLeaveFieldCache()

    const organization = new mongoose.Types.ObjectId()
    // 護理部只開放請假單；行政部沒有勾選（全部都可以用）
    nursing = await models.Department.create({ name: '護理部', organization, allowedFormIds: [leave.form._id] })
    office = await models.Department.create({ name: '行政部', organization })

    await addPerson('admin', { role: 'admin', department: nursing._id })
    await addPerson('admin2', { role: 'admin' })
    await addPerson('retiredAdmin', { role: 'admin', status: '離職員工' })
    await addPerson('hr', { signTags: ['人資'], department: office._id })
    await addPerson('ceo', { role: 'supervisor' })
    // 院長層級的護理長：沒有上級主管
    await addPerson('director', { role: 'supervisor', department: nursing._id })
    await addPerson('nurse', { department: nursing._id, supervisor: people.director._id })
    await addPerson('clerk', { department: office._id, supervisor: people.director._id })
    await addPerson('floater', { supervisor: people.director._id })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('R2 部門的「使用簽核表單」', () => {
    it('shows a nurse only the forms of her department and refuses the others with a Chinese 403', async () => {
      const list = await get('nurse', '/api/approvals/forms?is_active=true')
      expect(list.status).toBe(200)
      expect(formNames(list)).toEqual(['請假'])
      expect(list.headers['x-form-visibility']).toBe('department')

      const refused = await fileOvertime('nurse')
      expect(refused.status).toBe(403)
      expect(refused.body).toEqual({ error: '您所屬的部門未開放使用【加班申請】，請改選其他表單；如需使用請洽管理員', code: 'FORM_NOT_ALLOWED' })
      expect((await get('nurse', `/api/approvals/forms/${overtime.form._id}/fields`)).status).toBe(403)
      expect((await get('nurse', `/api/approvals/forms/${overtime.form._id}/workflow`)).status).toBe(403)
      expect(await models.ApprovalRequest.countDocuments({ form: overtime.form._id })).toBe(0)

      const allowed = await fileLeave('nurse', '事假')
      expect(allowed.status).toBe(201)
    })

    it('shows every form to a department without a selection, an employee without a department, and an admin', async () => {
      for (const key of ['clerk', 'floater']) {
        const list = await get(key, '/api/approvals/forms?is_active=true')
        expect(formNames(list)).toEqual(['加班申請', '請假'])
        expect(list.headers['x-form-visibility']).toBe('all')
      }
      expect((await fileOvertime('clerk')).status).toBe(201)

      // 管理員的部門（護理部）只開放請假單，但管理員不受限
      const adminList = await get('admin', '/api/approvals/forms')
      expect(formNames(adminList)).toEqual(['加班申請', '請假'])
      expect((await fileOvertime('admin')).status).toBe(201)
    })

    it('follows a change of the department selection immediately (no cache)', async () => {
      await models.Department.updateOne({ _id: office._id }, { $set: { allowedFormIds: [leave.form._id] } })
      expect(formNames(await get('clerk', '/api/approvals/forms'))).toEqual(['請假'])
      expect((await fileOvertime('clerk')).status).toBe(403)
      await models.Department.updateOne({ _id: office._id }, { $set: { allowedFormIds: [] } })
      expect(formNames(await get('clerk', '/api/approvals/forms'))).toEqual(['加班申請', '請假'])
    })
  })

  describe('R5 無上級主管改由最高層簽核人', () => {
    it('previews the fallback to the director before he files', async () => {
      const preview = await get('director', `/api/approvals/forms/${leave.form._id}/workflow`)
      expect(preview.status).toBe(200)
      expect(preview.body.steps[0]).toMatchObject({
        resolved_count: 2,
        unresolved_reason: null,
        fallback_text: '無上級主管，改由系統管理員簽核（任一位核准即可）',
        fallback_reason: '申請人沒有設定直屬主管',
      })
    })

    it('sends the director’s own 請假 to the eligible admins (any one of them) instead of failing', async () => {
      const filed = await fileLeave('director', '事假', '2026-11-17')
      expect(filed.status).toBe(201)

      const doc = await load(filed.body._id)
      expect(approversOf(doc)).toEqual([id('admin'), id('admin2')].sort())
      expect(approversOf(doc)).not.toContain(id('director'))
      expect(doc.steps[0]).toMatchObject({
        all_must_approve: false,
        fallback: { reason: 'no-supervisor', source: 'admins', text: '無上級主管，改由系統管理員簽核（任一位核准即可）' },
      })
      expect(doc.logs.map(log => log.action)).toEqual(['create', 'approver_fallback'])

      // 申請人不能簽自己的單；任一位管理員核准就通過
      expect((await post('director', `/api/approvals/${filed.body._id}/act`, { decision: 'approve' })).status).not.toBe(200)
      expect((await post('admin2', `/api/approvals/${filed.body._id}/act`, { decision: 'approve' })).status).toBe(200)
      expect((await load(filed.body._id)).status).toBe('approved')

      // 詳細頁面帶得到這關的說明
      const detail = await get('director', `/api/approvals/${filed.body._id}`)
      expect(detail.body.steps[0].fallback.text).toBe('無上級主管，改由系統管理員簽核（任一位核准即可）')
    })

    it('uses the top-level approvers an admin configured, and the admins again when that is the applicant', async () => {
      expect((await put('director', '/api/approvals/top-level-approvers', { ids: [id('ceo')] })).status).toBe(403)
      const saved = await put('admin', '/api/approvals/top-level-approvers', { ids: [id('ceo')] })
      expect(saved.status).toBe(200)
      expect(saved.body.approvers).toEqual([expect.objectContaining({ id: id('ceo'), name: 'ceo', eligible: true })])
      const stored = await models.OtherControlSetting.findOne({ key: 'default' }).lean()
      expect(stored.data.topLevelApproverIds).toEqual([id('ceo')])

      const toCeo = await fileLeave('director', '事假', '2026-11-18')
      expect(toCeo.status).toBe(201)
      const doc = await load(toCeo.body._id)
      expect(approversOf(doc)).toEqual([id('ceo')])
      expect(doc.steps[0].fallback).toMatchObject({ source: 'setting', text: '無上級主管，改由最高層簽核人簽核（任一位核准即可）' })

      // 最高層簽核人自己請假：不會簽自己的單，改送系統管理員
      const ceosOwn = await fileLeave('ceo', '事假', '2026-11-18')
      expect(ceosOwn.status).toBe(201)
      expect(approversOf(await load(ceosOwn.body._id))).toEqual([id('admin'), id('admin2')].sort())

      expect((await put('admin', '/api/approvals/top-level-approvers', { ids: [] })).status).toBe(200)
      expect((await get('admin', '/api/approvals/top-level-approvers')).body).toMatchObject({ ids: [], approvers: [] })
    })

    it('never makes an admin approve his own request: an admin without a supervisor goes to the other admin', async () => {
      const filed = await fileLeave('admin', '事假', '2026-11-19')
      expect(filed.status).toBe(201)
      expect(approversOf(await load(filed.body._id))).toEqual([id('admin2')])
    })

    it('keeps the old error when there is nobody to fall back to either', async () => {
      await models.Employee.updateMany({ role: 'admin' }, { $set: { status: '離職員工' } })
      try {
        const refused = await fileLeave('director', '事假', '2026-11-20')
        expect(refused.status).toBe(400)
        expect(refused.body).toMatchObject({ code: 'REQUIRED_APPROVER_MISSING', step: 1 })
        expect(refused.body.error).toContain('申請人尚未設定直屬主管')
      } finally {
        await models.Employee.updateMany({ _id: { $in: [people.admin._id, people.admin2._id] } }, { $set: { status: '正職員工' } })
      }
    })

    it('still sends a nurse to her own supervisor (nothing changes when there is a supervisor)', async () => {
      const filed = await fileLeave('nurse', '事假', '2026-11-20')
      const doc = await load(filed.body._id)
      expect(approversOf(doc)).toEqual([id('director')])
      expect(doc.steps[0].fallback).toBeUndefined()
      expect(doc.steps[0].all_must_approve).toBe(true)
    })
  })

  describe('R4 移休與存摺備註', () => {
    it('files 移休 against the 調休 bank: blocked without a balance, deducted on approval', async () => {
      const empty = await fileLeave('nurse', '移休', '2026-11-23', 8)
      expect(empty.status).toBe(400)
      expect(empty.body).toMatchObject({ code: 'COMP_LEAVE_INSUFFICIENT' })
      expect(empty.body.error).toContain('（1 天）')

      const given = await post('admin', '/api/compensatory-leave/credits', { employeeId: id('nurse'), hours: 8, note: '值班補償', earnedDate: '2026-11-01' })
      expect(given.status).toBe(201)

      const filed = await fileLeave('nurse', '移休', '2026-11-23', 8)
      expect(filed.status).toBe(201)
      expect((await get('nurse', '/api/compensatory-leave/mine')).body).toMatchObject({ balanceHours: 8, pendingHours: 8, availableHours: 0 })

      expect((await post('director', `/api/approvals/${filed.body._id}/act`, { decision: 'approve' })).status).toBe(200)
      const bank = (await get('nurse', '/api/compensatory-leave/mine')).body
      expect(bank).toMatchObject({ balanceHours: 0, pendingHours: 0, usedHours: 8 })
      expect(bank.credits[0].usages[0]).toMatchObject({ kind: 'leave_request', hours: 8 })
      const doc = await load(filed.body._id)
      expect(doc.logs.find(log => log.action === 'comp_leave').message).toContain('已扣用調休 8 小時（1 天）')
    })

    it('lets an admin write a note on the employee bank that the employee reads but cannot change', async () => {
      const saved = await put('admin', '/api/compensatory-leave/note', { employeeId: id('nurse'), note: '  10/10 國慶日改發加倍工資，不另給移休  ' })
      expect(saved.status).toBe(200)
      expect(saved.body).toMatchObject({ text: '10/10 國慶日改發加倍工資，不另給移休', updatedBy: { id: id('admin'), name: 'admin' } })

      const mine = await get('nurse', '/api/compensatory-leave/mine')
      expect(mine.body.note).toMatchObject({ text: '10/10 國慶日改發加倍工資，不另給移休' })
      const asAdmin = await get('admin', `/api/compensatory-leave?employeeId=${id('nurse')}`)
      expect(asAdmin.body.note.text).toBe('10/10 國慶日改發加倍工資，不另給移休')
      expect((await get('clerk', '/api/compensatory-leave/mine')).body.note).toEqual({ text: '', updatedAt: null, updatedBy: null })

      expect((await put('nurse', '/api/compensatory-leave/note', { employeeId: id('nurse'), note: '我自己改' })).status).toBe(403)
      // 每位員工一筆，系統狀態那一筆不受影響
      expect(await models.CompensatoryLeaveState.countDocuments({ key: /^note:/ })).toBe(1)
      const noteDoc = await models.CompensatoryLeaveState.findOne({ key: `note:${id('nurse')}` }).lean()
      expect(noteDoc).not.toHaveProperty('officeGovMakeupCutover')

      const cleared = await put('admin', '/api/compensatory-leave/note', { employeeId: id('nurse'), note: '' })
      expect(cleared.body.text).toBe('')
      expect(await models.CompensatoryLeaveState.countDocuments({ key: /^note:/ })).toBe(0)
    })
  })
})
