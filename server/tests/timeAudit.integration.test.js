// 出勤、排班、調休複查（2026-11）的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// 每一項修正前都在真的資料庫重現過：
// T1 打卡記錄：主管、管理員開個人的出勤打卡頁時列出的是別人的打卡（主管自己的反而不在裡面），每一筆還附整份員工資料（薪資、帳號）。
// T2 還有班表在用的班別被刪掉：日薪 2000 的人那個月從 1 天 2000 變成 0 天 0 元。
// T3 員工月中調單位：舊單位排的那幾天新單位的排班人員看不到、改不了（department overlap）、也發布不了。
// T4 批次回覆班表：其中一筆不能回覆時回 400，前面幾筆卻已經存成已確認。
// T5 同一格同時新增班表：後到的回了資料庫的 E11000 原文。
// T6 檢核 10 月卻回報整段落在 9 月的連續上班。
// T7 同一張調休單同時扣用：兩筆額度各被扣一次。
// T8 考勤匯入：Big5 的 CSV、Excel 日期儲存格、民國年。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27813 npm test -- tests/timeAudit.integration.test.js
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
    throw new Error('Time audit integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_time_audit_${process.pid}_${Date.now()}`
  return uri.toString()
}

const utc = (key) => new Date(`${key}T00:00:00.000Z`)
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describeIntegration('出勤、排班、調休複查 against a real MongoDB through the real app', () => {
  jest.setTimeout(180000)
  let app
  let m
  const people = {}
  const ids = {}
  const secret = 'integration-test-secret-time-audit-0123456789abcdef'

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const as = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })
  const get = (key, url) => request(app).get(url).set(as(key))
  const post = (key, url, body) => request(app).post(url).set(as(key)).send(body ?? {})
  const put = (key, url, body) => request(app).put(url).set(as(key)).send(body ?? {})
  const del = (key, url) => request(app).delete(url).set(as(key))
  const id = (key) => String(people[key]._id)
  const importFile = (buffer, filename, contentType, mappings) => request(app)
    .post('/api/attendance/import')
    .set(as('admin'))
    .field('mappings', JSON.stringify(mappings))
    .field('options', JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false }))
    .attach('file', buffer, { filename, contentType })

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.PORT = process.env.PORT || '0'
    process.env.JWT_SECRET = secret
    process.env.MONGODB_URI = isolatedMongoUri()
    process.env.API_RATE_LIMIT_MAX = '100000'
    process.env.API_MUTATION_RATE_LIMIT_MAX = '100000'
    ;({ app } = await import('../src/index.js'))
    m = {
      Employee: (await import('../src/models/Employee.js')).default,
      Department: (await import('../src/models/Department.js')).default,
      SubDepartment: (await import('../src/models/SubDepartment.js')).default,
      ShiftSchedule: (await import('../src/models/ShiftSchedule.js')).default,
      AttendanceSetting: (await import('../src/models/AttendanceSetting.js')).default,
      AttendanceRecord: (await import('../src/models/AttendanceRecord.js')).default,
      CompensatoryCredit: (await import('../src/models/CompensatoryCredit.js')).default,
    }
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(m).map((model) => model.syncIndexes()))

    const setting = await m.AttendanceSetting.create({
      shifts: [
        { name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
        { name: '舊班', code: 'OLD', semanticType: 'work', startTime: '09:00', endTime: '18:00', breakDuration: 60 },
      ],
    })
    ;[ids.D, ids.R, ids.E, ids.OLD] = setting.shifts.map((shift) => String(shift._id))
    const dept = await m.Department.create({ name: '護理部', organization: new mongoose.Types.ObjectId() })
    ids.dept = String(dept._id)
    const unitA = await m.SubDepartment.create({ department: dept._id, name: 'A 病房' })
    const unitB = await m.SubDepartment.create({ department: dept._id, name: 'B 病房' })
    ids.unitA = String(unitA._id)
    ids.unitB = String(unitB._id)
    const add = async (key, patch = {}) => {
      people[key] = await m.Employee.create({
        name: key, email: `${key}@example.test`, username: key, role: 'employee', employeeId: `E-${key}`,
        organization: 'org-1', department: dept._id, ...patch,
      })
    }
    await add('admin', { role: 'admin' })
    await add('sup', { role: 'supervisor', subDepartment: unitA._id, salaryAmount: 90000 })
    await add('nurse', { subDepartment: unitA._id, salaryType: '日薪', salaryAmount: 2000 })
    await add('mover', { subDepartment: unitB._id, name: '王小明', employeeId: 'N001' })
    await add('schedB', { subDepartment: unitB._id })
    unitB.schedulers = [people.schedB._id]
    await unitB.save()
    await m.Employee.updateOne({ _id: people.nurse._id }, { $set: { supervisor: people.sup._id } })
  })

  afterEach(() => jest.restoreAllMocks())

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('T1：打卡記錄只附辨識員工用的欄位；scope=self 是自己的；date 以台灣日期篩選', async () => {
    await m.AttendanceRecord.create([
      // 台灣 11/9 08:00、11/10 07:30（UTC 還是 11/9）、11/10 08:01、11/10 08:02
      { employee: people.nurse._id, action: 'clockIn', timestamp: new Date('2026-11-09T00:00:00Z'), source: 'online' },
      { employee: people.nurse._id, action: 'clockIn', timestamp: new Date('2026-11-09T23:30:00Z'), source: 'online' },
      { employee: people.sup._id, action: 'clockIn', timestamp: new Date('2026-11-10T00:01:00Z'), source: 'online' },
      { employee: people.admin._id, action: 'clockIn', timestamp: new Date('2026-11-10T00:02:00Z'), source: 'online' },
    ])

    // 主管不帶條件：部門同仁的記錄（原本的行為），但每一筆只有姓名、代號、部門、小單位，沒有薪資
    const team = await get('sup', '/api/attendance')
    expect(team.status).toBe(200)
    expect(team.body.map((row) => row.employee.name).sort()).toEqual(['admin', 'nurse', 'nurse'])
    team.body.forEach((row) => {
      // 只有姓名、代號、部門、小單位（另外是模型的虛擬欄位 id、employeeNo、annualLeave 的剩餘時數，都不含資料）
      for (const field of ['salaryAmount', 'salaryType', 'salaryAccountA', 'salaryItems', 'username', 'email', 'idNumber', 'emergencyContacts', 'laborInsuranceLevel', 'supervisor', 'role']) {
        expect(row.employee[field]).toBeUndefined()
      }
      expect(Object.keys(row.employee).length).toBeLessThanOrEqual(8)
    })

    // 個人的出勤打卡頁：scope=self 只有自己的
    const supOwn = await get('sup', '/api/attendance?scope=self')
    expect(supOwn.body.map((row) => row.employee.name)).toEqual(['sup'])
    const adminOwn = await get('admin', '/api/attendance?scope=self')
    expect(adminOwn.body.map((row) => row.employee.name)).toEqual(['admin'])

    // 台灣 11/10 的記錄：07:30 那一筆（UTC 11/9）要在裡面，11/9 08:00 那一筆不在
    const day = await get('nurse', '/api/attendance?date=2026-11-10')
    expect(day.body.map((row) => row.timestamp)).toEqual(['2026-11-09T23:30:00.000Z'])
    const range = await get('nurse', '/api/attendance?start=2026-11-09&end=2026-11-10')
    expect(range.body).toHaveLength(2)
    expect((await get('nurse', '/api/attendance?date=2026/11/10')).status).toBe(400)
    expect((await get('admin', '/api/attendance?employee=not-an-id')).status).toBe(400)
    expect((await get('admin', '/api/attendance?limit=1')).body).toHaveLength(1)
  })

  it('T2：還有班表在用的班別不能刪除，薪資照常；填錯的班別回 400', async () => {
    await m.ShiftSchedule.create({ employee: people.nurse._id, date: utc('2026-09-01'), shiftId: ids.OLD, state: 'finalized' })
    await m.AttendanceRecord.create([
      { employee: people.nurse._id, action: 'clockIn', timestamp: new Date('2026-09-01T01:00:00Z'), source: 'import' },
      { employee: people.nurse._id, action: 'clockOut', timestamp: new Date('2026-09-01T10:00:00Z'), source: 'import' },
    ])
    const payroll = () => get('admin', `/api/payroll/complete-data/${id('nurse')}/2026-09-01`)
    expect((await payroll()).body).toMatchObject({ workDays: 1, baseSalary: 2000 })

    const refused = await del('admin', `/api/shifts/${ids.OLD}`)
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ code: 'SHIFT_IN_USE', scheduleCount: 1, latestDate: '2026-09-01' })
    expect(refused.body.error).toContain('還有 1 筆班表在使用')
    expect((await payroll()).body).toMatchObject({ workDays: 1, baseSalary: 2000 })

    // 沒有班表在用的班別可以刪
    const spare = await post('admin', '/api/shifts', { name: '備用', code: 'SPARE', startTime: '10:00', endTime: '14:00' })
    expect(spare.status).toBe(201)
    expect((await del('admin', `/api/shifts/${spare.body._id}`)).status).toBe(204)

    const bad = await post('admin', '/api/shifts', { name: 'X', code: 'X1', startTime: '08:00', endTime: '16:00', breakDuration: -5 })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('休息時長必須是 0 或以上的數字')
  })

  it('T3：月中調到 B 病房的員工，舊單位排的班表在 B 病房看得到、改得了、發布得了、匯出也有', async () => {
    // 王小明原本在 A 病房，12/1～12/3 由 A 病房排了日班；之後調到 B 病房
    await m.ShiftSchedule.create([1, 2, 3].map((day) => ({
      employee: people.mover._id, date: utc(`2026-12-0${day}`), shiftId: ids.D,
      department: ids.dept, subDepartment: ids.unitA, needsReconfirm: true,
    })))
    const monthly = await get('schedB', `/api/schedules/monthly?month=2026-12&page=1&pageSize=50&department=${ids.dept}&subDepartment=${ids.unitB}`)
    expect(monthly.status).toBe(200)
    expect(monthly.body.employees.map((employee) => employee.name).sort()).toEqual(['schedB', '王小明'])
    const rows = monthly.body.schedules.filter((row) => String(row.employee?._id) === id('mover'))
    expect(rows.map((row) => row.date).sort()).toEqual(['2026/12/01', '2026/12/02', '2026/12/03'])

    // B 病房的排班人員把 12/1 改成休息日
    const edited = await put('schedB', `/api/schedules/${rows.find((row) => row.date === '2026/12/01')._id}`, {
      shiftId: ids.R, department: ids.dept, subDepartment: ids.unitB,
    })
    expect(edited.status).toBe(200)
    expect(String(edited.body.subDepartment)).toBe(ids.unitB)

    // 發布 B 病房：12/2、12/3 還掛在 A 病房底下的班表也一起發布
    const published = await post('schedB', '/api/schedules/publish', { month: '2026-12', department: ids.dept, subDepartment: ids.unitB })
    expect(published.status).toBe(200)
    expect(published.body.updated).toBe(3)
    const states = await m.ShiftSchedule.find({ employee: people.mover._id }).sort({ date: 1 }).lean()
    expect(states.map((row) => row.state)).toEqual(['pending_confirmation', 'pending_confirmation', 'pending_confirmation'])

    // 匯出 B 病房的班表：王小明那一列三天都有
    const exported = await get('schedB', `/api/schedules/export?month=2026-12&department=${ids.dept}&subDepartment=${ids.unitB}&format=excel`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
    expect(exported.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(exported.body)
    let moverRow = null
    workbook.worksheets[0].eachRow((row) => {
      const values = row.values.slice(1).map((value) => (value == null ? '' : String(value)))
      if (values[0] === 'N001') moverRow = values
    })
    expect(moverRow).not.toBeNull()
    // 員工代號、姓名、單位、職稱之後是 1 號起的每一天
    expect(moverRow.slice(4, 7)).toEqual(['休', 'D', 'D'])
  })

  it('T4：批次回覆班表時有一筆不能回覆：整批都不存', async () => {
    const [pending, finalized] = await m.ShiftSchedule.create([
      { employee: people.nurse._id, date: utc('2027-01-04'), shiftId: ids.D, state: 'pending_confirmation' },
      { employee: people.nurse._id, date: utc('2027-01-05'), shiftId: ids.D, state: 'finalized' },
    ])
    const res = await post('nurse', '/api/schedules/respond/bulk', { scheduleIds: [String(pending._id), String(finalized._id)], response: 'confirm' })
    expect(res.status).toBe(400)
    expect((await m.ShiftSchedule.findById(pending._id).lean()).employeeResponse).toBe('pending')

    const ok = await post('nurse', '/api/schedules/respond/bulk', { scheduleIds: [String(pending._id)], response: 'confirm' })
    expect(ok.status).toBe(200)
    expect((await m.ShiftSchedule.findById(pending._id).lean()).employeeResponse).toBe('confirmed')
  })

  it('T5：同一格同時新增班表、同時打卡：只有一筆成功，其餘是看得懂的訊息', async () => {
    const body = { employee: id('nurse'), date: '2029-01-10', shiftId: ids.D, department: ids.dept, subDepartment: ids.unitA }
    const created = await Promise.all([1, 2, 3, 4, 5].map(() => post('admin', '/api/schedules', body)))
    expect(created.map((res) => res.status).sort()).toEqual([201, 400, 400, 400, 400])
    created.filter((res) => res.status === 400).forEach((res) => {
      expect(res.body.error).toBe('employee conflict')
      expect(JSON.stringify(res.body)).not.toContain('E11000')
    })
    expect(await m.ShiftSchedule.countDocuments({ employee: people.nurse._id, date: utc('2029-01-10') })).toBe(1)

    // 台灣 2029-01-10 07:55 連點四次上班簽到
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2029-01-09T23:55:00.000Z'))
    const punches = await Promise.all([1, 2, 3, 4].map(() => post('nurse', '/api/attendance', { employee: id('nurse'), action: 'clockIn' })))
    jest.restoreAllMocks()
    expect(punches.map((res) => res.status).sort()).toEqual([201, 409, 409, 409])
    punches.filter((res) => res.status === 409).forEach((res) => {
      expect(res.body.error).toBe('這一班已經完成上班簽到，不需要重複打卡')
    })
    expect(await m.AttendanceRecord.countDocuments({ employee: people.nurse._id, timestamp: new Date('2029-01-09T23:55:00.000Z') })).toBe(1)
  })

  it('T6：檢核 10 月時不回報整段落在 9 月的連續上班', async () => {
    const rows = []
    // 9/24～9/30 連上 7 天（已完成發布，都在 9 月）；10 月週六休、週日例，本身合規（2028-10-01 是週日）
    for (let day = 24; day <= 30; day += 1) {
      rows.push({ employee: people.schedB._id, date: utc(`2028-09-${day}`), shiftId: ids.D, department: ids.dept, subDepartment: ids.unitB, state: 'finalized' })
    }
    for (let day = 1; day <= 31; day += 1) {
      const date = utc(`2028-10-${String(day).padStart(2, '0')}`)
      const weekday = date.getUTCDay()
      rows.push({
        employee: people.schedB._id, date, shiftId: weekday === 0 ? ids.E : weekday === 6 ? ids.R : ids.D,
        department: ids.dept, subDepartment: ids.unitB, needsReconfirm: true,
      })
    }
    await m.ShiftSchedule.create(rows)

    const res = await get('admin', `/api/schedules/rules/validate?month=2028-10&department=${ids.dept}&subDepartment=${ids.unitB}`)
    expect(res.status).toBe(200)
    expect((res.body.violations || []).filter((violation) => violation.rule === 'continuous-work-days')).toEqual([])
  })

  it('T7：同一張調休單同時扣用三次：只扣一筆額度', async () => {
    const service = await import('../src/services/compensatoryLeaveService.js')
    await m.CompensatoryCredit.create([1, 2].map((n) => ({
      employee: people.nurse._id, sourceType: 'manual', sourceKey: `manual:t7-${n}`, reason: 'manual',
      earnedDate: utc(`2026-0${n}-01`), hours: 8, usedHours: 0, status: 'available', note: 'T7',
    })))
    const requestId = new mongoose.Types.ObjectId()

    const results = await Promise.all([1, 2, 3].map(() => service.consumeCreditsForRequest({
      employeeId: people.nurse._id, requestId, hours: 8,
    })))

    expect(results.map((result) => result.state).sort()).toEqual(['already', 'already', 'consumed'])
    const credits = await m.CompensatoryCredit.find({ employee: people.nurse._id }).sort({ earnedDate: 1 }).lean()
    expect(credits.map((credit) => [credit.usedHours, credit.status, credit.usages.length])).toEqual([[8, 'used', 1], [0, 'available', 0]])

    // 返還也只退一次
    expect(await service.refundCreditsForRequest({ requestId })).toEqual({ refunded: true, hours: 8 })
    expect(await service.refundCreditsForRequest({ requestId })).toEqual({ refunded: false, hours: 0 })
    expect((await m.CompensatoryCredit.find({ employee: people.nurse._id }).lean()).map((credit) => credit.usedHours)).toEqual([0, 0])
  })

  it('T8：考勤匯入收 Big5 的 CSV、Excel 日期儲存格與民國年，重複匯入不會多出記錄', async () => {
    const mappings = { userId: '編號', name: '姓名', timestamp: '日期時間', type: '簽到/退' }
    // Big5：「編號,姓名,日期時間,簽到/退」與一列「N001,王小明,2027/03/01 下午 05:30:00,下班簽退」
    const big5 = (text) => {
      const table = new Map()
      const decoder = new TextDecoder('big5')
      for (let lead = 0x81; lead <= 0xfe; lead += 1) {
        for (let trail = 0x40; trail <= 0xfe; trail += 1) {
          if (trail > 0x7e && trail < 0xa1) continue
          const char = decoder.decode(Buffer.from([lead, trail]))
          if (char.length === 1 && char !== '�' && !table.has(char)) table.set(char, [lead, trail])
        }
      }
      const bytes = []
      for (const char of text) bytes.push(...(char.charCodeAt(0) < 0x80 ? [char.charCodeAt(0)] : table.get(char)))
      return Buffer.from(bytes)
    }
    const csv = big5('編號,姓名,日期時間,簽到/退\r\nN001,王小明,2027/03/01 下午 05:30:00,下班簽退\r\n')
    const fromCsv = await importFile(csv, 'fingerprint.csv', 'text/csv', mappings)
    expect(fromCsv.status).toBe(200)
    expect(fromCsv.body.summary).toMatchObject({ totalRows: 1, errorCount: 0, missingCount: 0, importedCount: 1 })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('考勤')
    sheet.addRow(['編號', '姓名', '日期時間', '簽到/退'])
    // 日期儲存格（Excel 顯示 2027/03/01 07:55）、民國年的文字、和 CSV 同一筆（重複）
    sheet.addRow(['N001', '王小明', new Date(Date.UTC(2027, 2, 1, 7, 55, 0)), '上班簽到'])
    sheet.addRow(['N001', '王小明', '116/03/02 上午 07:50:00', '上班簽到'])
    sheet.addRow(['N001', '王小明', '2027/03/01 下午 05:30:00', '下班簽退'])
    const fromXlsx = await importFile(Buffer.from(await workbook.xlsx.writeBuffer()), 'fingerprint.xlsx', XLSX_TYPE, mappings)
    expect(fromXlsx.status).toBe(200)
    expect(fromXlsx.body.summary).toMatchObject({ totalRows: 3, errorCount: 0, duplicateCount: 1, importedCount: 2 })

    const stored = await m.AttendanceRecord.find({ employee: people.mover._id, source: 'import' }).sort({ timestamp: 1 }).lean()
    expect(stored.map((row) => [row.action, row.timestamp.toISOString()])).toEqual([
      ['clockIn', '2027-02-28T23:55:00.000Z'],
      ['clockOut', '2027-03-01T09:30:00.000Z'],
      ['clockIn', '2027-03-01T23:50:00.000Z'],
    ])
  })
})
