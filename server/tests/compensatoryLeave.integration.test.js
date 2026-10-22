// 調休存摺的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 客戶 2026-10 的要求：國定假日落在休息日 -> 存入調休（記錄來源）-> 員工自己決定要不要用 -> 發起簽核 -> 核准扣用、撤回返還。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27501 npm test -- tests/compensatoryLeave.integration.test.js
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
    throw new Error('Compensatory leave integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_comp_leave_${process.pid}_${Date.now()}`
  return uri.toString()
}

const utc = (key) => new Date(`${key}T00:00:00.000Z`)

describeIntegration('調休存摺 against a real MongoDB through the real app', () => {
  jest.setTimeout(90000)
  let app
  let models
  let bankService
  let resolver
  let payroll
  const people = {}
  const secret = 'integration-test-secret-integration-test-secret'
  let leave
  let shifts

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const get = (key, url) => request(app).get(url).set(as(key))
  const post = (key, url, body) => request(app).post(url).set(as(key)).send(body ?? {})
  const id = (key) => String(people[key]._id)
  const fieldId = (label) => String(leave.fields.find(field => field.label === label)._id)
  const leaveData = (type, start, end, hours) => ({
    [fieldId('假別')]: type, [fieldId('開始日期')]: start, [fieldId('結束日期')]: end, [fieldId('時數')]: hours, [fieldId('事由')]: '調休',
  })
  const file = (key, type, start, end, hours) => post(key, '/api/approvals', { form_id: String(leave.form._id), form_data: leaveData(type, start, end, hours) })
  const approveAll = async (requestId) => {
    expect((await post('boss', `/api/approvals/${requestId}/act`, { decision: 'approve' })).status).toBe(200)
    const last = await post('hr', `/api/approvals/${requestId}/act`, { decision: 'approve' })
    expect(last.status).toBe(200)
    return last
  }
  const bankOf = async (key) => (await get(key, '/api/compensatory-leave/mine')).body
  const creditsOf = (key) => models.CompensatoryCredit.find({ employee: people[key]._id }).sort({ earnedDate: 1, createdAt: 1 }).lean()
  const dayType = async (key, dateKey) => {
    const person = await models.Employee.findById(people[key]._id).lean()
    const context = await resolver.loadHolidayContext({ start: dateKey, end: new Date(utc(dateKey).getTime() + 86400000), employees: [person] })
    return resolver.resolveDayType(context, person, dateKey, { rosterKind: undefined })
  }

  async function addPerson(key, patch = {}) {
    people[key] = await models.Employee.create({
      name: key, email: `${key}@example.test`, username: key, role: 'employee', organization: 'org-1', ...patch,
    })
    return people[key]
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
      Holiday: (await import('../src/models/Holiday.js')).default,
      CalendarYear: (await import('../src/models/CalendarYear.js')).default,
      CompensatoryCredit: (await import('../src/models/CompensatoryCredit.js')).default,
      CompensatoryLeaveState: (await import('../src/models/CompensatoryLeaveState.js')).default,
      HolidayCompensation: (await import('../src/models/HolidayCompensation.js')).default,
    }
    bankService = await import('../src/services/compensatoryLeaveService.js')
    resolver = await import('../src/services/holidayResolver.js')
    payroll = await import('../src/services/workHoursCalculationService.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(models).map(model => model.syncIndexes()))

    // 部署當天（2026-10-22）第一次啟動：行政人員的公務機關補假日從 10/23 起只是建議調休日
    const state = await bankService.ensureCompensatoryLeaveState({ now: new Date('2026-10-22T04:00:00.000Z') })
    expect(state.officeGovMakeupCutover).toBe('2026-10-23')

    await models.CalendarYear.create({ year: 2026, state: 'approved' })
    await models.Holiday.create([
      { date: utc('2026-10-10'), name: '國慶日', kind: 'statutory', archived: false },
      { date: utc('2026-10-25'), name: '臺灣光復暨金門古寧頭大捷紀念日', kind: 'statutory', archived: false },
      { date: utc('2026-12-25'), name: '行憲紀念日', kind: 'statutory', archived: false },
      { date: utc('2026-10-09'), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc('2026-10-10'), compensatesName: '國慶日', archived: false },
      { date: utc('2026-10-26'), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc('2026-10-25'), compensatesName: '臺灣光復暨金門古寧頭大捷紀念日', archived: false },
    ])
    const setting = await models.AttendanceSetting.create({
      shifts: [
        { name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
        { name: '國定假日', code: '國', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
      ],
    })
    shifts = Object.fromEntries(setting.shifts.map(shift => [shift.code, shift._id]))

    await addPerson('admin', { role: 'admin' })
    await addPerson('boss', { role: 'supervisor' })
    await addPerson('hr', { signTags: ['人資'] })
    await addPerson('stranger')
    const office = { supervisor: people.boss._id, requiresScheduling: false, holidayRegime: 'office', salaryType: '月薪', salaryAmount: 36000 }
    await addPerson('officeA', office)
    await addPerson('officeB', office)
    await addPerson('nurse', { supervisor: people.boss._id, holidayRegime: 'roster', salaryType: '月薪', salaryAmount: 48000 })

    // 護理師十月的班表（已完成發布）：10/10 國慶日是她的例假，10/25 排了「國」
    const rows = [['2026-10-09', '日'], ['2026-10-10', '例'], ['2026-10-11', '休'], ['2026-10-12', '日'], ['2026-10-25', '國'],
      ['2026-11-16', '日'], ['2026-11-17', '日']]
    await models.ShiftSchedule.create(rows.map(([key, code]) => ({ employee: people.nurse._id, date: utc(key), shiftId: shifts[code], state: 'finalized' })))

    const form = await models.FormTemplate.create({ name: '請假', semanticType: 'leave', is_active: true })
    const fields = []
    for (const [index, field] of [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number', required: true },
      { label: '事由', type_1: 'text' },
    ].entries()) fields.push(await models.FormField.create({ form: form._id, order: index + 1, ...field }))
    await models.ApprovalWorkflow.create({
      form: form._id,
      steps: [
        { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true },
        { step_order: 2, approver_type: 'tag', approver_value: '人資', all_must_approve: true, is_required: true, can_return: true },
      ],
    })
    leave = { form, fields }
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('國定假日落在休息日：存入調休，記錄來源，預設保存', () => {
    it('banks 2026-10-25 (Sunday) for office staff with its source, and does not give them the Monday off automatically', async () => {
      const synced = await post('admin', '/api/holiday-ledger/compensations/sync', { from: '2026-10', to: '2026-10' })
      expect(synced.status).toBe(200)
      expect(synced.body.created).toBe(3) // 兩位行政人員的 10/25、護理師的 10/10

      const bank = await bankOf('officeA')
      expect(bank).toMatchObject({ balanceHours: 8, pendingHours: 0, availableHours: 8, hoursPerCredit: 8, expiryMonths: 0 })
      expect(bank.credits).toHaveLength(1)
      expect(bank.credits[0]).toMatchObject({
        sourceText: '2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日', status: 'available', statusLabel: '未使用',
        hours: 8, remainingHours: 8, suggestedDate: '2026-10-26', usages: [],
      })
      // 10/26 只是建議調休日：不是她的假日；10/9（切換日之前）照舊是行政人員的補假
      expect((await dayType('officeA', '2026-10-26')).dayType).toBe('workday')
      expect((await dayType('officeA', '2026-10-09')).verdict).toMatchObject({ holiday: true, reason: 'gov_makeup' })

      const headers = await get('officeA', '/api/holiday-calendar/headers?month=2026-10')
      expect(headers.body.entries.filter(entry => entry.date === '2026-10-26').map(entry => [entry.label, entry.appliesTo])).toEqual([
        ['公務機關補假', 'roster'], ['建議調休日', 'office'],
      ])
    })

    it('banks the holiday on the nurse\'s rostered 例 (10/10) but not the one she rested on (10/25)', async () => {
      const [credit] = await creditsOf('nurse')
      expect(credit).toMatchObject({ reason: 'regular_rest', holidayName: '國慶日', hours: 8, status: 'available', suggestedDate: utc('2026-10-12') })
      expect((await bankOf('nurse')).credits.map(item => item.sourceText)).toEqual(['2026-10-10 國慶日 適逢例假'])
      // 同步可以重複執行
      const again = await post('admin', '/api/holiday-ledger/compensations/sync', { from: '2026-10', to: '2026-10' })
      expect(again.body).toMatchObject({ created: 0, voided: 0, reopened: 0, conflicts: 0 })
      expect(await models.CompensatoryCredit.countDocuments({})).toBe(3)
    })

    it('shows the banked holiday in the ledger as compensated without anything for HR to do', async () => {
      const ledger = await get('admin', '/api/holiday-ledger?month=2026-10')
      expect(ledger.status).toBe(200)
      const nurse = ledger.body.months[0].employees.find(row => row.employeeId === id('nurse'))
      expect(nurse.items.find(item => item.originalDate === '2026-10-10')).toMatchObject({ status: 'compensated', needsAction: null, compensation: { via: 'bank', creditStatus: 'available' } })
      expect(ledger.body.summary).toMatchObject({ compensationOpen: 0, banked: 3 })
    })

    it('lets the employee, the supervisor and an admin read the bank, and nobody else', async () => {
      expect((await get('nurse', `/api/compensatory-leave?employeeId=${id('nurse')}`)).status).toBe(200)
      expect((await get('boss', `/api/compensatory-leave?employeeId=${id('nurse')}`)).status).toBe(200)
      expect((await get('admin', `/api/compensatory-leave?employeeId=${id('nurse')}`)).status).toBe(200)
      expect((await get('stranger', `/api/compensatory-leave?employeeId=${id('nurse')}`)).status).toBe(404)
      expect((await get('nurse', `/api/compensatory-leave?employeeId=${id('officeA')}`)).status).toBe(404)
      expect((await post('nurse', '/api/compensatory-leave/credits', { employeeId: id('nurse'), hours: 8, note: '自己加' })).status).toBe(403)
    })
  })

  describe('使用調休：發起簽核，餘額不夠就擋下，核准扣用、那天具國定假日性質', () => {
    let officeRequestId

    it('files a 調休 for Monday 10/26 and blocks a second one that the bank cannot cover (pending hours count)', async () => {
      const created = await file('officeA', '調休', '2026-10-26', '2026-10-26', 8)
      expect(created.status).toBe(201)
      officeRequestId = created.body._id
      expect(await bankOf('officeA')).toMatchObject({ balanceHours: 8, pendingHours: 8, availableHours: 0 })

      const more = await file('officeA', '補休', '2026-10-27', '2026-10-27', 4)
      expect(more.status).toBe(400)
      expect(more.body).toMatchObject({ code: 'COMP_LEAVE_INSUFFICIENT', availableHours: 0, requestedHours: 4, pendingHours: 8 })
      expect(more.body.error).toContain('調休餘額不足')

      const stranger = await file('stranger', '調休', '2026-10-27', '2026-10-27', 8)
      expect(stranger.status).toBe(400)
      expect(stranger.body.code).toBe('COMP_LEAVE_INSUFFICIENT')
    })

    it('shows the approver the applicant\'s bank in the request detail', async () => {
      const detail = await get('hr', `/api/approvals/${officeRequestId}`)
      expect(detail.status).toBe(200)
      expect(detail.body.leave_balances.compensatory).toMatchObject({ focus: true, balanceHours: 8, thisRequest: null })
      expect(detail.body.leave_balances.compensatory.credits.map(item => item.sourceText)).toEqual(['2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日'])
      expect(detail.body.leave_balances.focus).toMatchObject({ typeKey: 'comp', remainingBefore: 8, remainingAfter: 0, exceeded: false })
    })

    it('consumes the credit on approval: balance 0, the day is a holiday for her (holiday work if she works), and payroll pays the day', async () => {
      const approved = await approveAll(officeRequestId)
      expect(approved.body.status).toBe('approved')
      expect(approved.body.warnings).toBeUndefined()

      const bank = await bankOf('officeA')
      expect(bank).toMatchObject({ balanceHours: 0, availableHours: 0, usedHours: 8 })
      expect(bank.credits[0]).toMatchObject({ status: 'used', usedHours: 8 })
      expect(bank.credits[0].usages).toEqual([expect.objectContaining({
        kind: 'leave_request', hours: 8, approvalRequestId: officeRequestId, approvalStatus: 'approved', fullDayDates: ['2026-10-26'],
      })])
      const doc = await models.ApprovalRequest.findById(officeRequestId).lean()
      expect(doc.logs.map(log => log.action)).toContain('comp_leave')

      const verdict = await dayType('officeA', '2026-10-26')
      expect(verdict.dayType).toBe('national_holiday')
      expect(verdict.verdict).toMatchObject({ reason: 'compensation', via: 'comp_leave', compensatesDate: '2026-10-25' })
      // 沒有用調休的同事：10/26 是一般上班日
      expect((await dayType('officeB', '2026-10-26')).dayType).toBe('workday')

      const impact = await payroll.calculateLeaveImpact(id('officeA'), '2026-10-01')
      expect(impact.leaveRecords).toEqual([expect.objectContaining({ leaveType: '調休', hours: 8, payRate: 1, isPaid: true })])
      expect(impact).toMatchObject({ paidLeaveHours: 8, unpaidLeaveHours: 0, leaveDeduction: 0 })

      const balances = await get('officeA', '/api/approvals/leave-balances?year=2026')
      expect(balances.body.items.find(item => item.key === 'comp')).toMatchObject({ source: 'bank', remainingHours: 0, usedHours: 8, quotaHours: 8 })

      const ledger = await get('admin', '/api/holiday-ledger?month=2026-10')
      const row = ledger.body.months[0].employees.find(entry => entry.employeeId === id('officeA'))
      expect(row.items.find(item => item.originalDate === '2026-10-25')).toMatchObject({ status: 'compensated', compensation: { via: 'comp_leave', date: '2026-10-26' } })
    })

    it('lets another employee keep it and use it in November as 4 + 4 hours from the same credit', async () => {
      const first = await file('officeB', '調休', '2026-11-02', '2026-11-02', 4)
      expect(first.status).toBe(201)
      await approveAll(first.body._id)
      let [credit] = await creditsOf('officeB')
      expect(credit).toMatchObject({ status: 'available', usedHours: 4 })
      expect(credit.usages[0]).toMatchObject({ hours: 4, fullDayDates: [] })
      // 只請半天：那天不是國定假日
      expect((await dayType('officeB', '2026-11-02')).dayType).toBe('workday')

      const second = await file('officeB', '調休', '2026-11-03', '2026-11-03', 4)
      expect(second.status).toBe(201)
      await approveAll(second.body._id)
      ;[credit] = await creditsOf('officeB')
      expect(credit).toMatchObject({ status: 'used', usedHours: 8 })
      expect(credit.usages.map(usage => usage.hours)).toEqual([4, 4])
      expect(await bankOf('officeB')).toMatchObject({ balanceHours: 0, availableHours: 0 })
    })

    it('checks the bank again on the last approval: an HR deduction in between keeps the request pending', async () => {
      const manual = await post('admin', '/api/compensatory-leave/credits', { employeeId: id('officeB'), hours: 8, note: '加班換休' })
      expect(manual.status).toBe(201)
      expect(manual.body).toMatchObject({ sourceText: '人資手動給予：加班換休', remainingHours: 8 })
      const pending = await file('officeB', '調休', '2026-11-09', '2026-11-09', 8)
      expect(pending.status).toBe(201)
      expect((await post('admin', '/api/compensatory-leave/adjustments', { employeeId: id('officeB'), hours: 4 })).body.code).toBe('NOTE_REQUIRED')
      expect((await post('admin', '/api/compensatory-leave/adjustments', { employeeId: id('officeB'), hours: 4, note: '更正' })).status).toBe(201)

      expect((await post('boss', `/api/approvals/${pending.body._id}/act`, { decision: 'approve' })).status).toBe(200)
      const blocked = await post('hr', `/api/approvals/${pending.body._id}/act`, { decision: 'approve' })
      expect(blocked.status).toBe(409)
      expect(blocked.body.code).toBe('COMP_LEAVE_INSUFFICIENT')
      expect((await models.ApprovalRequest.findById(pending.body._id).lean()).status).toBe('pending')
      // 否決：沒有扣任何時數
      expect((await post('hr', `/api/approvals/${pending.body._id}/act`, { decision: 'reject', comment: '時數不足' })).status).toBe(200)
      expect(await bankOf('officeB')).toMatchObject({ balanceHours: 4, pendingHours: 0, availableHours: 4 })
    })
  })

  describe('跨好幾筆額度扣用、撤回返還、人資手動給予', () => {
    let nurseRequestId

    it('gives the nurse a manual credit and takes 12 hours over two days from the earliest credit first, the rest from the next', async () => {
      const manual = await post('admin', '/api/compensatory-leave/credits', { employeeId: id('nurse'), hours: 8, note: '值班補償', earnedDate: '2026-10-20' })
      expect(manual.status).toBe(201)
      expect(await bankOf('nurse')).toMatchObject({ balanceHours: 16, availableHours: 16 })

      const created = await file('nurse', '調休', '2026-11-16', '2026-11-17', 12)
      expect(created.status).toBe(201)
      nurseRequestId = created.body._id
      await approveAll(nurseRequestId)

      const [holiday, extra] = await creditsOf('nurse')
      expect(holiday).toMatchObject({ sourceType: 'holiday_rest', usedHours: 8, status: 'used' })
      expect(extra).toMatchObject({ sourceType: 'manual', usedHours: 4, status: 'available' })
      // 11/16 整天（日班 8 小時），11/17 只請 4 小時
      expect(holiday.usages[0]).toMatchObject({ hours: 8, fullDayDates: ['2026-11-16'] })
      expect(holiday.usages[0].days).toEqual([{ date: '2026-11-16', hours: 8 }, { date: '2026-11-17', hours: 4 }])
      expect(extra.usages[0]).toMatchObject({ hours: 4, fullDayDates: ['2026-11-16'] })
      expect((await dayType('nurse', '2026-11-16')).dayType).toBe('national_holiday')
      expect((await dayType('nurse', '2026-11-17')).verdict.holiday).toBe(false)
      expect(await bankOf('nurse')).toMatchObject({ balanceHours: 4, availableHours: 4, usedHours: 12 })
    })

    it('returns the hours when the nurse withdraws the approved 調休 before it starts, and the day is no longer a holiday', async () => {
      const canceled = await post('nurse', `/api/approvals/${nurseRequestId}/cancel`, { comment: '改期' })
      expect(canceled.status).toBe(200)
      expect(canceled.body.status).toBe('canceled')
      expect(canceled.body.logs.at(-1).message).toContain('已撤回已核准的調休，返還 12 小時')
      expect(await bankOf('nurse')).toMatchObject({ balanceHours: 16, availableHours: 16, usedHours: 0 })
      const credits = await creditsOf('nurse')
      expect(credits.map(credit => [credit.status, credit.usedHours, credit.usages.length])).toEqual([['available', 0, 0], ['available', 0, 0]])
      expect((await dayType('nurse', '2026-11-16')).verdict.holiday).toBe(false)
      // 再撤一次不會重複返還
      expect((await post('nurse', `/api/approvals/${nurseRequestId}/cancel`)).status).toBe(200)
      expect((await bankOf('nurse')).balanceHours).toBe(16)
    })

    it('frees the pending hours when a pending 調休 is withdrawn or rejected, without touching the bank', async () => {
      const withdrawn = await file('nurse', '調休', '2026-11-16', '2026-11-16', 8)
      expect((await bankOf('nurse')).pendingHours).toBe(8)
      expect((await post('nurse', `/api/approvals/${withdrawn.body._id}/cancel`)).status).toBe(200)
      const rejected = await file('nurse', '補假', '2026-11-17', '2026-11-17', 8)
      expect((await post('boss', `/api/approvals/${rejected.body._id}/act`, { decision: 'reject', comment: '人力不足' })).status).toBe(200)
      expect(await bankOf('nurse')).toMatchObject({ balanceHours: 16, pendingHours: 0, availableHours: 16 })
    })

    it('does not let the employee withdraw an approved 調休 that already started, but an admin can, returning the hours', async () => {
      const past = await file('nurse', '調休', '2026-01-05', '2026-01-05', 8)
      expect(past.status).toBe(201)
      await approveAll(past.body._id)
      expect((await bankOf('nurse')).balanceHours).toBe(8)
      const own = await post('nurse', `/api/approvals/${past.body._id}/cancel`)
      expect(own.status).toBe(409)
      expect(own.body.code).toBe('LEAVE_STARTED')
      const canceled = await post('admin', `/api/approvals/${past.body._id}/cancel`, { comment: '人資更正' })
      expect(canceled.status).toBe(200)
      expect(canceled.body.status).toBe('canceled')
      expect(await bankOf('nurse')).toMatchObject({ balanceHours: 16, usedHours: 0 })
    })
  })

  describe('部署時的資料轉換（各只做一次）', () => {
    it('moves old 補假 obligations and the 補休 hours of the employee record into the bank once', async () => {
      const migrant = await addPerson('migrant', { annualLeave: { totalHours: 0, usedHours: 0, compensatoryHours: 6 } })
      await models.HolidayCompensation.create([
        { employee: migrant._id, holidayDate: utc('2026-02-28'), holidayName: '和平紀念日', origin: 'roster_rest_day', status: 'assigned', assignedDate: utc('2026-03-02'), agreementNote: '協商於 3/2' },
        { employee: migrant._id, holidayDate: utc('2026-04-04'), holidayName: '兒童節', origin: 'roster_rest_day', status: 'open' },
      ])
      const moved = await bankService.migrateHolidayCompensationsToCredits()
      expect(moved).toMatchObject({ skipped: false, created: 2, open: 1, assigned: 1 })
      const hours = await bankService.migrateLegacyCompensatoryHours()
      expect(hours).toMatchObject({ skipped: false, created: 1, employees: 1 })

      const bank = await bankOf('migrant')
      expect(bank).toMatchObject({ balanceHours: 14, usedHours: 8 })
      expect(bank.credits.map(credit => [credit.sourceText, credit.status])).toEqual(expect.arrayContaining([
        ['2026-02-28 和平紀念日 適逢休息日', 'used'], ['2026-04-04 兒童節 適逢休息日', 'available'], ['轉入既有補休時數', 'available'],
      ]))
      // HR 指定的 3/2 仍是她的假日
      expect((await dayType('migrant', '2026-03-02')).verdict).toMatchObject({ holiday: true, reason: 'compensation', via: 'hr_assigned' })

      expect(await bankService.migrateHolidayCompensationsToCredits()).toMatchObject({ skipped: true })
      expect(await bankService.migrateLegacyCompensatoryHours()).toMatchObject({ skipped: true })
      expect(await models.CompensatoryCredit.countDocuments({ employee: migrant._id })).toBe(3)
      // 舊資料不修改
      expect(await models.HolidayCompensation.countDocuments({ employee: migrant._id })).toBe(2)
    })

    it('lets an admin move the HR 指定 date, cancel it (hours back) and assign again with a note; supervisors cannot', async () => {
      const [assigned] = await models.CompensatoryCredit.find({ employee: people.migrant._id, status: 'used' }).lean()
      expect((await post('boss', `/api/holiday-ledger/compensations/${assigned._id}/assign`, { assignedDate: '2026-03-03', agreementNote: 'x' })).status).toBe(403)
      const moved = await post('admin', `/api/holiday-ledger/compensations/${assigned._id}/assign`, { assignedDate: '2026-03-03' })
      expect(moved.status).toBe(200)
      expect(moved.body).toMatchObject({ assignedDate: '2026-03-03', assignNote: '協商於 3/2', status: 'used' })
      expect((await dayType('migrant', '2026-03-02')).verdict.holiday).toBe(false)
      expect((await dayType('migrant', '2026-03-03')).verdict).toMatchObject({ reason: 'compensation', via: 'hr_assigned' })

      const unassigned = await post('admin', `/api/holiday-ledger/compensations/${assigned._id}/unassign`)
      expect(unassigned.body).toMatchObject({ status: 'available', remainingHours: 8, assignedDate: null })
      expect((await post('admin', `/api/holiday-ledger/compensations/${assigned._id}/assign`, { assignedDate: '2026-03-04' })).body.code).toBe('NOTE_REQUIRED')
      const again = await post('admin', `/api/holiday-ledger/compensations/${assigned._id}/assign`, { assignedDate: '2026-03-04', agreementNote: '重新協商' })
      expect(again.body).toMatchObject({ status: 'used', assignedDate: '2026-03-04', assignNote: '重新協商' })
      const credit = await models.CompensatoryCredit.findById(assigned._id).lean()
      expect(credit.usages).toHaveLength(1)
      expect(credit).toMatchObject({ usedHours: 8, status: 'used' })
    })
  })

  describe('審查後的修正', () => {
    // 人資作廢（例如已改發加倍工資）後，員工打開休假紀錄、人資重新計算都不會把額度重新開啟
    it('keeps a credit HR voided by hand void when the employee opens the ledger and when HR syncs again', async () => {
      const [holiday] = await models.CompensatoryCredit.find({ employee: people.nurse._id, sourceType: 'holiday_rest' }).lean()
      expect(holiday).toMatchObject({ holidayName: '國慶日', status: 'available', usedHours: 0 })
      expect((await bankOf('nurse')).availableHours).toBe(16)
      const voided = await post('admin', `/api/compensatory-leave/credits/${holiday._id}/void`, { note: '已發加倍工資，不另給調休' })
      expect(voided.status).toBe(200)
      expect((await bankOf('nurse')).availableHours).toBe(8)

      const ownLedger = await get('nurse', '/api/holiday-ledger?month=2026-10')
      expect(ownLedger.status).toBe(200)
      const synced = await post('admin', '/api/holiday-ledger/compensations/sync', { from: '2026-10', to: '2026-10' })
      expect(synced.body).toMatchObject({ reopened: 0 })
      expect(await models.CompensatoryCredit.findById(holiday._id).lean()).toMatchObject({ status: 'void', voidReason: 'manual', note: '作廢：已發加倍工資，不另給調休' })
      expect((await bankOf('nurse')).availableHours).toBe(8)

      // 休假紀錄：已處理（調休已作廢），不是「待存入調休」
      const ledger = await get('admin', '/api/holiday-ledger?month=2026-10')
      const row = ledger.body.months[0].employees.find(entry => entry.employeeId === id('nurse'))
      expect(row.items.find(item => item.originalDate === '2026-10-10')).toMatchObject({
        status: 'not_taken', needsAction: null, compensation: { via: 'bank', creditStatus: 'void', voidReason: 'manual' },
      })
      expect(ledger.body.summary.compensationOpen).toBe(0)
    })

    // 同時送出兩筆調休（連點、兩個分頁）：只有一筆通過，另一筆因為第一筆已在簽核中而被擋下，通過的那筆核准得了
    it('lets only one of two simultaneous 調休 filings through when the bank covers just one', async () => {
      await addPerson('twin', { supervisor: people.boss._id, requiresScheduling: false, holidayRegime: 'office' })
      expect((await post('admin', '/api/compensatory-leave/credits', { employeeId: id('twin'), hours: 14, note: '轉入' })).status).toBe(201)

      const results = await Promise.all([
        file('twin', '調休', '2026-11-05', '2026-11-05', 8),
        file('twin', '調休', '2026-11-06', '2026-11-06', 8),
      ])
      expect(results.map(result => result.status).sort()).toEqual([201, 400])
      const blocked = results.find(result => result.status === 400)
      expect(blocked.body).toMatchObject({ code: 'COMP_LEAVE_INSUFFICIENT', pendingHours: 8, availableHours: 6, requestedHours: 8 })
      expect(await bankOf('twin')).toMatchObject({ balanceHours: 14, pendingHours: 8, availableHours: 6 })
      expect(await models.ApprovalRequest.countDocuments({ applicant_employee: people.twin._id })).toBe(1)
      // 鎖用完就刪掉
      expect(await models.CompensatoryLeaveState.countDocuments({ key: /^filing:/ })).toBe(0)

      const approved = await approveAll(results.find(result => result.status === 201).body._id)
      expect(approved.body.status).toBe('approved')
      expect(await bankOf('twin')).toMatchObject({ balanceHours: 6, pendingHours: 0, availableHours: 6 })
    })
  })
})
