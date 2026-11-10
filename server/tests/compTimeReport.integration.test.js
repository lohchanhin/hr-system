// 「補休申請統計」報表：補休／調休／移休從 2026/10 起是請假單上的假別（調休存摺），不再是另一張「補休申請」表單。
// 報表以前只找名稱是 補休／補休申請／補休單 的表單，所以永遠是空的。真的 Express app + 真的 MongoDB。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27815 npm test -- tests/compTimeReport.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('comp_time_report')
const utcMidnight = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`)

kit.describe('補休申請統計 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const { models } = kit
  let deptId
  let leave
  let CompensatoryCredit
  const report = (query) => kit.get('admin', '/api/reports/department/comp-time/export').query(query)

  async function approvedLeave(person, { start, end, hours, type, status = 'approved' }) {
    return models.ApprovalRequest.create({
      form: leave.form._id,
      workflow: leave.workflow._id,
      applicant_employee: kit.people[person]._id,
      status,
      form_data: {
        [leave.fieldOf('假別')]: type,
        [leave.fieldOf('開始日期')]: start,
        [leave.fieldOf('結束日期')]: end,
        [leave.fieldOf('時數')]: hours,
      },
      steps: [],
    })
  }

  beforeAll(async () => {
    await kit.start()
    CompensatoryCredit = (await import('../src/models/CompensatoryCredit.js')).default
    await CompensatoryCredit.syncIndexes()
    const org = await models.Organization.create({ name: '安康護理之家' })
    const dept = await models.Department.create({ name: '護理部', organization: org._id })
    const other = await models.Department.create({ name: '行政部', organization: org._id })
    deptId = String(dept._id)
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('nurse', { name: '王小美', department: dept._id, organization: String(org._id) })
    await kit.addPerson('aide', { name: '陳大明', department: dept._id, organization: String(org._id) })
    await kit.addPerson('clerk', { name: '林行政', department: other._id, organization: String(org._id) })
    leave = await kit.makeForm('請假', 'leave', [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }], [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number' },
    ])
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    resetLeaveFieldCache()
  })

  afterAll(kit.stop)

  it('lists the 調休 / 補休 / 移休 leave requests of the month and the credits earned in it', async () => {
    const used = await approvedLeave('nurse', { start: '2026-10-13', end: '2026-10-13', hours: 8, type: '調休' })
    await approvedLeave('nurse', { start: '2026-10-20', end: '2026-10-20', hours: 4, type: '補休' })
    // 跨月的移休：10/30、10/31 各 8 小時在 10 月，11/1 的 8 小時算 11 月
    await approvedLeave('aide', { start: '2026-10-30', end: '2026-11-01', hours: 24, type: '移休' })
    // 不算：別的假別、還在簽核中的調休、別的部門
    await approvedLeave('nurse', { start: '2026-10-21', end: '2026-10-21', hours: 8, type: '事假' })
    await approvedLeave('nurse', { start: '2026-10-22', end: '2026-10-22', hours: 8, type: '調休', status: 'pending' })
    await approvedLeave('clerk', { start: '2026-10-23', end: '2026-10-23', hours: 8, type: '調休' })

    await CompensatoryCredit.create([
      {
        employee: kit.people.nurse._id, sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-10-10', reason: 'rest_day',
        holidayDate: utcMidnight('2026-10-10'), holidayName: '國慶日', earnedDate: utcMidnight('2026-10-10'), hours: 8, usedHours: 8, status: 'used',
        usages: [{ kind: 'leave_request', hours: 8, approvalRequest: used._id, days: [{ date: '2026-10-13', hours: 8 }] }],
      },
      { employee: kit.people.aide._id, sourceType: 'manual', sourceKey: 'manual:1', reason: 'manual', earnedDate: utcMidnight('2026-10-20'), hours: 4 },
      // 不算：作廢的、9 月取得的、別的部門的
      { employee: kit.people.aide._id, sourceType: 'manual', sourceKey: 'manual:2', reason: 'manual', earnedDate: utcMidnight('2026-10-21'), hours: 8, status: 'void', voidReason: 'manual' },
      { employee: kit.people.nurse._id, sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-09-25', reason: 'regular_rest', holidayDate: utcMidnight('2026-09-25'), holidayName: '中秋節', earnedDate: utcMidnight('2026-09-25'), hours: 8 },
      { employee: kit.people.clerk._id, sourceType: 'manual', sourceKey: 'manual:3', reason: 'manual', earnedDate: utcMidnight('2026-10-05'), hours: 8 },
    ])

    const october = await report({ month: '2026-10', department: deptId })
    expect(october.status).toBe(200)
    // 以前 records 是空的（只找「補休申請」表單）
    expect(october.body.records.map(row => [row.name, row.leaveType, row.date, row.endDate, row.hours])).toEqual([
      ['王小美', '調休', '2026-10-13', '2026-10-13', 8],
      ['王小美', '補休', '2026-10-20', '2026-10-20', 4],
      ['陳大明', '移休', '2026-10-30', '2026-11-01', 16],
    ])
    // 這張單扣的是哪一筆額度
    expect(october.body.records[0].overtimeReference).toBe('國慶日 2026-10-10')
    expect(october.body.summary).toEqual({ totalRequests: 3, totalHours: 28, earnedCredits: 2, earnedHours: 12 })

    const november = await report({ month: '2026-11', department: deptId })
    expect(november.body.records.map(row => [row.name, row.hours])).toEqual([['陳大明', 8]])
    expect(november.body.summary).toEqual({ totalRequests: 1, totalHours: 8, earnedCredits: 0, earnedHours: 0 })

    // 匯出檔也產得出來
    const excel = await report({ month: '2026-10', department: deptId, format: 'excel' })
    expect(excel.status).toBe(200)
    expect(excel.headers['content-type']).toContain('spreadsheetml')
  })

  it('still reports the credits earned in a month without any 調休 leave', async () => {
    const september = await report({ month: '2026-09', department: deptId })
    expect(september.status).toBe(200)
    expect(september.body.records).toEqual([])
    expect(september.body.summary).toEqual({ totalRequests: 0, totalHours: 0, earnedCredits: 1, earnedHours: 8 })
    // 什麼都沒有的月份維持原本的空白回應
    const empty = await report({ month: '2026-03', department: deptId })
    expect(empty.body).toMatchObject({ records: [], summary: {} })
  })
})
