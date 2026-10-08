// 簽核引擎的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27263 npm test -- tests/approvalEngine.integration.test.js
// 只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { jest } from '@jest/globals'
import ExcelJS from 'exceljs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import request from 'supertest'

const configured = process.env.APPROVAL_ENGINE_TEST_MONGODB_URI
const describeIntegration = configured ? describe : describe.skip

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '../../upload/approvals')

function isolatedMongoUri() {
  const uri = new URL(configured)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!localHosts.has(uri.hostname)) {
    throw new Error('Approval engine integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_approval_engine_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('approval engine against a real MongoDB through the real app', () => {
  jest.setTimeout(60000)
  let app
  let Employee
  let FormTemplate
  let FormField
  let ApprovalWorkflow
  let ApprovalRequest
  let ApprovalAttachment
  const people = {}
  const createdUploads = []
  const DEPT_A = new mongoose.Types.ObjectId()
  const DEPT_B = new mongoose.Types.ObjectId()
  let formCounter = 0

  const secret = 'integration-test-secret-integration-test-secret'

  function tokenFor(person) {
    return jwt.sign(
      { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
      secret,
      { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
    )
  }

  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const get = (key, url) => request(app).get(url).set(as(key))
  const post = (key, url, body) => request(app).post(url).set(as(key)).send(body ?? {})
  const id = (key) => String(people[key]._id)

  async function addPerson(key, patch = {}) {
    const doc = await Employee.create({
      name: key,
      email: `${key}@example.test`,
      username: key,
      role: 'employee',
      department: DEPT_A,
      organization: 'org-1',
      ...patch,
    })
    people[key] = doc
    return doc
  }

  async function reloadPerson(key) {
    people[key] = await Employee.findById(people[key]._id)
    return people[key]
  }

  async function makeForm({ name, semanticType = 'general', fields = [], steps }) {
    formCounter += 1
    const form = await FormTemplate.create({ name: `${name}-${formCounter}`, semanticType, is_active: true })
    const created = []
    for (const [index, field] of fields.entries()) {
      created.push(await FormField.create({ form: form._id, order: index + 1, ...field }))
    }
    const workflow = await ApprovalWorkflow.create({
      form: form._id,
      steps: steps.map((step, index) => ({ step_order: index + 1, ...step })),
    })
    return { form, workflow, fields: created }
  }

  const fieldId = (made, label) => String(made.fields.find(field => field.label === label)._id)
  const createRequest = (key, made, formData = {}) => post(key, '/api/approvals', { form_id: String(made.form._id), form_data: formData })
  const act = (key, requestId, decision, comment) => post(key, `/api/approvals/${requestId}/act`, { decision, comment })
  const load = (requestId) => ApprovalRequest.findById(requestId).lean()

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.PORT = process.env.PORT || '0'
    process.env.JWT_SECRET = secret
    process.env.MONGODB_URI = isolatedMongoUri()
    process.env.API_RATE_LIMIT_MAX = '100000'
    process.env.API_MUTATION_RATE_LIMIT_MAX = '100000'
    ;({ app } = await import('../src/index.js'))
    ;({ default: Employee } = await import('../src/models/Employee.js'))
    ;({ default: FormTemplate } = await import('../src/models/form_template.js'))
    ;({ default: FormField } = await import('../src/models/form_field.js'))
    ;({ default: ApprovalWorkflow } = await import('../src/models/approval_workflow.js'))
    ;({ default: ApprovalRequest } = await import('../src/models/approval_request.js'))
    ;({ default: ApprovalAttachment } = await import('../src/models/approval_attachment.js'))
    await mongoose.connect(process.env.MONGODB_URI)
    // 全新的資料庫：所有模型的索引都要能建起來（Employee 的 employeeId 索引以前宣告了兩次、同名不同選項而失敗）
    await Promise.all([Employee.syncIndexes(), FormTemplate.syncIndexes(), ApprovalRequest.syncIndexes(), ApprovalAttachment.syncIndexes()])

    // 客戶的資料庫：員工是匯入的，沒有任何簽核標籤
    await addPerson('admin', { role: 'admin' })
    await addPerson('boss', { role: 'supervisor' })
    await addPerson('a1', { supervisor: people.boss._id })
    await addPerson('a2', { supervisor: people.boss._id })
    await addPerson('a3', { supervisor: people.boss._id })
    await addPerson('nodept', { supervisor: people.boss._id, department: null, organization: undefined })
    await addPerson('hr1')
    await addPerson('hr2')
    await addPerson('hr3')
    await addPerson('hrB', { department: DEPT_B, organization: 'org-2' })
    await addPerson('hrLeft', { status: '離職員工' })
    await addPerson('r3a', { signRole: 'R003' })
    await addPerson('r3b', { signRole: 'R003' })
    await addPerson('u2', { signLevel: 'U002' })
    await addPerson('stranger')
  })

  afterAll(async () => {
    createdUploads.forEach((file) => {
      try { fs.unlinkSync(file) } catch { /* 已被清除 */ }
    })
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('multi-step workflow: manager, tag, role R003, level U002 and an optional empty step', () => {
    let made
    const workflowSteps = [
      { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true },
      { approver_type: 'tag', approver_value: '人資', all_must_approve: true, is_required: true, can_return: true },
      { approver_type: 'role', approver_value: 'R003', all_must_approve: false, is_required: true, can_return: true },
      { approver_type: 'level', approver_value: 'U002', all_must_approve: true, is_required: true, can_return: true },
      { approver_type: 'tag', approver_value: '不存在的標籤', all_must_approve: true, is_required: false, can_return: true },
    ]

    beforeAll(async () => {
      made = await makeForm({
        name: '出差申請單',
        fields: [{ label: '事由', type_1: 'text', required: true }, { label: '金額', type_1: 'number' }],
        steps: workflowSteps,
      })
    })

    it('refuses to file while nobody carries the 人資 tag, with an actionable Chinese message', async () => {
      const res = await createRequest('a1', made, { [fieldId(made, '事由')]: '到分院支援' })

      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        error: `【${made.form.name}】第2關（標籤：人資）找不到可簽核的人員，請聯絡管理員設定`,
        code: 'REQUIRED_APPROVER_MISSING',
        step: 2,
      })
      expect(await ApprovalRequest.countDocuments({ form: made.form._id })).toBe(0)
    })

    it('runs the whole flow once HR is tagged: concurrent HR approvals, any-one role step, level step, skipped optional step', async () => {
      // HR 事後才補上標籤（離職的人資還留著標籤、申請人自己也有標籤）
      await Employee.updateMany(
        { _id: { $in: ['hr1', 'hr2', 'hr3', 'hrB', 'hrLeft', 'a1'].map(id) } },
        { $set: { signTags: ['人資'] } },
      )
      const eventualHr = ['hr1', 'hr2', 'hr3', 'hrB'].map(id).sort()

      const created = await createRequest('a1', made, { [fieldId(made, '事由')]: '到分院支援', [fieldId(made, '金額')]: '3200', hours: 0.001 })
      expect(created.status).toBe(201)
      const requestId = created.body._id
      const doc = await load(requestId)
      expect(doc.form_data).toEqual({ [fieldId(made, '事由')]: '到分院支援', [fieldId(made, '金額')]: 3200 }) // 未知欄位丟棄、數字轉成數字
      expect(doc.steps.map(step => step.approvers.map(a => String(a.approver)).sort())).toEqual([
        [id('boss')],
        eventualHr, // 離職者與申請人本人都沒有被列入
        [id('r3a'), id('r3b')].sort(),
        [id('u2')],
        [],
      ])
      expect(doc.current_step_index).toBe(0)

      // 待簽匣只看「目前關卡」：還沒輪到人資時，人資的待簽是空的
      expect((await get('hr1', '/api/approvals/inbox')).body).toEqual([])
      const bossInbox = await get('boss', '/api/approvals/inbox')
      expect(bossInbox.body).toHaveLength(1)
      expect(bossInbox.body[0].form.name).toBe(made.form.name) // 已 populate
      expect(bossInbox.body[0].applicant_employee.name).toBe('a1')
      expect(bossInbox.headers['x-total-count']).toBe('1')

      // 第 1 關：主管
      const first = await act('boss', requestId, 'approve', '同意')
      expect(first.status).toBe(200)
      expect((await get('hr1', '/api/approvals/inbox')).body).toHaveLength(1)
      expect((await get('boss', '/api/approvals/inbox')).body).toEqual([])

      // 第 2 關：四位人資同一時間簽核（全員同意）——沒有人得到「已變更請重試」
      const results = await Promise.all(['hr1', 'hr2', 'hr3', 'hrB'].map(key => act(key, requestId, 'approve')))
      expect(results.map(res => res.status)).toEqual([200, 200, 200, 200])
      const afterHr = await load(requestId)
      expect(afterHr.steps[1].approvers.map(a => a.decision)).toEqual(['approved', 'approved', 'approved', 'approved'])
      expect(afterHr.current_step_index).toBe(2)
      expect(afterHr.logs.filter(log => log.action === 'move_next' && log.step_order === 3)).toHaveLength(1)

      // 第 3 關：角色 R003 任一人同意——一人簽，另一人記為 skipped（免簽）而不是 approved
      expect((await get('r3a', '/api/approvals/inbox')).body).toHaveLength(1)
      expect((await act('r3a', requestId, 'approve')).status).toBe(200)
      const afterRole = await load(requestId)
      expect(afterRole.steps[2].approvers.map(a => [String(a.approver), a.decision])).toEqual([
        [id('r3a'), 'approved'],
        [id('r3b'), 'skipped'],
      ])
      expect(afterRole.steps[2].approvers[1].decided_at).toBeInstanceOf(Date)
      expect(afterRole.current_step_index).toBe(3)
      expect((await get('r3b', '/api/approvals/inbox')).body).toEqual([])
      expect((await act('r3b', requestId, 'approve')).status).toBe(409) // 已由他人處理，中文訊息
      expect((await get('r3b', '/api/approvals/history')).body).toEqual([]) // 沒簽的人不會出現在歷史

      // 第 4 關：層級 U002；第 5 關是沒有簽核人的選填關卡，自動略過後結案
      const last = await act('u2', requestId, 'approve')
      expect(last.status).toBe(200)
      const finished = await load(requestId)
      expect(finished.status).toBe('approved')
      expect(finished.logs.map(log => log.action)).toEqual(expect.arrayContaining(['skip', 'finish']))
      expect(finished.logs.find(log => log.action === 'skip').message).toContain('第 5 關')

      // 歷史：一般員工身分的人資也看得到自己簽過的單；沒簽過的人看不到
      const hrHistory = await get('hr1', '/api/approvals/history')
      expect(hrHistory.status).toBe(200)
      expect(hrHistory.body).toHaveLength(1)
      expect(hrHistory.body[0].my_approvals).toEqual([expect.objectContaining({ step_order: 2, decision: 'approved' })])
      expect((await get('stranger', '/api/approvals/history')).body).toEqual([])
      expect((await get('r3a', '/api/approvals/history')).body).toHaveLength(1)

      // 管理員的歷史是全部（含別人簽的）
      const adminHistory = await get('admin', '/api/approvals/history')
      expect(adminHistory.body.map(item => item._id)).toContain(requestId)

      // 申請人的清單已 populate，不必再逐筆查明細
      const mine = await get('a1', '/api/approvals')
      expect(mine.body[0].form.name).toBe(made.form.name)
      expect(mine.body[0].steps[1].approvers[0].approver.name).toBeTruthy()
      const paged = await get('a1', '/api/approvals?page=1&limit=1')
      expect(paged.body).toMatchObject({ page: 1, limit: 1, total: 1 })

      // 明細
      const detail = await get('a1', `/api/approvals/${requestId}`)
      expect(detail.body.viewer).toEqual({ is_applicant: true, can_act: false, can_override: false })
      expect(detail.body.logs.some(log => log.by_employee?.name === 'boss')).toBe(true)
    })

    it('does not let the applicant approve their own request even though they hold the 人資 tag', async () => {
      // a1 持有 人資 標籤；單子是 a1 自己送的，a1 不在簽核人名單，也不能硬簽
      const created = await createRequest('a1', made, { [fieldId(made, '事由')]: '自簽測試' })
      expect(created.status).toBe(201)
      const doc = await load(created.body._id)
      expect(doc.steps[1].approvers.map(a => String(a.approver))).not.toContain(id('a1'))

      const forced = await act('a1', created.body._id, 'approve')
      expect(forced.status).toBe(403)
      expect(forced.body.code).toBe('SELF_APPROVAL')
      await post('a1', `/api/approvals/${created.body._id}/cancel`)
      // 後面的案例不需要 a1 持有 人資 標籤
      await Employee.updateOne({ _id: people.a1._id }, { $set: { signTags: [] } })
    })
  })

  describe('reject, return and resubmit', () => {
    let made

    beforeAll(async () => {
      made = await makeForm({
        name: '用印申請',
        fields: [{ label: '內容', type_1: 'textarea', required: true }],
        steps: [
          { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true },
          { approver_type: 'tag', approver_value: '人資', all_must_approve: false, is_required: true, can_return: true },
        ],
      })
    })

    it('rejects: the status becomes rejected and the reason is on the approver', async () => {
      const created = await createRequest('a2', made, { [fieldId(made, '內容')]: '用印' })
      const res = await act('boss', created.body._id, 'reject', '資料不全')
      expect(res.status).toBe(200)
      const doc = await load(created.body._id)
      expect(doc.status).toBe('rejected')
      expect(doc.steps[0].approvers[0]).toMatchObject({ decision: 'rejected', comment: '資料不全' })
      expect((await act('boss', created.body._id, 'approve')).status).toBe(409)
      // 否決的人看得到自己簽過的單
      expect((await get('boss', '/api/approvals/history')).body.map(item => item._id)).toContain(created.body._id)
    })

    it('returns with a reason the applicant can read, then resubmits corrected data to freshly resolved approvers', async () => {
      const created = await createRequest('a2', made, { [fieldId(made, '內容')]: '舊內容' })
      const requestId = created.body._id

      const returned = await act('boss', requestId, 'return', '請補充用印對象')
      expect(returned.status).toBe(200)
      let doc = await load(requestId)
      expect(doc.status).toBe('returned')
      expect(doc.steps[0].approvers[0]).toMatchObject({ decision: 'returned', comment: '請補充用印對象' })
      expect(doc.logs.find(log => log.action === 'return')).toMatchObject({ comment: '請補充用印對象', by_employee: people.boss._id })

      // 退簽的人在「我已簽核」看得到，申請人在明細看得到原因
      const bossHistory = await get('boss', '/api/approvals/history')
      const item = bossHistory.body.find(row => row._id === requestId)
      expect(item.my_approvals[0]).toMatchObject({ decision: 'returned', comment: '請補充用印對象' })
      const detail = await get('a2', `/api/approvals/${requestId}`)
      expect(detail.body.last_return).toMatchObject({ comment: '請補充用印對象', by: { name: 'boss' } })

      // 退回期間，人資標籤的持有者有變動；重新送出會重新解析簽核人
      await Employee.updateOne({ _id: people.hr3._id }, { $set: { signTags: [] } })
      const resubmitted = await post('a2', `/api/approvals/${requestId}/resubmit`, {
        form_data: { [fieldId(made, '內容')]: '更正後的內容：用印對象為地政事務所', 隨便: 'x' },
        comment: '已補充',
      })
      expect(resubmitted.status).toBe(200)
      doc = await load(requestId)
      expect(doc.status).toBe('pending')
      expect(doc.form_data).toEqual({ [fieldId(made, '內容')]: '更正後的內容：用印對象為地政事務所' })
      expect(doc.steps[0].approvers[0].decision).toBe('pending')
      expect(doc.steps[1].approvers.map(a => String(a.approver)).sort()).toEqual([id('hr1'), id('hr2'), id('hrB')].sort())
      expect(doc.logs[doc.logs.length - 1]).toMatchObject({ action: 'resubmit', comment: '已補充' })
      await Employee.updateOne({ _id: people.hr3._id }, { $set: { signTags: ['人資'] } })

      // 補件後完成簽核；任一人同意的第 2 關，其餘人資記為 skipped
      expect((await act('boss', requestId, 'approve')).status).toBe(200)
      expect((await act('hr2', requestId, 'approve')).status).toBe(200)
      doc = await load(requestId)
      expect(doc.status).toBe('approved')
      expect(doc.steps[1].approvers.map(a => a.decision).sort()).toEqual(['approved', 'skipped', 'skipped'])
    })

    it('rejects invalid corrected data on resubmit and leaves the request returned', async () => {
      const made2 = await makeForm({
        name: '金額更正',
        fields: [{ label: '金額', type_1: 'number', required: true }],
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      const created = await createRequest('a2', made2, { [fieldId(made2, '金額')]: 100 })
      await act('boss', created.body._id, 'return', '金額錯誤')

      const bad = await post('a2', `/api/approvals/${created.body._id}/resubmit`, { form_data: { [fieldId(made2, '金額')]: 'abc' } })
      expect(bad.status).toBe(400)
      expect(bad.body.error).toContain('金額')
      expect((await load(created.body._id)).status).toBe('returned')
    })

    it('withdraws a pending request, treats a repeated withdraw as done, and never reveals it to others', async () => {
      const created = await createRequest('a3', made, { [fieldId(made, '內容')]: '撤回測試' })
      expect((await post('stranger', `/api/approvals/${created.body._id}/cancel`)).status).toBe(404)
      expect((await post('a3', `/api/approvals/${created.body._id}/cancel`, { comment: '不需要了' })).status).toBe(200)
      expect((await post('a3', `/api/approvals/${created.body._id}/cancel`)).status).toBe(200)
      const doc = await load(created.body._id)
      expect(doc.status).toBe('canceled')
      expect(doc.logs.filter(log => log.action === 'cancel')).toHaveLength(1)
      expect((await post('boss', `/api/approvals/${created.body._id}/act`, { decision: 'approve' })).status).toBe(409)
    })

    it('refuses to withdraw an approved request that is not annual leave', async () => {
      const created = await createRequest('a3', made, { [fieldId(made, '內容')]: '已完成' })
      await act('boss', created.body._id, 'approve')
      await act('hr1', created.body._id, 'approve')
      expect((await load(created.body._id)).status).toBe('approved')
      const res = await post('a3', `/api/approvals/${created.body._id}/cancel`)
      expect(res.status).toBe(409)
      expect((await load(created.body._id)).status).toBe('approved')
    })
  })

  describe('administrator override for a stuck request', () => {
    it('lets the admin push a step through after an approver left, and records admin_override', async () => {
      const made = await makeForm({
        name: '離職交接',
        fields: [],
        steps: [{ approver_type: 'tag', approver_value: '交接人資', all_must_approve: true, is_required: true, can_return: true },
          { approver_type: 'user', approver_value: [], all_must_approve: true, is_required: false, can_return: true },
          { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      await Employee.updateMany({ _id: { $in: [id('hr1'), id('hr2')] } }, { $set: { signTags: ['人資', '交接人資'] } })
      const created = await createRequest('a1', made)
      expect(created.status).toBe(201)
      const requestId = created.body._id

      expect((await act('hr1', requestId, 'approve')).status).toBe(200)
      // hr2 在這時離職：帳號不能登入，這關永遠等不到他
      await Employee.updateOne({ _id: people.hr2._id }, { $set: { status: '離職員工' } })
      const gone = await get('hr2', `/api/approvals/${requestId}`).catch(error => error)
      expect(gone.status).toBe(401)

      // 其他人（含主管）不能越權；管理員看得到卡住的單與卡在誰身上
      expect((await act('boss', requestId, 'approve')).status).toBe(409)
      const overview = await get('admin', '/api/approvals/history?status=pending')
      const stuck = overview.body.items ? overview.body.items : overview.body
      const row = stuck.find(item => item._id === requestId)
      expect(row.pending_approvers.map(approver => approver.name)).toEqual(['hr2'])
      const detail = await get('admin', `/api/approvals/${requestId}`)
      expect(detail.body.viewer).toMatchObject({ can_act: false, can_override: true })

      const forced = await act('admin', requestId, 'approve', '離職交接，代為核可')
      expect(forced.status).toBe(200)
      const doc = await load(requestId)
      expect(doc.steps[0].approvers.map(a => a.decision).sort()).toEqual(['approved', 'skipped'])
      expect(doc.current_step_index).toBe(2) // 選填的空關卡自動略過
      expect(doc.logs.find(log => log.action === 'admin_override')).toMatchObject({
        decision: 'approve', step_order: 1, comment: '離職交接，代為核可', by_employee: people.admin._id,
      })

      // 主管簽完結案；管理員也可以代為否決／退簽別的單
      expect((await act('boss', requestId, 'approve')).status).toBe(200)
      expect((await load(requestId)).status).toBe('approved')

      const second = await createRequest('a2', made)
      const rejected = await act('admin', second.body._id, 'reject', '無法處理')
      expect(rejected.status).toBe(200)
      expect((await load(second.body._id)).status).toBe('rejected')

      const third = await createRequest('a3', made)
      expect((await act('admin', third.body._id, 'return', '請重新申請')).status).toBe(200)
      expect((await load(third.body._id)).status).toBe('returned')

      await Employee.updateOne({ _id: people.hr2._id }, { $set: { status: '正職員工' } })
    })

    it('does not let the admin decide on their own request', async () => {
      const made = await makeForm({
        name: '管理員自簽',
        steps: [{ approver_type: 'user', approver_value: [id('boss')], all_must_approve: true, is_required: true, can_return: true }],
      })
      const created = await createRequest('admin', made)
      expect(created.status).toBe(201)
      const res = await act('admin', created.body._id, 'approve')
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('SELF_APPROVAL')
    })
  })

  describe('concurrent approvers on one step', () => {
    it('lets all approvers of an all-must-approve step sign at the same instant', async () => {
      const made = await makeForm({
        name: '全員同意',
        steps: [{ approver_type: 'user', approver_value: ['hr1', 'hr2', 'hr3', 'hrB'].map(id), all_must_approve: true, is_required: true, can_return: true }],
      })
      const created = await createRequest('a1', made)
      const results = await Promise.all(['hr1', 'hr2', 'hr3', 'hrB'].map(key => act(key, created.body._id, 'approve')))
      expect(results.map(res => res.status)).toEqual([200, 200, 200, 200])
      expect((await load(created.body._id)).status).toBe('approved')
    })

    it('lets a dozen approvers of one all-must-approve step sign together without anyone being told to retry', async () => {
      const keys = Array.from({ length: 12 }, (_, index) => `crowd${index}`)
      for (const key of keys) await addPerson(key)
      const made = await makeForm({
        name: '十二人同簽',
        steps: [{ approver_type: 'user', approver_value: keys.map(id), all_must_approve: true, is_required: true, can_return: true }],
      })
      const created = await createRequest('a1', made)
      expect(created.status).toBe(201)

      const results = await Promise.all(keys.map(key => act(key, created.body._id, 'approve')))

      expect(results.map(res => res.status)).toEqual(Array(12).fill(200))
      const doc = await load(created.body._id)
      expect(doc.status).toBe('approved')
      expect(doc.steps[0].approvers.every(a => a.decision === 'approved')).toBe(true)
      expect(doc.logs.filter(log => log.action === 'approve')).toHaveLength(12)
    })

    it('gives the losers of an any-one step a Chinese 409 and records exactly one approval', async () => {
      const made = await makeForm({
        name: '任一人同意',
        steps: [{ approver_type: 'user', approver_value: ['hr1', 'hr2', 'hr3'].map(id), all_must_approve: false, is_required: true, can_return: true }],
      })
      const created = await createRequest('a1', made)
      const results = await Promise.all(['hr1', 'hr2', 'hr3'].map(key => act(key, created.body._id, 'approve')))

      const statuses = results.map(res => res.status).sort()
      expect(statuses).toEqual([200, 409, 409])
      results.filter(res => res.status === 409).forEach(res => {
        expect(res.body.error).toMatch(/已不是待簽核|已由其他簽核人處理|已經處理過/)
      })
      const doc = await load(created.body._id)
      expect(doc.status).toBe('approved')
      expect(doc.steps[0].approvers.map(a => a.decision).sort()).toEqual(['approved', 'skipped', 'skipped'])
      expect(doc.logs.filter(log => log.action === 'approve')).toHaveLength(1)
    })
  })

  describe('scope, self-exclusion and eligibility', () => {
    it('limits a 部門-scoped tag step to the applicant department and never widens it for an applicant without one', async () => {
      const made = await makeForm({
        name: '部門人資',
        steps: [{ approver_type: 'tag', approver_value: '人資', scope_type: 'dept', all_must_approve: true, is_required: true, can_return: true }],
      })
      const ok = await createRequest('a2', made)
      expect(ok.status).toBe(201)
      const doc = await load(ok.body._id)
      expect(doc.steps[0].approvers.map(a => String(a.approver)).sort()).toEqual([id('hr1'), id('hr2'), id('hr3')].sort())

      const lonely = await createRequest('nodept', made)
      expect(lonely.status).toBe(400)
      expect(lonely.body).toMatchObject({ code: 'REQUIRED_APPROVER_MISSING', step: 1 })
      expect(lonely.body.error).toContain('申請人尚未設定所屬部門')
    })

    it('reports that the applicant is the only holder instead of letting them approve themselves', async () => {
      await Employee.updateOne({ _id: people.stranger._id }, { $set: { signTags: ['獨一標籤'] } })
      const made = await makeForm({
        name: '獨一',
        steps: [{ approver_type: 'tag', approver_value: '獨一標籤', all_must_approve: true, is_required: true, can_return: true }],
      })
      const res = await createRequest('stranger', made)
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('符合條件的簽核人只有申請人本人')
    })

    it('treats a tag with stray whitespace in the stored value the same as the workflow tag', async () => {
      await Employee.collection.updateOne({ _id: people.stranger._id }, { $set: { signTags: ['　財務覆核  '] } }) // 未正規化的舊資料（全形空白、結尾空白）
      const made = await makeForm({
        name: '財務',
        steps: [{ approver_type: 'tag', approver_value: '財務覆核', all_must_approve: true, is_required: true, can_return: true }],
      })
      const res = await createRequest('a1', made)
      expect(res.status).toBe(201)
      expect((await load(res.body._id)).steps[0].approvers.map(a => String(a.approver))).toEqual([id('stranger')])
    })

    it('ignores departed and disabled people for user and manager steps', async () => {
      await Employee.updateOne({ _id: people.a3._id }, { $set: { supervisor: people.hrLeft._id } })
      const made = await makeForm({
        name: '離職主管',
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      const res = await createRequest('a3', made)
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('申請人的直屬主管已離職')
      await Employee.updateOne({ _id: people.a3._id }, { $set: { supervisor: people.boss._id } })
    })
  })

  describe('特休 (annual leave) balance flow', () => {
    let made
    let typeId
    let startId
    let endId
    let daysId

    const leave = (start, end, extra = {}) => ({ [typeId]: '特休假', [startId]: start, [endId]: end, ...extra })

    beforeAll(async () => {
      made = await makeForm({
        name: '特休請假單',
        semanticType: 'leave',
        fields: [
          { label: '假別', type_1: 'select', options: ['特休假', '病假'], required: true },
          { label: '日期(起)', type_1: 'date', required: true },
          { label: '日期(迄)', type_1: 'date', required: true },
          { label: '天數', type_1: 'number' },
        ],
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      typeId = fieldId(made, '假別')
      startId = fieldId(made, '日期(起)')
      endId = fieldId(made, '日期(迄)')
      daysId = fieldId(made, '天數')
    })

    it('checks the balance at filing, counts days correctly, deducts on approval and refunds on withdrawal', async () => {
      await Employee.updateOne({ _id: people.a1._id }, { $set: { 'annualLeave.totalDays': 3, 'annualLeave.usedDays': 0 } })

      // 2 天
      const first = await createRequest('a1', made, leave('2099-03-02', '2099-03-03'))
      expect(first.status).toBe(201)
      expect((await act('boss', first.body._id, 'approve')).status).toBe(200)
      expect((await Employee.findById(id('a1'))).annualLeave.usedDays).toBe(2)
      expect((await load(first.body._id)).annual_leave).toMatchObject({ state: 'deducted', days: 2 })

      // 剩 1 天：再申請 2 天被擋下，清楚的中文訊息
      const tooMuch = await createRequest('a1', made, leave('2099-04-01', '2099-04-02'))
      expect(tooMuch.status).toBe(400)
      expect(tooMuch.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remaining: 1, requested: 2 })
      expect(tooMuch.body.error).toBe('特休餘額不足：剩餘 1 天，本次申請 2 天')

      // 同一天上午 9:00 到下午 6:00（台灣時間）算 1 天，不是 2 天
      const oneDay = await createRequest('a1', made, leave('2099-05-04T01:00:00.000Z', '2099-05-04T10:00:00.000Z'))
      expect(oneDay.status).toBe(201)
      expect((await act('boss', oneDay.body._id, 'approve')).status).toBe(200)
      expect((await Employee.findById(id('a1'))).annualLeave.usedDays).toBe(3)

      // 假期還沒開始：申請人可以撤回，天數返還；重複撤回不會重複返還
      const withdraw = await post('a1', `/api/approvals/${first.body._id}/cancel`, { comment: '行程取消' })
      expect(withdraw.status).toBe(200)
      expect(withdraw.body.status).toBe('canceled')
      let employee = await Employee.findById(id('a1'))
      expect(employee.annualLeave.usedDays).toBe(1)
      expect((await post('a1', `/api/approvals/${first.body._id}/cancel`)).status).toBe(200)
      expect((await Employee.findById(id('a1'))).annualLeave.usedDays).toBe(1)
      expect((await load(first.body._id)).annual_leave).toMatchObject({ state: 'refunded', days: 2 })

      // 管理員也可以撤回核准的特休（返還 1 天）
      const adminCancel = await post('admin', `/api/approvals/${oneDay.body._id}/cancel`)
      expect(adminCancel.status).toBe(200)
      employee = await Employee.findById(id('a1'))
      expect(employee.annualLeave.usedDays).toBe(0)
      expect(employee.annualLeave.appliedApprovalRequestIds ?? []).toEqual([])
      // 一般員工不能撤回別人的單
      expect((await post('stranger', `/api/approvals/${oneDay.body._id}/cancel`)).status).toBe(404)
    })

    it('uses the 天數 field for half days and keeps the approval with a visible failure when the balance changed meanwhile', async () => {
      await Employee.updateOne({ _id: people.a2._id }, { $set: { 'annualLeave.totalDays': 1, 'annualLeave.usedDays': 0 } })

      const halfDay = await createRequest('a2', made, leave('2099-06-01', '2099-06-01', { [daysId]: 0.5 }))
      expect(halfDay.status).toBe(201)
      const another = await createRequest('a2', made, leave('2099-06-08', '2099-06-08', { [daysId]: 1 }))
      expect(another.status).toBe(201) // 送出當下餘額 1 天，足夠

      expect((await act('boss', halfDay.body._id, 'approve')).status).toBe(200)
      expect((await Employee.findById(id('a2'))).annualLeave.usedDays).toBe(0.5)

      // 第二張核准時餘額只剩 0.5 天：核准成立，但扣減失敗要清楚留下紀錄並回報
      const second = await act('boss', another.body._id, 'approve')
      expect(second.status).toBe(200)
      expect(second.body.status).toBe('approved')
      expect(second.body.warnings).toEqual([{
        code: 'ANNUAL_LEAVE_DEDUCTION_FAILED',
        message: '特休扣減失敗：餘額不足（剩餘 0.5 天，本次需扣 1 天），請人資確認特休天數後手動補登',
      }])
      const doc = await load(another.body._id)
      expect(doc.annual_leave).toMatchObject({ state: 'failed', days: 1 })
      expect(doc.logs.find(log => log.action === 'annual_leave_error').message).toContain('餘額不足')
      expect((await Employee.findById(id('a2'))).annualLeave.usedDays).toBe(0.5)
    })

    it('does not block employees whose quota was never configured, and says so after approval', async () => {
      const res = await createRequest('a3', made, leave('2099-07-01', '2099-07-02'))
      expect(res.status).toBe(201)
      const approved = await act('boss', res.body._id, 'approve')
      expect(approved.status).toBe(200)
      expect(approved.body.warnings[0].code).toBe('ANNUAL_LEAVE_DEDUCTION_FAILED')
    })

    it('sets the yearly quota without touching the days already used, and resets on a new year', async () => {
      await Employee.updateOne(
        { _id: people.a1._id },
        { $set: { 'annualLeave.totalDays': 5, 'annualLeave.usedDays': 2, 'annualLeave.year': 2098, 'annualLeave.appliedApprovalRequestIds': ['x'] } },
      )
      const sameYear = await request(app).patch(`/api/employees/${id('a1')}/annual-leave`).set(as('admin')).send({ totalDays: 12, year: 2098 })
      expect(sameYear.status).toBe(200)
      expect(sameYear.body.annualLeave).toMatchObject({ totalDays: 12, usedDays: 2, year: 2098 })

      const newYear = await request(app).patch(`/api/employees/${id('a1')}/annual-leave`).set(as('admin')).send({ totalDays: 14, year: 2099 })
      expect(newYear.status).toBe(200)
      expect(newYear.body.annualLeave).toMatchObject({ totalDays: 14, usedDays: 0, year: 2099 })
      expect((await request(app).patch(`/api/employees/${new mongoose.Types.ObjectId()}/annual-leave`).set(as('admin')).send({ totalDays: 3, year: 2099 })).status).toBe(400)
    })

    it('rejects an end date before the start date', async () => {
      const res = await createRequest('a1', made, leave('2099-08-05', '2099-08-01'))
      expect(res.status).toBe(400)
      // 請假規範檢核（laborRuleValidationService）先擋下；特休的日期檢查是同一件事的後援
      expect(res.body.violations).toEqual([expect.objectContaining({ rule: 'leave-time-range', message: '請假結束日期不可早於開始日期' })])
    })

    it('exposes the usage history through the employee API using the real field ids', async () => {
      await Employee.updateOne({ _id: people.a2._id }, { $set: { 'annualLeave.year': 2099 } })
      const res = await get('admin', `/api/employees/${id('a2')}/annual-leave/history?year=2099`)
      expect(res.status).toBe(200)
      expect(res.body.map(item => item.days).sort()).toEqual([0.5, 1])
    })
  })

  describe('attachments', () => {
    it('keeps Chinese names, binds files to their uploader and one request, and blocks the static path', async () => {
      const made = await makeForm({
        name: '附件申請',
        fields: [{ label: '證明', type_1: 'file' }],
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      const proofId = fieldId(made, '證明')

      const upload = await request(app)
        .post('/api/approvals/attachments')
        .set(as('a1'))
        .attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: '請假證明_醫師診斷書.pdf', contentType: 'application/pdf' })
      expect(upload.status).toBe(201)
      const file = upload.body.files[0]
      createdUploads.push(path.join(UPLOAD_DIR, path.basename(file.url)))
      expect(file.name).toBe('請假證明_醫師診斷書.pdf')

      // 別人不能拿去用；不存在的檔案也不行
      const stolen = await createRequest('a2', made, { [proofId]: [file] })
      expect(stolen.status).toBe(400)
      expect(stolen.body.error).toContain('不是由您上傳')
      const fake = await createRequest('a1', made, { [proofId]: [{ name: 'x.pdf', url: '/upload/approvals/1700000000000-0000000000000000.pdf' }] })
      expect(fake.status).toBe(400)

      // 本人可以用一次；前端回傳的名稱、大小以上傳紀錄為準
      const created = await createRequest('a1', made, { [proofId]: [{ ...file, name: '偽造名稱.pdf', size: 1 }] })
      expect(created.status).toBe(201)
      const stored = (await load(created.body._id)).form_data[proofId][0]
      expect(stored).toMatchObject({ name: '請假證明_醫師診斷書.pdf', url: file.url, type: 'application/pdf' })
      expect((await ApprovalAttachment.findOne({ filename: path.basename(file.url) })).request.toString()).toBe(created.body._id)

      // 同一個檔案不能掛到第二張單
      const reused = await createRequest('a1', made, { [proofId]: [file] })
      expect(reused.status).toBe(400)
      expect(reused.body.error).toContain('已被其他申請使用')

      // 簽核人可下載；沒有關係的人不行
      const download = await get('boss', `/api/approvals/${created.body._id}/attachments/${path.basename(file.url)}`)
      expect(download.status).toBe(200)
      expect(download.headers['content-disposition']).toContain(encodeURIComponent('請假證明_醫師診斷書.pdf'))
      expect((await get('stranger', `/api/approvals/${created.body._id}/attachments/${path.basename(file.url)}`)).status).toBe(404)

      // 靜態路徑：一般與各種編碼寫法都是 404（不需要登入也一樣）
      const name = path.basename(file.url)
      for (const url of [`/upload/approvals/${name}`, `/upload/%61pprovals/${name}`, `/upload/approvals%2f${name}`, `/upload/APPROVALS/${name}`]) {
        expect((await request(app).get(url)).status).toBe(404)
      }
    })
  })

  describe('legacy and edge data', () => {
    it('still opens (and can reject) a request whose form template was deleted', async () => {
      const made = await makeForm({
        name: '將被刪除',
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      const created = await createRequest('a1', made)
      expect(created.status).toBe(201)
      await FormTemplate.deleteOne({ _id: made.form._id })

      const detail = await get('a1', `/api/approvals/${created.body._id}`)
      expect(detail.status).toBe(200)
      expect(detail.body.form).toMatchObject({ _id: String(made.form._id), name: '（表單已刪除）', deleted: true })
      const approve = await act('boss', created.body._id, 'approve')
      expect(approve.status).toBe(409)
      expect(approve.body.code).toBe('FORM_NOT_AVAILABLE')
      expect((await act('boss', created.body._id, 'reject', '表單已刪除')).status).toBe(200)
      // 清單也能正常列出（form 為 null）
      expect((await get('a1', '/api/approvals')).status).toBe(200)
    })

    it('does not show the fake approvals of old any-one steps (approved without a time) in the history', async () => {
      const made = await makeForm({
        name: '舊資料',
        steps: [{ approver_type: 'user', approver_value: [id('hr1'), id('hr2')], all_must_approve: false, is_required: true, can_return: true }],
      })
      await ApprovalRequest.create({
        form: made.form._id,
        workflow: made.workflow._id,
        form_data: {},
        applicant_employee: people.a1._id,
        status: 'approved',
        current_step_index: 0,
        steps: [{
          step_order: 1,
          all_must_approve: false,
          approvers: [
            { approver: people.hr1._id, decision: 'approved', decided_at: new Date(), comment: '我簽的' },
            { approver: people.hr2._id, decision: 'approved' }, // 舊版把沒簽的人也記成 approved，沒有時間
          ],
        }],
      })

      const hr2History = await get('hr2', '/api/approvals/history')
      expect(hr2History.body.filter(item => item.form?._id === String(made.form._id))).toEqual([])
      const hr1History = await get('hr1', '/api/approvals/history')
      const row = hr1History.body.find(item => item.form?._id === String(made.form._id))
      expect(row.my_approvals).toEqual([expect.objectContaining({ decision: 'approved', comment: '我簽的' })])
    })

    it('keeps attachments when a returned request is resubmitted with the same files, and accepts a newly uploaded one', async () => {
      const made = await makeForm({
        name: '退回附件',
        fields: [{ label: '證明', type_1: 'file' }],
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      const proofId = fieldId(made, '證明')
      const upload = async (name) => {
        const res = await request(app)
          .post('/api/approvals/attachments')
          .set(as('a1'))
          .attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: name, contentType: 'application/pdf' })
        createdUploads.push(path.join(UPLOAD_DIR, path.basename(res.body.files[0].url)))
        return res.body.files[0]
      }
      const first = await upload('第一份.pdf')
      const created = await createRequest('a1', made, { [proofId]: [first] })
      expect(created.status).toBe(201)
      await act('boss', created.body._id, 'return', '再補一份')

      const second = await upload('第二份.pdf')
      const resubmitted = await post('a1', `/api/approvals/${created.body._id}/resubmit`, { form_data: { [proofId]: [first, second] } })
      expect(resubmitted.status).toBe(200)
      const doc = await load(created.body._id)
      expect(doc.form_data[proofId].map(file => file.name)).toEqual(['第一份.pdf', '第二份.pdf'])
      expect((await ApprovalAttachment.find({ request: created.body._id })).length).toBe(2)
    })
  })

  describe('list endpoints at volume', () => {
    it('pages through many requests without loading everything, with accurate totals', async () => {
      await addPerson('volBoss', { role: 'supervisor' })
      const made = await makeForm({
        name: '大量',
        steps: [{ approver_type: 'user', approver_value: [id('volBoss')], all_must_approve: true, is_required: true, can_return: true }],
      })
      const docs = Array.from({ length: 130 }, (_, index) => ({
        form: made.form._id,
        workflow: made.workflow._id,
        form_data: {},
        applicant_employee: people.a1._id,
        status: 'pending',
        current_step_index: 0,
        steps: [{ step_order: 1, approvers: [{ approver: people.volBoss._id, decision: 'pending' }], all_must_approve: true, is_required: true, can_return: true }],
        logs: [],
        createdAt: new Date(Date.now() + index),
      }))
      await ApprovalRequest.insertMany(docs)

      const page1 = await get('volBoss', '/api/approvals/inbox?page=1&limit=50')
      expect(page1.body.total).toBe(130)
      expect(page1.body.items).toHaveLength(50)
      const page3 = await get('volBoss', '/api/approvals/inbox?page=3&limit=50')
      expect(page3.body.items).toHaveLength(30)
      const ids = new Set([...page1.body.items, ...page3.body.items].map(item => item._id))
      expect(ids.size).toBe(80)

      const capped = await get('volBoss', '/api/approvals/inbox?limit=100000')
      expect(capped.body.limit).toBe(200)
      expect(capped.body.items).toHaveLength(130)
      const legacy = await get('volBoss', '/api/approvals/inbox')
      expect(Array.isArray(legacy.body)).toBe(true)
      expect(legacy.headers['x-total-count']).toBe('130')

      // 查詢使用索引（不是整個集合掃描）
      const explain = await ApprovalRequest.find({
        steps: { $elemMatch: { approvers: { $elemMatch: { approver: people.volBoss._id, $or: [{ decision: { $in: ['rejected', 'returned'] } }, { decision: 'approved', decided_at: { $type: 'date' } }] } } } },
      }).sort({ updatedAt: -1 }).explain('queryPlanner')
      expect(JSON.stringify(explain.queryPlanner.winningPlan)).toContain('IXSCAN')
    })
  })

  describe('Employee indexes on a fresh database', () => {
    it('builds every index, with a single plain employeeId index', async () => {
      await Employee.syncIndexes()
      await Employee.createIndexes()
      const indexes = await Employee.collection.indexes()
      const employeeIdIndexes = indexes.filter(index => JSON.stringify(index.key) === JSON.stringify({ employeeId: 1 }))
      expect(employeeIdIndexes).toHaveLength(1)
      expect(employeeIdIndexes[0]).toMatchObject({ name: 'employeeId_1' })
      expect(employeeIdIndexes[0].unique).toBeUndefined()
      expect(employeeIdIndexes[0].sparse).toBeUndefined()
    })
  })

  describe('a second action on a step that has already moved on is refused (never replayed on the next step)', () => {
    const STALE_MESSAGE = '這張簽核單剛被其他人處理，目前關卡已經改變，請重新整理後再確認'
    let threeSteps

    const userStep = (keys, extra = {}) => ({
      approver_type: 'user', approver_value: keys.map(id), all_must_approve: true, is_required: true, can_return: true, ...extra,
    })

    // 讓兩個請求都先讀到同一版單據，再一起存檔：不靠時間碰運氣，保證有一個會遇到版本衝突並重試
    async function raceAfterBothRead(calls) {
      const original = ApprovalRequest.findById
      let arrived = 0
      let release
      const gate = new Promise(resolve => { release = resolve })
      const spy = jest.spyOn(ApprovalRequest, 'findById').mockImplementation(function findByIdGated(...args) {
        const query = original.apply(this, args)
        arrived += 1
        const mine = arrived
        if (mine > calls.length) return query
        return Promise.resolve(query).then(async (doc) => {
          if (mine === calls.length) release()
          await gate
          return doc
        })
      })
      try {
        return await Promise.all(calls.map(call => call()))
      } finally {
        spy.mockRestore()
      }
    }

    beforeAll(async () => {
      await addPerson('admin2', { role: 'admin' })
      threeSteps = await makeForm({
        name: '三關覆核',
        steps: [userStep(['boss']), userStep(['hr1']), userStep(['hr2'])],
      })
    })

    it('two admins overriding the same step at the same moment: one wins, the other gets a Chinese 409 and step 2 is not skipped (8 rounds)', async () => {
      for (let round = 0; round < 8; round += 1) {
        const created = await createRequest('a1', threeSteps)
        expect(created.status).toBe(201)
        const requestId = created.body._id

        const results = await raceAfterBothRead([
          () => act('admin', requestId, 'approve', `管理員一 第${round}輪`),
          () => act('admin2', requestId, 'approve', `管理員二 第${round}輪`),
        ])

        expect(results.map(res => res.status).sort()).toEqual([200, 409])
        const loser = results.find(res => res.status === 409)
        expect(loser.body).toEqual({ error: STALE_MESSAGE, code: 'CONFLICT' })
        const doc = await load(requestId)
        expect(doc.status).toBe('pending')
        expect(doc.current_step_index).toBe(1) // 只前進一關，第 2 關還在等人資
        expect(doc.steps[1].approvers.map(a => a.decision)).toEqual(['pending'])
        expect(doc.logs.filter(log => log.action === 'admin_override')).toHaveLength(1)
      }
    })

    it('the same race without any synchronisation never skips a step when the screens say which step they saw (8 rounds)', async () => {
      for (let round = 0; round < 8; round += 1) {
        const created = await createRequest('a1', threeSteps)
        const requestId = created.body._id

        const results = await Promise.all([
          post('admin', `/api/approvals/${requestId}/act`, { decision: 'approve', step_order: 1 }),
          post('admin2', `/api/approvals/${requestId}/act`, { decision: 'approve', step_order: 1 }),
        ])

        expect(results.map(res => res.status).sort()).toEqual([200, 409])
        expect(results.find(res => res.status === 409).body.code).toBe('CONFLICT')
        const doc = await load(requestId)
        expect(doc.current_step_index).toBe(1)
        expect(doc.logs.filter(log => log.action === 'admin_override')).toHaveLength(1)
      }
    })

    it('a stale screen that names its step is refused even long after the other action finished', async () => {
      const created = await createRequest('a1', threeSteps)
      const requestId = created.body._id
      expect((await act('boss', requestId, 'approve')).status).toBe(200) // 第 1 關完成，現在是第 2 關

      const stale = await post('admin', `/api/approvals/${requestId}/act`, { decision: 'approve', step_order: 1 })

      expect(stale.status).toBe(409)
      expect(stale.body).toEqual({ error: STALE_MESSAGE, code: 'CONFLICT' })
      expect((await load(requestId)).current_step_index).toBe(1)
      const malformed = await post('admin', `/api/approvals/${requestId}/act`, { decision: 'approve', step_order: 'x' })
      expect(malformed.status).toBe(400)
      expect(malformed.body.error).toBe('關卡編號格式不正確')
    })

    it('double return from two tabs: the second 退簽 is refused instead of sending the request one step further back', async () => {
      const created = await createRequest('a1', threeSteps)
      const requestId = created.body._id
      expect((await act('boss', requestId, 'approve')).status).toBe(200) // 現在是第 2 關（hr1）

      const results = await raceAfterBothRead([
        () => act('hr1', requestId, 'return', '分頁一'),
        () => act('hr1', requestId, 'return', '分頁二'),
      ])

      expect(results.map(res => res.status).sort()).toEqual([200, 409])
      const doc = await load(requestId)
      expect(doc.status).toBe('pending') // 沒有被連退兩關退回申請人
      expect(doc.current_step_index).toBe(0)
      expect(doc.steps[0].approvers.map(a => a.decision)).toEqual(['pending'])
      expect(doc.logs.filter(log => log.action === 'return')).toHaveLength(1)
    })

    it('a double approve by the same person on a step that is not the last one only counts once', async () => {
      const created = await createRequest('a1', threeSteps)
      const requestId = created.body._id

      const results = await raceAfterBothRead([
        () => act('boss', requestId, 'approve'),
        () => act('boss', requestId, 'approve'),
      ])

      expect(results.map(res => res.status).sort()).toEqual([200, 409])
      const doc = await load(requestId)
      expect(doc.current_step_index).toBe(1)
      expect(doc.logs.filter(log => log.action === 'approve')).toHaveLength(1)
    })

    it('still lets 25 approvers of one all-must-approve step sign at the same instant', async () => {
      const keys = Array.from({ length: 25 }, (_, index) => `mass${index}`)
      for (const key of keys) await addPerson(key)
      const made = await makeForm({ name: '二十五人同簽', steps: [userStep(keys)] })
      const created = await createRequest('a1', made)
      expect(created.status).toBe(201)

      const results = await Promise.all(keys.map(key => act(key, created.body._id, 'approve')))

      expect(results.map(res => res.status)).toEqual(Array(25).fill(200))
      const doc = await load(created.body._id)
      expect(doc.status).toBe('approved')
      expect(doc.logs.filter(log => log.action === 'approve')).toHaveLength(25)
    })
  })

  describe('resubmitting a returned request keeps the answers the apply screen cannot edit', () => {
    it('keeps the answer of a field that was deactivated while the request was returned', async () => {
      const made = await makeForm({
        name: '保留舊答案',
        fields: [{ label: '事由', type_1: 'text', required: true }, { label: '附註', type_1: 'text' }],
        steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
      })
      const reasonId = fieldId(made, '事由')
      const noteId = fieldId(made, '附註')
      const created = await createRequest('a2', made, { [reasonId]: '原本的事由', [noteId]: 'a' })
      expect(created.status).toBe(201)
      expect((await act('boss', created.body._id, 'return', '請補充')).status).toBe(200)

      // 管理員在這期間「刪除」事由欄位：因為已有申請單，只是停用
      const removed = await request(app).delete(`/api/approvals/forms/${made.form._id}/fields/${reasonId}`).set(as('admin'))
      expect(removed.status).toBe(200)
      expect(removed.body.deactivated).toBe(true)

      // 申請人的畫面只載入啟用中的欄位，所以只送附註
      const fields = await get('a2', `/api/approvals/forms/${made.form._id}/fields`)
      expect(fields.body.map(field => field.label)).toEqual(['附註'])
      const resubmitted = await post('a2', `/api/approvals/${created.body._id}/resubmit`, { form_data: { [noteId]: 'b' } })

      expect(resubmitted.status).toBe(200)
      const doc = await load(created.body._id)
      expect(doc.status).toBe('pending')
      expect(doc.form_data).toEqual({ [reasonId]: '原本的事由', [noteId]: 'b' })
    })
  })

  describe('annual leave follows the form type and counts hours like payroll and reports', () => {
    let leaveForm
    let generalForm
    let leaveIds

    const fieldsFor = () => [
      { label: '假別', type_1: 'select', options: ['特休假', '病假'], required: true },
      { label: '開始時間', type_1: 'datetime', required: true },
      { label: '結束時間', type_1: 'datetime', required: true },
      { label: '天數', type_1: 'number' },
    ]
    const bossStep = [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }]
    const data = (made, start, end, extra = {}) => ({
      [fieldId(made, '假別')]: '特休假', [fieldId(made, '開始時間')]: start, [fieldId(made, '結束時間')]: end, ...extra,
    })

    beforeAll(async () => {
      leaveForm = await makeForm({ name: '特休時數單', semanticType: 'leave', fields: fieldsFor(), steps: bossStep })
      generalForm = await makeForm({ name: '請假', semanticType: 'general', fields: fieldsFor(), steps: bossStep })
      leaveIds = { days: fieldId(leaveForm, '天數') }
      await addPerson('alHours', { supervisor: people.boss._id, annualLeave: { totalDays: 1, usedDays: 0 } })
      await addPerson('alGeneral', { supervisor: people.boss._id, annualLeave: { totalDays: 1, usedDays: 0 } })
    })

    it('deducts 0.5 day for a 4-hour 特休, refuses 4 hours when only 0.25 day is left, and refunds exactly what was deducted', async () => {
      const fourHours = data(leaveForm, '2099-09-07T01:00:00.000Z', '2099-09-07T05:00:00.000Z') // 台灣 09:00-13:00

      const created = await createRequest('alHours', leaveForm, fourHours)
      expect(created.status).toBe(201)
      expect((await act('boss', created.body._id, 'approve')).status).toBe(200)
      expect((await Employee.findById(id('alHours'))).annualLeave.usedDays).toBe(0.5)
      expect((await load(created.body._id)).annual_leave).toMatchObject({ state: 'deducted', days: 0.5 })

      // 再申請一個上午（0.5 天）剛好用完；第三次就不夠了
      const second = await createRequest('alHours', leaveForm, data(leaveForm, '2099-09-08T01:00:00.000Z', '2099-09-08T05:00:00.000Z'))
      expect(second.status).toBe(201)
      await Employee.updateOne({ _id: people.alHours._id }, { $set: { 'annualLeave.usedDays': 0.75 } })
      const tooMuch = await createRequest('alHours', leaveForm, data(leaveForm, '2099-09-09T01:00:00.000Z', '2099-09-09T05:00:00.000Z'))
      expect(tooMuch.status).toBe(400)
      expect(tooMuch.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remaining: 0.25, requested: 0.5 })
      expect(tooMuch.body.error).toBe('特休餘額不足：剩餘 0.25 天，本次申請 0.5 天')
      await Employee.updateOne({ _id: people.alHours._id }, { $set: { 'annualLeave.usedDays': 0.5 } })

      // 撤回第一張：返還的是記下的 0.5 天
      const withdraw = await post('alHours', `/api/approvals/${created.body._id}/cancel`, { comment: '取消' })
      expect(withdraw.status).toBe(200)
      expect((await Employee.findById(id('alHours'))).annualLeave.usedDays).toBe(0)
      expect((await load(created.body._id)).annual_leave).toMatchObject({ state: 'refunded', days: 0.5 })
    })

    it('keeps whole days as before and lets the 天數 field win over the times', async () => {
      await Employee.updateOne({ _id: people.alHours._id }, { $set: { 'annualLeave.totalDays': 10, 'annualLeave.usedDays': 0 } })

      const threeDays = await createRequest('alHours', leaveForm, data(leaveForm, '2099-10-05T01:00:00.000Z', '2099-10-07T10:00:00.000Z'))
      expect((await act('boss', threeDays.body._id, 'approve')).status).toBe(200)
      expect((await Employee.findById(id('alHours'))).annualLeave.usedDays).toBe(3)

      const filled = await createRequest('alHours', leaveForm, data(leaveForm, '2099-10-12T01:00:00.000Z', '2099-10-12T05:00:00.000Z', { [leaveIds.days]: 1.5 }))
      expect((await act('boss', filled.body._id, 'approve')).status).toBe(200)
      expect((await Employee.findById(id('alHours'))).annualLeave.usedDays).toBe(4.5)
    })

    it('a form named 請假 that an admin explicitly set to 一般 neither checks nor deducts the annual leave balance', async () => {
      const twoDays = data(generalForm, '2099-11-02', '2099-11-03')

      const created = await createRequest('alGeneral', generalForm, twoDays) // 餘額只有 1 天，但這張不是請假單
      expect(created.status).toBe(201)
      expect((await act('boss', created.body._id, 'approve')).status).toBe(200)

      expect((await Employee.findById(id('alGeneral'))).annualLeave.usedDays).toBe(0)
      expect((await load(created.body._id)).annual_leave).toBeUndefined()
      // 同樣的資料換成請假性質的表單就會被餘額擋下
      const asLeave = await createRequest('alGeneral', leaveForm, data(leaveForm, '2099-11-02', '2099-11-03'))
      expect(asLeave.status).toBe(400)
      expect(asLeave.body.code).toBe('ANNUAL_LEAVE_INSUFFICIENT')
    })
  })

  describe('the workflow preview an employee sees before filling the form', () => {
    let preview

    beforeAll(async () => {
      await Employee.updateMany({ _id: { $in: ['hr1', 'hr2', 'hrB'].map(id) } }, { $set: { signTags: ['預覽人資'] } })
      preview = await makeForm({
        name: '流程預覽',
        steps: [
          { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true },
          { approver_type: 'tag', approver_value: '預覽人資', scope_type: 'dept', all_must_approve: false, is_required: true, can_return: true },
          { approver_type: 'tag', approver_value: '沒有人持有的標籤', all_must_approve: true, is_required: true, can_return: true },
          { approver_type: 'role', approver_value: 'R003', all_must_approve: false, is_required: false, can_return: true },
          { approver_type: 'level', approver_value: 'U005', all_must_approve: true, is_required: false, can_return: true },
        ],
      })
    })

    it('counts, per step, the eligible people the step would resolve to for the caller as applicant', async () => {
      const res = await get('a1', `/api/approvals/forms/${preview.form._id}/workflow`)

      expect(res.status).toBe(200)
      expect(res.body.steps.map(step => [step.resolved_count, step.unresolved_reason])).toEqual([
        [1, null], // 直屬主管 boss
        [2, null], // 預覽人資在 a1 的部門：hr1、hr2（hrB 在別的部門）
        [0, '目前沒有在職員工持有「沒有人持有的標籤」標籤'],
        [2, null], // R003：r3a、r3b
        [0, '目前沒有符合此層級的在職員工'],
      ])
      expect(res.body.steps.map(step => step.approver_type)).toEqual(['manager', 'tag', 'tag', 'role', 'level']) // 原本的欄位都還在
    })

    it('resolves for the person who is asking: no department means a department-scoped step has nobody, with the reason', async () => {
      const res = await get('nodept', `/api/approvals/forms/${preview.form._id}/workflow`)

      expect(res.status).toBe(200)
      expect(res.body.steps[1]).toMatchObject({ resolved_count: 0, unresolved_reason: '申請人尚未設定所屬部門' })
      expect(res.body.steps[0]).toMatchObject({ resolved_count: 1, unresolved_reason: null })
    })

    it('answers with counts and reasons only: no name or id of the people it found', async () => {
      const res = await get('a1', `/api/approvals/forms/${preview.form._id}/workflow`)

      const text = JSON.stringify(res.body)
      for (const key of ['boss', 'hr1', 'hr2', 'hrB', 'r3a', 'r3b']) {
        expect(text).not.toContain(`"${key}"`)
        expect(text).not.toContain(id(key))
      }
      res.body.steps.forEach(step => {
        expect(typeof step.resolved_count).toBe('number')
        expect(step.unresolved_reason === null || typeof step.unresolved_reason === 'string').toBe(true)
      })
    })

    it('an employee can read it, and a malformed id gets a Chinese 400 on the template reads', async () => {
      expect((await get('a1', `/api/approvals/forms/${preview.form._id}/workflow`)).status).toBe(200)
      for (const url of ['/api/approvals/forms/zzz/workflow', '/api/approvals/forms/zzz/fields', '/api/approvals/forms/zzz']) {
        const bad = await get('a1', url)
        expect(bad.status).toBe(400)
        expect(bad.body).toEqual({ error: '表單編號格式不正確' })
      }
      const missing = await get('a1', `/api/approvals/forms/${new mongoose.Types.ObjectId()}/workflow`)
      expect(missing.status).toBe(404)
    })
  })

  describe('sign tags stored in an old spelling are healed by the startup migration', () => {
    it('makes the delete-impact check see the same tag holders as the approver resolution', async () => {
      await addPerson('tagNew', { signTags: ['遷移標籤'] })
      await addPerson('tagOld')
      await Employee.collection.updateOne({ _id: people.tagOld._id }, { $set: { signTags: ['遷移標籤 ', '　全形　標籤'] } }) // 舊資料：結尾空白、全形空白
      await makeForm({
        name: '遷移標籤流程',
        steps: [{ approver_type: 'tag', approver_value: '遷移標籤', all_must_approve: true, is_required: true, can_return: true }],
      })

      const { normalizeStoredSignTags } = await import('../src/controllers/employeeController.js')
      expect(await normalizeStoredSignTags()).toBeGreaterThanOrEqual(1)
      expect((await Employee.collection.findOne({ _id: people.tagOld._id })).signTags).toEqual(['遷移標籤', '全形 標籤'])
      expect(await normalizeStoredSignTags()).toBe(0) // 重複執行不會再有變動

      const impact = await post('admin', '/api/employees/delete-impact', { ids: [id('tagNew')] })
      expect(impact.status).toBe(200)
      expect(impact.body.impact.lostTags).toEqual([]) // tagOld 仍持有這個標籤，刪掉 tagNew 不會讓流程找不到人
    })
  })

  describe('employee edits: supervisor rules and the annual leave used days', () => {
    it('refuses a departed supervisor, clears the supervisor with null, and only writes usedDays when it really changed', async () => {
      await addPerson('editee', { supervisor: people.boss._id, annualLeave: { totalDays: 10, usedDays: 3 } })
      await Employee.updateOne({ _id: people.editee._id }, { $set: { 'annualLeave.appliedApprovalRequestIds': ['keep-me'] } })
      const put = (body) => request(app).put(`/api/employees/${id('editee')}`).set(as('admin')).send(body)

      const departed = await put({ supervisor: id('hrLeft') })
      expect(departed.status).toBe(400)
      expect(departed.body.error).toBe('所選的直屬主管已離職、停用或留職停薪，無法擔任簽核人，請重新選擇')
      const self = await put({ supervisor: id('editee') })
      expect(self.status).toBe(400)
      expect((await Employee.findById(id('editee'))).supervisor.toString()).toBe(id('boss'))

      // 整包送出且天數沒變：不碰 usedDays，也不碰已記錄的簽核單
      const unchanged = await put({ annualLeave: { totalDays: 12, usedDays: 3 } })
      expect(unchanged.status).toBe(200)
      let stored = await Employee.findById(id('editee')).select('+annualLeave.appliedApprovalRequestIds')
      expect(stored.annualLeave).toMatchObject({ totalDays: 12, usedDays: 3 })
      expect(Array.from(stored.annualLeave.appliedApprovalRequestIds)).toEqual(['keep-me'])

      const changed = await put({ annualLeave: { usedDays: 1 }, supervisor: null })
      expect(changed.status).toBe(200)
      stored = await Employee.findById(id('editee')).select('+annualLeave.appliedApprovalRequestIds')
      expect(stored.annualLeave.usedDays).toBe(1)
      expect(Array.from(stored.annualLeave.appliedApprovalRequestIds)).toEqual(['keep-me'])
      expect((await Employee.collection.findOne({ _id: people.editee._id })).supervisor).toBeUndefined() // $unset，不是存成 null
    })

    it('an approval that deducts leave between loading and saving the employee is not overwritten by the form that still carries the old days', async () => {
      await addPerson('raceEdit', { annualLeave: { totalDays: 10, usedDays: 3 } })
      const original = Employee.updateOne
      const spy = jest.spyOn(Employee, 'updateOne').mockImplementation(async function updateAfterDeduction(...args) {
        spy.mockRestore() // 只攔第一次（編輯員工的那次寫入）
        await Employee.collection.updateOne({ _id: people.raceEdit._id }, { $inc: { 'annualLeave.usedDays': 1 } }) // 此時簽核通過、剛好扣了 1 天
        return original.apply(this, args)
      })

      const res = await request(app)
        .put(`/api/employees/${id('raceEdit')}`)
        .set(as('admin'))
        .send({ name: 'raceEdit', annualLeave: { totalDays: 12, usedDays: 3 } }) // 舊畫面整包送出，usedDays 還是 3

      spy.mockRestore()
      expect(res.status).toBe(200)
      const stored = await Employee.findById(id('raceEdit'))
      expect(stored.annualLeave.totalDays).toBe(12)
      expect(stored.annualLeave.usedDays).toBe(4) // 扣掉的那 1 天沒有被蓋回 3
    })

    it('set-supervisors checks eligibility for the whole batch and clears with an empty value', async () => {
      await addPerson('subA', { supervisor: people.boss._id })
      const post1 = await post('admin', '/api/employees/set-supervisors', { assignments: [{ employee: id('subA'), supervisor: id('hrLeft') }] })
      expect(post1.status).toBe(400)
      expect(post1.body.error).toMatch(/已離職、停用或留職停薪/)
      expect((await Employee.findById(id('subA'))).supervisor.toString()).toBe(id('boss'))

      const cleared = await post('admin', '/api/employees/set-supervisors', { assignments: [{ employee: id('subA'), supervisor: '' }] })
      expect(cleared.status).toBe(200)
      expect((await Employee.collection.findOne({ _id: people.subA._id })).supervisor).toBeUndefined()
    })
  })

  describe('bulk import update matched by Email only', () => {
    // 官方範本的英文欄位（匯入程式要求全部都在，內容可以空白）加上簽核設定三欄
    const IMPORT_HEADERS = [
      'employeeId', 'name', 'gender', 'idNumber', 'birthDate', 'birthPlace', 'bloodType', 'languages',
      'disabilityLevel', 'identityCategory', 'maritalStatus', 'dependents', 'email', 'mobile', 'landline',
      'householdAddress', 'contactAddress', 'lineId', 'organization', 'department', 'subDepartment',
      'supervisor', 'title', 'practiceTitle', 'status', 'probationDays', 'partTime', 'needClockIn',
      'education_level', 'education_school', 'education_major', 'education_status',
      'education_graduationYear', 'militaryService_type', 'militaryService_branch', 'militaryService_rank',
      'militaryService_dischargeYear', 'emergency1_name', 'emergency1_relation', 'emergency1_phone1',
      'emergency1_phone2', 'emergency2_name', 'emergency2_relation', 'emergency2_phone1',
      'emergency2_phone2', 'hireDate', 'startDate', 'resignationDate', 'dismissalDate', 'rehireStartDate',
      'rehireEndDate', 'appointment_remark', 'salaryType', 'salaryAmount', 'laborPensionSelf',
      'employeeAdvance', 'salaryAccountA_bank', 'salaryAccountA_acct', 'salaryAccountB_bank',
      'salaryAccountB_acct', 'salaryItems', 'annualLeave_totalDays', 'annualLeave_usedDays',
      'annualLeave_accumulatedLeave', 'annualLeave_expiryDate', 'annualLeave_compensatoryHours',
      'laborInsuredSalary', 'pensionInsuredSalary', 'healthInsuredSalary', 'dependentCount',
      'signTags', 'signRole', 'signLevel',
    ]

    async function workbook(row) {
      const book = new ExcelJS.Workbook()
      const sheet = book.addWorksheet('員工資料')
      sheet.addRow(IMPORT_HEADERS)
      sheet.addRow(IMPORT_HEADERS.map(key => ({ employeeId: '員工編號', name: '姓名', email: '電子郵件 (必填唯一)', signTags: '簽核標籤', signRole: '簽核角色', signLevel: '簽核層級' }[key] ?? '')))
      sheet.addRow(IMPORT_HEADERS.map(key => row[key] ?? ''))
      return Buffer.from(await book.xlsx.writeBuffer())
    }

    it('warns about the cleared tags, role and level on this path too, and really clears them', async () => {
      await addPerson('byMail', { employeeId: 'OLD-1', signTags: ['人資', '排班負責人'], signRole: 'R007', signLevel: 'U002', email: 'by-mail@example.test' })
      const buffer = await workbook({ employeeId: 'NEW-99', name: 'byMail', idNumber: 'A123456789', email: 'by-mail@example.test' })

      const res = await request(app)
        .post('/api/employees/bulk-import')
        .set(as('admin'))
        .attach('file', buffer, { filename: 'import.xlsx' })
        .field('options', JSON.stringify({ updateExisting: true }))

      expect({ status: res.status, body: res.body }).toMatchObject({ status: 200 })
      expect(res.body).toMatchObject({ createdCount: 0, updatedCount: 1 })
      expect(res.body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('已清除原有標籤：人資、排班負責人'),
        expect.stringContaining('已清除原有角色：R007'),
        expect.stringContaining('已清除原有層級：U002'),
      ]))
      const stored = await Employee.findById(id('byMail'))
      expect(stored.signTags).toEqual([])
      expect(stored.employeeId).toBe('OLD-1') // 員工編號不會被更新
    })
  })

  describe('default templates: restoring does not hide a deactivated one', () => {
    it('warns that a deactivated default form stays deactivated', async () => {
      const first = await post('admin', '/api/approvals/restore-defaults')
      expect(first.status).toBe(200)
      const certificate = await FormTemplate.findOne({ default_key: 'employment_certificate' })
      expect(certificate).toBeTruthy()
      await FormTemplate.updateOne({ _id: certificate._id }, { $set: { is_active: false } })

      const second = await post('admin', '/api/approvals/restore-defaults')

      expect(second.status).toBe(200)
      expect(second.body.createdCount).toBe(0)
      expect(second.body.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'inactive_template',
          form: '在職證明',
          formId: String(certificate._id),
          message: '「在職證明」目前是停用狀態，員工看不到也無法申請，請到「編輯」重新啟用。',
        }),
      ]))
      expect(second.body.templates.find(item => item.key === 'employment_certificate')).toMatchObject({ isActive: false })
      expect((await FormTemplate.findById(certificate._id)).is_active).toBe(false)
    })
  })

  describe('error hygiene', () => {
    it('answers malformed ids with 400 and never leaks Mongoose messages', async () => {
      for (const url of ['/api/approvals/abc', '/api/approvals/abc/attachments/x.pdf']) {
        const res = await get('a1', url)
        expect(res.status).toBe(400)
        expect(JSON.stringify(res.body)).not.toMatch(/Cast to ObjectId|Mongoose|ApprovalRequest/)
      }
      const act400 = await post('boss', '/api/approvals/abc/act', { decision: 'approve' })
      expect(act400.status).toBe(400)
      const comment400 = await post('boss', `/api/approvals/${new mongoose.Types.ObjectId()}/act`, { decision: 'approve', comment: { a: 1 } })
      expect(comment400.status).toBe(400)
      expect(comment400.body.error).toBe('意見內容格式不正確')
      const badForm = await post('a1', '/api/approvals', { form_id: 'nope', form_data: {} })
      expect(badForm.status).toBe(400)
    })
  })
})
