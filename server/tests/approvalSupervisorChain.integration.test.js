// 主管鏈、請假長度條件、略過重複簽核人、流程試算的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// 依客戶「迦南體系簽核權限」的設定（docs/approval-supervisor-chain.md）：一張請假單，
//   第1關 主管鏈到「一般假單決行」為止、必簽；第2關 主管鏈到「長假決行」為止、請假滿 56 小時才需要、非必簽。
// 同時確認沒有用到新設定的流程（申請者的主管 + 標籤 人資）、已經送出的單據和以前一樣。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27726 npm test -- tests/approvalSupervisorChain.integration.test.js
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
    throw new Error('Supervisor chain integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_supervisor_chain_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('主管鏈與請假長度條件 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let models
  const people = {}
  const secret = 'integration-test-secret-integration-test-secret-chain'
  let chainLeave
  let plainLeave

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
  const keyOf = (employeeId) => Object.keys(people).find(key => id(key) === String(employeeId))
  const fieldOf = (made, label) => String(made.fields.find(field => field.label === label)._id)
  const leaveData = (made, { start, end, hours, type = '病假' }) => ({
    [fieldOf(made, '假別')]: type,
    [fieldOf(made, '開始日期')]: start,
    [fieldOf(made, '結束日期')]: end,
    [fieldOf(made, '時數')]: hours,
    [fieldOf(made, '事由')]: '家中有事',
  })
  const ONE_DAY = { start: '2026-11-09', end: '2026-11-09', hours: 8 }
  const SIX_AND_HALF = { start: '2026-11-16', end: '2026-11-22', hours: 52 }
  const SEVEN = { start: '2026-11-23', end: '2026-11-29', hours: 56 }
  const file = (key, made, leave) => post(key, '/api/approvals', { form_id: String(made.form._id), form_data: leaveData(made, leave) })
  const load = (requestId) => models.ApprovalRequest.findById(requestId).lean()
  const chainOf = (doc) => doc.steps.map(step => step.approvers.map(item => keyOf(item.approver)).join('+'))
  const act = (key, requestId, decision, comment = '') => post(key, `/api/approvals/${requestId}/act`, { decision, comment })

  async function addPerson(key, patch = {}) {
    people[key] = await models.Employee.create({
      name: key, employeeId: key.toUpperCase(), email: `${key}@example.test`, username: key, role: 'employee', organization: 'org-1', ...patch,
    })
    return people[key]
  }

  async function makeForm(name, semanticType, steps) {
    const form = await models.FormTemplate.create({ name, semanticType, is_active: true })
    const fields = []
    const specs = [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number', required: true },
      { label: '事由', type_1: 'text' },
    ]
    for (const [index, field] of specs.entries()) fields.push(await models.FormField.create({ form: form._id, order: index + 1, ...field }))
    await models.ApprovalWorkflow.create({ form: form._id, steps })
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
      FormTemplate: (await import('../src/models/form_template.js')).default,
      FormField: (await import('../src/models/form_field.js')).default,
      ApprovalWorkflow: (await import('../src/models/approval_workflow.js')).default,
      ApprovalRequest: (await import('../src/models/approval_request.js')).default,
      ShiftSchedule: (await import('../src/models/ShiftSchedule.js')).default,
      AttendanceSetting: (await import('../src/models/AttendanceSetting.js')).default,
    }
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(models).map(model => model.syncIndexes()))

    await addPerson('admin', { role: 'admin' })
    await addPerson('vp', { role: 'supervisor', signTags: ['長假決行'] })
    await addPerson('adminVp', { role: 'supervisor', signTags: ['一般假單決行', '長假決行'] })
    await addPerson('director', { role: 'supervisor', signTags: ['一般假單決行'], supervisor: people.vp._id })
    await addPerson('head', { role: 'supervisor', supervisor: people.director._id })
    await addPerson('nurse', { supervisor: people.head._id })
    await addPerson('nurse2', { supervisor: people.head._id })
    await addPerson('dietitian', { role: 'supervisor', signTags: ['一般假單決行'], supervisor: people.director._id })
    await addPerson('cook', { supervisor: people.dietitian._id })
    await addPerson('lead', { role: 'supervisor', supervisor: people.adminVp._id })
    await addPerson('clerk', { supervisor: people.lead._id })
    await addPerson('hr', { signTags: ['人資'] })

    chainLeave = await makeForm('請假', 'leave', [])
    plainLeave = await makeForm('請假（舊流程）', 'leave', [
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ])
    resetLeaveFieldCache()
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('lets the administrator configure the customer workflow through the API, and only the administrator', async () => {
    const steps = [
      { step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行', maxLevels: 5 }, is_required: true },
      { step_order: 2, approver_type: 'manager_chain', approver_value: { stopAtTag: '長假決行', maxLevels: 5 }, is_required: false, condition: { kind: 'leave_hours_gte', value: 56 } },
    ]
    expect((await put('head', `/api/approvals/forms/${chainLeave.form._id}/workflow`, { steps })).status).toBe(403)

    const saved = await put('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow`, { steps })
    expect(saved.status).toBe(200)
    expect(saved.body.steps.map(step => [step.approver_type, step.approver_value, step.condition ?? null])).toEqual([
      ['manager_chain', { stopAtTag: '一般假單決行', maxLevels: 5 }, null],
      ['manager_chain', { stopAtTag: '長假決行', maxLevels: 5 }, { kind: 'leave_hours_gte', value: 56 }],
    ])
    expect(saved.body.policy.skipRepeatedApprovers).toBe(false)

    const refused = await put('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow`, { steps: [steps[1]] })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toContain('至少要有一關沒有條件')
  })

  it('gives a nurse 護理長 → 主任 for 1 and 6.5 days, and adds 醫療副院長 automatically from 56 hours', async () => {
    const short = await file('nurse', chainLeave, ONE_DAY)
    expect(short.status).toBe(201)
    const shortDoc = await load(short.body._id)
    expect(chainOf(shortDoc)).toEqual(['head', 'director'])
    expect(shortDoc.steps.map(step => step.name)).toEqual(['第1級主管', '第2級主管'])
    expect(shortDoc.logs.map(log => log.message)).toContain('第2關不適用（請假未滿 56 小時，本次 8 小時）')

    const almost = await load((await file('nurse', chainLeave, SIX_AND_HALF)).body._id)
    expect(chainOf(almost)).toEqual(['head', 'director'])
    expect(almost.logs.find(log => log.action === 'step_not_applicable').message).toBe('第2關不適用（請假未滿 56 小時，本次 52 小時）')

    const seven = await file('nurse', chainLeave, SEVEN)
    expect(seven.status).toBe(201)
    const sevenDoc = await load(seven.body._id)
    expect(chainOf(sevenDoc)).toEqual(['head', 'director', 'vp'])
    expect(sevenDoc.steps.map(step => [step.name, step.is_required])).toEqual([['第1級主管', true], ['第2級主管', true], ['第3級主管', false]])
    expect(sevenDoc.logs.find(log => log.action === 'skip_repeated_approver').message)
      .toBe('第2關（主管鏈，到「長假決行」為止）略過已是前面關卡簽核人的head（HEAD）（第1級主管）、director（DIRECTOR）（第2級主管）')
  })

  it('stops the kitchen at the dietitian, and walks 營養師 → 主任 → 醫療副院長 for 7 days', async () => {
    expect(chainOf(await load((await file('cook', chainLeave, ONE_DAY)).body._id))).toEqual(['dietitian'])
    expect(chainOf(await load((await file('cook', chainLeave, SEVEN)).body._id))).toEqual(['dietitian', 'director', 'vp'])
  })

  it('keeps 總務 → 組長 → 行政副院長 for 7 days too (the long-leave level is already in the chain)', async () => {
    const doc = await load((await file('clerk', chainLeave, SEVEN)).body._id)
    expect(chainOf(doc)).toEqual(['lead', 'adminVp'])
    expect(doc.logs.find(log => log.action === 'skip_repeated_approver').message).toContain('這一關略過')
  })

  it('sends the leave of a top manager without a supervisor to the system administrators (R5 fallback)', async () => {
    const doc = await load((await file('vp', chainLeave, SEVEN)).body._id)
    expect(chainOf(doc)).toEqual(['admin'])
    expect(doc.steps[0]).toMatchObject({ all_must_approve: false, fallback: { reason: 'no-supervisor', source: 'admins' } })
    expect(doc.logs.map(log => log.action)).toContain('approver_fallback')
    // 第2關（選填的主管鏈）也沒有主管：不放進單據，紀錄寫明
    expect(doc.logs.map(log => log.message)).toContain('第2關（主管鏈，到「長假決行」為止）沒有可簽核的主管（申請人尚未設定直屬主管），這一關略過')
  })

  it('walks a 7-day request to the end, with the level names in the detail and in the history', async () => {
    const created = await file('nurse2', chainLeave, SEVEN)
    const requestId = created.body._id
    for (const key of ['head', 'director', 'vp']) {
      const res = await act(key, requestId, 'approve', `${key} 同意`)
      expect(res.status).toBe(200)
    }
    const doc = await load(requestId)
    expect(doc.status).toBe('approved')

    const detail = await get('nurse2', `/api/approvals/${requestId}`)
    expect(detail.body.steps.map(step => step.name)).toEqual(['第1級主管', '第2級主管', '第3級主管'])

    const history = await get('vp', '/api/approvals/history?page=1&limit=50')
    const item = history.body.items.find(row => String(row._id) === String(requestId))
    expect(item.my_approvals).toEqual([expect.objectContaining({ step_order: 3, step_name: '第3級主管', decision: 'approved' })])
  })

  it('re-evaluates the condition when a returned 6.5-day request is resubmitted as 7 days', async () => {
    const created = await file('nurse2', chainLeave, { start: '2026-12-07', end: '2026-12-13', hours: 52 })
    const requestId = created.body._id
    expect(chainOf(await load(requestId))).toEqual(['head', 'director'])
    expect((await act('head', requestId, 'return', '請改成 7 日')).status).toBe(200)
    expect((await load(requestId)).status).toBe('returned')

    const resubmitted = await post('nurse2', `/api/approvals/${requestId}/resubmit`, {
      form_data: leaveData(chainLeave, { start: '2026-12-07', end: '2026-12-13', hours: 56 }),
      comment: '改成 7 日',
    })
    expect(resubmitted.status).toBe(200)
    const doc = await load(requestId)
    expect(doc.status).toBe('pending')
    expect(chainOf(doc)).toEqual(['head', 'director', 'vp'])
    const actions = doc.logs.map(log => log.action)
    expect(actions.indexOf('step_not_applicable')).toBeLessThan(actions.indexOf('resubmit'))
    expect(actions.lastIndexOf('skip_repeated_approver')).toBeGreaterThan(actions.indexOf('resubmit'))
  })

  it('skips an inactive 護理長 and goes on to 主任, with a note on the step', async () => {
    await models.Employee.updateOne({ _id: people.head._id }, { $set: { status: '留職停薪' } })
    try {
      const doc = await load((await file('nurse2', chainLeave, { start: '2026-12-21', end: '2026-12-21', hours: 8 })).body._id)
      expect(chainOf(doc)).toEqual(['director'])
      expect(doc.steps[0]).toMatchObject({ name: '第2級主管', note: '已略過留職停薪的head（HEAD）（第1級主管），改由上一級主管簽核' })
    } finally {
      await models.Employee.updateOne({ _id: people.head._id }, { $set: { status: '正職員工' } })
    }
  })

  it('shows the levels and the condition in the preview, without names', async () => {
    const res = await get('nurse', `/api/approvals/forms/${chainLeave.form._id}/workflow`)
    expect(res.status).toBe(200)
    expect(res.body.steps[0].chain_levels.map(level => level.label)).toEqual(['第1級主管', '第2級主管'])
    expect(res.body.steps[1]).toMatchObject({ condition_text: '請假滿 56 小時才需要', repeated_count: 2 })
    expect(res.body.steps[1].chain_levels.map(level => [level.label, level.repeated])).toEqual([['第1級主管', true], ['第2級主管', true], ['第3級主管', false]])
    expect(JSON.stringify(res.body)).not.toContain('HEAD')
  })

  it('lets the administrator try the workflow for any employee with names, and nobody else', async () => {
    expect((await get('head', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('cook')}&start=2026-11-23&end=2026-11-29`)).status).toBe(403)

    const trial = await get('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('cook')}&start=2026-11-23&end=2026-11-29`)
    expect(trial.status).toBe(200)
    expect(trial.body).toMatchObject({ ok: true, error: null, leave: { hours: 56, calendarDays: 7, scheduledDays: 7, scheduledNote: '期間沒有班表，以日曆日計算' } })
    expect(trial.body.steps.map(step => [step.name, step.approvers.map(person => person.employeeId).join('+'), step.source_position])).toEqual([
      ['第1級主管', 'DIETITIAN', 1],
      ['第2級主管', 'DIRECTOR', 2],
      ['第3級主管', 'VP', 2],
    ])
    expect(trial.body.workflow[1]).toMatchObject({ condition_text: '請假滿 56 小時才需要', condition_applies: true, included: true })
    expect(trial.body.workflow[1].chain.levels.map(level => [level.label, level.approver.employeeId, level.repeated])).toEqual([
      ['第1級主管', 'DIETITIAN', true], ['第2級主管', 'DIRECTOR', false], ['第3級主管', 'VP', false],
    ])

    const short = await get('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('cook')}&start=2026-11-16&end=2026-11-22&hours=52`)
    expect(short.body.steps.map(step => step.approvers[0].employeeId)).toEqual(['DIETITIAN'])
    expect(short.body.workflow[1]).toMatchObject({ included: false, condition_applies: false, condition_detail: '請假未滿 56 小時，本次 52 小時' })
    expect(short.body.logs).toEqual(['第2關不適用（請假未滿 56 小時，本次 52 小時）'])

    const fallback = await get('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('vp')}&start=2026-11-09`)
    expect(fallback.body.steps[0]).toMatchObject({ approvers: [expect.objectContaining({ employeeId: 'ADMIN' })], fallback_text: '無上級主管，改由系統管理員簽核（任一位核准即可）（申請人沒有設定直屬主管）' })

    const bad = await get('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('cook')}&start=2026-11-29&end=2026-11-23`)
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('結束日期不可早於開始日期')
  })

  it('counts 12-hour shifts for the scheduled-day condition (5 shifts = 60 hours is not 7 working days)', async () => {
    const setting = await models.AttendanceSetting.create({ shifts: [
      { name: '白12', code: 'D12', startTime: '07:00', endTime: '19:00', breakMinutes: 0 },
      { name: '休', code: 'OFF', startTime: '00:00', endTime: '00:00', semanticType: 'rest_day' },
    ] })
    const [day12, off] = setting.shifts
    const work = new Set(['2027-01-04', '2027-01-06', '2027-01-08', '2027-01-11', '2027-01-13'])
    for (let offset = 0; offset < 12; offset += 1) {
      const key = new Date(Date.UTC(2027, 0, 4 + offset)).toISOString().slice(0, 10)
      await models.ShiftSchedule.create({ employee: people.nurse._id, date: new Date(`${key}T00:00:00.000Z`), shiftId: work.has(key) ? day12._id : off._id, state: 'finalized' })
    }
    await put('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow`, { steps: [
      { step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行' } },
      { step_order: 2, approver_type: 'manager_chain', approver_value: { stopAtTag: '長假決行' }, is_required: false, condition: { kind: 'leave_scheduled_days_gte', value: 7 } },
    ] })
    try {
      const trial = await get('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('nurse')}&start=2027-01-04&end=2027-01-15&hours=60`)
      expect(trial.body.leave).toMatchObject({ hours: 60, calendarDays: 12, scheduledDays: 5, scheduledNote: '' })
      expect(trial.body.steps).toHaveLength(2)
      expect(trial.body.logs).toEqual(['第2關不適用（請假未滿 7 個排班日，本次 5 個排班日）'])
    } finally {
      await put('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow`, { steps: [
        { step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行', maxLevels: 5 } },
        { step_order: 2, approver_type: 'manager_chain', approver_value: { stopAtTag: '長假決行', maxLevels: 5 }, is_required: false, condition: { kind: 'leave_hours_gte', value: 56 } },
      ] })
    }
  })

  it('accepts any active employee of another 機構 / 部門 as 直屬主管 through 員工管理, and still refuses the employee themselves', async () => {
    const outsider = await addPerson('outsider', { organization: 'org-2', department: new mongoose.Types.ObjectId() })
    const crossOrg = await put('admin', `/api/employees/${id('clerk')}`, { supervisor: String(outsider._id) })
    expect(crossOrg.status).toBe(200)
    expect(String((await models.Employee.findById(people.clerk._id).lean()).supervisor)).toBe(String(outsider._id))

    const self = await put('admin', `/api/employees/${id('clerk')}`, { supervisor: id('clerk') })
    expect(self.status).toBe(400)
    expect(self.body.error).toBe('不能把自己設為直屬主管（會變成自己簽自己）')

    // 兩位主管互為直屬主管（彼此簽對方的假）以前就可以設定，現在也可以；主管鏈走到重複的人就停
    const mutual = await put('admin', `/api/employees/${id('outsider')}`, { supervisor: id('clerk') })
    expect(mutual.status).toBe(200)
    const trial = await get('admin', `/api/approvals/forms/${chainLeave.form._id}/workflow/trial?employee=${id('clerk')}&start=2026-11-09`)
    expect(trial.body.steps.map(step => step.approvers[0].employeeId)).toEqual(['OUTSIDER'])
    expect(trial.body.workflow[0].chain).toMatchObject({ end: 'loop' })

    await models.Employee.updateOne({ _id: people.clerk._id }, { $set: { supervisor: people.lead._id } })
  })

  describe('沒有用到新設定時和以前一樣', () => {
    it('keeps 申請者的主管 + 標籤 人資 on a plain leave form, whatever the length', async () => {
      const doc = await load((await file('nurse', plainLeave, { start: '2026-12-28', end: '2027-01-03', hours: 56 })).body._id)
      expect(chainOf(doc)).toEqual(['head', 'hr'])
      expect(doc.steps.every(step => step.name === undefined && step.note === undefined)).toBe(true)
      expect(doc.logs.map(log => log.action)).toEqual(['create'])
    })

    it('leaves a pending request alone when its workflow is changed to a chain afterwards', async () => {
      const created = await file('cook', plainLeave, { start: '2027-02-01', end: '2027-02-01', hours: 8 })
      const before = await load(created.body._id)
      expect(chainOf(before)).toEqual(['dietitian', 'hr'])

      await put('admin', `/api/approvals/forms/${plainLeave.form._id}/workflow`, { steps: [
        { step_order: 1, approver_type: 'manager_chain', approver_value: { maxLevels: 5 } },
      ] })
      try {
        expect((await act('dietitian', created.body._id, 'approve')).status).toBe(200)
        const after = await load(created.body._id)
        expect(chainOf(after)).toEqual(['dietitian', 'hr'])
        expect(after.current_step_index).toBe(1)
        expect(after.steps.map(step => step.name)).toEqual([undefined, undefined])
      } finally {
        await put('admin', `/api/approvals/forms/${plainLeave.form._id}/workflow`, { steps: [
          { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
          { step_order: 2, approver_type: 'tag', approver_value: '人資' },
        ] })
      }
    })
  })
})
