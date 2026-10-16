// 請假以「小時」為單位的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27413 npm test -- tests/leaveHoursBalances.integration.test.js
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
    throw new Error('Leave hours integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_leave_hours_${process.pid}_${Date.now()}`
  return uri.toString()
}

describeIntegration('leave hours, balances, quotas and migrations against a real MongoDB through the real app', () => {
  jest.setTimeout(60000)
  let app
  let Employee
  let FormTemplate
  let FormField
  let ApprovalWorkflow
  let ApprovalRequest
  let ShiftSchedule
  let AttendanceSetting
  let migrations
  let payroll
  const people = {}
  let formCounter = 0
  const secret = 'integration-test-secret-integration-test-secret'

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
  const load = (requestId) => ApprovalRequest.findById(requestId).lean()

  async function addPerson(key, patch = {}) {
    people[key] = await Employee.create({
      name: key, email: `${key}@example.test`, username: key, role: 'employee', organization: 'org-1', ...patch,
    })
    return people[key]
  }

  async function makeForm({ name, semanticType = 'leave', fields = [], steps }) {
    formCounter += 1
    const form = await FormTemplate.create({ name: `${name}-${formCounter}`, semanticType, is_active: true })
    const created = []
    for (const [index, field] of fields.entries()) created.push(await FormField.create({ form: form._id, order: index + 1, ...field }))
    const workflow = await ApprovalWorkflow.create({ form: form._id, steps: steps.map((step, index) => ({ step_order: index + 1, ...step })) })
    return { form, workflow, fields: created }
  }
  const fieldId = (made, label) => String(made.fields.find(field => field.label === label)._id)

  const managerStep = { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }
  const hrStep = { approver_type: 'tag', approver_value: '人資', all_must_approve: true, is_required: true, can_return: true }

  // 台灣時間的時間點
  const tw = (day, time) => `2099-03-${day}T${time}:00+08:00`
  const LEAVE_TYPES = ['特休假', '事假', '病假', '家庭照顧假', '生理假', '婚假', '公假']

  let leave // 新版的請假單：假別、開始時間、結束時間、時數
  const request1 = (key, formData) => post(key, '/api/approvals', { form_id: String(leave.form._id), form_data: formData })
  const data = (type, start, end, hours) => ({
    [fieldId(leave, '假別')]: type, [fieldId(leave, '開始時間')]: start, [fieldId(leave, '結束時間')]: end, [fieldId(leave, '事由')]: '家務',
    ...(hours === undefined ? {} : { [fieldId(leave, '時數')]: hours }),
  })
  const approveAll = async (requestId) => {
    expect((await post('boss', `/api/approvals/${requestId}/act`, { decision: 'approve' })).status).toBe(200)
    expect((await post('hr', `/api/approvals/${requestId}/act`, { decision: 'approve' })).status).toBe(200)
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
    migrations = await import('../src/services/leaveHoursMigration.js')
    payroll = await import('../src/services/workHoursCalculationService.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all([Employee.syncIndexes(), FormTemplate.syncIndexes(), ApprovalRequest.syncIndexes(), ShiftSchedule.syncIndexes()])

    await addPerson('admin', { role: 'admin' })
    await addPerson('boss', { role: 'supervisor' })
    await addPerson('hr', { signTags: ['人資'] })
    await addPerson('stranger')
    await addPerson('nurse1', { supervisor: people.boss._id, salaryType: '月薪', salaryAmount: 48000, annualLeave: { totalHours: 80, usedHours: 0, year: 2099 } })
    await addPerson('nurse2', { supervisor: people.boss._id, annualLeave: { totalHours: 80, usedHours: 0, year: 2099 } })
    await addPerson('nurse3', { supervisor: people.boss._id, annualLeave: { totalHours: 16, usedHours: 8, year: 2099 } })

    leave = await makeForm({
      name: '請假',
      fields: [
        { label: '假別', type_1: 'select', options: LEAVE_TYPES, required: true },
        { label: '開始時間', type_1: 'datetime', required: true },
        { label: '結束時間', type_1: 'datetime', required: true },
        { label: '時數', type_1: 'number', required: true },
        { label: '事由', type_1: 'text' },
      ],
      steps: [managerStep, hrStep],
    })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('hours are the unit of a leave request: capture, validation and counting', () => {
    it('accepts hours inside the chosen period (half-hour steps) and stores them as typed', async () => {
      const created = await request1('nurse1', data('事假', tw('02', '09:00'), tw('02', '13:00'), 4))
      expect(created.status).toBe(201)
      expect(created.body.warnings).toBeUndefined()
      expect((await load(created.body._id)).form_data[fieldId(leave, '時數')]).toBe(4)

      const half = await request1('nurse1', data('事假', tw('03', '09:00'), tw('03', '13:00'), 2.5))
      expect(half.status).toBe(201) // 比期間少是可以的
    })

    it('rejects zero, negative and off-step hours, and more hours than the period can hold, with a Chinese reason per rule', async () => {
      for (const bad of [0, -2, 3.3]) {
        const res = await request1('nurse1', data('事假', tw('04', '09:00'), tw('04', '13:00'), bad))
        expect(res.status).toBe(400)
        expect(res.body.violations).toEqual([expect.objectContaining({ rule: expect.stringMatching(/leave-hours-invalid|required-form-field/) })])
      }
      const off = await request1('nurse1', data('事假', tw('04', '09:00'), tw('04', '13:00'), 3.3))
      expect(off.body.violations[0]).toMatchObject({ rule: 'leave-hours-invalid', message: '請假時數必須是大於 0 的數字，且以 0.5 小時為單位' })

      const tooMany = await request1('nurse1', data('事假', tw('04', '09:00'), tw('04', '13:00'), 5))
      expect(tooMany.status).toBe(400)
      expect(tooMany.body.violations).toEqual([expect.objectContaining({
        rule: 'leave-hours-range',
        message: '請假時數 5 小時超過所選期間可請的上限 4 小時（每日最多 8 小時）',
      })])
      const noHours = await request1('nurse1', data('事假', tw('04', '09:00'), tw('04', '13:00')))
      expect(noHours.status).toBe(400)
      expect(noHours.body.violations).toEqual([expect.objectContaining({ rule: 'required-form-field', label: '時數' })])
    })

    it('counts an overnight leave across the day boundary: 23:00 to 07:00 holds 8 hours, 9 is too many, and payroll splits it over the two Taiwan days', async () => {
      const nine = await request1('nurse2', data('事假', tw('10', '23:00'), tw('11', '07:00'), 9))
      expect(nine.status).toBe(400)
      expect(nine.body.violations[0]).toMatchObject({ rule: 'leave-hours-range', maxHours: 8 })

      const ok = await request1('nurse2', data('事假', tw('10', '23:00'), tw('11', '07:00'), 8))
      expect(ok.status).toBe(201)
      await approveAll(ok.body._id)

      // 薪資讀同一個「時數」欄位：2099-03 這個月共 8 小時，分在 3/10（1 小時）與 3/11（7 小時）
      const impact = await payroll.calculateLeaveImpact(id('nurse2'), '2099-03-01')
      expect(impact.leaveRecords).toHaveLength(1)
      expect(impact.leaveRecords[0]).toMatchObject({ leaveType: '事假', hours: 8, days: 1 })
      expect(impact.leaveHours).toBe(8)
      const february = await payroll.calculateLeaveImpact(id('nurse2'), '2099-02-01')
      expect(february.leaveHours).toBe(0)
    })
  })

  describe('a nurse on a scheduled 12-hour shift can take the whole shift off, a nurse without that shift cannot', () => {
    let dayShiftId
    let restShiftId
    let earlyShiftId

    beforeAll(async () => {
      await AttendanceSetting.deleteMany({})
      const setting = await AttendanceSetting.create({
        shifts: [
          { name: '12小時日班', code: '日12', semanticType: 'work', startTime: '07:00', endTime: '19:00' },
          { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
          // 預設的早班：08:30-17:30 休息 60 分鐘，實際工作 8 小時（請一天假是 8 小時，不是 9 小時）
          { name: '早班', code: '早', semanticType: 'work', startTime: '08:30', endTime: '17:30', breakDuration: 60 },
        ],
      })
      dayShiftId = setting.shifts[0]._id
      restShiftId = setting.shifts[1]._id
      earlyShiftId = setting.shifts[2]._id
      await ShiftSchedule.create({ employee: people.nurse1._id, date: new Date('2099-04-06T00:00:00.000Z'), shiftId: dayShiftId })
      await ShiftSchedule.create({ employee: people.nurse1._id, date: new Date('2099-04-07T00:00:00.000Z'), shiftId: restShiftId })
      await ShiftSchedule.create({ employee: people.nurse1._id, date: new Date('2099-04-08T00:00:00.000Z'), shiftId: dayShiftId })
      await ShiftSchedule.create({ employee: people.nurse1._id, date: new Date('2099-04-13T00:00:00.000Z'), shiftId: earlyShiftId })
    })

    it('reads the hours hint from the caller\'s own schedule: 12 on a 12-hour shift, 0 on a rest day, 8 on an unscheduled day', async () => {
      const oneShift = await get('nurse1', `/api/approvals/leave-hours-hint?start=${encodeURIComponent('2099-04-06')}&end=${encodeURIComponent('2099-04-06')}`)
      expect(oneShift.status).toBe(200)
      expect(oneShift.body).toMatchObject({ valid: true, maxHours: 12, suggestedHours: 12, scheduleChecked: true })

      const week = await get('nurse1', '/api/approvals/leave-hours-hint?start=2099-04-06&end=2099-04-09')
      expect(week.body.days.map(day => [day.dateKey, day.suggestedHours, day.scheduled])).toEqual([
        ['2099-04-06', 12, 'work'], ['2099-04-07', 0, 'off'], ['2099-04-08', 12, 'work'], ['2099-04-09', 8, null],
      ])
      expect(week.body.suggestedHours).toBe(32)

      const timed = await get('nurse1', `/api/approvals/leave-hours-hint?start=${encodeURIComponent(tw('06', '07:00').replace('2099-03', '2099-04'))}&end=${encodeURIComponent(tw('06', '19:00').replace('2099-03', '2099-04'))}`)
      expect(timed.body).toMatchObject({ allDay: false, suggestedHours: 12 })

      // 沒有排班的人看不到別人的班表：同一天回到每日上限 8 小時
      const other = await get('nurse2', '/api/approvals/leave-hours-hint?start=2099-04-06&end=2099-04-06')
      expect(other.body).toMatchObject({ suggestedHours: 8, maxHours: 8 })
    })

    it('accepts 12 hours for the full 07:00-19:00 shift of the scheduled nurse and refuses it for the nurse without that shift', async () => {
      const start = '2099-04-06T07:00:00+08:00'
      const end = '2099-04-06T19:00:00+08:00'

      const scheduled = await request1('nurse1', data('事假', start, end, 12))
      expect(scheduled.status).toBe(201)

      const unscheduled = await request1('nurse2', data('事假', start, end, 12))
      expect(unscheduled.status).toBe(400)
      expect(unscheduled.body.violations[0]).toMatchObject({ rule: 'leave-hours-range', maxHours: 8 })

      // 排了 12 小時班的那一天也不能超過 12 小時；休息日沒有放寬
      const tooMuch = await request1('nurse1', data('病假', '2099-04-08T07:00:00+08:00', '2099-04-08T19:00:00+08:00', 12.5))
      expect(tooMuch.status).toBe(400)
      expect(tooMuch.body.violations[0]).toMatchObject({ rule: 'leave-hours-range', maxHours: 12 })
      const restDay = await request1('nurse1', data('病假', '2099-04-07T07:00:00+08:00', '2099-04-07T19:00:00+08:00', 12))
      expect(restDay.status).toBe(400)
    })

    it('counts the net working hours of a shift with a break: the 早班 08:30-17:30 (60 minute break) is 8 hours, 9 hours of leave on it is refused', async () => {
      const hint = await get('nurse1', '/api/approvals/leave-hours-hint?start=2099-04-13&end=2099-04-13')
      expect(hint.body).toMatchObject({ valid: true, maxHours: 8, suggestedHours: 8, scheduleChecked: true })
      expect(hint.body.days[0]).toMatchObject({ dateKey: '2099-04-13', scheduled: 'work', shiftHours: 8, suggestedHours: 8 })

      const start = '2099-04-13T08:30:00+08:00'
      const end = '2099-04-13T17:30:00+08:00'
      const nine = await request1('nurse1', data('病假', start, end, 9))
      expect(nine.status).toBe(400)
      expect(nine.body.violations[0]).toMatchObject({ rule: 'leave-hours-range', maxHours: 8 })
      expect((await request1('nurse1', data('病假', start, end, 8))).status).toBe(201)
    })

    it('deducts 12 hours of 特休 for the 12-hour shift and counts 12 leave hours in payroll', async () => {
      const created = await request1('nurse1', data('特休假', '2099-04-08T07:00:00+08:00', '2099-04-08T19:00:00+08:00', 12))
      expect(created.status).toBe(201)
      await approveAll(created.body._id)

      expect((await load(created.body._id)).annual_leave).toMatchObject({ state: 'deducted', hours: 12, days: 1.5 })
      expect((await Employee.findById(id('nurse1'))).annualLeave.usedHours).toBe(12)
      const impact = await payroll.calculateLeaveImpact(id('nurse1'), '2099-04-01')
      expect(impact.leaveRecords.find(record => record.leaveType === '特休假')).toMatchObject({ hours: 12 })
    })
  })

  describe('balances of every leave type, for the employee, the supervisor, the approver and the admin', () => {
    beforeAll(async () => {
      await addPerson('balEmp', { supervisor: people.boss._id, annualLeave: { totalHours: 80, usedHours: 16, year: 2099, compensatoryHours: 6, accumulatedLeave: 1 } })
      const approved = async (type, start, end, hours) => {
        const res = await request1('balEmp', data(type, start, end, hours))
        expect(res.status).toBe(201)
        await approveAll(res.body._id)
      }
      await approved('事假', '2099-05-04T09:00:00+08:00', '2099-05-04T18:00:00+08:00', 8)
      await approved('事假', '2099-05-05T09:00:00+08:00', '2099-05-05T18:00:00+08:00', 6.5)
      await approved('家庭照顧假', '2099-05-06T09:00:00+08:00', '2099-05-06T18:00:00+08:00', 8)
      await approved('病假', '2099-05-07T09:00:00+08:00', '2099-05-07T18:00:00+08:00', 4)
      await approved('生理假', '2099-05-08T09:00:00+08:00', '2099-05-08T18:00:00+08:00', 8)
      await approved('婚假', '2099-05-11T09:00:00+08:00', '2099-05-13T18:00:00+08:00', 24)
      await approved('公假', '2099-05-14T09:00:00+08:00', '2099-05-14T18:00:00+08:00', 8)
      // 簽核中的一張：還沒核准，只算簽核中
      expect((await request1('balEmp', data('事假', '2099-05-18T09:00:00+08:00', '2099-05-18T18:00:00+08:00', 3))).status).toBe(201)
    })

    const item = (body, key) => body.items.find(entry => entry.key === key)

    it('shows the employee every leave type in hours with the day equivalent: used, pending, remaining and what counts against what', async () => {
      const res = await get('balEmp', '/api/approvals/leave-balances?year=2099')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ year: 2099, dayHours: 8, maxHoursPerDay: 8, minUnitHours: 0.5, employee: { name: 'balEmp' } })
      expect(item(res.body, 'annual')).toMatchObject({ quotaHours: 80, usedHours: 16, remainingHours: 64, remainingDays: 8, source: 'employee' })
      // 事假 14.5 自己 + 8 家庭照顧假 = 22.5；簽核中 3
      expect(item(res.body, 'personal')).toMatchObject({ quotaHours: 112, usedHours: 22.5, pendingHours: 3, remainingHours: 89.5, availableHours: 86.5 })
      expect(item(res.body, 'personal').includes).toEqual([{ key: 'family_care', name: '家庭照顧假', approvedHours: 8, pendingHours: 0, hours: 8 }])
      expect(item(res.body, 'family_care')).toMatchObject({ usedHours: 8, remainingHours: 48 })
      expect(item(res.body, 'sick')).toMatchObject({ quotaHours: 240, usedHours: 4, remainingHours: 236, includes: [] }) // 生理假 8 小時在免計的 24 小時內
      expect(item(res.body, 'menstrual')).toMatchObject({ quotaHours: 96, usedHours: 8, remainingHours: 88 })
      expect(item(res.body, 'marriage')).toMatchObject({ period: 'event', quotaHours: 64, usedHours: 24, remainingHours: null })
      expect(item(res.body, 'official')).toMatchObject({ quotaHours: null, usedHours: 8, status: 'unlimited' })
      expect(item(res.body, 'comp')).toMatchObject({ quotaHours: 6, status: 'manual' })
      expect(item(res.body, 'accumulated')).toMatchObject({ quotaHours: 8, status: 'manual' })
      expect(res.body.unmatched).toEqual([])
    })

    // 「含家庭照顧假 N 小時」在「已使用」底下只能是已核准的；簽核中的家庭照顧假另外帶，畫面放在「簽核中」
    it('carries the approved and the pending hours of 家庭照顧假 separately in the includes line (the pending hours are not part of 已使用)', async () => {
      await addPerson('balPending', { supervisor: people.boss._id, annualLeave: { totalHours: 80, usedHours: 0, year: 2099 } })
      const filed = async (type, day, hours, approve) => {
        const res = await request1('balPending', data(type, `2099-06-${day}T09:00:00+08:00`, `2099-06-${day}T18:00:00+08:00`, hours))
        expect(res.status).toBe(201)
        if (approve) await approveAll(res.body._id)
      }
      await filed('事假', '01', 8, true)
      await filed('家庭照顧假', '02', 4, true)
      await filed('家庭照顧假', '03', 2, false)

      const res = await get('balPending', '/api/approvals/leave-balances?year=2099')

      expect(res.status).toBe(200)
      expect(item(res.body, 'personal')).toMatchObject({ usedHours: 12, pendingHours: 2 }) // 已使用 8 + 4；簽核中 2
      expect(item(res.body, 'personal').includes).toEqual([{ key: 'family_care', name: '家庭照顧假', approvedHours: 4, pendingHours: 2, hours: 6 }])
      expect(item(res.body, 'family_care')).toMatchObject({ usedHours: 4, pendingHours: 2 })
    })

    it('shows the same balances to the direct supervisor, to a step approver of that employee and to the admin, and to nobody else', async () => {
      const url = `/api/approvals/leave-balances?employeeId=${id('balEmp')}&year=2099`
      for (const viewer of ['boss', 'hr', 'admin']) {
        const res = await get(viewer, url)
        expect(res.status).toBe(200)
        expect(item(res.body, 'personal').usedHours).toBe(22.5)
      }
      const stranger = await get('stranger', url)
      expect(stranger.status).toBe(404)
      expect(stranger.body).toEqual({ error: '找不到這位員工的資料' })
      expect((await get('nurse2', url)).status).toBe(404)
      // 本人不帶 employeeId 就是自己
      expect(item((await get('balEmp', '/api/approvals/leave-balances?year=2099')).body, 'personal').usedHours).toBe(22.5)
    })

    it('rejects a bad employee id or year, and is not swallowed by GET /api/approvals/:id', async () => {
      expect((await get('balEmp', '/api/approvals/leave-balances?employeeId=abc')).status).toBe(400)
      expect((await get('balEmp', '/api/approvals/leave-balances?year=1900')).status).toBe(400)
      expect((await get('balEmp', '/api/approvals/leave-balances')).status).toBe(200)
    })

    it('puts the applicant\'s balances in the request detail the supervisor and HR open, with this request\'s effect on its type', async () => {
      const pending = await request1('balEmp', data('事假', '2099-05-19T09:00:00+08:00', '2099-05-19T18:00:00+08:00', 8))
      const detail = await get('boss', `/api/approvals/${pending.body._id}`)

      expect(detail.status).toBe(200)
      expect(detail.body.leave_balances).toMatchObject({ year: 2099, employee: { name: 'balEmp' } })
      // 這張單自己不算在「核准前」的簽核中時數裡：之前簽核中只有 3 小時那一張
      expect(item(detail.body.leave_balances, 'personal').pendingHours).toBe(3)
      expect(detail.body.leave_balances.focus).toMatchObject({
        typeKey: 'personal', requestedHours: 8, remainingBefore: 86.5, remainingAfter: 78.5, exceeded: false,
      })
      expect(detail.body.leave_balance).toMatchObject({ totalHours: 80, usedHours: 16, remainingHours: 64 }) // 舊欄位仍在，附上時數
      expect((await get('hr', `/api/approvals/${pending.body._id}`)).body.leave_balances).toBeTruthy()
    })
  })

  describe('quotas: 特休 blocks, 事假 warns by default and blocks when the admin switches it on', () => {
    it('blocks a 特休 request above the remaining hours, with hours in the message, and lets the exact remainder through', async () => {
      const tooMuch = await request1('nurse3', data('特休假', tw('16', '09:00'), tw('17', '18:00'), 16))
      expect(tooMuch.status).toBe(400)
      expect(tooMuch.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 8, requestedHours: 16 })
      expect(tooMuch.body.error).toBe('特休餘額不足：剩餘 8 小時（1 天），本次申請 16 小時（2 天）')

      const exact = await request1('nurse3', data('特休假', tw('16', '09:00'), tw('16', '18:00'), 8))
      expect(exact.status).toBe(201)
      await approveAll(exact.body._id)
      expect((await Employee.findById(id('nurse3'))).annualLeave.usedHours).toBe(16)

      // 用完之後再申請任何時數都被擋下
      const none = await request1('nurse3', data('特休假', tw('18', '09:00'), tw('18', '13:00'), 0.5))
      expect(none.status).toBe(400)
      expect(none.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 0, requestedHours: 0.5 })
    })

    // 特休超過剩餘時數一律擋下：設定頁的開關對特休不適用，API 存成 warn 也還是 block，餘額與簽核明細也回報 block
    it('keeps 特休 blocking whatever the admin tries to save (warn / none): the policy, the balances and the request all say block', async () => {
      for (const enforcement of ['warn', 'none']) {
        const saved = await put('admin', '/api/other-control-settings/leave-policy', { types: [{ key: 'annual', enforcement }] })
        expect(saved.status).toBe(200)
        expect(saved.body.policy.types.find(entry => entry.key === 'annual').enforcement).toBe('block')
      }
      const read = await get('admin', '/api/other-control-settings/leave-policy')
      expect(read.body.policy.types.find(entry => entry.key === 'annual').enforcement).toBe('block')
      const balances = await get('nurse3', '/api/approvals/leave-balances')
      expect(balances.body.items.find(entry => entry.key === 'annual')).toMatchObject({ enforcement: 'block', source: 'employee' })

      const over = await request1('nurse3', data('特休假', tw('23', '09:00'), tw('24', '18:00'), 16))
      expect(over.status).toBe(400)
      expect(over.body.code).toBe('ANNUAL_LEAVE_INSUFFICIENT')
    })

    it('files an over-quota 事假 anyway but warns (default), and the approvers see it in the detail', async () => {
      await addPerson('quota1', { supervisor: people.boss._id })
      // 先用掉 104 小時（13 天）事假
      for (const day of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13']) {
        const filed = await request1('quota1', data('事假', `2098-06-${day}T09:00:00+08:00`, `2098-06-${day}T18:00:00+08:00`, 8))
        expect(filed.status).toBe(201)
        expect(filed.body.warnings).toBeUndefined()
        await approveAll(filed.body._id)
      }

      const over = await request1('quota1', data('事假', '2098-07-01T09:00:00+08:00', '2098-07-02T18:00:00+08:00', 16))
      expect(over.status).toBe(201)
      expect(over.body.warnings).toEqual([expect.objectContaining({
        code: 'LEAVE_QUOTA_EXCEEDED',
        typeKey: 'personal',
        requestedHours: 16,
        message: '事假今年額度 112 小時，已使用 104 小時，可請 8 小時，本次申請 16 小時，將超出 8 小時',
      })])
      expect(await ApprovalRequest.exists({ _id: over.body._id })).toBeTruthy()

      const detail = await get('boss', `/api/approvals/${over.body._id}`)
      expect(detail.body.leave_balances.focus).toMatchObject({ typeKey: 'personal', exceeded: true, remainingBefore: 8, remainingAfter: -8, enforcement: 'warn' })
    })

    it('blocks the same request once the admin switches 事假 to block, and the setting is admin only', async () => {
      expect((await get('quota1', '/api/other-control-settings/leave-policy')).status).toBe(403)
      expect((await put('boss', '/api/other-control-settings/leave-policy', {})).status).toBe(403)

      const current = await get('admin', '/api/other-control-settings/leave-policy')
      expect(current.status).toBe(200)
      expect(current.body.policy.types.find(entry => entry.key === 'personal')).toMatchObject({ quotaHours: 112, enforcement: 'warn' })
      expect(current.body.defaults.types.find(entry => entry.key === 'annual')).toMatchObject({ enforcement: 'block' })

      const invalid = await put('admin', '/api/other-control-settings/leave-policy', { maxHoursPerDay: 0 })
      expect(invalid.status).toBe(400)
      expect(invalid.body).toEqual({ error: '每日最多可請時數必須介於 1 至 24 小時' })

      const saved = await put('admin', '/api/other-control-settings/leave-policy', { types: [{ key: 'personal', enforcement: 'block' }] })
      expect(saved.status).toBe(200)
      expect(saved.body.policy.types.find(entry => entry.key === 'personal').enforcement).toBe('block')

      const blocked = await request1('quota1', data('事假', '2098-07-06T09:00:00+08:00', '2098-07-07T18:00:00+08:00', 16))
      expect(blocked.status).toBe(400)
      expect(blocked.body).toMatchObject({ code: 'LEAVE_QUOTA_INSUFFICIENT', typeKey: 'personal', requestedHours: 16 })
      expect(blocked.body.error).toContain('將超出')
      expect(blocked.body.error).toContain('無法送出')
      // 簽核中的 16 小時也算占用額度（104 + 16 > 112）：同一個人再申請 8 小時一樣被擋
      expect((await request1('quota1', data('事假', '2098-07-08T09:00:00+08:00', '2098-07-08T18:00:00+08:00', 8))).status).toBe(400)
      // 另一位還有額度的員工，在額度內照常送出
      await addPerson('quota2', { supervisor: people.boss._id })
      expect((await request1('quota2', data('事假', '2098-07-08T09:00:00+08:00', '2098-07-08T18:00:00+08:00', 8))).status).toBe(201)

      // 其他假別不受影響（病假還是只警告），然後把 事假 改回只警告
      const restored = await put('admin', '/api/other-control-settings/leave-policy', { types: [{ key: 'personal', enforcement: 'warn' }] })
      expect(restored.status).toBe(200)
      expect((await request1('quota1', data('事假', '2098-07-09T09:00:00+08:00', '2098-07-10T18:00:00+08:00', 16))).status).toBe(201)
    })

    it('changes the daily maximum for everybody from the setting (12-hour shifts)', async () => {
      const saved = await put('admin', '/api/other-control-settings/leave-policy', { maxHoursPerDay: 12 })
      expect(saved.status).toBe(200)

      const twelve = await request1('nurse2', data('病假', '2099-06-02T07:00:00+08:00', '2099-06-02T19:00:00+08:00', 12))
      expect(twelve.status).toBe(201)
      const balances = await get('nurse2', '/api/approvals/leave-balances?year=2099')
      expect(balances.body.maxHoursPerDay).toBe(12)

      await put('admin', '/api/other-control-settings/leave-policy', { maxHoursPerDay: 8 })
      expect((await request1('nurse2', data('病假', '2099-06-03T07:00:00+08:00', '2099-06-03T19:00:00+08:00', 12))).status).toBe(400)
    })
  })

  describe('the migration on a mixed dataset is idempotent and leaves old data readable', () => {
    let customer
    let resetLeaveFieldCache
    const OLD_UPDATED_AT = new Date('2026-09-01T00:00:00.000Z')

    beforeAll(async () => {
      // 客戶原本的休假申請單：假別類別（字典）、日期起迄、必填的天數
      customer = await makeForm({
        name: '休假/事假/公假申請單',
        fields: [
          { label: '假別類別 (C12)', type_1: 'select', options: ['特休假', '事假', '公假'], required: true },
          { label: '日期(起)', type_1: 'date', required: true },
          { label: '日期(迄)', type_1: 'date', required: true },
          { label: '天數', type_1: 'number', required: true },
        ],
        steps: [managerStep],
      })
      // 這張表單是直接寫進資料庫的（不經過表單編輯 API），請假欄位對應的快取要手動清掉
      ;({ resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js'))
      resetLeaveFieldCache()
      await addPerson('legacyA', { supervisor: people.boss._id })
      await addPerson('legacyB', { supervisor: people.boss._id })
      await addPerson('legacyC', { supervisor: people.boss._id })
      await addPerson('legacyD', { supervisor: people.boss._id })
      await addPerson('alreadyHours', { supervisor: people.boss._id })
      // 舊格式（只有天數欄位）：14 與已用 2；客戶輸入成小時的 170（已用 8）；沒設定；沒有特休資料；已經是時數的員工
      // 資料裡有 170，整份資料的慣例就是「小時填在天數欄位」，所以 14 也是 14 小時（不是 14 天）
      // updatedAt 先寫成固定的舊日期：搬移不是人工修改，不能動到它
      const raw = Employee.collection
      await raw.updateOne({ _id: people.legacyA._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 14, usedDays: 2, year: 2099, accumulatedLeave: 1, notes: '備註A' } } })
      await raw.updateOne({ _id: people.legacyB._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 170, usedDays: 8, year: 2099 } } })
      await raw.updateOne({ _id: people.legacyC._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 0, usedDays: 0, year: 2099 } } })
      await raw.updateOne({ _id: people.legacyD._id }, { $unset: { annualLeave: 1 } })
      await raw.updateOne({ _id: people.alreadyHours._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalHours: 40, usedHours: 8, totalDays: 99, usedDays: 99, year: 2099, unitSource: 'entered' } } })
      // 一張舊的已核准假單（天數欄位 2 天，客戶表單的欄位）：薪資與餘額必須在搬移前後讀到一樣的結果
      await ApprovalRequest.create({
        form: customer.form._id,
        workflow: customer.workflow._id,
        applicant_employee: people.legacyA._id,
        status: 'approved',
        form_data: {
          [fieldId(customer, '假別類別 (C12)')]: '事假',
          [fieldId(customer, '日期(起)')]: '2099-08-03',
          [fieldId(customer, '日期(迄)')]: '2099-08-07',
          [fieldId(customer, '天數')]: 2,
        },
      })
    })

    it('decides the unit for the whole data set (170 in the file means 14 is 14 hours too), repairs nothing it should not, keeps updatedAt and does nothing the second time', async () => {
      const beforeImpact = await payroll.calculateLeaveImpact(id('legacyA'), '2099-08-01')
      const beforeBalances = (await get('admin', `/api/approvals/leave-balances?employeeId=${id('legacyA')}&year=2099`)).body

      const first = await migrations.migrateAnnualLeaveToHours()
      expect(first.migrated).toBeGreaterThanOrEqual(3) // legacyA、B、C 之外還有前面測試建立的員工（只有 totalDays 預設值 0）
      expect(first.fromDays).toBeGreaterThanOrEqual(1) // 數字都是 0 的員工沒有東西要判斷
      expect(first.alreadyHours).toBe(2) // legacyA（14）跟著整份資料，legacyB（170）本來就是小時

      const read = async (key) => (await Employee.collection.findOne({ _id: people[key]._id })).annualLeave
      expect(await read('legacyA')).toMatchObject({ totalHours: 14, usedHours: 2, unitSource: 'migrated-hours', totalDays: 14, usedDays: 2, accumulatedLeave: 1, notes: '備註A' })
      expect(await read('legacyB')).toMatchObject({ totalHours: 170, usedHours: 8, unitSource: 'migrated-hours', totalDays: 170 })
      expect(await read('legacyC')).toMatchObject({ totalHours: 0, usedHours: 0, unitSource: 'migrated-days' })
      expect(await read('alreadyHours')).toMatchObject({ totalHours: 40, usedHours: 8, unitSource: 'entered', totalDays: 99 }) // 已經搬過的不再動
      expect((await Employee.collection.findOne({ _id: people.legacyD._id })).annualLeave).toBeUndefined() // 沒有特休資料的不建立
      // 搬移不是人工修改：搬過的與沒搬的員工 updatedAt 都沒變（bulkWrite 要在每個 updateOne 上關掉 timestamps）
      for (const key of ['legacyA', 'legacyB', 'legacyC', 'alreadyHours']) {
        expect((await Employee.collection.findOne({ _id: people[key]._id })).updatedAt).toEqual(OLD_UPDATED_AT)
      }

      const second = await migrations.migrateAnnualLeaveToHours()
      expect(second).toEqual({ migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0, flagged: 0 })

      // 搬移前後，同一個人的薪資請假與餘額相同
      const afterImpact = await payroll.calculateLeaveImpact(id('legacyA'), '2099-08-01')
      expect(afterImpact).toEqual(beforeImpact)
      expect(afterImpact.leaveHours).toBe(16)
      const afterBalances = (await get('admin', `/api/approvals/leave-balances?employeeId=${id('legacyA')}&year=2099`)).body
      expect(afterBalances.items.find(entry => entry.key === 'annual')).toMatchObject({ quotaHours: 14, usedHours: 2, remainingHours: 12 })
      expect(afterBalances.items.find(entry => entry.key === 'personal').usedHours).toBe(beforeBalances.items.find(entry => entry.key === 'personal').usedHours)
    })

    it('an already migrated data set (the earlier per-person rule): only the guesses are flagged, the numbers and updatedAt are untouched, and it is idempotent', async () => {
      await addPerson('guessed24', { supervisor: people.boss._id })
      await addPerson('guessed14', { supervisor: people.boss._id })
      await addPerson('editedByHr', { supervisor: people.boss._id })
      await addPerson('confirmedByHr', { supervisor: people.boss._id })
      await addPerson('noData', { supervisor: people.boss._id })
      const raw = Employee.collection
      // 舊規則搬過的結果：24 被當成 3 天（192 小時）、14 被當成 14 天；人資改過總時數的、人資確認過的、沒有資料的
      await raw.updateOne({ _id: people.guessed24._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 24, usedDays: 0, totalHours: 192, usedHours: 0, unitSource: 'migrated-days', year: 2099 } } })
      await raw.updateOne({ _id: people.guessed14._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 14, usedDays: 2, totalHours: 112, usedHours: 24, unitSource: 'migrated-days', year: 2099 } } })
      await raw.updateOne({ _id: people.editedByHr._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 14, usedDays: 0, totalHours: 100, usedHours: 0, unitSource: 'entered', year: 2099 } } })
      await raw.updateOne({ _id: people.confirmedByHr._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 10, usedDays: 0, totalHours: 80, usedHours: 0, unitSource: 'entered', year: 2099 } } })
      await raw.updateOne({ _id: people.noData._id }, { $set: { updatedAt: OLD_UPDATED_AT, annualLeave: { totalDays: 0, usedDays: 0, totalHours: 0, usedHours: 0, unitSource: 'migrated-days', year: 2099 } } })

      const first = await migrations.migrateAnnualLeaveToHours()
      expect(first).toMatchObject({ migrated: 0, flagged: 2 })

      const read = async (key) => Employee.collection.findOne({ _id: people[key]._id })
      expect((await read('guessed24')).annualLeave).toMatchObject({ totalHours: 192, usedHours: 0, unitSource: 'migrated-hours', totalDays: 24 }) // 數字不動，只是標成待確認
      expect((await read('guessed14')).annualLeave).toMatchObject({ totalHours: 112, usedHours: 24, unitSource: 'migrated-hours', totalDays: 14, usedDays: 2 })
      expect((await read('editedByHr')).annualLeave).toMatchObject({ totalHours: 100, unitSource: 'entered' })
      expect((await read('confirmedByHr')).annualLeave).toMatchObject({ totalHours: 80, unitSource: 'entered' })
      expect((await read('noData')).annualLeave).toMatchObject({ totalHours: 0, unitSource: 'migrated-days' })
      for (const key of ['guessed24', 'guessed14', 'editedByHr', 'confirmedByHr', 'noData']) {
        expect((await read(key)).updatedAt).toEqual(OLD_UPDATED_AT)
      }
      // 員工 API 帶著待確認的標記，員工管理畫面據此顯示提醒
      expect((await get('admin', `/api/employees/${id('guessed24')}`)).body.annualLeave).toMatchObject({ totalHours: 192, unitSource: 'migrated-hours' })

      // 冪等：再執行一次什麼都不會變
      expect(await migrations.migrateAnnualLeaveToHours()).toEqual({ migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0, flagged: 0 })
      expect((await read('guessed24')).annualLeave).toMatchObject({ totalHours: 192, unitSource: 'migrated-hours' })

      // 給人資核對的清單：凍結的天數、現在的時數、單位來源
      const report = await migrations.buildAnnualLeaveUnitReport()
      expect(report.hoursConvention).toBe(true)
      const row = (name) => report.rows.find(item => item.name === name)
      expect(row('guessed24')).toMatchObject({ totalDays: 24, usedDays: 0, totalHours: 192, usedHours: 0, unitSource: 'migrated-hours', reading: 'days x8' })
      expect(row('legacyB')).toMatchObject({ totalDays: 170, totalHours: 170, unitSource: 'migrated-hours', reading: 'as hours' })
      expect(row('confirmedByHr')).toBeUndefined()
      expect(row('noData')).toBeUndefined()

      // 人資在員工管理確認（勾選）之後變成 entered，之後不會再被標記
      const confirmed = await request(app).put(`/api/employees/${id('guessed24')}`).set(as('admin')).send({ annualLeave: { unitConfirmed: true } })
      expect(confirmed.status).toBe(200)
      expect((await read('guessed24')).annualLeave).toMatchObject({ totalHours: 192, unitSource: 'entered' })
      expect(await migrations.flagGuessedAnnualLeaveUnits()).toBe(0)
      expect((await read('guessed24')).annualLeave).toMatchObject({ unitSource: 'entered' })
    })

    it('adds the 時數 field to the customer form once, deactivates 天數 (never deletes it) and never re-adds a field the admin removed', async () => {
      const first = await migrations.migrateLeaveFormsToHours()
      expect(first.forms).toBeGreaterThanOrEqual(1)
      expect(first.added).toBeGreaterThanOrEqual(1)

      const fields = await FormField.find({ form: customer.form._id }).lean()
      const hours = fields.filter(field => field.label === '時數')
      expect(hours).toHaveLength(1)
      expect(hours[0]).toMatchObject({ type_1: 'number', required: true, is_active: true })
      expect(fields.find(field => field.label === '天數')).toMatchObject({ is_active: false })
      expect((await FormTemplate.findById(customer.form._id)).leave_hours_migrated).toBe(true)
      // 時數欄位放在原本天數欄位的位置
      expect(hours[0].order).toBe(fields.find(field => field.label === '天數').order)

      expect(await migrations.migrateLeaveFormsToHours()).toEqual({ forms: 0, added: 0, deactivated: 0 })
      expect(await FormField.countDocuments({ form: customer.form._id, label: '時數' })).toBe(1)

      // 管理員之後自己把時數欄位刪掉（停用）：不會再被補回來
      await FormField.updateOne({ _id: hours[0]._id }, { $set: { is_active: false } })
      expect(await migrations.migrateLeaveFormsToHours()).toEqual({ forms: 0, added: 0, deactivated: 0 })
    })

    it('files the next request on the migrated customer form with hours, and the old days answer is still counted for the old request', async () => {
      await FormField.updateOne({ form: customer.form._id, label: '時數' }, { $set: { is_active: true } })
      resetLeaveFieldCache()

      const created = await post('legacyA', '/api/approvals', {
        form_id: String(customer.form._id),
        form_data: {
          [fieldId(customer, '假別類別 (C12)')]: '特休假',
          [fieldId(customer, '日期(起)')]: '2099-09-07T00:00:00+08:00',
          [fieldId(customer, '日期(迄)')]: '2099-09-08T00:00:00+08:00',
          [(await FormField.findOne({ form: customer.form._id, label: '時數' }))._id.toString()]: 12,
        },
      })
      expect(created.status).toBe(201)
      expect((await post('boss', `/api/approvals/${created.body._id}/act`, { decision: 'approve' })).status).toBe(200)
      expect((await load(created.body._id)).annual_leave).toMatchObject({ state: 'deducted', hours: 12 })
      expect((await Employee.findById(id('legacyA'))).annualLeave.usedHours).toBe(14) // 搬來的 2 + 12

      // 舊單據（只有天數答案）照樣是 16 小時
      const balances = (await get('admin', `/api/employees/${id('legacyA')}/annual-leave/history?year=2099`)).body
      expect(balances.map(entry => entry.hours)).toEqual([12])
    })

    it('hours are shown in the employee API, also for a document that is still on the old day fields', async () => {
      await addPerson('stillLegacy', { supervisor: people.boss._id })
      await Employee.collection.updateOne({ _id: people.stillLegacy._id }, { $set: { annualLeave: { totalDays: 10, usedDays: 4, year: 2099 } } })

      const detail = await get('admin', `/api/employees/${id('stillLegacy')}`)
      expect(detail.status).toBe(200)
      expect(detail.body.annualLeave).toMatchObject({ totalHours: 80, usedHours: 32, remainingHours: 48, remainingDays: 6 })

      const list = await get('admin', '/api/employees?pageSize=100')
      const row = list.body.employees.find(employee => employee.name === 'stillLegacy')
      expect(row.annualLeave).toMatchObject({ totalHours: 80, remainingHours: 48 })

      // 這時扣減也能成功：第一次扣減時把這位員工換成時數
      const { deductAnnualLeave } = await import('../src/services/annualLeaveService.js')
      await deductAnnualLeave(people.stillLegacy._id, 8, new mongoose.Types.ObjectId().toString())
      expect((await Employee.collection.findOne({ _id: people.stillLegacy._id })).annualLeave).toMatchObject({ totalHours: 80, usedHours: 40, unitSource: 'migrated-days' })
    })
  })
})
