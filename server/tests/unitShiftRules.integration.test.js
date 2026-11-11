// 小單位設定的端到端測試（客戶 2026/11）：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// - 設定畫面拿掉「班表拉選」與沒有功能的欄位後，只送畫面上的欄位存檔：資料庫裡原本的值都保留
// - 「使用班別」限制所有班別（客戶 2026/11/11「全部都要能管控」）：休息日、例假、國定假日、請假也要選了才能用，
//   新增、批次、修改與匯入都一樣
// 預設略過；要執行時指定一個本機的暫用資料庫（和其他整合測試相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27321 npm test -- tests/unitShiftRules.integration.test.js
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
    throw new Error('Unit shift rule integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_unit_shift_rules_${process.pid}_${Date.now()}`
  return uri.toString()
}

const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describeIntegration('unit settings and the controlled shift list (rest shifts included) against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let SubDepartment
  let ShiftSchedule
  const people = {}
  const ids = {}
  const MONTH = '2031-04'
  const secret = 'integration-test-secret-unit-shift-rules-0123456789'

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
  const dateOf = (day) => `${MONTH}-${String(day).padStart(2, '0')}`
  const createSchedule = (employeeKey, day, shift) => post('scheduler', '/api/schedules', {
    employee: id(employeeKey),
    date: dateOf(day),
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

  async function workbook(employeeCode, codes) {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('工作表1')
    sheet.addRow(['公版班表'])
    sheet.addRow(['', '', '行事曆'])
    sheet.addRow(['', '', '日期', ...codes.map((_, index) => index + 20)])
    sheet.addRow(['員工代號', '姓名', '星期', ...codes.map(() => '')])
    sheet.addRow([employeeCode, '', '護理師', ...codes])
    return Buffer.from(await book.xlsx.writeBuffer())
  }

  const importPreview = async (codes) => request(app)
    .post('/api/schedules/import')
    .set(as('scheduler'))
    .field('month', MONTH)
    .field('department', ids.dept)
    .field('subDepartment', ids.unit)
    .field('mode', 'preview')
    .attach('file', await workbook('E-carer', codes), { filename: 'schedule.xlsx', contentType: xlsxType })

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.PORT = process.env.PORT || '0'
    process.env.JWT_SECRET = secret
    process.env.MONGODB_URI = isolatedMongoUri()
    process.env.API_RATE_LIMIT_MAX = '100000'
    process.env.API_MUTATION_RATE_LIMIT_MAX = '100000'
    ;({ app } = await import('../src/index.js'))
    ;({ default: Employee } = await import('../src/models/Employee.js'))
    ;({ default: SubDepartment } = await import('../src/models/SubDepartment.js'))
    ;({ default: ShiftSchedule } = await import('../src/models/ShiftSchedule.js'))
    const { default: Department } = await import('../src/models/Department.js')
    const { default: Organization } = await import('../src/models/Organization.js')
    const { default: AttendanceSetting } = await import('../src/models/AttendanceSetting.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all([Employee.syncIndexes(), ShiftSchedule.syncIndexes()])

    const setting = await AttendanceSetting.create({
      shifts: [
        { name: '白班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
        { name: '大夜', code: 'N', semanticType: 'work', startTime: '00:00', endTime: '08:00' },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
        { name: '國定假日', code: '國', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
      ],
    })
    const [day, night, rest, regular, holiday] = setting.shifts
    Object.assign(ids, {
      day: String(day._id), night: String(night._id), rest: String(rest._id), regular: String(regular._id), holiday: String(holiday._id),
    })

    const org = await Organization.create({ name: '迦南測試機構' })
    const dept = await Department.create({ name: '護理部', organization: org._id })
    // 舊資料：小單位存過班表拉選、證號、人力需求等現在不再顯示的欄位；使用班別只選了大夜（沒有休息類班別）
    const unit = await SubDepartment.create({
      name: 'B1 病房',
      code: 'B1',
      department: dept._id,
      unitName: '舊單位名稱',
      institutionCode: 'IC-9',
      uniformNumber: '12345678',
      laborInsuranceNumber: 'LAB-1',
      healthInsuranceNumber: 'HEA-1',
      taxRegistrationNumber: 'TAX-1',
      location: '三樓',
      phone: '02-1234-5678',
      responsiblePerson: '林負責',
      manager: '王組長',
      headcount: 12,
      shift: day._id,
      scheduleSetting: '舊排班設定',
      allowedShiftIds: [ids.night],
    })
    Object.assign(ids, { org: String(org._id), dept: String(dept._id), unit: String(unit._id) })

    await addPerson('admin', { role: 'admin' })
    await addPerson('scheduler', { name: '排班員', department: dept._id })
    await addPerson('carer', { name: 'B1 護理師', department: dept._id, subDepartment: unit._id })
    await SubDepartment.updateOne({ _id: unit._id }, { $set: { schedulers: [people.scheduler._id] } })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  it('saves the slimmer unit dialog (only the shown fields) without wiping the hidden values', async () => {
    const before = await SubDepartment.findById(ids.unit).lean()
    const saved = await put('admin', `/api/sub-departments/${ids.unit}`, {
      department: ids.dept,
      name: 'B1 病房（內科）',
      code: 'B1',
      schedulers: [id('scheduler')],
    })
    expect(saved.status).toBe(200)
    const after = await SubDepartment.findById(ids.unit).lean()
    expect(after.name).toBe('B1 病房（內科）')
    for (const key of ['unitName', 'institutionCode', 'uniformNumber', 'laborInsuranceNumber', 'healthInsuranceNumber',
      'taxRegistrationNumber', 'location', 'phone', 'responsiblePerson', 'manager', 'headcount', 'scheduleSetting']) {
      expect(after[key]).toEqual(before[key])
    }
    expect(String(after.shift)).toBe(ids.day)
    expect(after.allowedShiftIds).toEqual([ids.night])
    expect(after.schedulers.map(String)).toEqual([id('scheduler')])

    // API 仍接受、回傳班表拉選（shiftId）
    const listed = await get('admin', `/api/sub-departments?department=${ids.dept}`)
    expect(listed.body.find((unit) => unit._id === ids.unit)).toMatchObject({ shiftId: ids.day, uniformNumber: '12345678', headcount: 12 })
  })

  it('refuses rest-type shifts the unit did not select, like any unselected work shift', async () => {
    expect((await createSchedule('carer', 1, 'night')).status).toBe(201)
    for (const [day, shift] of [[2, 'rest'], [3, 'regular'], [4, 'holiday'], [5, 'day']]) {
      const refused = await createSchedule('carer', day, shift)
      expect(refused.status).toBe(400)
      expect(refused.body.code).toBe('SHIFT_NOT_ALLOWED')
      expect(refused.body.error).toContain('B1 病房')
    }
  })

  it('allows a rest shift once it is selected, in a batch and when changing an existing schedule', async () => {
    const saved = await put('admin', `/api/sub-departments/${ids.unit}`, { allowedShiftIds: [ids.night, ids.rest] })
    expect(saved.status).toBe(200)

    const batch = await post('scheduler', '/api/schedules/batch', {
      schedules: [{ employee: id('carer'), date: dateOf(6), shiftId: ids.rest }],
    })
    expect(batch.status).toBe(201)
    const refusedBatch = await post('scheduler', '/api/schedules/batch', {
      schedules: [
        { employee: id('carer'), date: dateOf(7), shiftId: ids.rest },
        { employee: id('carer'), date: dateOf(8), shiftId: ids.regular },
      ],
    })
    expect(refusedBatch.status).toBe(400)
    expect(refusedBatch.body.code).toBe('SHIFT_NOT_ALLOWED')

    const nightSchedule = await ShiftSchedule.findOne({ employee: people.carer._id, shiftId: ids.night }).lean()
    const changed = await put('scheduler', `/api/schedules/${nightSchedule._id}`, { shiftId: ids.rest })
    expect(changed.status).toBe(200)
    expect(changed.body.shiftId).toBe(ids.rest)
    const refusedChange = await put('scheduler', `/api/schedules/${nightSchedule._id}`, { shiftId: ids.holiday })
    expect(refusedChange.status).toBe(400)
    expect(refusedChange.body.code).toBe('SHIFT_NOT_ALLOWED')
  })

  it('accepts only the selected shift codes in a schedule import, rest-type codes included', async () => {
    const accepted = await importPreview(['休', 'N'])
    expect(accepted.status).toBe(200)
    expect(accepted.body.errors).toEqual([])
    expect(accepted.body.scheduleDays).toBe(2)

    const refused = await importPreview(['例', 'D'])
    expect(refused.status).toBe(422)
    expect(refused.body.errors.map((error) => error.message)).toEqual([
      expect.stringContaining('沒有開放使用「例」這個班別'),
      expect.stringContaining('沒有開放使用「D」這個班別'),
    ])
  })
})
