// 排班規範（一例一休）的兩項客戶回饋，端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone，沒有交易）。
//   1. 兼職人員（Employee.partTime === true）不套用排班規範：預檢、匯入預覽與匯入、發布、完成發布都一樣
//   2. 月初、月尾不足一整週（週一為起點、週日為終點）：以鄰月已存的班表補齊（兩個方向），
//      補不齊就違規，還補得上的回報「目前無法判斷」，鄰月之後匯入或儲存時重新檢核就會判斷
// 預設略過；要執行時指定一個本機的暫用資料庫（和 approvalEngine.integration.test.js 相同的環境變數）：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27411 npm test -- tests/scheduleBoundaryWeeksAndPartTime.integration.test.js
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
  uri.pathname = `/hr_schedule_rules_${process.pid}_${Date.now()}`
  return uri.toString()
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const WEEKLY = 'weekly-one-regular-rest-one-rest-day'
// 7/1～7/5（首週在七月的部分）都是日班、沒有例也沒有休；7/6 週一排休，避免變成連續 7 天上班
const FIRST_WEEK_WITHOUT_REST = { 4: '日', 5: '日', 6: '休' }

describeIntegration('schedule rules (part-time exemption, month-edge weeks) against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let Employee
  let ShiftSchedule
  let AttendanceSetting
  let admin

  const secret = 'integration-test-secret-integration-test-secret'
  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const auth = () => ({ Authorization: `Bearer ${tokenFor(admin)}` })
  const get = (url) => request(app).get(url).set(auth())
  const post = (url, body) => request(app).post(url).set(auth()).send(body ?? {})
  const put = (url, body) => request(app).put(url).set(auth()).send(body ?? {})

  // 每個情境用自己的部門，排班與發布互不影響
  let counter = 0
  const newDepartment = () => new mongoose.Types.ObjectId()
  async function addEmployee(department, { partTime, name } = {}) {
    counter += 1
    return Employee.create({
      name: name || `員工${counter}`,
      email: `schedule-rules-${counter}@example.test`,
      username: `schedule-rules-${counter}`,
      employeeId: `S${String(counter).padStart(3, '0')}`,
      role: 'employee',
      organization: 'org-1',
      department,
      ...(partTime === undefined ? {} : { partTime }),
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

  async function workbookFor(month, rows) {
    const days = rows[0].codes.length
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('工作表1')
    const dayNumbers = Array.from({ length: days }, (_, index) => index + 1)
    sheet.addRow(['公版班表'])
    sheet.addRow(['', '', '行事曆'])
    sheet.addRow(['', '', '日期', ...dayNumbers])
    sheet.addRow(['員工代號', '姓名', '星期', ...dayNumbers.map(() => '')])
    rows.forEach(({ employee, codes }) => sheet.addRow([employee.employeeId, employee.name, '護理師', ...codes]))
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  const importWorkbook = (file, department, month, mode = 'preview') => request(app)
    .post('/api/schedules/import')
    .set(auth())
    .field('month', month)
    .field('department', String(department))
    .field('mode', mode)
    .attach('file', file, { filename: 'schedule.xlsx', contentType: XLSX_TYPE })

  const validate = (department, month) => get(`/api/schedules/rules/validate?month=${month}&department=${department}`)
  const weeklyOf = (violations) => violations.filter((item) => item.rule === WEEKLY)
  const idOf = (employee) => String(employee._id)

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
    // breakDuration 要設 60：排班檢核先讀 breakDuration，模型預設 0 會讓 8 小時的日班變成 9 小時
    await AttendanceSetting.create({
      shifts: [
        { name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 },
        { name: '長班', code: '長', semanticType: 'work', startTime: '06:00', endTime: '22:00', breakMinutes: 0, breakDuration: 0 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
      ],
    })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  describe('month-edge weeks (July 2026 starts on Wednesday and ends on Friday)', () => {
    it('judges nothing silently: both edge weeks of a month imported alone are reported as "cannot be judged yet", naming employee and week', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department, { name: '王小美' })
      const file = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07', FIRST_WEEK_WITHOUT_REST) }])

      const preview = await importWorkbook(file, department, '2026-07')

      expect(preview.status).toBe(200)
      expect(preview.body.errors).toEqual([])
      expect(preview.body.warnings).toEqual([])
      expect(preview.body.violations).toEqual([])
      expect(preview.body.pendingWeeks).toEqual([
        expect.objectContaining({
          rule: 'weekly-rest-pending',
          employee: idOf(nurse),
          employeeCode: nurse.employeeId,
          employeeName: '王小美',
          weekStart: '2026-06-29',
          weekEnd: '2026-07-05',
          missingDates: ['2026-06-29', '2026-06-30'],
          missingMonths: ['2026-06'],
        }),
        expect.objectContaining({
          weekStart: '2026-07-27',
          weekEnd: '2026-08-02',
          missingDates: ['2026-08-01', '2026-08-02'],
          missingMonths: ['2026-08'],
        }),
      ])
      expect(preview.body.pendingWeeks[0].message).toContain('2026年6月 班表排定後會重新檢核')
      expect(await ShiftSchedule.countDocuments({ employee: nurse._id })).toBe(0)

      const committed = await importWorkbook(file, department, '2026-07', 'commit')
      expect(committed.status).toBe(201)
      expect(committed.body.imported).toBe(31)
      expect(committed.body.pendingWeeks).toHaveLength(2)
      expect(await ShiftSchedule.countDocuments({ employee: nurse._id })).toBe(31)

      const checked = await validate(department, '2026-07')
      expect(checked.status).toBe(200)
      expect(checked.body).toMatchObject({ ok: true, count: 0, violations: [] })
      expect(checked.body.pendingWeeks.map((item) => item.weekStart)).toEqual(['2026-06-29', '2026-07-27'])
    })

    it('a week whose in-month days already hold 例 and 休 is judged and passes without any notice', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department)
      // 7/4 週六例、7/5 週日休（預設）→ 首週完整；7/27～7/31 五天日班 → 末週仍待判斷
      const file = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07') }])

      const preview = await importWorkbook(file, department, '2026-07')

      expect(preview.body.violations).toEqual([])
      expect(preview.body.pendingWeeks.map((item) => item.weekStart)).toEqual(['2026-07-27'])
    })

    it('saving the neighbouring month later judges the week from both sides (previous month, then next month)', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department, { name: '林小華' })
      // 七月先匯入：首週 7/1～7/5 都是日班
      const july = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07', FIRST_WEEK_WITHOUT_REST) }])
      expect((await importWorkbook(july, department, '2026-07', 'commit')).status).toBe(201)

      // 六月再匯入：6/29、6/30 也是日班 → 這一週七天都有資料卻沒有例也沒有休，六月這邊的匯入就會判斷出來
      const juneCodes = monthCodes('2026-06', { 29: '日', 30: '日' })
      const june = await workbookFor('2026-06', [{ employee: nurse, codes: juneCodes }])
      const junePreview = await importWorkbook(june, department, '2026-06')

      expect(junePreview.status).toBe(200)
      expect(weeklyOf(junePreview.body.violations)).toEqual([
        expect.objectContaining({
          employee: idOf(nurse),
          weekStart: '2026-06-29',
          regularRestCount: 0,
          restDayCount: 0,
          crossMonth: true,
          outsideDates: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'],
          missingDates: [],
        }),
      ])
      expect(weeklyOf(junePreview.body.violations)[0].message).toContain('此週跨月')
      // 六月的最後一週已經判斷出來了，不會同時又當成待判斷
      expect(junePreview.body.pendingWeeks || []).toEqual([])

      expect((await importWorkbook(june, department, '2026-06', 'commit')).status).toBe(201)

      // 回到七月重新檢核：同一週現在是違規，不再是待判斷（七月末週 8/1、8/2 仍待判斷）
      const julyAgain = await validate(department, '2026-07')
      expect(julyAgain.body.ok).toBe(false)
      expect(weeklyOf(julyAgain.body.violations)).toEqual([
        expect.objectContaining({ employee: idOf(nurse), weekStart: '2026-06-29', crossMonth: true }),
      ])
      expect(julyAgain.body.pendingWeeks.map((item) => item.weekStart)).toEqual(['2026-07-27'])
    })

    it('saving the neighbouring month with 休 / 例 on the free days clears the notice (cell saves count the same as imports)', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department)
      const july = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07', FIRST_WEEK_WITHOUT_REST) }])
      await importWorkbook(july, department, '2026-07', 'commit')
      expect((await validate(department, '2026-07')).body.pendingWeeks.map((item) => item.weekStart))
        .toEqual(['2026-06-29', '2026-07-27'])

      // 六月 6/29 休、6/30 例：用單格儲存（POST /api/schedules），不是匯入
      const setting = await AttendanceSetting.findOne().lean()
      const shiftId = (code) => String(setting.shifts.find((shift) => shift.code === code)._id)
      for (const [date, code] of [['2026-06-29', '休'], ['2026-06-30', '例']]) {
        const saved = await post('/api/schedules', {
          employee: idOf(nurse), date, shiftId: shiftId(code), department: String(department),
        })
        expect(saved.status).toBe(201)
      }

      const checked = await validate(department, '2026-07')
      expect(checked.body).toMatchObject({ ok: true, count: 0, violations: [] })
      expect(checked.body.pendingWeeks.map((item) => item.weekStart)).toEqual(['2026-07-27'])
    })

    // 客戶要求變更（「可以顯示規範，可是不要阻止發布」）：真的違規原本會擋發布（400、維持草稿），現在照樣發布、完成發布並回報違規
    it('publish is not blocked by weeks that cannot be judged yet but reports them; a real violation is reported and does not block either', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department)
      const file = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07') }])
      await importWorkbook(file, department, '2026-07', 'commit')

      const published = await post('/api/schedules/publish', { month: '2026-07', department: String(department) })

      expect(published.status).toBe(200)
      expect(published.body.updated).toBe(31)
      expect(published.body.pendingWeeks).toEqual([expect.objectContaining({ weekStart: '2026-07-27', employeeCode: nurse.employeeId })])
      expect(published.body).not.toHaveProperty('violations')
      expect(await ShiftSchedule.countDocuments({ employee: nurse._id, state: 'pending_confirmation' })).toBe(31)

      // 全員確認後完成發布：同樣不被待判斷的週別擋住，也回報它們
      await ShiftSchedule.updateMany({ employee: nurse._id }, { $set: { employeeResponse: 'confirmed' } })
      const finalized = await post('/api/schedules/publish/finalize', { month: '2026-07', department: String(department) })
      expect(finalized.status).toBe(200)
      expect(finalized.body.finalized).toBe(31)
      expect(finalized.body.pendingWeeks).toEqual([expect.objectContaining({ weekStart: '2026-07-27' })])

      // 另一個部門：7/13 那週整週日班（沒有例也沒有休）→ 違規，但不擋發布：照樣發送員工確認，回應列出違規（含員工代號、姓名）
      const otherDepartment = newDepartment()
      const other = await addEmployee(otherDepartment)
      const broken = await workbookFor('2026-07', [{ employee: other, codes: monthCodes('2026-07', { 18: '日', 19: '日' }) }])
      await importWorkbook(broken, otherDepartment, '2026-07', 'commit')
      const withViolation = await post('/api/schedules/publish', { month: '2026-07', department: String(otherDepartment) })
      expect(withViolation.status).toBe(200)
      expect(withViolation.body.updated).toBe(31)
      expect(weeklyOf(withViolation.body.violations)).toEqual([expect.objectContaining({
        weekStart: '2026-07-13',
        employee: idOf(other),
        employeeCode: other.employeeId,
        employeeName: other.name,
      })])
      expect(await ShiftSchedule.countDocuments({ employee: other._id, state: 'pending_confirmation' })).toBe(31)

      // 完成發布同樣不擋，照樣鎖定並再回報一次
      await ShiftSchedule.updateMany({ employee: other._id }, { $set: { employeeResponse: 'confirmed' } })
      const finalizedWithViolation = await post('/api/schedules/publish/finalize', { month: '2026-07', department: String(otherDepartment) })
      expect(finalizedWithViolation.status).toBe(200)
      expect(finalizedWithViolation.body.finalized).toBe(31)
      expect(weeklyOf(finalizedWithViolation.body.violations)).toEqual([expect.objectContaining({ weekStart: '2026-07-13' })])
      expect(await ShiftSchedule.countDocuments({ employee: other._id, state: 'finalized' })).toBe(31)
    })

    // 完成發布不被違規擋下之後：鎖定的月份按「排班檢核」仍要列出違規（含員工代號、姓名），不能回「已通過」
    it('after finalizing despite a violation, the rule check of the locked month still lists it and names the employee', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department, { name: '王違規' })
      const broken = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07', { 18: '日', 19: '日' }) }])
      await importWorkbook(broken, department, '2026-07', 'commit')

      // 發布前的預檢：每項違規附上員工代號、姓名（確認視窗用這份結果，員工不在目前這一頁也看得到是誰）
      const before = await validate(department, '2026-07')
      expect(before.body.ok).toBe(false)
      expect(before.body).not.toHaveProperty('finalized')
      expect(before.body.violations.every((item) => item.employeeCode === nurse.employeeId && item.employeeName === '王違規')).toBe(true)
      expect(weeklyOf(before.body.violations)).toEqual([expect.objectContaining({ weekStart: '2026-07-13', employee: idOf(nurse) })])

      expect((await post('/api/schedules/publish', { month: '2026-07', department: String(department) })).status).toBe(200)
      await ShiftSchedule.updateMany({ employee: nurse._id }, { $set: { employeeResponse: 'confirmed' } })
      const finalized = await post('/api/schedules/publish/finalize', { month: '2026-07', department: String(department) })
      expect(finalized.status).toBe(200)
      expect(await ShiftSchedule.countDocuments({ employee: nurse._id, state: 'finalized', needsReconfirm: false })).toBe(31)

      // 整個月都已鎖定：改檢核已鎖定的班表，結果和完成發布當下回報的一樣
      const after = await validate(department, '2026-07')
      expect(after.status).toBe(200)
      expect(after.body).toEqual(expect.objectContaining({ ok: false, finalized: true }))
      expect(after.body.count).toBe(finalized.body.violations.length)
      expect(after.body.violations.map((item) => item.rule).sort()).toEqual(finalized.body.violations.map((item) => item.rule).sort())
      expect(weeklyOf(after.body.violations)).toEqual([expect.objectContaining({
        weekStart: '2026-07-13', employeeCode: nurse.employeeId, employeeName: '王違規',
      })])
      // 只檢核、不改：班表仍是鎖定的
      expect(await ShiftSchedule.countDocuments({ employee: nurse._id, state: 'finalized' })).toBe(31)

      // 鎖定之後又改了其中一格（變回待發布）：檢核範圍回到待發布的班表（和發布一致），回應不再標 finalized
      const edited = await ShiftSchedule.findOne({ employee: nurse._id }).sort({ date: 1 })
      await ShiftSchedule.updateOne({ _id: edited._id }, { $set: { state: 'draft', needsReconfirm: true } })
      const reopened = await validate(department, '2026-07')
      expect(reopened.body.ok).toBe(false)
      expect(reopened.body).not.toHaveProperty('finalized')
    })

    it('a file with fewer day columns than the month says so instead of silently skipping the weekly check', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department)
      const partial = await workbookFor('2026-07', [{ employee: nurse, codes: monthCodes('2026-07').slice(0, 28) }])

      const preview = await importWorkbook(partial, department, '2026-07')

      expect(preview.status).toBe(200)
      expect(preview.body.warnings).toEqual([
        expect.objectContaining({ message: expect.stringContaining('此檔案只有 28 天的日期欄位（2026-07 共 31 天），未檢核每週一例一休') }),
      ])
      expect(preview.body.pendingWeeks || []).toEqual([])
    })
  })

  describe('part-time employees', () => {
    // 前十二天都是日班（連續 12 天沒有休/例）、7/20 排 06:00-22:00 的長班（16 小時，隔天 8 點上班只隔 10 小時）、7/18 的例改成日班（那週沒有例假）
    const violatingCodes = () => monthCodes('2026-07', {
      1: '日', 2: '日', 3: '日', 4: '日', 5: '日', 6: '日', 7: '日', 8: '日', 9: '日', 10: '日', 11: '日', 12: '日',
      18: '日', 20: '長',
    })

    it('reports the full-time control for every rule family but nothing at all for the part-time employee with the same rows', async () => {
      const department = newDepartment()
      const fullTime = await addEmployee(department, { partTime: false, name: '正職護理師' })
      const partTime = await addEmployee(department, { partTime: true, name: '兼職護理師' })
      const legacy = await addEmployee(department, { name: '舊資料員工' }) // 沒有 partTime 欄位的舊資料算正職
      await Employee.collection.updateOne({ _id: legacy._id }, { $unset: { partTime: '' } })
      const codes = violatingCodes()
      const file = await workbookFor('2026-07', [
        { employee: fullTime, codes },
        { employee: partTime, codes },
        { employee: legacy, codes },
      ])

      const preview = await importWorkbook(file, department, '2026-07')

      expect(preview.status).toBe(200)
      const byEmployee = (employee) => preview.body.violations.filter((item) => item.employee === idOf(employee))
      for (const employee of [fullTime, legacy]) {
        expect([...new Set(byEmployee(employee).map((item) => item.rule))].sort()).toEqual([
          'continuous-work-days', 'daily-work-hours', 'regular-work-hours', 'shift-gap', WEEKLY,
        ])
      }
      expect(byEmployee(partTime)).toEqual([])
      expect((preview.body.pendingWeeks || []).filter((item) => item.employee === idOf(partTime))).toEqual([])
      expect(preview.body.ruleExemptEmployees).toEqual([{ employeeId: partTime.employeeId, name: '兼職護理師' }])

      // 班表本身照常存檔，兼職人員只是不套用規範
      const committed = await importWorkbook(file, department, '2026-07', 'commit')
      expect(committed.status).toBe(201)
      expect(await ShiftSchedule.countDocuments({ employee: partTime._id })).toBe(31)
      expect(byEmployee(partTime)).toEqual([])
      expect(committed.body.violations.filter((item) => item.employee === idOf(partTime))).toEqual([])
      expect(committed.body.violations.filter((item) => item.employee === idOf(fullTime)).length).toBeGreaterThan(0)

      // 預檢端點：只有正職有違規，兼職不在裡面
      const checked = await validate(department, '2026-07')
      expect(checked.body.ok).toBe(false)
      expect(new Set(checked.body.violations.map((item) => item.employee))).toEqual(new Set([idOf(fullTime), idOf(legacy)]))
    })

    it('still blocks a part-time employee’s file on data errors (unknown shift code)', async () => {
      const department = newDepartment()
      const partTime = await addEmployee(department, { partTime: true })
      const file = await workbookFor('2026-07', [{ employee: partTime, codes: monthCodes('2026-07', { 3: 'ZZ' }) }])

      const preview = await importWorkbook(file, department, '2026-07')

      expect(preview.status).toBe(422)
      expect(preview.body.errors).toEqual([expect.objectContaining({ day: 3, code: 'ZZ' })])
    })

    // 客戶要求變更：正職的同一份班表原本發布會被擋（400），現在照樣發布、只回報違規；兼職人員一樣完全沒有違規
    it('publish and finalize pass for a part-time-only scope without any finding; the same rows of a full-time employee publish too but report the violations', async () => {
      const partDepartment = newDepartment()
      const fullDepartment = newDepartment()
      const partTime = await addEmployee(partDepartment, { partTime: true })
      const fullTime = await addEmployee(fullDepartment, { partTime: false })
      const codes = violatingCodes()
      await importWorkbook(await workbookFor('2026-07', [{ employee: partTime, codes }]), partDepartment, '2026-07', 'commit')
      await importWorkbook(await workbookFor('2026-07', [{ employee: fullTime, codes }]), fullDepartment, '2026-07', 'commit')

      const fullPublished = await post('/api/schedules/publish', { month: '2026-07', department: String(fullDepartment) })
      expect(fullPublished.status).toBe(200)
      expect(fullPublished.body.updated).toBe(31)
      expect(fullPublished.body.violations.length).toBeGreaterThan(0)
      expect(fullPublished.body.violations.every((item) => item.employee === idOf(fullTime))).toBe(true)
      expect(await ShiftSchedule.countDocuments({ employee: fullTime._id, state: 'pending_confirmation' })).toBe(31)

      const published = await post('/api/schedules/publish', { month: '2026-07', department: String(partDepartment) })
      expect(published.status).toBe(200)
      expect(published.body.updated).toBe(31)
      expect(published.body).not.toHaveProperty('violations')

      await ShiftSchedule.updateMany({ employee: partTime._id }, { $set: { employeeResponse: 'confirmed' } })
      const finalized = await post('/api/schedules/publish/finalize', { month: '2026-07', department: String(partDepartment) })
      expect(finalized.status).toBe(200)
      expect(finalized.body.finalized).toBe(31)
    })

    it('follows the current flag at once: switching 兼職 off in 員工管理 applies the rules again, switching it on lifts them', async () => {
      const department = newDepartment()
      const nurse = await addEmployee(department, { partTime: true })
      await importWorkbook(await workbookFor('2026-07', [{ employee: nurse, codes: violatingCodes() }]), department, '2026-07', 'commit')
      expect((await validate(department, '2026-07')).body).toMatchObject({ ok: true, count: 0 })

      const off = await put(`/api/employees/${nurse._id}`, { isPartTime: false })
      expect(off.status).toBe(200)
      expect((await Employee.findById(nurse._id).lean()).partTime).toBe(false)
      const strict = await validate(department, '2026-07')
      expect(strict.body.ok).toBe(false)
      expect(strict.body.violations.every((item) => item.employee === idOf(nurse))).toBe(true)
      expect(strict.body.count).toBeGreaterThan(0)

      const on = await put(`/api/employees/${nurse._id}`, { isPartTime: true })
      expect(on.status).toBe(200)
      expect((await validate(department, '2026-07')).body).toMatchObject({ ok: true, count: 0 })
    })

    it('hands the part-time flag to the schedule roster', async () => {
      const department = newDepartment()
      const partTime = await addEmployee(department, { partTime: true })
      const fullTime = await addEmployee(department, { partTime: false })

      const roster = await get(`/api/employees/schedule?department=${department}&month=2026-07&page=1&pageSize=50`)

      expect(roster.status).toBe(200)
      const flags = Object.fromEntries(roster.body.employees.map((employee) => [employee._id, employee.partTime]))
      expect(flags).toEqual({ [idOf(partTime)]: true, [idOf(fullTime)]: false })
    })
  })
})
