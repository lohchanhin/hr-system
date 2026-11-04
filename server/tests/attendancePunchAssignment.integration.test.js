// 打卡複查（2026-11）的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// A1 大夜 00:00-08:00、日薪 2000：10/12 缺勤、10/13 上班（10/12 23:55 指紋簽到、10/13 08:04 線上簽退）
//    -> 薪資明細只算 1 天 2000（原本 10/12 也拿到同一組打卡，2 天 4000），部門報表出勤、工時也一樣。
// A2 10/13 23:50 線上簽到 10/14 的大夜班 -> 201，記在 10/14（原本回 400）。
// A3 遲到報表的實際打卡帶來源，Excel 匯出多一欄「打卡來源」。
// A4 5000 筆的 CSV 考勤檔可以預覽、匯入（原本 Node 24 上回 400「無法讀取匯入檔案」）。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27723 npm test -- tests/attendancePunchAssignment.integration.test.js
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
    throw new Error('Attendance punch assignment integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_punch_assignment_${process.pid}_${Date.now()}`
  return uri.toString()
}

const utc = (key) => new Date(`${key}T00:00:00.000Z`)
const binary = (res, callback) => {
  const chunks = []
  res.on('data', (chunk) => chunks.push(chunk))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
}

describeIntegration('打卡複查 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let models
  const people = {}
  const secret = 'integration-test-secret-punch-assignment-0123456789'
  let department
  const schedules = {}

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const at = (iso) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso))
  const punchOnline = (action) => request(app).post('/api/attendance').set(as('nurse')).send({ employee: String(people.nurse._id), action })
  const importFile = (buffer, filename, contentType, { dryRun = false, mappings } = {}) => request(app)
    .post('/api/attendance/import')
    .set(as('admin'))
    .field('mappings', JSON.stringify(mappings))
    .field('options', JSON.stringify({ timezone: 'Asia/Taipei', dryRun }))
    .attach('file', buffer, { filename, contentType })
  const report = (type, format = 'json') => request(app)
    .get(`/api/reports/department/${type}/export`)
    .query({ month: '2026-10', department: String(department._id), format })
    .set(as('admin'))
  const completeData = () => request(app).get(`/api/payroll/complete-data/${people.nurse._id}/2026-10-01`).set(as('admin'))

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
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(models).map((model) => model.syncIndexes()))

    const setting = await models.AttendanceSetting.create({
      shifts: [
        { name: '大夜', code: '大', semanticType: 'work', startTime: '00:00', endTime: '08:00', breakDuration: 0 },
        { name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
      ],
      abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
    })
    const [bigNight, dayShift] = setting.shifts.map((shift) => shift._id)
    department = await models.Department.create({ name: '加護病房', organization: new mongoose.Types.ObjectId() })
    people.admin = await models.Employee.create({ name: '管理者', email: 'admin@example.test', username: 'admin', role: 'admin', organization: 'org-1' })
    people.nurse = await models.Employee.create({
      name: '羅護理師', email: 'nurse@example.test', username: 'nurse', role: 'employee', organization: 'org-1',
      employeeId: 'N001', department: department._id, salaryType: '日薪', salaryAmount: 2000,
    })
    people.other = await models.Employee.create({
      name: '陳護理師', email: 'other@example.test', username: 'other', role: 'employee', organization: 'org-1',
      employeeId: 'N002', salaryType: '月薪', salaryAmount: 40000,
    })
    const created = await models.ShiftSchedule.create([
      { employee: people.nurse._id, date: utc('2026-10-12'), shiftId: bigNight, state: 'finalized' },
      { employee: people.nurse._id, date: utc('2026-10-13'), shiftId: bigNight, state: 'finalized' },
      { employee: people.nurse._id, date: utc('2026-10-14'), shiftId: bigNight, state: 'finalized' },
      { employee: people.nurse._id, date: utc('2026-10-20'), shiftId: dayShift, state: 'finalized' },
    ])
    created.forEach((item) => { schedules[item.date.toISOString().slice(0, 10)] = item })
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

  it('A1：10/12 缺勤、10/13 上班（23:55 指紋簽到、08:04 線上簽退）：薪資明細只算 1 天 2000，報表出勤 1 天', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('考勤')
    sheet.addRow(['編號', '姓名', '日期時間', '簽到/退'])
    sheet.addRow(['N001', '羅護理師', '2026/10/12 下午 11:55:00', '上班簽到'])
    const imported = await importFile(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'fingerprint.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      { mappings: { userId: '編號', name: '姓名', timestamp: '日期時間', type: '簽到/退' } },
    )
    expect(imported.status).toBe(200)
    expect(imported.body.summary).toMatchObject({ importedCount: 1 })

    at('2026-10-13T00:04:00.000Z')
    const clockOut = await punchOnline('clockOut')
    expect(clockOut.status).toBe(201)
    jest.restoreAllMocks()

    const complete = await completeData()
    expect(complete.status).toBe(200)
    expect(complete.body).toMatchObject({ workDays: 1, baseSalary: 2000, actualWorkHours: 8.15 })
    const days = Object.fromEntries(complete.body.dailyDetails.map((item) => [item.date, item]))
    expect(days['2026-10-12']).toMatchObject({ hasAttendance: false, workedHours: 0, clockInTime: null })
    expect(days['2026-10-13']).toMatchObject({
      hasAttendance: true,
      workedHours: 8.15,
      clockInTime: '2026-10-12T15:55:00.000Z',
      clockOutTime: '2026-10-13T00:04:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'online',
    })

    const attendance = await report('attendance')
    expect(attendance.status).toBe(200)
    expect(attendance.body.records).toEqual([expect.objectContaining({ scheduled: 4, attended: 1, absent: 3 })])
    const hours = await report('work-hours')
    expect(hours.status).toBe(200)
    expect(hours.body.records.filter((item) => item.workedHours > 0).map((item) => [item.date, item.workedHours])).toEqual([['2026-10-13', 8.15]])
  })

  it('A2：10/13 23:50 線上簽到 10/14 的大夜班 -> 201，08:02 簽退後 10/14 也算出勤（2 天 4000）', async () => {
    at('2026-10-13T15:50:00.000Z')
    const clockIn = await punchOnline('clockIn')
    expect(clockIn.status).toBe(201)
    expect(clockIn.body.source).toBe('online')
    const stored = await models.AttendanceRecord.findById(clockIn.body._id).select('+punchKey').lean()
    expect(stored.punchKey).toBe(`${people.nurse._id}:${schedules['2026-10-14']._id}:clockIn`)

    at('2026-10-14T00:02:00.000Z')
    expect((await punchOnline('clockOut')).status).toBe(201)
    jest.restoreAllMocks()

    const complete = await completeData()
    expect(complete.body).toMatchObject({ workDays: 2, baseSalary: 4000 })
    const day14 = complete.body.dailyDetails.find((item) => item.date === '2026-10-14')
    expect(day14).toMatchObject({ hasAttendance: true, clockInTime: '2026-10-13T15:50:00.000Z', clockOutTime: '2026-10-14T00:02:00.000Z', workedHours: 8.2 })
    // 10/13 的那一班不受影響
    expect(complete.body.dailyDetails.find((item) => item.date === '2026-10-13')).toMatchObject({ clockOutTime: '2026-10-13T00:04:00.000Z' })
  })

  it('A3：遲到報表的實際打卡帶來源；Excel 匯出「實際打卡」右邊是「打卡來源」', async () => {
    at('2026-10-20T00:10:00.000Z')
    expect((await punchOnline('clockIn')).status).toBe(201)
    jest.restoreAllMocks()

    const tardiness = await report('tardiness')
    expect(tardiness.status).toBe(200)
    expect(tardiness.body.records).toEqual([expect.objectContaining({
      date: '2026-10-20', actualClockIn: '08:10', clockInSource: 'online', minutesLate: 10,
    })])

    const excel = await report('tardiness', 'excel').buffer(true).parse(binary)
    expect(excel.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(excel.body)
    const rows = []
    workbook.worksheets[0].eachRow((row) => rows.push(row.values.slice(1).map((value) => (value == null ? '' : String(value)))))
    const header = rows.find((row) => row.includes('實際打卡'))
    expect(header.indexOf('打卡來源')).toBe(header.indexOf('實際打卡') + 1)
    const dataRow = rows.find((row) => row.includes('08:10'))
    expect(dataRow[header.indexOf('打卡來源')]).toBe('線上')
  })

  it('A4：5000 筆的 CSV 考勤檔可以預覽與匯入', async () => {
    const lines = ['USERID,CHECKTIME,CHECKTYPE']
    for (let index = 0; index < 5000; index += 1) {
      const time = new Date(Date.UTC(2026, 9, 1) + index * 60000)
      const stamp = time.toISOString().replace('T', ' ').slice(0, 19)
      lines.push(`N002,${stamp},${index % 2 === 0 ? 'I' : 'O'}`)
    }
    const buffer = Buffer.from(`${lines.join('\r\n')}\r\n`)
    const mappings = { userId: 'USERID', timestamp: 'CHECKTIME', type: 'CHECKTYPE' }

    const preview = await importFile(buffer, 'attendance.csv', 'text/csv', { dryRun: true, mappings })
    expect(preview.status).toBe(200)
    expect(preview.body.summary).toMatchObject({ totalRows: 5000, readyCount: 5000, importedCount: 0 })

    const res = await importFile(buffer, 'attendance.csv', 'text/csv', { mappings })
    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ totalRows: 5000, importedCount: 5000 })
    expect(await models.AttendanceRecord.countDocuments({ employee: people.other._id, source: 'import' })).toBe(5000)
  })
})
