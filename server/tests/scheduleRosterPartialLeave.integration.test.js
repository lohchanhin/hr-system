// 排班遇到「只請幾小時的假」的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
// 請假改以小時計之後，只請 2 小時的假不能讓整天都排不了班：上班班別只有在核准請假「整天」或「涵蓋整個班次」時才擋，
// 判斷與國定假日休假紀錄（holidayRestLedgerService）共用同一個 buildLeaveDayCheck。
// 預設略過；要執行時指定一個本機的暫用資料庫（和其他整合測試相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27321 npm test -- tests/scheduleRosterPartialLeave.integration.test.js
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
    throw new Error('Schedule roster leave integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_roster_leave_${process.pid}_${Date.now()}`
  return uri.toString()
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
// 台灣時間 YYYY-MM-DD hh:mm 的 UTC ISO 字串（前端日期選擇器送出的格式）
const taiwanIso = (day, hour = 0, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date, hour, minute) - TAIPEI_OFFSET_MS).toISOString()
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describeIntegration('rostering around hourly approved leave, against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let FormTemplate
  let FormField
  let ApprovalWorkflow
  let ApprovalRequest
  let ShiftSchedule
  let AttendanceSetting
  let resetLeaveFieldCache
  const people = {}
  const shifts = {}
  let leaveForm
  let nurseSeq = 0
  const MONTH = '2026-11'
  const DAYS_IN_MONTH = 30
  const DEPT = new mongoose.Types.ObjectId()
  const SUB = new mongoose.Types.ObjectId()
  const day = (n) => `${MONTH}-${String(n).padStart(2, '0')}`

  const secret = 'integration-test-secret-integration-test-secret'
  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const auth = (key) => ({ Authorization: `Bearer ${tokenFor(people[key])}` })

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

  // 每個情境一位新護理師，避免班表的 (員工, 日期) 唯一索引互相干擾
  async function addNurse() {
    nurseSeq += 1
    const key = `nurse${nurseSeq}`
    const nurse = await addPerson(key, {
      name: `護理師${nurseSeq}`,
      employeeId: `N${String(nurseSeq).padStart(3, '0')}`,
      supervisor: people.boss._id,
      department: DEPT,
      subDepartment: SUB,
    })
    return nurse
  }

  // 一張核准的請假：from / to 是 [日, 時, 分]（台灣時間）；整天的假兩端都是 00:00
  async function approveLeave(nurse, from, to, leaveType = '事假') {
    const fieldData = {
      [leaveForm.fields['假別']]: leaveType,
      [leaveForm.fields['開始時間']]: taiwanIso(day(from[0]), from[1] ?? 0, from[2] ?? 0),
      [leaveForm.fields['結束時間']]: taiwanIso(day(to[0]), to[1] ?? 0, to[2] ?? 0),
    }
    await ApprovalRequest.create({
      form: leaveForm.form._id,
      workflow: leaveForm.workflow._id,
      applicant_employee: nurse._id,
      applicant_department: String(DEPT),
      form_data: fieldData,
      status: 'approved',
      steps: [{ step_order: 1, approvers: [{ approver: people.boss._id, decision: 'approved' }], all_must_approve: true }],
    })
  }

  // 公版班表：codes 是 { 日: 代碼 }，其餘日期留空
  async function workbookFor(nurse, codes) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('工作表1')
    const days = Array.from({ length: DAYS_IN_MONTH }, (_, index) => index + 1)
    sheet.addRow(['公版班表'])
    sheet.addRow(['', '', '行事曆'])
    sheet.addRow(['', '', '日期', ...days])
    sheet.addRow(['員工代號', '姓名', '星期', ...days.map(() => '')])
    sheet.addRow([nurse.employeeId, nurse.name, '護理師', ...days.map((n) => codes[n] || '')])
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  async function importCells(nurse, codes, mode = 'preview') {
    return request(app)
      .post('/api/schedules/import')
      .set(auth('admin'))
      .field('month', MONTH)
      .field('department', String(DEPT))
      .field('mode', mode)
      .attach('file', await workbookFor(nurse, codes), { filename: 'schedule.xlsx', contentType: XLSX_TYPE })
  }

  const createCell = (nurse, n, code, as = 'boss') => request(app)
    .post('/api/schedules')
    .set(auth(as))
    .send({ employee: String(nurse._id), date: day(n), shiftId: String(shifts[code]._id), department: String(DEPT), subDepartment: String(SUB) })

  const batchCells = (nurse, cells, as = 'boss') => request(app)
    .post('/api/schedules/batch')
    .set(auth(as))
    .send({
      schedules: cells.map(([n, code]) => ({
        employee: String(nurse._id), date: day(n), shiftId: String(shifts[code]._id), department: String(DEPT), subDepartment: String(SUB),
      })),
    })

  const updateCell = (id, body, as = 'boss') => request(app).put(`/api/schedules/${id}`).set(auth(as)).send(body)

  const rowOn = async (nurse, n) => ShiftSchedule.findOne({ employee: nurse._id, date: new Date(`${day(n)}T00:00:00.000Z`) }).lean()
  const rowCount = (nurse) => ShiftSchedule.countDocuments({ employee: nurse._id })

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

    await addPerson('admin', { role: 'admin' })
    await addPerson('boss', { role: 'supervisor', department: DEPT })

    const form = await FormTemplate.create({ name: '(全)假別申請單', semanticType: 'leave', semantic_type_set: true, is_active: true })
    const fields = {}
    const defs = [
      { label: '假別', type_1: 'select', required: true, options: ['特休', '事假', '病假'] },
      { label: '開始時間', type_1: 'datetime', required: true },
      { label: '結束時間', type_1: 'datetime', required: true },
    ]
    for (const [index, def] of defs.entries()) {
      const created = await FormField.create({ form: form._id, order: index + 1, ...def })
      fields[def.label] = String(created._id)
    }
    const workflow = await ApprovalWorkflow.create({
      form: form._id,
      steps: [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', all_must_approve: true, is_required: true, can_return: true }],
    })
    leaveForm = { form, fields, workflow }
    resetLeaveFieldCache()

    // 日班 08:00-17:00（休息 60 分鐘）、下午班 13:00-17:00、夜班 22:00-06:00、休息日（00:00-00:00）、特休（請假班別）
    const setting = await AttendanceSetting.create({
      shifts: [
        { name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 },
        { name: '下午班', code: 'P', semanticType: 'work', startTime: '13:00', endTime: '17:00' },
        { name: '夜班', code: 'N', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true },
        { name: '休息日', code: 'R', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '特休', code: '特', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
      ],
    })
    setting.shifts.forEach((shift) => { shifts[shift.code] = shift })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('a 2-hour leave does not stop a working shift', () => {
    it('lets the import preview and commit place the 日班 on that day', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])

      const preview = await importCells(nurse, { 3: 'D', 4: 'D' })
      expect(preview.status).toBe(200)
      expect(preview.body.errors).toEqual([])
      expect(preview.body.scheduleDays).toBe(2)

      const committed = await importCells(nurse, { 3: 'D', 4: 'D' }, 'commit')
      expect(committed.status).toBe(201)
      expect(committed.body.imported).toBe(2)
      expect(String((await rowOn(nurse, 3)).shiftId)).toBe(String(shifts.D._id))
    })

    it('lets a single cell be created, then changed to another working shift', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])

      const created = await createCell(nurse, 3, 'D')
      expect(created.status).toBe(201)

      const changed = await updateCell(created.body._id, { shiftId: String(shifts.P._id) })
      expect(changed.status).toBe(200)
      expect(String((await rowOn(nurse, 3)).shiftId)).toBe(String(shifts.P._id))
    })

    it('lets a row be moved onto that day', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])
      const created = await createCell(nurse, 5, 'D')
      expect(created.status).toBe(201)

      const moved = await updateCell(created.body._id, { date: day(3) })
      expect(moved.status).toBe(200)
      expect(await rowOn(nurse, 3)).toBeTruthy()
    })

    it('lets the batch apply put the 日班 on that day together with other days', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])

      const res = await batchCells(nurse, [[2, 'D'], [3, 'D'], [4, 'D']])
      expect(res.status).toBe(201)
      expect(await rowCount(nurse)).toBe(3)
    })

    it('does not break the schedule completeness check for that day', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])
      expect((await createCell(nurse, 3, 'D')).status).toBe(201)

      const validation = await request(app).get(`/api/schedules/validate?month=${MONTH}&department=${DEPT}`).set(auth('admin'))
      expect(validation.status).toBe(200)
      const mine = validation.body.results.find((item) => item.employeeId === String(nurse._id))
      expect(mine.conflictDays).toEqual([])
    })
  })

  describe('the completeness check flags a worked row only when the leave blocks it', () => {
    it('for a row that was rostered before a full-day or covering leave was approved', async () => {
      const nurse = await addNurse()
      for (const [n, code] of [[3, 'D'], [4, 'D'], [5, 'P'], [6, 'R']]) {
        expect((await createCell(nurse, n, code)).status).toBe(201)
      }
      await approveLeave(nurse, [3, 9], [3, 11])
      await approveLeave(nurse, [4, 0], [4, 0])
      await approveLeave(nurse, [5, 13], [5, 17])
      await approveLeave(nurse, [6, 0], [6, 0])

      const validation = await request(app).get(`/api/schedules/validate?month=${MONTH}&department=${DEPT}`).set(auth('admin'))
      expect(validation.status).toBe(200)
      const mine = validation.body.results.find((item) => item.employeeId === String(nurse._id))
      // 3 日只請 2 小時、6 日是休息日：不算衝突；4 日全天請假、5 日請假涵蓋整個下午班：衝突
      expect(mine.conflictDays).toEqual([day(4), day(5)])
    })
  })

  describe('the Excel export of the roster', () => {
    it('keeps the rostered shift on a 2-hour leave day and shows the leave on a whole-day leave', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])
      expect((await createCell(nurse, 3, 'D')).status).toBe(201)
      // 全天請假核准之前就排好的班：匯出時請假蓋過班表代碼（原本的行為）
      expect((await createCell(nurse, 4, 'D')).status).toBe(201)
      await approveLeave(nurse, [4, 0], [4, 0])

      const res = await request(app)
        .get(`/api/schedules/export?month=${MONTH}&department=${DEPT}&format=excel`)
        .set(auth('admin'))
        .buffer(true)
        .parse((response, callback) => {
          const chunks = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => callback(null, Buffer.concat(chunks)))
        })
      expect(res.status).toBe(200)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(res.body)
      const sheet = workbook.getWorksheet('工作表1')
      let mine = null
      sheet.eachRow((row) => { if (row.getCell(1).value === nurse.employeeId) mine = row })
      expect(mine).toBeTruthy()
      expect(mine.getCell(4 + 3).value).toBe('D')
      expect(mine.getCell(4 + 4).value).toBe('事')
    })
  })

  describe('a 2-hour leave on a rest-day shift is fine', () => {
    it('for import, single create and batch', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [6, 9], [6, 11])

      expect((await importCells(nurse, { 6: 'R' })).body.errors).toEqual([])
      expect((await createCell(nurse, 6, 'R')).status).toBe(201)
      const other = await addNurse()
      await approveLeave(other, [6, 9], [6, 11])
      expect((await batchCells(other, [[6, 'R']])).status).toBe(201)
    })
  })

  describe('a full-day approved leave still blocks a working shift', () => {
    it('for import, single create, update and batch, and leaves non-work shifts alone', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [7, 0], [7, 0])

      const preview = await importCells(nurse, { 7: 'D' })
      expect(preview.status).toBe(422)
      expect(preview.body.errors).toEqual([expect.objectContaining({ day: 7, code: 'D', message: '該日期已有核准請假，無法匯入班別' })])
      expect((await importCells(nurse, { 7: 'D' }, 'commit')).status).toBe(422)
      expect(await rowCount(nurse)).toBe(0)

      const created = await createCell(nurse, 7, 'D')
      expect(created.status).toBe(400)
      expect(created.body).toEqual({ error: 'leave conflict' })

      const batch = await batchCells(nurse, [[8, 'D'], [7, 'D']])
      expect(batch.status).toBe(400)
      expect(batch.body).toEqual({ error: 'leave conflict' })
      expect(await rowCount(nurse)).toBe(0)

      const free = await createCell(nurse, 9, 'D')
      expect(free.status).toBe(201)
      const moved = await updateCell(free.body._id, { date: day(7) })
      expect(moved.status).toBe(400)
      expect(moved.body).toEqual({ error: 'leave conflict' })

      // 休息日、請假班別：匯入不算衝突；手動排班遇到整天請假仍然擋（原本的行為，見 docs/shift-holiday-leave-codes.md）
      expect((await importCells(nurse, { 7: 'R' })).body.errors).toEqual([])
      expect((await createCell(nurse, 7, 'R')).status).toBe(400)
      expect((await batchCells(nurse, [[7, 'R']])).status).toBe(400)
    })

    it('blocks the 日班 on every day of a multi-day leave, and only those days', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [10, 0], [12, 0], '特休')

      const preview = await importCells(nurse, { 9: 'D', 10: 'D', 11: 'D', 12: 'D', 13: 'D' })
      expect(preview.status).toBe(422)
      expect(preview.body.errors.map((error) => error.day)).toEqual([10, 11, 12])

      for (const n of [10, 11, 12]) {
        const res = await createCell(nurse, n, 'D')
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ error: 'leave conflict' })
      }
      for (const n of [9, 13]) {
        expect((await createCell(nurse, n, 'D')).status).toBe(201)
      }
    })

    it('blocks the whole day when a leave on the day is all-day even if a 2-hour leave sits next to it', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [14, 9], [14, 11])
      await approveLeave(nurse, [14, 0], [14, 0], '特休')

      expect((await createCell(nurse, 14, 'D')).status).toBe(400)
    })
  })

  describe('a leave that covers the shift blocks it', () => {
    it('blocks an afternoon shift covered by an afternoon leave, but not the 日班 that only overlaps it', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [15, 13], [15, 17])

      const preview = await importCells(nurse, { 15: 'P' })
      expect(preview.status).toBe(422)
      expect(preview.body.errors).toEqual([expect.objectContaining({ day: 15, code: 'P' })])
      expect((await createCell(nurse, 15, 'P')).status).toBe(400)
      const batch = await batchCells(nurse, [[15, 'P']])
      expect(batch.status).toBe(400)
      expect(batch.body).toEqual({ error: 'leave conflict' })

      // 日班 08:00-17:00 只被 13:00-17:00 涵蓋一部分
      expect((await importCells(nurse, { 15: 'D' })).body.errors).toEqual([])
      expect((await createCell(nurse, 15, 'D')).status).toBe(201)
    })

    it('blocks a leave that covers the whole 日班, also when only the unpaid break is left uncovered', async () => {
      const whole = await addNurse()
      await approveLeave(whole, [16, 8], [16, 17])
      expect((await createCell(whole, 16, 'D')).status).toBe(400)
      expect((await importCells(whole, { 16: 'D' })).status).toBe(422)

      const withinBreak = await addNurse()
      await approveLeave(withinBreak, [16, 9], [16, 17])
      expect((await createCell(withinBreak, 16, 'D')).status).toBe(400)

      const beyondBreak = await addNurse()
      await approveLeave(beyondBreak, [16, 10], [16, 17])
      expect((await createCell(beyondBreak, 16, 'D')).status).toBe(201)
    })

    it('blocks a shift covered by two leaves together', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [17, 8], [17, 12])
      await approveLeave(nurse, [17, 12], [17, 17])
      expect((await createCell(nurse, 17, 'D')).status).toBe(400)
    })

    it('judges a timed multi-day leave per day', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [20, 13], [22, 10])

      // 20 日只請下午、22 日只請上午前段：日班都沒被涵蓋；21 日整天都在請假中
      expect((await createCell(nurse, 20, 'D')).status).toBe(201)
      expect((await createCell(nurse, 22, 'D')).status).toBe(201)
      const middle = await createCell(nurse, 21, 'D')
      expect(middle.status).toBe(400)
      expect(middle.body).toEqual({ error: 'leave conflict' })
    })
  })

  describe('a shift that cannot be resolved keeps the old day-level rule', () => {
    it('blocks any approved leave when the shift id is not in the shift table', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [24, 9], [24, 11])
      const res = await request(app)
        .post('/api/schedules')
        .set(auth('boss'))
        .send({ employee: String(nurse._id), date: day(24), shiftId: String(new mongoose.Types.ObjectId()), department: String(DEPT) })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'leave conflict' })
    })
  })

  describe('each request reads the approved leave once', () => {
    it('import, batch and single create do not query leave per cell', async () => {
      const nurse = await addNurse()
      await approveLeave(nurse, [3, 9], [3, 11])
      await approveLeave(nurse, [10, 0], [11, 0])
      const spy = jest.spyOn(ApprovalRequest, 'find')
      try {
        const codes = Object.fromEntries(Array.from({ length: 28 }, (_, index) => [index + 1, 'D']))
        spy.mockClear()
        await importCells(nurse, codes)
        expect(spy).toHaveBeenCalledTimes(1)

        spy.mockClear()
        await importCells(nurse, codes, 'commit')
        expect(spy).toHaveBeenCalledTimes(1)

        const other = await addNurse()
        await approveLeave(other, [3, 9], [3, 11])
        spy.mockClear()
        const batch = await batchCells(other, Array.from({ length: 28 }, (_, index) => [index + 1, 'D']))
        expect(batch.status).toBe(201)
        expect(spy).toHaveBeenCalledTimes(1)

        spy.mockClear()
        expect((await createCell(other, 29, 'D')).status).toBe(201)
        expect(spy).toHaveBeenCalledTimes(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('the completeness check reads it a fixed number of times however many employees it checks', async () => {
      // 下午班排好之後才核准涵蓋整個下午班的假：每位都是 25 日衝突
      const addCoveredNurse = async () => {
        const nurse = await addNurse()
        expect((await createCell(nurse, 25, 'P')).status).toBe(201)
        await approveLeave(nurse, [25, 13], [25, 17])
        return nurse
      }
      const validate = () => request(app).get(`/api/schedules/validate?month=${MONTH}&department=${DEPT}`).set(auth('admin'))
      const nurses = [await addCoveredNurse()]
      const spy = jest.spyOn(ApprovalRequest, 'find')
      try {
        spy.mockClear()
        const fewer = await validate()
        expect(fewer.status).toBe(200)
        const findsWithFewer = spy.mock.calls.length

        for (let index = 0; index < 6; index += 1) nurses.push(await addCoveredNurse())
        spy.mockClear()
        const more = await validate()
        expect(more.status).toBe(200)
        expect(more.body.results.length).toBeGreaterThanOrEqual(fewer.body.results.length + 6)
        for (const nurse of nurses) {
          expect(more.body.results.find((item) => item.employeeId === String(nurse._id)).conflictDays).toEqual([day(25)])
        }
        // 請假日曆一次、請假時間區間一次（一個請假表單），不隨員工人數增加
        expect(spy).toHaveBeenCalledTimes(2)
        expect(findsWithFewer).toBe(2)
      } finally {
        spy.mockRestore()
      }
    })
  })
})
