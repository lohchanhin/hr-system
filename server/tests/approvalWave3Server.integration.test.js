// 第三輪簽核修正（伺服器端）的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 預設略過；要執行時指定一個本機的暫用資料庫（和 approvalEngine.integration.test.js 相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27301 npm test -- tests/approvalWave3Server.integration.test.js
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
    throw new Error('Wave 3 integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_wave3_server_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('wave 3 server fixes against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let FormTemplate
  let FormField
  let ApprovalWorkflow
  let ApprovalRequest
  let ShiftSchedule
  let AttendanceSetting
  const people = {}
  let formCounter = 0
  let dayShiftId
  let restShiftId
  let regularRestShiftId
  let resetLeaveFieldCache

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
  const put = (key, url, body) => request(app).put(url).set(as(key)).send(body ?? {})
  const del = (key, url) => request(app).delete(url).set(as(key))
  const id = (key) => String(people[key]._id)

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
    // 請假表單與欄位的對應有快取；經由 API 建立 / 修改表單時控制器會清掉它，這裡直接寫入資料庫所以要自己清
    resetLeaveFieldCache()
    return { form, workflow, fields: created }
  }

  const fieldId = (made, label) => String(made.fields.find((field) => field.label === label)._id)
  const createRequest = (key, made, formData) => post(key, '/api/approvals', { form_id: String(made.form._id), form_data: formData })
  const act = (key, requestId, decision, extra = {}) => post(key, `/api/approvals/${requestId}/act`, { decision, ...extra })
  const load = (requestId) => ApprovalRequest.findById(requestId).lean()
  const managerStep = [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }]
  const decisionsOf = (doc, stepIndex = 0) => Object.fromEntries(
    doc.steps[stepIndex].approvers.map((approver) => [String(approver.approver), approver.decision]),
  )

  // 把欄位「刪除」（有申請單時只是停用），再建立同標籤的新欄位；回傳新欄位的 id
  async function replaceField(made, label, spec) {
    const oldId = fieldId(made, label)
    const removed = await del('admin', `/api/approvals/forms/${made.form._id}/fields/${oldId}`)
    expect(removed.status).toBe(200)
    expect(removed.body.deactivated).toBe(true)
    const added = await post('admin', `/api/approvals/forms/${made.form._id}/fields`, { label, order: 50, ...spec })
    expect(added.status).toBe(201)
    return String(added.body._id)
  }

  const leaveFieldSpecs = () => [
    { label: '假別', type_1: 'select', required: true, options: ['特休', '事假', '病假'] },
    { label: '開始時間', type_1: 'datetime', required: true },
    { label: '結束時間', type_1: 'datetime', required: true },
    { label: '事由', type_1: 'text' },
  ]

  const approveLeave = async (made, key, formData) => {
    const created = await createRequest(key, made, formData)
    expect(created.status).toBe(201)
    const approved = await act('boss', created.body._id, 'approve')
    expect(approved.status).toBe(200)
    expect((await load(created.body._id)).status).toBe('approved')
    return created.body._id
  }

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
    await Promise.all([Employee.syncIndexes(), FormTemplate.syncIndexes(), ApprovalRequest.syncIndexes(), ShiftSchedule.syncIndexes()])

    await addPerson('admin', { role: 'admin', signTags: ['人資'] }) // 管理員同時是「人資」標籤持有者
    await addPerson('boss', { role: 'supervisor' })
    await addPerson('hrB', { signTags: ['人資'] })
    await addPerson('hrC', { signTags: ['人資'] })
    await addPerson('fin', { signTags: ['財務覆核'] })

    const setting = await AttendanceSetting.create({
      shifts: [
        { name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
      ],
    })
    ;[dayShiftId, restShiftId, regularRestShiftId] = setting.shifts.map((shift) => shift._id)
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  /* ------------------------------ S-0 ------------------------------ */
  describe('S-0: an admin who is also a named approver and decided already', () => {
    let made

    beforeAll(async () => {
      made = await makeForm({
        name: '人資核定單',
        fields: [{ label: '事由', type_1: 'text', required: true }],
        steps: [{ approver_type: 'tag', approver_value: '人資', all_must_approve: true, is_required: true, can_return: true }],
      })
      for (const key of ['a1', 'a2']) await addPerson(key, { supervisor: people.boss._id })
    })

    const file = async () => {
      const created = await createRequest('a1', made, { [fieldId(made, '事由')]: '核定' })
      expect(created.status).toBe(201)
      return created.body._id
    }

    it('answers ALREADY_DECIDED to a second approve (sequential) and keeps the other two approvers required', async () => {
      const requestId = await file()
      expect((await act('admin', requestId, 'approve')).status).toBe(200)

      const second = await act('admin', requestId, 'approve')

      expect(second.status).toBe(409)
      expect(second.body).toEqual({ error: '您已經處理過這一關，請重新整理頁面', code: 'ALREADY_DECIDED' })
      const doc = await load(requestId)
      expect(decisionsOf(doc)).toEqual({ [id('admin')]: 'approved', [id('hrB')]: 'pending', [id('hrC')]: 'pending' })
      expect(doc.status).toBe('pending')
      expect(doc.current_step_index).toBe(0)
      expect(doc.logs.map((log) => log.action)).toEqual(['create', 'approve'])
    })

    it('answers the same to a repeated reject or return', async () => {
      const requestId = await file()
      await act('admin', requestId, 'approve')

      for (const decision of ['reject', 'return']) {
        const again = await act('admin', requestId, decision)
        expect(again.status).toBe(409)
        expect(again.body.code).toBe('ALREADY_DECIDED')
      }
      expect((await load(requestId)).status).toBe('pending')
    })

    it('refuses the second of two concurrent approves (8 repetitions): never an override that skips hrB and hrC', async () => {
      for (let round = 0; round < 8; round += 1) {
        const requestId = await file()

        const results = await Promise.all([act('admin', requestId, 'approve'), act('admin', requestId, 'approve')])

        expect(results.map((res) => res.status).sort()).toEqual([200, 409])
        const loser = results.find((res) => res.status === 409)
        expect(loser.body.code).toBe('ALREADY_DECIDED')
        const doc = await load(requestId)
        expect(decisionsOf(doc)).toEqual({ [id('admin')]: 'approved', [id('hrB')]: 'pending', [id('hrC')]: 'pending' })
        expect(doc.status).toBe('pending')
        expect(doc.logs.map((log) => log.action)).toEqual(['create', 'approve'])
      }
    })

    it('still lets the admin override explicitly (override: true) after deciding: skips the others and is logged', async () => {
      const requestId = await file()
      await act('admin', requestId, 'approve')

      const override = await act('admin', requestId, 'approve', { override: true, comment: '其餘人員出差，代為核可' })

      expect(override.status).toBe(200)
      const doc = await load(requestId)
      expect(decisionsOf(doc)).toEqual({ [id('admin')]: 'approved', [id('hrB')]: 'skipped', [id('hrC')]: 'skipped' })
      expect(doc.status).toBe('approved')
      expect(doc.logs.map((log) => log.action)).toEqual(expect.arrayContaining(['admin_override', 'finish']))
    })

    it('keeps the override of an admin who is not named on the step, with and without the flag', async () => {
      const finance = await makeForm({
        name: '財務覆核單',
        fields: [{ label: '事由', type_1: 'text', required: true }],
        steps: [{ approver_type: 'tag', approver_value: '財務覆核', all_must_approve: true, is_required: true, can_return: true }],
      })
      for (const extra of [{}, { override: true }]) {
        const created = await createRequest('a2', finance, { [fieldId(finance, '事由')]: '覆核' })
        expect(created.status).toBe(201)
        const override = await act('admin', created.body._id, 'approve', extra)
        expect(override.status).toBe(200)
        const doc = await load(created.body._id)
        expect(doc.status).toBe('approved')
        expect(doc.logs.map((log) => log.action)).toContain('admin_override')
      }
    })
  })

  /* ------------------------------ S-1 / S-2 ------------------------------ */
  describe('S-1: overtime caps keep counting approved overtime whose answers sit under deactivated fields', () => {
    it('refuses the further 2 hours before and after the three fields were deleted (deactivated) and recreated', async () => {
      const made = await makeForm({
        name: '加班申請單',
        semanticType: 'overtime',
        fields: [
          { label: '開始時間', type_1: 'datetime', required: true },
          { label: '結束時間', type_1: 'datetime', required: true },
          { label: '事由', type_1: 'text' },
        ],
        steps: managerStep,
      })
      await addPerson('ot1', { supervisor: people.boss._id })
      await ShiftSchedule.create({ employee: people.ot1._id, date: new Date('2026-11-04T00:00:00.000Z'), shiftId: dayShiftId })
      const filing = (startKey, endKey, startZ, endZ) => ({
        [startKey]: startZ,
        [endKey]: endZ,
      })

      // 台灣 11/04 19:00-22:00 的 3 小時加班，核准
      const first = await createRequest('ot1', made, {
        ...filing(fieldId(made, '開始時間'), fieldId(made, '結束時間'), '2026-11-04T11:00:00.000Z', '2026-11-04T14:00:00.000Z'),
        [fieldId(made, '事由')]: '趕工',
      })
      expect(first.status).toBe(201)
      expect((await act('boss', first.body._id, 'approve')).status).toBe(200)

      // 對照：欄位沒動時，再加 2 小時（22:00-24:00）超過每日 4 小時
      const control = await createRequest('ot1', made, {
        ...filing(fieldId(made, '開始時間'), fieldId(made, '結束時間'), '2026-11-04T14:00:00.000Z', '2026-11-04T16:00:00.000Z'),
        [fieldId(made, '事由')]: '加班',
      })
      expect(control.status).toBe(400)
      expect(control.body.violations).toEqual([expect.objectContaining({ rule: 'daily-overtime-hours', minutes: 300 })])
      expect(control.body.violations[0].message).toContain('每日加班不得超過4小時')
      expect(control.body.violations[0].message).toContain('累計 5.0 小時')

      // 三個欄位被刪除（停用）又建立同標籤的新欄位
      const newStart = await replaceField(made, '開始時間', { type_1: 'datetime', required: true })
      const newEnd = await replaceField(made, '結束時間', { type_1: 'datetime', required: true })
      const newReason = await replaceField(made, '事由', { type_1: 'text' })

      const afterReplace = await createRequest('ot1', made, {
        ...filing(newStart, newEnd, '2026-11-04T14:00:00.000Z', '2026-11-04T16:00:00.000Z'),
        [newReason]: '加班',
      })
      expect(afterReplace.status).toBe(400)
      expect(afterReplace.body.violations).toEqual([expect.objectContaining({ rule: 'daily-overtime-hours', minutes: 300 })])

      // 剛好湊滿 4 小時（再 1 小時）仍然可以
      const exactlyFour = await createRequest('ot1', made, {
        ...filing(newStart, newEnd, '2026-11-04T14:00:00.000Z', '2026-11-04T15:00:00.000Z'),
        [newReason]: '加班',
      })
      expect(exactlyFour.status).toBe(201)
    })
  })

  describe('S-2: the leave overlap check and the schedule rules see approved leave under a deactivated start field', () => {
    it('refuses a filing that overlaps an approved leave after the 開始時間 field was replaced', async () => {
      const made = await makeForm({ name: '請假單', semanticType: 'leave', fields: leaveFieldSpecs(), steps: managerStep })
      await addPerson('lv1', { supervisor: people.boss._id })
      const typeId = fieldId(made, '假別')
      const endId = fieldId(made, '結束時間')
      const reasonId = fieldId(made, '事由')

      // 已核准：台灣 11/09 00:00 到 11/10 18:00 的事假
      await approveLeave(made, 'lv1', {
        [typeId]: '事假',
        [fieldId(made, '開始時間')]: '2026-11-08T16:00:00.000Z',
        [endId]: '2026-11-10T10:00:00.000Z',
        [reasonId]: '家務',
      })

      const newStart = await replaceField(made, '開始時間', { type_1: 'datetime', required: true })
      const overlapping = await createRequest('lv1', made, {
        [typeId]: '事假',
        [newStart]: '2026-11-09T16:00:00.000Z', // 台灣 11/10 00:00
        [endId]: '2026-11-10T10:00:00.000Z',
        [reasonId]: '家務',
      })

      expect(overlapping.status).toBe(400)
      expect(overlapping.body.violations).toEqual([expect.objectContaining({ rule: 'leave-overlap', status: 'approved' })])

      // 不重疊的日子照常可以申請
      const free = await createRequest('lv1', made, {
        [typeId]: '事假',
        [newStart]: '2026-11-19T16:00:00.000Z',
        [endId]: '2026-11-20T10:00:00.000Z',
        [reasonId]: '家務',
      })
      expect(free.status).toBe(201)
    })

    it('counts the old-field leave toward the six-day limit of the schedule rules', async () => {
      const { assertScheduleRuleCompliance } = await import('../src/services/laborRuleValidationService.js')
      const made = await makeForm({ name: '請假單', semanticType: 'leave', fields: leaveFieldSpecs(), steps: managerStep })
      await addPerson('lv2', { supervisor: people.boss._id })
      await approveLeave(made, 'lv2', {
        [fieldId(made, '假別')]: '病假',
        [fieldId(made, '開始時間')]: '2026-11-08T16:00:00.000Z', // 台灣 11/09
        [fieldId(made, '結束時間')]: '2026-11-09T10:00:00.000Z',
      })
      await replaceField(made, '開始時間', { type_1: 'datetime', required: true })
      for (const day of ['03', '04', '05', '06', '07', '08']) {
        await ShiftSchedule.create({ employee: people.lv2._id, date: new Date(`2026-11-${day}T00:00:00.000Z`), shiftId: dayShiftId })
      }

      await expect(assertScheduleRuleCompliance({
        candidateSchedules: [{ employee: String(people.lv2._id), date: new Date('2026-11-03T00:00:00.000Z'), shiftId: String(dayShiftId) }],
      })).rejects.toMatchObject({
        violations: [expect.objectContaining({
          rule: 'continuous-work-days',
          dates: ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'],
        })],
      })
    })
  })

  /* ------------------------------ S-3 ------------------------------ */
  describe('S-3: annual leave when the 假別 field was replaced while the request was pending', () => {
    it('deducts on approval, lists the record in the history and refunds on withdrawal', async () => {
      const made = await makeForm({ name: '特休請假單', semanticType: 'leave', fields: leaveFieldSpecs(), steps: managerStep })
      await addPerson('al1', { supervisor: people.boss._id, annualLeave: { totalDays: 10, usedDays: 0, year: 2099 } })
      const typeId = fieldId(made, '假別')

      // 台灣 2099-03-02 00:00 到 2099-03-03 18:00：2 天
      const created = await createRequest('al1', made, {
        [typeId]: '特休',
        [fieldId(made, '開始時間')]: '2099-03-01T16:00:00.000Z',
        [fieldId(made, '結束時間')]: '2099-03-03T10:00:00.000Z',
      })
      expect(created.status).toBe(201)

      // 簽核中管理員把假別欄位刪掉（停用）又重建同標籤的新欄位
      await replaceField(made, '假別', { type_1: 'select', options: ['特休', '事假', '病假'] })

      const approved = await act('boss', created.body._id, 'approve')
      expect(approved.status).toBe(200)
      expect(approved.body.warnings).toBeUndefined()
      const doc = await load(created.body._id)
      expect(doc.status).toBe('approved')
      expect(doc.annual_leave).toMatchObject({ state: 'deducted', days: 2 })
      expect(doc.logs.map((log) => log.action)).toContain('annual_leave')
      expect((await Employee.findById(id('al1'))).annualLeave.usedDays).toBe(2)

      const history = await get('admin', `/api/employees/${id('al1')}/annual-leave/history`)
      expect(history.status).toBe(200)
      expect(history.body).toEqual([expect.objectContaining({ requestId: created.body._id, days: 2 })])

      const cancel = await post('al1', `/api/approvals/${created.body._id}/cancel`, { comment: '行程取消' })
      expect(cancel.status).toBe(200)
      expect(cancel.body.status).toBe('canceled')
      expect((await load(created.body._id)).annual_leave).toMatchObject({ state: 'refunded', days: 2 })
      expect((await Employee.findById(id('al1'))).annualLeave.usedDays).toBe(0)
    })
  })

  /* ------------------------------ S-4 ------------------------------ */
  describe('S-4: GET /api/employees/schedule?status=onLeave reads leave days in Taiwan time', () => {
    it('finds a one-day leave on Taiwan 2026-07-01 (stored 2026-06-30T16:00Z) in July and not in June, whatever the server TZ', async () => {
      const made = await makeForm({ name: '請假單', semanticType: 'leave', fields: leaveFieldSpecs(), steps: managerStep })
      await addPerson('lv7', { name: '七月請假', supervisor: people.boss._id })
      await addPerson('lv6', { name: '六月請假', supervisor: people.boss._id })
      const seed = (employeeKey, start, end) => ApprovalRequest.create({
        form: made.form._id,
        workflow: made.workflow._id,
        applicant_employee: people[employeeKey]._id,
        status: 'approved',
        form_data: {
          [fieldId(made, '假別')]: '事假',
          [fieldId(made, '開始時間')]: start,
          [fieldId(made, '結束時間')]: end,
        },
      })
      await seed('lv7', '2026-06-30T16:00:00.000Z', '2026-06-30T16:00:00.000Z') // 台灣 7/1 整天
      await seed('lv6', '2026-06-29T16:00:00.000Z', '2026-06-29T16:00:00.000Z') // 台灣 6/30 整天

      const names = async (month) => (await get('admin', `/api/employees/schedule?month=${month}&status=onLeave`)).body.employees
        .map((employee) => employee.name)
        .filter((name) => name === '七月請假' || name === '六月請假')
        .sort()

      expect(await names('2026-07')).toEqual(['七月請假'])
      expect(await names('2026-06')).toEqual(['六月請假'])
    })
  })

  /* ------------------------------ S-5 ------------------------------ */
  describe('S-5: PUT /api/employees/:id with a stale edit dialog', () => {
    const usedDays = async (key) => (await Employee.findById(id(key))).annualLeave.usedDays

    it('never touches usedDays when the body does not carry it, and ignores an untouched stale value', async () => {
      await addPerson('ed1', { annualLeave: { totalDays: 10, usedDays: 0 } })
      await Employee.updateOne({ _id: people.ed1._id }, { $inc: { 'annualLeave.usedDays': 1 } }) // 視窗開著時簽核又扣了 1 天

      const noUsedDays = await put('admin', `/api/employees/${id('ed1')}`, { annualLeave: { totalDays: 12, notes: '改總天數' } })
      expect(noUsedDays.status).toBe(200)
      expect(await usedDays('ed1')).toBe(1)

      const stale = await put('admin', `/api/employees/${id('ed1')}`, { annualLeave: { totalDays: 13, usedDays: 0, usedDaysBase: 0 } })
      expect(stale.status).toBe(200)
      const stored = await Employee.findById(id('ed1'))
      expect(stored.annualLeave).toMatchObject({ totalDays: 13, usedDays: 1 })
    })

    it('applies only the admin difference with $inc when a deduction happened meanwhile, and a plain set otherwise', async () => {
      await addPerson('ed2', { annualLeave: { totalDays: 10, usedDays: 0 } })
      await Employee.updateOne({ _id: people.ed2._id }, { $inc: { 'annualLeave.usedDays': 1 } })

      // 視窗開啟時 0，管理員改成 2（差額 +2），期間簽核扣了 1 → 3
      const adjusted = await put('admin', `/api/employees/${id('ed2')}`, { annualLeave: { usedDays: 2, usedDaysBase: 0 } })
      expect(adjusted.status).toBe(200)
      expect(await usedDays('ed2')).toBe(3)

      // 沒有期間異動（base 等於目前存的）：直接設成管理員填的值
      const direct = await put('admin', `/api/employees/${id('ed2')}`, { annualLeave: { usedDays: 1, usedDaysBase: 3 } })
      expect(direct.status).toBe(200)
      expect(await usedDays('ed2')).toBe(1)

      // 沒帶 base（舊畫面）：維持原本行為，人工更正直接設定
      const legacy = await put('admin', `/api/employees/${id('ed2')}`, { annualLeave: { usedDays: 5 } })
      expect(legacy.status).toBe(200)
      expect(await usedDays('ed2')).toBe(5)
    })

    it('keeps a deduction that happens between loading the employee and saving the correction', async () => {
      await addPerson('ed3', { annualLeave: { totalDays: 10, usedDays: 3 } })
      const original = Employee.updateOne
      const spy = jest.spyOn(Employee, 'updateOne').mockImplementation(async function updateAfterDeduction(...args) {
        spy.mockRestore()
        await Employee.collection.updateOne({ _id: people.ed3._id }, { $inc: { 'annualLeave.usedDays': 1 } }) // 此時簽核通過、剛好扣了 1 天
        return original.apply(this, args)
      })

      // 視窗開啟時 2，之後被扣到 3（stored 3 ≠ base 2）；管理員把 2 改成 4（差額 +2）；寫入前又被扣 1 天 → 3 + 1 + 2 = 6
      const res = await put('admin', `/api/employees/${id('ed3')}`, { annualLeave: { usedDays: 4, usedDaysBase: 2 } })

      spy.mockRestore()
      expect(res.status).toBe(200)
      expect(await usedDays('ed3')).toBe(6)
    })

    it('never takes usedDays below zero, even when a refund lands between loading and saving', async () => {
      await addPerson('ed4', { annualLeave: { totalDays: 10, usedDays: 2 } })
      const original = Employee.updateOne
      const spy = jest.spyOn(Employee, 'updateOne').mockImplementation(async function updateAfterRefund(...args) {
        spy.mockRestore()
        await Employee.collection.updateOne({ _id: people.ed4._id }, { $inc: { 'annualLeave.usedDays': -1 } }) // 此時有人撤回特休、返還 1 天
        return original.apply(this, args)
      })

      // 視窗開啟時 3，目前存 2，管理員把 3 改成 0（差額 -3 → 夾在 -2）；寫入前又返還 1 天 → 2 - 1 - 2 = -1 → 補成 0
      const res = await put('admin', `/api/employees/${id('ed4')}`, { annualLeave: { usedDays: 0, usedDaysBase: 3 } })

      spy.mockRestore()
      expect(res.status).toBe(200)
      expect(await usedDays('ed4')).toBe(0)
    })
  })

  /* ------------------------------ S-7 ------------------------------ */
  describe('S-7: daily / hourly pay over a leave that crosses a rest day and a regular rest day', () => {
    it('pays 2 workdays for a Fri 09:00 - Mon 18:00 特休 (日薪 2000 → 4000, 16 leave hours); 時薪 the same hours; 月薪 unchanged', async () => {
      const made = await makeForm({ name: '請假單', semanticType: 'leave', fields: leaveFieldSpecs(), steps: managerStep })
      await addPerson('pay-d', { salaryType: '日薪', salaryAmount: 2000, supervisor: people.boss._id })
      await addPerson('pay-h', { salaryType: '時薪', salaryAmount: 250, supervisor: people.boss._id })
      await addPerson('pay-m', { salaryType: '月薪', salaryAmount: 30000, supervisor: people.boss._id })
      const week = [
        ['2026-09-04', dayShiftId], // 週五
        ['2026-09-05', restShiftId], // 週六 休息日
        ['2026-09-06', regularRestShiftId], // 週日 例假
        ['2026-09-07', dayShiftId], // 週一
      ]
      for (const key of ['pay-d', 'pay-h', 'pay-m']) {
        for (const [date, shiftId] of week) {
          await ShiftSchedule.create({ employee: people[key]._id, date: new Date(`${date}T00:00:00.000Z`), shiftId })
        }
        await ApprovalRequest.create({
          form: made.form._id,
          workflow: made.workflow._id,
          applicant_employee: people[key]._id,
          status: 'approved',
          form_data: {
            [fieldId(made, '假別')]: '特休',
            [fieldId(made, '開始時間')]: '2026-09-04T01:00:00.000Z', // 台灣 9/4 09:00
            [fieldId(made, '結束時間')]: '2026-09-07T10:00:00.000Z', // 台灣 9/7 18:00
          },
        })
      }
      const complete = async (key) => (await get('admin', `/api/payroll/complete-data/${id(key)}/2026-09-01`)).body

      const daily = await complete('pay-d')
      expect(daily).toMatchObject({ workDays: 0, leaveHours: 16, paidLeaveHours: 16, baseSalary: 4000 })
      const hourly = await complete('pay-h')
      expect(hourly).toMatchObject({ leaveHours: 16, paidLeaveHours: 16, baseSalary: 4000 })
      const monthly = await complete('pay-m')
      expect(monthly).toMatchObject({ leaveHours: 32, paidLeaveHours: 32, leaveDeduction: 0, baseSalary: 30000 })

      const impact = await get('admin', `/api/payroll/leave-impact/${id('pay-d')}/2026-09-01`)
      expect(impact.body.leaveHours).toBe(16)
    })
  })

  /* ------------------------------ S-8 ------------------------------ */
  describe('S-8: delete impact and the startup heal with legacy tag values stored in workflows', () => {
    it('reports the tag as lost when the workflow step still holds a trailing-space value, and heals it idempotently', async () => {
      const { normalizeStoredSignTags } = await import('../src/controllers/employeeController.js')
      const made = await makeForm({
        name: '稽核單',
        fields: [{ label: '事由', type_1: 'text' }],
        steps: [
          { approver_type: 'tag', approver_value: '稽核', all_must_approve: true, is_required: true, can_return: true, name: '稽核關' },
          { approver_type: 'tag', approver_value: '備援', all_must_approve: false, is_required: false, can_return: false },
        ],
      })
      await addPerson('holder', { signTags: ['稽核'] })
      // 舊資料：沒整理過的標籤值（繞過驗證直接寫進資料庫）
      await ApprovalWorkflow.collection.updateOne(
        { _id: made.workflow._id },
        { $set: { 'steps.0.approver_value': '稽核 ', 'steps.1.approver_value': ['　備援', '備援 '] } },
      )

      const before = await post('admin', '/api/employees/delete-impact', { ids: [id('holder')] })
      expect(before.status).toBe(200)
      expect(before.body.impact.lostTags).toEqual([{ name: '稽核', requiredByWorkflows: 1 }])
      expect(before.body.impact.messages.at(-1)).toContain('「稽核」')

      const rawBefore = await ApprovalWorkflow.collection.findOne({ _id: made.workflow._id })
      await normalizeStoredSignTags()
      const healed = await ApprovalWorkflow.collection.findOne({ _id: made.workflow._id })
      expect(healed.steps.map((step) => step.approver_value)).toEqual(['稽核', ['備援']])
      // 只動 approver_value：其他欄位與 updatedAt 都沒變
      expect(healed.steps.map(({ approver_value, ...rest }) => rest)).toEqual(rawBefore.steps.map(({ approver_value, ...rest }) => rest))
      expect(healed.updatedAt).toEqual(rawBefore.updatedAt)

      // 重複執行不再有變動
      await normalizeStoredSignTags()
      const again = await ApprovalWorkflow.collection.findOne({ _id: made.workflow._id })
      expect(again).toEqual(healed)

      const after = await post('admin', '/api/employees/delete-impact', { ids: [id('holder')] })
      expect(after.body.impact.lostTags).toEqual([{ name: '稽核', requiredByWorkflows: 1 }])
    })
  })

  /* ------------------------------ S-9 ------------------------------ */
  describe('S-9: Chinese error bodies of the template endpoints', () => {
    it('answers 表單性質不正確 and 欄位代碼格式不正確 instead of the English bodies', async () => {
      const created = await post('admin', '/api/approvals/forms', { name: '新表單', semanticType: 'bogus' })
      expect(created.status).toBe(400)
      expect(created.body).toEqual({ error: '表單性質不正確' })

      const made = await makeForm({ name: '一般表單', fields: [{ label: '欄位', type_1: 'text' }], steps: managerStep })
      const updated = await put('admin', `/api/approvals/forms/${made.form._id}`, { semanticType: 'bogus' })
      expect(updated.status).toBe(400)
      expect(updated.body).toEqual({ error: '表單性質不正確' })

      const added = await post('admin', `/api/approvals/forms/${made.form._id}/fields`, { label: '新欄位', type_1: 'text', field_key: 'C12; drop' })
      expect(added.status).toBe(400)
      expect(added.body).toEqual({ error: '欄位代碼格式不正確' })

      const changed = await put('admin', `/api/approvals/forms/${made.form._id}/fields/${fieldId(made, '欄位')}`, { field_key: 'C12; drop' })
      expect(changed.status).toBe(400)
      expect(changed.body).toEqual({ error: '欄位代碼格式不正確' })
    })
  })
})
