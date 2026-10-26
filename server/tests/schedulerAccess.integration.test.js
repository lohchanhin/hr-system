// 排班人員（R1）與小單位使用班別（R3）的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// 預設略過；要執行時指定一個本機的暫用資料庫（和其他整合測試相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27321 npm test -- tests/schedulerAccess.integration.test.js
// 只接受 loopback 位址，並在隨機命名的資料庫內進行，結束後整個刪除。
import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import request from 'supertest'
import ExcelJS from 'exceljs'

const configured = process.env.APPROVAL_ENGINE_TEST_MONGODB_URI
const describeIntegration = configured ? describe : describe.skip

function isolatedMongoUri() {
  const uri = new URL(configured)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!localHosts.has(uri.hostname)) {
    throw new Error('Scheduler access integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_scheduler_access_${process.pid}_${Date.now()}`
  return uri.toString()
}

const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describeIntegration('schedulers of units against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let Department
  let SubDepartment
  let Organization
  let AttendanceSetting
  let FormTemplate
  let ShiftSchedule
  const people = {}
  const ids = {}
  const MONTH = '2031-03'
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
  const namesOf = (res) => (Array.isArray(res.body) ? res.body : res.body.employees).map((employee) => employee.name).sort()
  const createSchedule = (key, employeeKey, day, shift) => post(key, '/api/schedules', {
    employee: id(employeeKey),
    date: `${MONTH}-${String(day).padStart(2, '0')}`,
    shiftId: ids[shift],
  })

  async function addPerson(key, patch = {}) {
    people[key] = await Employee.create({
      name: key,
      email: `${key}@example.test`,
      username: key,
      role: 'employee',
      employeeId: `E-${key}`,
      ...patch,
    })
    return people[key]
  }

  async function workbook(rows, code) {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('工作表1')
    sheet.addRow(['公版班表'])
    sheet.addRow(['', '', '行事曆'])
    sheet.addRow(['', '', '日期', 1])
    sheet.addRow(['員工代號', '姓名', '星期', ''])
    rows.forEach((employeeCode) => sheet.addRow([employeeCode, '', '護理師', code]))
    return Buffer.from(await book.xlsx.writeBuffer())
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
    ;({ default: Department } = await import('../src/models/Department.js'))
    ;({ default: SubDepartment } = await import('../src/models/SubDepartment.js'))
    ;({ default: Organization } = await import('../src/models/Organization.js'))
    ;({ default: AttendanceSetting } = await import('../src/models/AttendanceSetting.js'))
    ;({ default: FormTemplate } = await import('../src/models/form_template.js'))
    ;({ default: ShiftSchedule } = await import('../src/models/ShiftSchedule.js'))
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all([Employee.syncIndexes(), ShiftSchedule.syncIndexes(), FormTemplate.syncIndexes()])

    const org = await Organization.create({ name: '迦南測試機構' })
    const deptA = await Department.create({ name: '護理部', organization: org._id })
    const deptB = await Department.create({ name: '長照部', organization: org._id })
    const deptC = await Department.create({ name: '行政部', organization: org._id })
    Object.assign(ids, { org: String(org._id), deptA: String(deptA._id), deptB: String(deptB._id), deptC: String(deptC._id) })
    const unitA1 = await SubDepartment.create({ name: '3A 病房', department: deptA._id })
    const unitA2 = await SubDepartment.create({ name: '5B 病房', department: deptA._id })
    const unitB1 = await SubDepartment.create({ name: '日照中心', department: deptB._id })
    Object.assign(ids, { unitA1: String(unitA1._id), unitA2: String(unitA2._id), unitB1: String(unitB1._id) })
    const setting = await AttendanceSetting.create({
      shifts: [
        { name: '白班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
        { name: '大夜', code: 'N', semanticType: 'work', startTime: '00:00', endTime: '08:00' },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
      ],
    })
    const [day, night, rest] = setting.shifts
    Object.assign(ids, { day: String(day._id), night: String(night._id), rest: String(rest._id) })

    await addPerson('admin', { role: 'admin' })
    await addPerson('boss', { role: 'supervisor', department: deptA._id, subDepartment: unitA2._id })
    // 排班員：員工角色，自己在 5B，要被指定為 3A（護理部）與日照中心（長照部）的排班人員
    await addPerson('scheduler', { name: '排班員', department: deptA._id, subDepartment: unitA2._id, supervisor: people.boss._id })
    await addPerson('nurseA1', { name: '3A 護理師', department: deptA._id, subDepartment: unitA1._id })
    await addPerson('nurseA2', { name: '5B 護理師', department: deptA._id, subDepartment: unitA2._id, supervisor: people.boss._id })
    await addPerson('carerB1', { name: '日照照服員', department: deptB._id, subDepartment: unitB1._id })
    await addPerson('clerk', { name: '行政人員', department: deptC._id })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('lets the administrator assign the schedulers and the 使用班別 of the units through the API', async () => {
    const forScheduler = await put('admin', `/api/sub-departments/${ids.unitA1}`, { schedulers: [id('scheduler')] })
    expect(forScheduler.status).toBe(200)
    expect(forScheduler.body.schedulers).toEqual([id('scheduler')])
    const unitB1 = await put('admin', `/api/sub-departments/${ids.unitB1}`, {
      schedulers: [id('scheduler'), id('scheduler')],
      allowedShiftIds: [ids.night, ids.rest],
    })
    expect(unitB1.status).toBe(200)
    expect(unitB1.body).toMatchObject({ schedulers: [id('scheduler')], allowedShiftIds: [ids.night, ids.rest] })
    expect((await put('admin', `/api/sub-departments/${ids.unitB1}`, { allowedShiftIds: ['not-a-shift'] })).status).toBe(400)

    const stored = await SubDepartment.findById(ids.unitA1).lean()
    expect(stored.schedulers.map(String)).toEqual([id('scheduler')])
    // 其他欄位照舊：只改名稱時不清掉排班人員
    await put('admin', `/api/sub-departments/${ids.unitA1}`, { name: '3A 病房' })
    expect((await SubDepartment.findById(ids.unitA1).lean()).schedulers.map(String)).toEqual([id('scheduler')])
  })

  it('gives the employee-role scheduler the schedule page (profile, menu, unit list)', async () => {
    const profile = await get('scheduler', '/api/profile')
    expect(profile.status).toBe(200)
    expect(profile.body.scheduleAccess).toMatchObject({ canSchedule: true, supervisorScope: false })
    expect([...profile.body.scheduleAccess.subDepartmentIds].sort()).toEqual([ids.unitA1, ids.unitB1].sort())
    expect([...profile.body.scheduleAccess.departmentIds].sort()).toEqual([ids.deptA, ids.deptB].sort())
    expect((await get('scheduler', '/api/menu')).body.map((item) => item.name)).toContain('Schedule')
    expect((await get('scheduler', '/api/sub-departments')).status).toBe(200)

    expect((await get('clerk', '/api/profile')).body.scheduleAccess.canSchedule).toBe(false)
    expect((await get('clerk', '/api/menu')).body.map((item) => item.name)).not.toContain('Schedule')
    expect((await get('clerk', '/api/sub-departments')).status).toBe(403)
  })

  it('shows the scheduler exactly the employees of the two units, and nothing else', async () => {
    const unitA1 = await get('scheduler', `/api/employees/schedule?department=${ids.deptA}&subDepartment=${ids.unitA1}`)
    expect(unitA1.status).toBe(200)
    expect(namesOf(unitA1)).toEqual(['3A 護理師'])
    const unitB1 = await get('scheduler', `/api/employees/schedule?department=${ids.deptB}&subDepartment=${ids.unitB1}`)
    expect(namesOf(unitB1)).toEqual(['日照照服員'])
    expect(namesOf(await get('scheduler', `/api/employees/schedule?department=${ids.deptA}&subDepartment=${ids.unitA2}`))).toEqual([])
    expect(namesOf(await get('scheduler', '/api/employees/schedule'))).toEqual(['3A 護理師', '日照照服員'])
  })

  it('lets the scheduler write, read and publish schedules of the units only, with the 使用班別 of each unit', async () => {
    expect((await createSchedule('scheduler', 'nurseA1', 2, 'day')).status).toBe(201)
    expect((await createSchedule('scheduler', 'nurseA2', 2, 'day')).status).toBe(403)
    expect((await createSchedule('scheduler', 'scheduler', 2, 'day')).status).toBe(403)
    expect((await createSchedule('scheduler', 'clerk', 2, 'day')).status).toBe(403)

    const refused = await createSchedule('scheduler', 'carerB1', 2, 'day')
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('SHIFT_NOT_ALLOWED')
    expect(refused.body.error).toContain('日照中心')
    expect((await createSchedule('scheduler', 'carerB1', 2, 'night')).status).toBe(201)

    const monthly = await get('scheduler', `/api/schedules/monthly?month=${MONTH}&employeeIds=${id('nurseA1')},${id('carerB1')}&page=1&pageSize=50`)
    expect(monthly.status).toBe(200)
    expect(monthly.body.schedules).toHaveLength(2)
    expect((await get('scheduler', `/api/schedules/monthly?month=${MONTH}&employeeIds=${id('nurseA2')}&page=1&pageSize=50`)).status).toBe(403)
    expect((await get('scheduler', `/api/schedules/leave-approvals?month=${MONTH}`)).status).toBe(200)
    expect((await get('scheduler', `/api/schedules/summary?month=${MONTH}`)).body.stats.direct).toBe(2)

    const published = await post('scheduler', '/api/schedules/publish', { month: MONTH })
    expect(published.status).toBe(200)
    expect(published.body.updated).toBe(2)
  })

  it('refuses a disallowed shift in a schedule import by the scheduler', async () => {
    const file = await workbook(['E-carerB1'], 'D')
    const res = await request(app)
      .post('/api/schedules/import')
      .set(as('scheduler'))
      .field('month', MONTH)
      .field('department', ids.deptB)
      .field('subDepartment', ids.unitB1)
      .field('mode', 'preview')
      .attach('file', file, { filename: 'schedule.xlsx', contentType: xlsxType })
    expect(res.status).toBe(422)
    expect(res.body.errors.map((error) => error.message)).toEqual([expect.stringContaining('沒有開放使用「D」這個班別')])
  })

  it('keeps the supervisor scope (self and direct reports) and lets the administrator see everyone', async () => {
    expect(namesOf(await get('boss', '/api/employees/schedule'))).toEqual(['5B 護理師', '排班員'])
    expect((await createSchedule('boss', 'nurseA2', 3, 'day')).status).toBe(201)
    expect((await createSchedule('boss', 'nurseA1', 3, 'day')).status).toBe(403)

    const all = await get('admin', '/api/employees/schedule')
    expect(all.body).toHaveLength(Object.keys(people).length)
    expect((await createSchedule('admin', 'carerB1', 4, 'day')).status).toBe(201)
    const everything = await get('admin', `/api/schedules/monthly?month=${MONTH}`)
    expect(everything.body.schedules).toHaveLength(4)
  })

  it('removes supervisor-only access in scheduler_only mode, while schedulers keep theirs', async () => {
    const saved = await put('admin', '/api/other-control-settings/schedule-access', { mode: 'scheduler_only' })
    expect(saved.status).toBe(200)
    expect(saved.body.mode).toBe('scheduler_only')

    expect((await get('boss', '/api/profile')).body.scheduleAccess).toMatchObject({ canSchedule: false, supervisorScope: false })
    expect((await get('boss', '/api/menu')).body.map((item) => item.name)).not.toContain('Schedule')
    expect((await createSchedule('boss', 'nurseA2', 5, 'day')).status).toBe(403)
    expect((await get('boss', `/api/schedules/monthly?month=${MONTH}&employee=${id('nurseA2')}`)).status).toBe(403)
    expect((await createSchedule('scheduler', 'nurseA1', 5, 'day')).status).toBe(201)

    await put('admin', '/api/other-control-settings/schedule-access', { mode: 'supervisor_and_scheduler' })
    expect((await createSchedule('boss', 'nurseA2', 5, 'day')).status).toBe(201)
  })

  it('treats the legacy 排班管理者 of a department as a scheduler of the whole department', async () => {
    await put('admin', `/api/departments/${ids.deptC}`, { name: '行政部', organization: ids.org, deptManager: id('nurseA2') })
    expect(namesOf(await get('nurseA2', '/api/employees/schedule'))).toEqual(['行政人員'])
    expect((await createSchedule('nurseA2', 'clerk', 6, 'day')).status).toBe(201)
  })

  it('saves the 使用簽核表單 of a department', async () => {
    const form = await FormTemplate.create({ name: '請假單', is_active: true })
    const saved = await put('admin', `/api/departments/${ids.deptA}`, { name: '護理部', organization: ids.org, allowedFormIds: [String(form._id)] })
    expect(saved.status).toBe(200)
    expect(saved.body.allowedFormIds).toEqual([String(form._id)])
    expect((await Department.findById(ids.deptA).lean()).allowedFormIds.map(String)).toEqual([String(form._id)])
    const listed = await get('admin', '/api/departments')
    expect(listed.body.find((dept) => dept._id === ids.deptA).allowedFormIds).toEqual([String(form._id)])
    expect((await put('admin', `/api/departments/${ids.deptA}`, { allowedFormIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(400)
  })
})
