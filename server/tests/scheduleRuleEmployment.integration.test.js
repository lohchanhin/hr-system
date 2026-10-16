// 跨月週「目前無法判斷」只看員工在職的日子，端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 新進員工（到職日之前的鄰月日子）與離職員工（離職日之後的鄰月日子）永遠不會有鄰月班表，不能一直掛著待判斷。
// 預設略過；要執行時指定一個本機的暫用資料庫（和 approvalEngine.integration.test.js 相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27411 npm test -- tests/scheduleRuleEmployment.integration.test.js
// 只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
import { jest } from '@jest/globals'
import ExcelJS from 'exceljs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import request from 'supertest'

const configured = process.env.APPROVAL_ENGINE_TEST_MONGODB_URI
const describeIntegration = configured ? describe : describe.skip

function isolatedMongoUri() {
  const uri = new URL(configured)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!localHosts.has(uri.hostname)) {
    throw new Error('Schedule integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_schedule_employment_${process.pid}_${Date.now()}`
  return uri.toString()
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const WEEKLY = 'weekly-one-regular-rest-one-rest-day'
const DAY_MS = 24 * 60 * 60 * 1000

describeIntegration('schedule rules: pending cross-month weeks only count the days a person is employed (real MongoDB, real app)', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let ShiftSchedule
  let AttendanceSetting
  let admin
  let shiftIds

  const secret = 'integration-test-secret-integration-test-secret'
  const auth = () => ({
    Authorization: `Bearer ${jwt.sign(
      { id: String(admin._id), sub: String(admin._id), role: admin.role, ver: Number(admin.authVersion ?? 0) },
      secret,
      { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
    )}`,
  })
  const validate = (department, month) => request(app)
    .get(`/api/schedules/rules/validate?month=${month}&department=${department}`)
    .set(auth())

  let counter = 0
  const newDepartment = () => new mongoose.Types.ObjectId()
  async function addEmployee(department, extra = {}) {
    counter += 1
    return Employee.create({
      name: `員工${counter}`,
      email: `schedule-employment-${counter}@example.test`,
      username: `schedule-employment-${counter}`,
      employeeId: `E${String(counter).padStart(3, '0')}`,
      role: 'employee',
      organization: 'org-1',
      department,
      ...extra,
    })
  }

  // 一天一個班別代碼；預設週六例、週日休、其餘日班，overrides 以「幾號」指定
  function monthCodes(month, overrides = {}) {
    const [year, mon] = month.split('-').map(Number)
    const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
    return Array.from({ length: days }, (_, index) => {
      const day = index + 1
      if (overrides[day]) return overrides[day]
      const weekday = new Date(Date.UTC(year, mon - 1, day)).getUTCDay()
      if (weekday === 6) return '例'
      if (weekday === 0) return '休'
      return '日'
    })
  }
  // 7/1～7/5（首週在七月的部分）、7/27～7/31（末週在七月的部分）都是日班，沒有例也沒有休；7/6 排休，避免變成連續 7 天上班
  const JULY_WITHOUT_EDGE_RESTS = { 4: '日', 5: '日', 6: '休' }
  async function saveJuly(employee, department) {
    const start = Date.UTC(2026, 6, 1)
    const rows = monthCodes('2026-07', JULY_WITHOUT_EDGE_RESTS).map((code, index) => ({
      employee: employee._id,
      date: new Date(start + index * DAY_MS),
      shiftId: shiftIds[code],
      department,
      needsReconfirm: true,
    }))
    await ShiftSchedule.insertMany(rows)
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
    ;({ default: ShiftSchedule } = await import('../src/models/ShiftSchedule.js'))
    ;({ default: AttendanceSetting } = await import('../src/models/AttendanceSetting.js'))
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all([Employee.syncIndexes(), ShiftSchedule.syncIndexes()])

    admin = await Employee.create({
      name: 'admin', email: 'admin@example.test', username: 'admin', role: 'admin', organization: 'org-1',
    })
    const setting = await AttendanceSetting.create({
      shifts: [
        { name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
      ],
    })
    shiftIds = Object.fromEntries(setting.shifts.map((shift) => [shift.code, shift._id]))
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('a new hire (hired 7/1) has no June week left pending, a leaver (last day 7/31) has no August week left pending, a regular employee has both', async () => {
    const department = newDepartment()
    const regular = await addEmployee(department, { name: '一般員工' })
    const newHire = await addEmployee(department, {
      name: '新進員工',
      status: '試用期員工',
      appointment: { hireDate: new Date('2026-06-30T16:00:00.000Z') }, // 台灣 2026-07-01 00:00
    })
    const leaver = await addEmployee(department, {
      name: '離職員工',
      status: '離職員工',
      appointment: { hireDate: new Date('2024-03-01T00:00:00.000Z'), resignationDate: new Date('2026-07-30T16:00:00.000Z') }, // 台灣 2026-07-31
    })
    for (const person of [regular, newHire, leaver]) await saveJuly(person, department)

    const checked = await validate(department, '2026-07')

    expect(checked.status).toBe(200)
    expect(checked.body).toMatchObject({ ok: true, count: 0, violations: [] })
    const pending = checked.body.pendingWeeks.map((item) => `${item.employee}:${item.weekStart}`).sort()
    expect(pending).toEqual([
      `${regular._id}:2026-06-29`,
      `${regular._id}:2026-07-27`,
      `${leaver._id}:2026-06-29`,
      `${newHire._id}:2026-07-27`,
    ].sort())
    const leaverWeek = checked.body.pendingWeeks.find((item) => item.employee === String(leaver._id))
    expect(leaverWeek.missingDates).toEqual(['2026-06-29', '2026-06-30'])
  })

  it('counts only the days a person is employed: hired on 6/30, a single fillable day cannot hold both 例 and 休, so the week is a violation that says so', async () => {
    const department = newDepartment()
    const newHire = await addEmployee(department, {
      name: '週二到職',
      status: '試用期員工',
      appointment: { hireDate: new Date('2026-06-29T16:00:00.000Z') }, // 台灣 2026-06-30
    })
    await saveJuly(newHire, department)

    const checked = await validate(department, '2026-07')

    expect(checked.status).toBe(200)
    expect(checked.body.ok).toBe(false)
    const weekly = checked.body.violations.filter((item) => item.rule === WEEKLY)
    expect(weekly).toEqual([
      expect.objectContaining({
        employee: String(newHire._id),
        weekStart: '2026-06-29',
        crossMonth: true,
        outsideDates: ['2026-06-29', '2026-06-30'],
        missingDates: ['2026-06-30'],
        notEmployedDates: ['2026-06-29'],
      }),
    ])
    expect(weekly[0].message).toContain('2026-06-29 在到職前或離職後，不計入')
    expect(checked.body.pendingWeeks.map((item) => item.weekStart)).toEqual(['2026-07-27'])
  })

  it('the import preview (the same check) leaves out the days before the hire day too', async () => {
    const department = newDepartment()
    const newHire = await addEmployee(department, {
      name: '匯入新進',
      status: '試用期員工',
      appointment: { hireDate: new Date('2026-06-30T16:00:00.000Z') },
    })
    const dayNumbers = Array.from({ length: 31 }, (_, index) => index + 1)
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('工作表1')
    sheet.addRow(['公版班表'])
    sheet.addRow(['', '', '行事曆'])
    sheet.addRow(['', '', '日期', ...dayNumbers])
    sheet.addRow(['員工代號', '姓名', '星期', ...dayNumbers.map(() => '')])
    sheet.addRow([newHire.employeeId, newHire.name, '護理師', ...monthCodes('2026-07', JULY_WITHOUT_EDGE_RESTS)])
    const file = Buffer.from(await workbook.xlsx.writeBuffer())

    const preview = await request(app)
      .post('/api/schedules/import')
      .set(auth())
      .field('month', '2026-07')
      .field('department', String(department))
      .field('mode', 'preview')
      .attach('file', file, { filename: 'schedule.xlsx', contentType: XLSX_TYPE })

    expect(preview.status).toBe(200)
    expect(preview.body.violations).toEqual([])
    expect(preview.body.pendingWeeks.map((item) => item.weekStart)).toEqual(['2026-07-27'])
  })
})
