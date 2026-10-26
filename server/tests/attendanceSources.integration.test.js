// 線上打卡與指紋匯入互補、不互相覆蓋的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// 客戶 2026-10 的要求：「線上打卡和指紋記錄，不要互相覆蓋，要互補」。
// 情境：護理師 08:10 線上簽到 -> 管理者匯入考勤機檔案（07:55 簽到、17:05 簽退）-> 兩邊都保留並標示來源，
// 工時、遲到、報表都以 07:55-17:05 計算 -> 同一個檔案再匯入一次不會多出記錄 -> 匯入後的線上打卡也不會動到匯入的記錄。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27603 npm test -- tests/attendanceSources.integration.test.js
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
    throw new Error('Attendance source integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_attendance_sources_${process.pid}_${Date.now()}`
  return uri.toString()
}

const utc = (key) => new Date(`${key}T00:00:00.000Z`)

async function fingerprintFile(rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('考勤')
  sheet.addRow(['編號', '姓名', '日期時間', '簽到/退'])
  rows.forEach((row) => sheet.addRow(row))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describeIntegration('線上打卡與指紋匯入 against a real MongoDB through the real app', () => {
  jest.setTimeout(90000)
  let app
  let models
  let payroll
  let deduction
  const people = {}
  const secret = 'integration-test-secret-integration-test-secret'
  let department
  let file

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const at = (iso) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso))
  const punchOnline = (action) => request(app).post('/api/attendance').set(as('nurse')).send({ employee: String(people.nurse._id), action })
  const importFile = (buffer, { dryRun = false } = {}) => request(app)
    .post('/api/attendance/import')
    .set(as('admin'))
    .field('mappings', JSON.stringify({ userId: '編號', name: '姓名', timestamp: '日期時間', type: '簽到/退' }))
    .field('options', JSON.stringify({ timezone: 'Asia/Taipei', dryRun }))
    .attach('file', buffer, { filename: 'fingerprint.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const recordsOfNurse = () => models.AttendanceRecord.find({ employee: people.nurse._id }).sort({ timestamp: 1 }).lean()
  const shape = (records) => records.map((record) => [record.action, record.timestamp.toISOString(), record.source ?? 'legacy'])

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
      ShiftSchedule: (await import('../src/models/ShiftSchedule.js')).default,
      AttendanceSetting: (await import('../src/models/AttendanceSetting.js')).default,
      AttendanceRecord: (await import('../src/models/AttendanceRecord.js')).default,
    }
    payroll = await import('../src/services/workHoursCalculationService.js')
    deduction = await import('../src/services/attendanceDeductionService.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(models).map((model) => model.syncIndexes()))

    const setting = await models.AttendanceSetting.create({
      shifts: [{ name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 }],
      abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
    })
    const dayShift = setting.shifts[0]._id
    department = await models.Department.create({ name: '內科病房', organization: new mongoose.Types.ObjectId() })
    people.admin = await models.Employee.create({ name: '管理者', email: 'admin@example.test', username: 'admin', role: 'admin', organization: 'org-1' })
    people.nurse = await models.Employee.create({
      name: '林護理師', email: 'nurse@example.test', username: 'nurse', role: 'employee', organization: 'org-1',
      employeeId: 'N001', department: department._id, salaryType: '月薪', salaryAmount: 48000,
    })
    await models.ShiftSchedule.create([
      { employee: people.nurse._id, date: utc('2026-10-21'), shiftId: dayShift, state: 'finalized' },
      { employee: people.nurse._id, date: utc('2026-10-22'), shiftId: dayShift, state: 'finalized' },
    ])
    file = await fingerprintFile([
      ['N001', '林護理師', '2026/10/21 上午 07:55:00', '上班簽到'],
      ['N001', '林護理師', '2026/10/21 下午 05:05:00', '下班簽退'],
    ])
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('護理師 08:10 線上簽到：記錄來源為線上，此時算遲到 10 分鐘', async () => {
    at('2026-10-21T00:10:00.000Z')
    const res = await punchOnline('clockIn')

    expect(res.status).toBe(201)
    expect(res.body.source).toBe('online')
    expect(shape(await recordsOfNurse())).toEqual([['clockIn', '2026-10-21T00:10:00.000Z', 'online']])
    const late = await deduction.calculateLateEarlyCount(people.nurse._id, '2026-10')
    expect(late.lateDetails.map((item) => [item.date, item.minutesLate])).toEqual([['2026-10-21', 10]])
  })

  it('匯入指紋檔（07:55 簽到、17:05 簽退）：預覽不寫入，正式匯入只新增，線上簽到原封不動', async () => {
    const onlineBefore = (await recordsOfNurse())[0]

    const preview = await importFile(file, { dryRun: true })
    expect(preview.status).toBe(200)
    expect(preview.body.summary).toMatchObject({ readyCount: 2, duplicateCount: 0, importedCount: 0 })
    expect(await models.AttendanceRecord.countDocuments()).toBe(1)

    const res = await importFile(file)
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('考勤資料匯入完成')
    expect(res.body.summary).toMatchObject({ readyCount: 2, duplicateCount: 0, importedCount: 2 })

    const records = await recordsOfNurse()
    expect(shape(records)).toEqual([
      ['clockIn', '2026-10-20T23:55:00.000Z', 'import'],
      ['clockIn', '2026-10-21T00:10:00.000Z', 'online'],
      ['clockOut', '2026-10-21T09:05:00.000Z', 'import'],
    ])
    const onlineAfter = records.find((record) => record.source === 'online')
    expect(String(onlineAfter._id)).toBe(String(onlineBefore._id))
    expect(onlineAfter).toEqual(onlineBefore)
  })

  it('工時、遲到早退、報表都以 07:55-17:05 計算（線上與指紋互補）', async () => {
    const work = await payroll.calculateWorkHours(people.nurse._id, '2026-10-01')
    const day = work.dailyDetails.find((item) => item.date === '2026-10-21')
    expect(day).toEqual(expect.objectContaining({
      hasAttendance: true,
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:05:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'import',
      workedHours: 8.17,
    }))

    const lateEarly = await deduction.calculateLateEarlyCount(people.nurse._id, '2026-10')
    expect(lateEarly).toMatchObject({ lateCount: 0, earlyLeaveCount: 0 })

    // 薪資明細 API（後台每日出勤明細）
    const complete = await request(app).get(`/api/payroll/complete-data/${people.nurse._id}/2026-10-01`).set(as('admin'))
    expect(complete.status).toBe(200)
    expect(complete.body.dailyDetails.find((item) => item.date === '2026-10-21')).toEqual(expect.objectContaining({
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:05:00.000Z',
      clockInSource: 'import',
    }))

    // 部門報表：工時與遲到
    const report = (type) => request(app)
      .get(`/api/reports/department/${type}/export`)
      .query({ month: '2026-10', department: String(department._id) })
      .set(as('admin'))
    const hours = await report('work-hours')
    expect(hours.status).toBe(200)
    expect(hours.body.records.find((item) => item.date === '2026-10-21')).toEqual(expect.objectContaining({ workedHours: 8.17 }))
    const tardiness = await report('tardiness')
    expect(tardiness.status).toBe(200)
    expect(tardiness.body.records).toEqual([])
    const attendance = await report('attendance')
    expect(attendance.body.records[0]).toMatchObject({ scheduled: 2, attended: 1 })
  })

  it('同一個檔案再匯入一次不會新增任何記錄（重複略過）', async () => {
    const before = await recordsOfNurse()

    const res = await importFile(file)

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('沒有新的打卡記錄：2 筆與既有打卡記錄重複，已略過')
    expect(res.body.summary).toMatchObject({ readyCount: 2, duplicateCount: 2, importedCount: 0 })
    expect(await recordsOfNurse()).toEqual(before)
  })

  it('匯入後的線上打卡另外新增，不會動到匯入的記錄；簽退取最晚的一筆', async () => {
    const importedBefore = await models.AttendanceRecord.find({ source: 'import' }).sort({ timestamp: 1 }).lean()

    at('2026-10-21T09:20:00.000Z')
    const clockOut = await punchOnline('clockOut')
    expect(clockOut.status).toBe(201)
    expect(clockOut.body.source).toBe('online')
    // 同一班重複的線上簽退仍然擋下
    at('2026-10-21T09:25:00.000Z')
    expect((await punchOnline('clockOut')).status).toBe(409)

    at('2026-10-22T00:03:00.000Z')
    expect((await punchOnline('clockIn')).status).toBe(201)

    expect(await models.AttendanceRecord.find({ source: 'import' }).sort({ timestamp: 1 }).lean()).toEqual(importedBefore)
    expect(shape(await recordsOfNurse())).toEqual([
      ['clockIn', '2026-10-20T23:55:00.000Z', 'import'],
      ['clockIn', '2026-10-21T00:10:00.000Z', 'online'],
      ['clockOut', '2026-10-21T09:05:00.000Z', 'import'],
      ['clockOut', '2026-10-21T09:20:00.000Z', 'online'],
      ['clockIn', '2026-10-22T00:03:00.000Z', 'online'],
    ])

    jest.restoreAllMocks()
    const work = await payroll.calculateWorkHours(people.nurse._id, '2026-10-01')
    expect(work.dailyDetails.find((item) => item.date === '2026-10-21')).toEqual(expect.objectContaining({
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:20:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'online',
    }))

    // 員工自己的打卡記錄列出來源
    const mine = await request(app).get('/api/attendance').set(as('nurse'))
    expect(mine.status).toBe(200)
    expect(mine.body.map((record) => record.source)).toEqual(['online', 'online', 'import', 'online', 'import'])
  })
})
