// 審查 F1 / F2 / F4 的端對端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
//  F1 部門「使用簽核表單」勾選的表單被刪除或停用：刪除時從部門拿掉、讀取時已刪除的不算、全部不能用 = 全部表單、部門設定照常儲存。
//  F2 跨網域時前端讀得到 X-Form-Visibility（CORS exposedHeaders）。
//  F4 以前自建的「移休」假別不會讓假別規則再也存不了；請「移休」照舊從調休存摺扣用。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27602 npm test -- tests/formDepartmentCleanup.integration.test.js
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
    throw new Error('Form department cleanup integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_form_departments_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('部門勾選的表單被刪除或停用、跨網域標頭、舊的移休假別 against a real MongoDB through the real app', () => {
  jest.setTimeout(90000)
  let app
  let models
  const people = {}
  const forms = {}
  const departments = {}
  const secret = 'integration-test-secret-integration-test-secret'
  let organization

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const get = (key, url) => request(app).get(url).set(as(key))
  const post = (key, url, body) => request(app).post(url).set(as(key)).send(body ?? {})
  const put = (key, url, body) => request(app).put(url).set(as(key)).send(body ?? {})
  const del = (key, url) => request(app).delete(url).set(as(key))
  const fieldOf = (made, label) => String(made.fields.find(field => field.label === label)._id)
  const formId = (key) => String(forms[key].form._id)
  const selectionOf = async (key) => (await models.Department.findById(departments[key]._id).lean()).allowedFormIds.map(String)
  const listAs = async (key) => {
    const res = await get(key, '/api/approvals/forms?is_active=true')
    expect(res.status).toBe(200)
    return { names: res.body.map(form => form.name).sort(), header: res.headers['x-form-visibility'] }
  }

  async function addPerson(key, patch = {}) {
    people[key] = await models.Employee.create({
      name: key, email: `${key}@example.test`, username: key, role: 'employee', organization: 'org-1', ...patch,
    })
    return people[key]
  }

  async function makeForm(key, name, semanticType, fieldSpecs) {
    const form = await models.FormTemplate.create({ name, semanticType, is_active: true })
    const fields = []
    for (const [index, field] of fieldSpecs.entries()) fields.push(await models.FormField.create({ form: form._id, order: index + 1, ...field }))
    await models.ApprovalWorkflow.create({
      form: form._id,
      steps: [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', is_required: true, can_return: true, all_must_approve: true }],
    })
    forms[key] = { form, fields }
    return forms[key]
  }

  async function addDepartment(key, name, formKeys) {
    departments[key] = await models.Department.create({ name, organization, allowedFormIds: formKeys.map(formKey => forms[formKey].form._id) })
    return departments[key]
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

    await makeForm('leave', '請假', 'leave', [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number', required: true },
      { label: '事由', type_1: 'text' },
    ])
    await makeForm('overtime', '加班申請', 'general', [{ label: '事由', type_1: 'text', required: true }])
    await makeForm('drill', '演習登記', 'general', [{ label: '事由', type_1: 'text' }])
    await makeForm('trip', '出差申請', 'general', [{ label: '事由', type_1: 'text', required: true }])
    resetLeaveFieldCache()

    organization = new mongoose.Types.ObjectId()
    // 演習組只勾選演習登記；病房勾選請假、加班、演習；出差組只勾選出差申請；護理部只勾選請假單；行政部沒有勾選
    await addDepartment('drillTeam', '演習組', ['drill'])
    await addDepartment('ward', '病房', ['leave', 'overtime', 'drill'])
    await addDepartment('tripTeam', '出差組', ['trip'])
    await addDepartment('nursing', '護理部', ['leave'])
    await addDepartment('office', '行政部', [])

    await addPerson('admin', { role: 'admin' })
    await addPerson('director', { role: 'supervisor' })
    await addPerson('drillNurse', { department: departments.drillTeam._id, supervisor: people.director._id })
    await addPerson('wardNurse', { department: departments.ward._id, supervisor: people.director._id })
    await addPerson('traveler', { department: departments.tripTeam._id, supervisor: people.director._id })
    await addPerson('nurse', { department: departments.nursing._id, supervisor: people.director._id })
    await addPerson('clerk', { department: departments.office._id, supervisor: people.director._id })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('F1 勾選的表單被刪除或停用', () => {
    it('pulls a really deleted form out of every department; the emptied one sees every form instead of none', async () => {
      expect(await listAs('drillNurse')).toEqual({ names: ['演習登記'], header: 'department' })

      const deleted = await del('admin', `/api/approvals/forms/${formId('drill')}`)
      expect(deleted.status).toBe(200)
      expect(deleted.body).toMatchObject({ deleted: true, departmentsUpdated: 2, departmentsUsingAllForms: 1 })
      expect(deleted.body.message).toContain('已從 2 個部門的「使用簽核表單」拿掉這張表單')
      expect(await models.FormTemplate.countDocuments({ _id: forms.drill.form._id })).toBe(0)

      expect(await selectionOf('drillTeam')).toEqual([])
      expect(await selectionOf('ward')).toEqual([formId('leave'), formId('overtime')])
      expect(await listAs('drillNurse')).toEqual({ names: ['出差申請', '加班申請', '請假'], header: 'all' })
      expect(await listAs('wardNurse')).toEqual({ names: ['加班申請', '請假'], header: 'department' })
    })

    it('ignores an id left behind by an earlier deletion, and lets the admin save the department again', async () => {
      const ghost = new mongoose.Types.ObjectId()
      await models.Department.updateOne({ _id: departments.nursing._id }, { $set: { allowedFormIds: [ghost, forms.leave.form._id] } })
      expect(await listAs('nurse')).toEqual({ names: ['請假'], header: 'department' })

      await models.Department.updateOne({ _id: departments.nursing._id }, { $set: { allowedFormIds: [ghost] } })
      expect(await listAs('nurse')).toEqual({ names: ['出差申請', '加班申請', '請假'], header: 'all' })
      expect((await post('nurse', '/api/approvals', { form_id: formId('overtime'), form_data: { [fieldOf(forms.overtime, '事由')]: '盤點' } })).status).toBe(201)

      // 部門設定畫面會把「已刪除的表單」一起送回來：照常儲存，只留下還在的表單
      const saved = await put('admin', `/api/departments/${departments.nursing._id}`, {
        name: '護理部', organization: String(organization), allowedFormIds: [String(ghost), formId('leave')],
      })
      expect(saved.status).toBe(200)
      expect(saved.body.allowedFormIds.map(String)).toEqual([formId('leave')])
      expect(await selectionOf('nursing')).toEqual([formId('leave')])

      const refused = await put('admin', `/api/departments/${departments.nursing._id}`, { name: '護理部', organization: String(organization), allowedFormIds: ['junk'] })
      expect(refused.status).toBe(400)
      expect(refused.body).toEqual({ error: '使用簽核表單格式不正確' })
      expect(await selectionOf('nursing')).toEqual([formId('leave')])
    })

    it('keeps the selection of a form deactivated instead of deleted, shows every active form meanwhile, and restricts again once it is re-enabled', async () => {
      const filed = await post('clerk', '/api/approvals', { form_id: formId('trip'), form_data: { [fieldOf(forms.trip, '事由')]: '研討會' } })
      expect(filed.status).toBe(201)

      const deactivated = await del('admin', `/api/approvals/forms/${formId('trip')}`)
      expect(deactivated.status).toBe(200)
      expect(deactivated.body).toMatchObject({ deleted: false, deactivated: true, requestCount: 1, departmentsUsingAllForms: 1 })
      expect(deactivated.body.message).toContain('另外有 1 個部門勾選的表單都已停用或刪除')
      expect(await selectionOf('tripTeam')).toEqual([formId('trip')])
      expect(await listAs('traveler')).toEqual({ names: ['加班申請', '請假'], header: 'all' })

      expect((await put('admin', `/api/approvals/forms/${formId('trip')}`, { is_active: true })).status).toBe(200)
      expect(await listAs('traveler')).toEqual({ names: ['出差申請'], header: 'department' })
    })
  })

  describe('F2 跨網域的表單清單標頭', () => {
    it('lets a cross-origin front end read X-Form-Visibility', async () => {
      const res = await get('nurse', '/api/approvals/forms?is_active=true').set('Origin', 'http://localhost:5173')
      expect(res.status).toBe(200)
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
      expect(res.headers['access-control-expose-headers'].split(',').map(item => item.trim())).toContain('X-Form-Visibility')
      expect(res.headers['x-form-visibility']).toBe('department')
    })
  })

  describe('F4 以前自建的「移休」假別', () => {
    it('saves the leave policy from the admin screen although a custom type is still called 移休, and 移休 keeps going to the 調休 bank', async () => {
      // 這版之前存下的設定：自建「移休」（16 小時、超額不能送出）
      const legacy = {
        types: [{ key: 'move_rest', name: '移休', aliases: ['挪休'], quotaHours: 16, period: 'year', enforcement: 'block', display: 'always', enabled: true, note: '舊的移休' }],
      }
      await models.OtherControlSetting.updateOne({ key: 'default' }, { $set: { 'data.leavePolicy': legacy } }, { upsert: true })

      const current = await get('admin', '/api/other-control-settings/leave-policy')
      expect(current.status).toBe(200)
      const policy = current.body.policy
      policy.types.find(item => item.key === 'personal').quotaHours = 96
      const saved = await put('admin', '/api/other-control-settings/leave-policy', policy)
      expect(saved.status).toBe(200)
      expect(saved.body.policy.types.find(item => item.key === 'move_rest')).toMatchObject({ name: '移休', quotaHours: 16, note: '舊的移休' })
      expect(saved.body.policy.types.find(item => item.key === 'personal').quotaHours).toBe(96)

      // 請「移休」檢查的是調休存摺（沒有存摺就擋下），不是那個自建假別的 16 小時
      const filed = await post('clerk', '/api/approvals', {
        form_id: formId('leave'),
        form_data: {
          [fieldOf(forms.leave, '假別')]: '移休',
          [fieldOf(forms.leave, '開始日期')]: '2026-11-23',
          [fieldOf(forms.leave, '結束日期')]: '2026-11-23',
          [fieldOf(forms.leave, '時數')]: 8,
          [fieldOf(forms.leave, '事由')]: '家中有事',
        },
      })
      expect(filed.status).toBe(400)
      expect(filed.body).toMatchObject({ code: 'COMP_LEAVE_INSUFFICIENT' })
    })
  })
})
