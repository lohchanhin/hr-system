// 排班頁「相關簽核」的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 預設略過；要執行時指定一個本機的暫用資料庫（和其他整合測試相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27321 npm test -- tests/scheduleRelatedApprovals.integration.test.js
// 只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
// 伺服器時區也會影響日期判斷，要驗證時分別加上 TZ=UTC 與 TZ=Asia/Taipei 各跑一次。
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
    throw new Error('Schedule approvals integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_schedule_approvals_${process.pid}_${Date.now()}`
  return uri.toString()
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
// 獨立於正式程式的台灣日期／月份計算（測試的對照基準）
const taiwanDay = (value) => new Date(new Date(value).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10)
// 台灣時間 YYYY-MM-DD hh:mm 的 UTC ISO 字串（前端日期選擇器送出的格式）
const taiwanIso = (day, hour = 0, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date, hour, minute) - TAIPEI_OFFSET_MS).toISOString()
}
const addMonths = (month, delta) => {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

describeIntegration('schedule related approvals against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let FormTemplate
  let FormField
  let ApprovalWorkflow
  let ApprovalRequest
  let ShiftSchedule
  let AttendanceSetting
  let resetLeaveFieldCache
  const people = {}
  const forms = {}
  const DEPT_A = new mongoose.Types.ObjectId()
  const DEPT_B = new mongoose.Types.ObjectId()
  const SUB_A = new mongoose.Types.ObjectId()
  const MONTH = taiwanDay(new Date()).slice(0, 7)
  const day = (n) => `${MONTH}-${String(n).padStart(2, '0')}`

  const secret = 'integration-test-secret-integration-test-secret'
  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const get = (key, url) => request(app).get(url).set(as(key))
  const post = (key, url, body) => request(app).post(url).set(as(key)).send(body ?? {})
  const id = (key) => String(people[key]._id)
  const listUrl = (month, query = '') => `/api/schedules/leave-approvals?month=${month}${query}`

  async function addPerson(key, patch = {}) {
    people[key] = await Employee.create({
      name: key,
      email: `${key}@example.test`,
      username: key,
      role: 'employee',
      organization: 'org-1',
      ...patch,
    })
    return people[key]
  }

  async function makeForm(key, { name, semanticType = 'general', fields, steps }) {
    const form = await FormTemplate.create({ name, semanticType, semantic_type_set: true, is_active: true })
    const made = { form, fields: {} }
    for (const [index, field] of fields.entries()) {
      const created = await FormField.create({ form: form._id, order: index + 1, ...field })
      made.fields[field.label] = String(created._id)
    }
    made.workflow = await ApprovalWorkflow.create({
      form: form._id,
      steps: steps.map((step, index) => ({ step_order: index + 1, ...step })),
    })
    forms[key] = made
    resetLeaveFieldCache()
    return made
  }

  // 直接寫入資料庫（不經送件流程）：任意狀態、任意申請日
  async function insertRequest(formKey, personKey, { status = 'pending', data = {}, createdAt = new Date() } = {}) {
    const made = forms[formKey]
    const form_data = Object.fromEntries(Object.entries(data).map(([label, value]) => [made.fields[label], value]))
    const doc = await ApprovalRequest.create({
      form: made.form._id,
      workflow: made.workflow._id,
      applicant_employee: people[personKey]._id,
      applicant_department: people[personKey].department ? String(people[personKey].department) : undefined,
      form_data,
      status,
      steps: [{ step_order: 1, approvers: [{ approver: people.boss2._id, decision: status === 'approved' ? 'approved' : 'pending' }], all_must_approve: true }],
      createdAt,
    })
    return String(doc._id)
  }

  // 經由真的 API 送件
  async function fileRequest(formKey, personKey, data) {
    const made = forms[formKey]
    const form_data = Object.fromEntries(Object.entries(data).map(([label, value]) => [made.fields[label], value]))
    const res = await post(personKey, '/api/approvals', { form_id: String(made.form._id), form_data })
    if (res.status !== 201) throw new Error(`送件失敗 ${formKey}/${personKey}: ${res.status} ${JSON.stringify(res.body)}`)
    return String(res.body._id)
  }

  const idsOf = (res) => res.body.approvals.map((item) => item._id)

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
    ;({ default: ShiftSchedule } = await import('../src/models/ShiftSchedule.js'))
    ;({ default: AttendanceSetting } = await import('../src/models/AttendanceSetting.js'))
    ;({ resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js'))
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all([Employee.syncIndexes(), FormTemplate.syncIndexes(), ApprovalRequest.syncIndexes()])

    await addPerson('admin', { role: 'admin' })
    await addPerson('boss', { role: 'supervisor', department: DEPT_A })
    await addPerson('boss2', { role: 'supervisor', department: DEPT_B })
    await addPerson('sha', { name: '沙俊宇', supervisor: people.boss._id, department: DEPT_A, subDepartment: SUB_A })
    await addPerson('wang', { name: '王小明', supervisor: people.boss._id, department: DEPT_B })
    await addPerson('outsider', { name: '外部員工', supervisor: people.boss2._id, department: DEPT_B })

    const managerStep = [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }]
    const bossTwoStep = [{ approver_type: 'user', approver_value: [people.boss2._id], all_must_approve: true, is_required: true, can_return: true }]
    await makeForm('leave', {
      name: '(全)假別申請單',
      semanticType: 'leave',
      steps: managerStep,
      fields: [
        { label: '假別', type_1: 'select', required: true, options: ['特休', '事假', '病假'] },
        { label: '開始時間', type_1: 'datetime', required: true },
        { label: '結束時間', type_1: 'datetime', required: true },
        { label: '事由', type_1: 'text' },
      ],
    })
    await makeForm('overtime', {
      name: '加班申請',
      semanticType: 'overtime',
      steps: bossTwoStep,
      fields: [
        { label: '開始時間', type_1: 'datetime', required: true },
        { label: '結束時間', type_1: 'datetime', required: true },
        { label: '是否跨日', type_1: 'checkbox' },
        { label: '事由', type_1: 'textarea' },
      ],
    })
    await makeForm('support', {
      name: '支援申請',
      steps: bossTwoStep,
      fields: [
        { label: '申請事由', type_1: 'textarea', required: true },
        { label: '日期(起)', type_1: 'date' },
        { label: '日期(迄)', type_1: 'date' },
      ],
    })
    await makeForm('keep', {
      name: '特休保留',
      steps: bossTwoStep,
      fields: [
        { label: '年度', type_1: 'text' },
        { label: '理由', type_1: 'textarea' },
      ],
    })
    await makeForm('bonus', {
      name: '獎金申請',
      steps: bossTwoStep,
      fields: [
        { label: '獎金類型', type_1: 'text' },
        { label: '金額', type_1: 'number' },
        { label: '事由', type_1: 'textarea' },
      ],
    })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('the list, end to end', () => {
    let shaLeave
    let shaOvertime
    let wangSupport
    let outsiderLeave
    const inserted = {}

    beforeAll(async () => {
      // 加班申請必須先有當日班表
      const setting = await AttendanceSetting.create({
        shifts: [{ name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 }],
      })
      await ShiftSchedule.create({
        employee: people.sha._id,
        date: new Date(`${day(14)}T00:00:00.000Z`),
        shiftId: setting.shifts[0]._id,
        department: DEPT_A,
      })

      // 經由真的 API 送件，再由主管核准：沙俊宇的請假（本月 12～13 日）
      shaLeave = await fileRequest('leave', 'sha', {
        假別: '事假',
        開始時間: taiwanIso(day(12)),
        結束時間: taiwanIso(day(13)),
        事由: '家中有事',
      })
      const approved = await post('boss', `/api/approvals/${shaLeave}/act`, { decision: 'approve' })
      expect(approved.status).toBe(200)
      expect((await ApprovalRequest.findById(shaLeave).lean()).status).toBe('approved')

      shaOvertime = await fileRequest('overtime', 'sha', {
        開始時間: taiwanIso(day(14), 18),
        結束時間: taiwanIso(day(14), 21),
        事由: '病房交班延遲',
      })
      wangSupport = await fileRequest('support', 'wang', { 申請事由: '支援急診', '日期(起)': day(20), '日期(迄)': day(21) })
      outsiderLeave = await fileRequest('leave', 'outsider', {
        假別: '病假',
        開始時間: taiwanIso(day(12)),
        結束時間: taiwanIso(day(12)),
      })

      inserted.keepReturned = await insertRequest('keep', 'sha', { status: 'returned', data: { 年度: '2026', 理由: '年底前無法休完' } })
      inserted.bonusRejected = await insertRequest('bonus', 'wang', { status: 'rejected', data: { 獎金類型: '年終', 金額: 5000, 事由: '績效優良' } })
      inserted.bonusCanceled = await insertRequest('bonus', 'wang', { status: 'canceled', data: { 獎金類型: '全勤', 金額: 800 } })
      inserted.pendingLeave = await insertRequest('leave', 'wang', {
        status: 'pending',
        data: { 假別: '特休', 開始時間: taiwanIso(day(25)), 結束時間: taiwanIso(day(26)) },
      })
      inserted.rejectedLeave = await insertRequest('leave', 'sha', {
        status: 'rejected',
        data: { 假別: '病假', 開始時間: taiwanIso(day(5)), 結束時間: taiwanIso(day(5)) },
      })
    })

    it('shows the administrator every form type and status, and the client-readable shape (applicant_employee._id)', async () => {
      const res = await get('admin', listUrl(MONTH))

      expect(res.status).toBe(200)
      expect(res.headers['x-approvals-truncated']).toBeUndefined()
      const byId = Object.fromEntries(res.body.approvals.map((item) => [item._id, item]))
      expect(Object.keys(byId).sort()).toEqual([
        shaLeave, shaOvertime, wangSupport, outsiderLeave, ...Object.values(inserted),
      ].sort())
      res.body.approvals.forEach((item) => {
        expect(item.applicant_employee._id).toBe(item.employee._id)
        expect(item.applicant_employee.name).toBeTruthy()
        expect(item.form._id).toBeTruthy()
        expect(typeof item.isLeave).toBe('boolean')
      })
      expect(new Set(res.body.approvals.map((item) => item.status))).toEqual(new Set(['approved', 'pending', 'rejected', 'returned', 'canceled']))
      expect(byId[shaLeave]).toEqual(expect.objectContaining({
        isLeave: true,
        leaveType: '事假',
        status: 'approved',
        startDate: taiwanIso(day(12)),
        endDate: taiwanIso(day(13)),
        noteSummary: '家中有事',
        form: expect.objectContaining({ name: '(全)假別申請單', semanticType: 'leave' }),
      }))
      expect(byId[shaOvertime]).toEqual(expect.objectContaining({
        isLeave: false,
        status: 'pending',
        startDate: taiwanIso(day(14), 18),
        endDate: taiwanIso(day(14), 21),
        noteSummary: '病房交班延遲',
        form: expect.objectContaining({ name: '加班申請', semanticType: 'overtime' }),
      }))
      expect(byId[wangSupport]).toEqual(expect.objectContaining({ startDate: day(20), endDate: day(21), noteSummary: '支援急診' }))
      expect(byId[inserted.keepReturned]).toEqual(expect.objectContaining({ status: 'returned', noteSummary: '年底前無法休完' }))
      expect(byId[inserted.keepReturned]).not.toHaveProperty('startDate')
      expect(byId[inserted.bonusCanceled]).not.toHaveProperty('noteSummary')
      // 日曆（leaves[]）仍只有核准的請假：沙俊宇那張
      expect(res.body.leaves.map((leave) => [String(leave.employee._id), leave.leaveType, leave.status])).toEqual([[id('sha'), '事假', 'approved']])
    })

    it('shows a supervisor the requests of the direct reports only, and refuses an employee outside the scope', async () => {
      const res = await get('boss', listUrl(MONTH, `&supervisor=${id('boss')}`))

      expect(res.status).toBe(200)
      const applicants = new Set(res.body.approvals.map((item) => item.applicant_employee.name))
      expect(applicants).toEqual(new Set(['沙俊宇', '王小明']))
      expect(idsOf(res)).not.toContain(outsiderLeave)
      expect(idsOf(res)).toEqual(expect.arrayContaining([shaLeave, shaOvertime, wangSupport, ...Object.values(inserted)]))

      const refused = await get('boss', listUrl(MONTH, `&employee=${id('outsider')}`))
      expect(refused.status).toBe(403)
    })

    it('shows a plain employee their own requests only', async () => {
      const res = await get('sha', listUrl(MONTH))

      expect(res.status).toBe(200)
      expect(new Set(res.body.approvals.map((item) => item.applicant_employee.name))).toEqual(new Set(['沙俊宇']))
      expect(idsOf(res)).toEqual(expect.arrayContaining([shaLeave, shaOvertime, inserted.keepReturned, inserted.rejectedLeave]))
      expect((await get('sha', listUrl(MONTH, `&employee=${id('wang')}`))).status).toBe(403)
    })

    it('lists every approval the 我已簽核 tab shows for the same employees (the reported symptom: the section stayed empty)', async () => {
      const signedByBoss = await get('boss', '/api/approvals/history')
      expect(signedByBoss.status).toBe(200)
      const signedIds = signedByBoss.body.map((item) => item._id)
      expect(signedIds).toContain(shaLeave)
      const bossList = await get('boss', listUrl(MONTH, `&supervisor=${id('boss')}`))
      signedIds.forEach((signedId) => expect(idsOf(bossList)).toContain(signedId))

      // 管理員的 我已簽核 看得到所有人的單；排班頁（不限範圍）也都列得出來
      const adminHistory = await get('admin', '/api/approvals/history')
      const adminList = await get('admin', listUrl(MONTH))
      adminHistory.body.forEach((item) => expect(idsOf(adminList)).toContain(item._id))
    })

    it('narrows the list by department and sub department like the calendar does', async () => {
      const byDepartment = await get('admin', listUrl(MONTH, `&department=${DEPT_A}`))
      expect(new Set(byDepartment.body.approvals.map((item) => item.applicant_employee.name))).toEqual(new Set(['沙俊宇']))

      const bySub = await get('admin', listUrl(MONTH, `&department=${DEPT_A}&subDepartment=${SUB_A}`))
      expect(new Set(bySub.body.approvals.map((item) => item.applicant_employee.name))).toEqual(new Set(['沙俊宇']))

      const otherDepartment = await get('boss', listUrl(MONTH, `&supervisor=${id('boss')}&department=${DEPT_B}`))
      expect(new Set(otherDepartment.body.approvals.map((item) => item.applicant_employee.name))).toEqual(new Set(['王小明']))
    })

    it('lets the supervisor open a report\'s request read-only, and keeps everyone outside the scope at 404', async () => {
      // 沙俊宇的加班單簽核人是 boss2，不是 boss
      const asBoss = await get('boss', `/api/approvals/${shaOvertime}`)
      expect(asBoss.status).toBe(200)
      expect(asBoss.body.viewer).toEqual({ is_applicant: false, can_act: false, can_override: false })
      expect(asBoss.body.form.name).toBe('加班申請')

      expect((await get('boss', `/api/approvals/${outsiderLeave}`)).status).toBe(404)
      expect((await get('wang', `/api/approvals/${shaOvertime}`)).status).toBe(404)
      expect((await get('sha', `/api/approvals/${shaOvertime}`)).status).toBe(200)
      const asAdmin = await get('admin', `/api/approvals/${shaOvertime}`)
      expect(asAdmin.status).toBe(200)
      expect(asAdmin.body.viewer.can_override).toBe(true)
    })

    it('does not give the read-only supervisor any right to act, cancel or resubmit', async () => {
      const act = await post('boss', `/api/approvals/${shaOvertime}/act`, { decision: 'approve' })
      expect(act.status).toBe(404)
      const cancel = await post('boss', `/api/approvals/${shaOvertime}/cancel`, {})
      expect(cancel.status).toBe(404)
      const resubmit = await post('boss', `/api/approvals/${inserted.keepReturned}/resubmit`, {})
      expect(resubmit.status).toBe(404)
      const persisted = await ApprovalRequest.findById(shaOvertime).lean()
      expect(persisted.status).toBe('pending')
      expect((await ApprovalRequest.findById(inserted.keepReturned).lean()).status).toBe('returned')
    })

    it('lists a request of a deleted form, and an administrator can still open it', async () => {
      const orphanId = await insertRequest('keep', 'sha', { status: 'pending', data: { 理由: '表單之後被刪除' } })
      const doomed = await FormTemplate.create({ name: '會被刪除的表單', semanticType: 'general', is_active: true })
      const workflow = await ApprovalWorkflow.create({ form: doomed._id, steps: [{ step_order: 1, approver_type: 'user', approver_value: [people.boss2._id] }] })
      const doomedRequest = await ApprovalRequest.create({
        form: doomed._id,
        workflow: workflow._id,
        applicant_employee: people.sha._id,
        status: 'pending',
        steps: [{ step_order: 1, approvers: [{ approver: people.boss2._id, decision: 'pending' }] }],
      })
      await FormTemplate.deleteOne({ _id: doomed._id })

      const res = await get('boss', listUrl(MONTH, `&supervisor=${id('boss')}`))
      const orphan = res.body.approvals.find((item) => item._id === String(doomedRequest._id))
      expect(orphan.form).toEqual({ _id: String(doomed._id), name: '（表單已刪除）', category: '', semanticType: 'general' })
      expect(idsOf(res)).toContain(orphanId)
      const detail = await get('boss', `/api/approvals/${doomedRequest._id}`)
      expect(detail.status).toBe(200)
      expect(detail.body.form.name).toBe('（表單已刪除）')
    })
  })

  describe('month relevance against the database pre-filter', () => {
    // 對照基準：不看正式程式，直接依規則算出哪些單據該出現在清單
    const expectedFor = (month, docs) => docs.filter((doc) => {
      if (doc.from || doc.to) {
        const from = taiwanDay(doc.from || doc.to)
        const to = taiwanDay(doc.to || doc.from)
        return from < `${addMonths(month, 1)}-01` && to >= `${month}-01`
      }
      return taiwanDay(doc.createdAt).slice(0, 7) === month || ['pending', 'returned'].includes(doc.status)
    }).map((doc) => doc.id)

    it('lists exactly the requests the rules call for, whatever form, status, filing month or date format', async () => {
      const VIEW = addMonths(MONTH, 7)
      const created = (offsetMonths, dayOfMonth, hour) => new Date(taiwanIso(`${addMonths(VIEW, offsetMonths)}-${String(dayOfMonth).padStart(2, '0')}`, hour))
      const statuses = ['pending', 'approved', 'rejected', 'returned', 'canceled']
      // 固定種子的簡單亂數，讓失敗可以重現
      let seed = 20260709
      const rand = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % max }

      const plans = [
        { form: 'leave', start: '開始時間', end: '結束時間', iso: true, data: { 假別: '事假' } },
        { form: 'overtime', start: '開始時間', end: '結束時間', iso: true, data: {} },
        { form: 'support', start: '日期(起)', end: '日期(迄)', iso: false, data: { 申請事由: '支援' } },
        { form: 'keep', data: { 理由: '保留' } },
        { form: 'bonus', data: { 獎金類型: '年終', 事由: '績效' } },
      ]
      for (let index = 0; index < 90; index += 1) {
        const plan = plans[rand(plans.length)]
        const status = statuses[rand(statuses.length)]
        const person = ['sha', 'wang'][rand(2)]
        const createdAt = created(rand(5) - 3, 1 + rand(28), rand(24))
        const data = { ...plan.data }
        // 約三分之二的單有日期；日期落在前後各三個月內，含跨月的長區間
        if (plan.start && rand(3) > 0) {
          const [year, month] = addMonths(VIEW, rand(7) - 3).split('-').map(Number)
          const startMs = Date.UTC(year, month - 1, 1 + rand(28))
          const length = rand(4) === 0 ? 20 + rand(15) : rand(3)
          const startKey = new Date(startMs).toISOString().slice(0, 10)
          const endKey = new Date(startMs + length * 86400000).toISOString().slice(0, 10)
          data[plan.start] = plan.iso ? taiwanIso(startKey, rand(24)) : startKey
          data[plan.end] = plan.iso ? taiwanIso(endKey, rand(24)) : endKey
        }
        await insertRequest(plan.form, person, { status, data, createdAt })
      }

      // 資料庫裡沙俊宇與王小明所有的單（含前面測試建立的）：從存的欄位答案讀出日期，套用規則
      const dateLabels = { leave: ['開始時間', '結束時間'], overtime: ['開始時間', '結束時間'], support: ['日期(起)', '日期(迄)'] }
      const formKeyById = Object.fromEntries(Object.entries(forms).map(([key, made]) => [String(made.form._id), key]))
      const all = await ApprovalRequest.find({ applicant_employee: { $in: [people.sha._id, people.wang._id] } }).lean()
      const docs = all.map((doc) => {
        const labels = dateLabels[formKeyById[String(doc.form)]]
        return {
          id: String(doc._id),
          status: doc.status,
          createdAt: doc.createdAt,
          from: labels ? doc.form_data?.[forms[formKeyById[String(doc.form)]].fields[labels[0]]] : undefined,
          to: labels ? doc.form_data?.[forms[formKeyById[String(doc.form)]].fields[labels[1]]] : undefined,
        }
      })
      expect(docs.length).toBeGreaterThan(90)

      for (const month of [addMonths(VIEW, -1), VIEW, addMonths(VIEW, 1), addMonths(VIEW, -4)]) {
        const res = await get('boss', listUrl(month, `&supervisor=${id('boss')}`))
        expect(res.status).toBe(200)
        const expected = expectedFor(month, docs)
        expect(expected.length).toBeGreaterThan(0)
        expect(idsOf(res).sort()).toEqual(expected.sort())
      }
    })

    it('keeps the 500 cap and marks the truncation, newest first', async () => {
      await addPerson('capper', { supervisor: people.boss._id, department: DEPT_A })
      const CAP_MONTH = addMonths(MONTH, 30)
      const base = new Date(taiwanIso(`${CAP_MONTH}-20`, 12)).getTime()
      const batch = Array.from({ length: 520 }, (_, index) => ({
        form: forms.keep.form._id,
        workflow: forms.keep.workflow._id,
        applicant_employee: people.capper._id,
        status: 'approved',
        form_data: { [forms.keep.fields['理由']]: `第 ${index} 筆` },
        steps: [{ step_order: 1, approvers: [{ approver: people.boss2._id, decision: 'approved' }] }],
        createdAt: new Date(base - index * 60000),
        updatedAt: new Date(base - index * 60000),
      }))
      const stored = await ApprovalRequest.insertMany(batch, { timestamps: false })

      const res = await get('admin', listUrl(CAP_MONTH, `&employee=${id('capper')}`))
      expect(res.status).toBe(200)
      expect(res.body.approvals).toHaveLength(500)
      expect(res.headers['x-approvals-truncated']).toBe('true')
      expect(res.body.approvals[0].noteSummary).toBe('第 0 筆')
      expect(res.body.approvals[499].noteSummary).toBe('第 499 筆')

      // 剛好 500 筆：不算被截斷
      await ApprovalRequest.deleteMany({ _id: { $in: stored.slice(500).map((doc) => doc._id) } })
      const exact = await get('admin', listUrl(CAP_MONTH, `&employee=${id('capper')}`))
      expect(exact.body.approvals).toHaveLength(500)
      expect(exact.headers['x-approvals-truncated']).toBeUndefined()
    })
  })
})
