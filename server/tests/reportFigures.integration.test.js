// 部門報表的數字要和它統計的出勤、請假資料一致：真的 Express app + 真的 MongoDB。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27814 npm test -- tests/reportFigures.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('report_figures')

const DAY_MS = 24 * 60 * 60 * 1000
const taipeiKey = (ms) => new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
// 台灣時間 yyyy-mm-dd hh:mm 的時間點
const at = (dateKey, time) => new Date(`${dateKey}T${time}:00+08:00`)
const utcMidnight = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`)

kit.describe('部門報表 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const { models } = kit
  let deptId
  let otherDeptId
  let shiftId
  let leave
  const report = (key, type, query) => kit.get(key, `/api/reports/department/${type}/export`).query(query)

  async function approvedLeave(person, { start, end, hours, type = '事假' }) {
    return models.ApprovalRequest.create({
      form: leave.form._id,
      workflow: leave.workflow._id,
      applicant_employee: kit.people[person]._id,
      status: 'approved',
      form_data: {
        [leave.fieldOf('假別')]: type,
        [leave.fieldOf('開始時間')]: start,
        [leave.fieldOf('結束時間')]: end,
        ...(hours !== undefined ? { [leave.fieldOf('時數')]: hours } : {}),
      },
      steps: [],
    })
  }
  const schedule = (person, dateKey) => models.ShiftSchedule.create({
    employee: kit.people[person]._id, date: utcMidnight(dateKey), shiftId, department: deptId,
  })
  const punch = (person, action, dateKey, time) => models.AttendanceRecord.create({
    employee: kit.people[person]._id, action, timestamp: at(dateKey, time), source: 'online',
  })

  beforeAll(async () => {
    await kit.start()
    const org = await models.Organization.create({ name: '安康護理之家' })
    const dept = await models.Department.create({ name: '護理部', organization: org._id })
    const other = await models.Department.create({ name: '行政部', organization: org._id })
    deptId = String(dept._id)
    otherDeptId = String(other._id)
    const setting = await models.AttendanceSetting.create({
      shifts: [{ name: '日班', code: 'D', startTime: '08:00', endTime: '17:00', breakDuration: 60, crossDay: false }],
      abnormalRules: { lateGrace: 5, earlyLeaveGrace: 5 },
    })
    shiftId = setting.shifts[0]._id
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('head', { role: 'supervisor', department: dept._id, organization: String(org._id) })
    await kit.addPerson('nurse', { department: dept._id, organization: String(org._id), supervisor: kit.people.head._id })
    await kit.addPerson('aide', { department: dept._id, organization: String(org._id), supervisor: kit.people.head._id })
    await kit.addPerson('clerk', { department: other._id, organization: String(org._id) })
    await models.Department.updateOne({ _id: dept._id }, { deptManager: kit.id('head') })
    leave = await kit.makeForm('請假', 'leave', [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }], [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始時間', type_1: 'datetime', required: true },
      { label: '結束時間', type_1: 'datetime', required: true },
      { label: '時數', type_1: 'number' },
    ])
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    resetLeaveFieldCache()
    // 主管可以看的報表類型（正式環境在啟動時建立）
    const { ensureDefaultSupervisorReports } = await import('../src/services/supervisorReportSeed.js')
    await ensureDefaultSupervisorReports()
  })

  afterAll(kit.stop)

  it('does not report lateness or early leave for the part of a shift covered by approved leave (same as payroll)', async () => {
    // 10/05：核准請假 08:00–10:00，10:00 打卡上班 → 不是遲到 115 分鐘
    await schedule('nurse', '2026-10-05')
    await approvedLeave('nurse', { start: at('2026-10-05', '08:00'), end: at('2026-10-05', '10:00'), hours: 2 })
    await punch('nurse', 'clockIn', '2026-10-05', '10:00')
    await punch('nurse', 'clockOut', '2026-10-05', '17:00')
    // 10/07：核准請假 15:00–17:00，15:00 打卡下班 → 不是早退
    await schedule('nurse', '2026-10-07')
    await approvedLeave('nurse', { start: at('2026-10-07', '15:00'), end: at('2026-10-07', '17:00'), hours: 2 })
    await punch('nurse', 'clockIn', '2026-10-07', '07:55')
    await punch('nurse', 'clockOut', '2026-10-07', '15:00')
    // 10/08：請假到 10:00，卻 10:30 才到 → 從請假結束起算遲到 30 - 5 = 25 分鐘；10/09 沒請假，真的遲到 20 分鐘（扣掉寬限 15）
    await schedule('nurse', '2026-10-08')
    await approvedLeave('nurse', { start: at('2026-10-08', '08:00'), end: at('2026-10-08', '10:00'), hours: 2 })
    await punch('nurse', 'clockIn', '2026-10-08', '10:30')
    await punch('nurse', 'clockOut', '2026-10-08', '17:00')
    await schedule('nurse', '2026-10-09')
    await punch('nurse', 'clockIn', '2026-10-09', '08:20')
    await punch('nurse', 'clockOut', '2026-10-09', '16:30')

    const late = await report('admin', 'tardiness', { month: '2026-10', department: deptId })
    expect(late.status).toBe(200)
    expect(late.body.records.map(row => [row.date, row.minutesLate])).toEqual([['2026-10-08', 25], ['2026-10-09', 15]])
    expect(late.body.records[0].scheduledStart).toBe('10:00')
    expect(late.body.summary).toMatchObject({ totalLateCount: 2, totalLateMinutes: 40 })

    const early = await report('admin', 'early-leave', { month: '2026-10', department: deptId })
    expect(early.status).toBe(200)
    expect(early.body.records.map(row => [row.date, row.minutesEarly])).toEqual([['2026-10-09', 25]])

    // 薪資的遲到早退次數（扣款依據）是同一組數字
    const { calculateLateEarlyCount } = await import('../src/services/attendanceDeductionService.js')
    const payroll = await calculateLateEarlyCount(kit.id('nurse'), '2026-10')
    expect(payroll.lateCount).toBe(late.body.summary.totalLateCount)
    expect(payroll.earlyLeaveCount).toBe(early.body.summary.totalEarlyLeaveCount)
  })

  it('does not count approved leave days or shifts that have not started yet as 缺勤', async () => {
    // 10/06 整天請假（沒有打卡）、10/12 真的沒來
    await schedule('nurse', '2026-10-06')
    await approvedLeave('nurse', { start: '2026-10-06', end: '2026-10-06', type: '特休' })
    await schedule('nurse', '2026-10-12')
    const october = await report('admin', 'attendance', { month: '2026-10', department: deptId })
    expect(october.status).toBe(200)
    const nurse = october.body.records.find(row => row.name === 'nurse')
    // 10/05、07、08、09 有出勤；10/06 請假；10/12 缺勤
    expect(nurse).toMatchObject({ scheduled: 6, attended: 4, onLeave: 1, absent: 1 })
    expect(october.body.summary).toMatchObject({ scheduled: 6, attended: 4, onLeave: 1, absent: 1 })

    // 這個月還沒到的班：算應出勤，不算缺勤
    const tomorrow = taipeiKey(Date.now() + DAY_MS)
    const yesterday = taipeiKey(Date.now() - DAY_MS)
    await schedule('aide', tomorrow)
    const current = await report('admin', 'attendance', { month: tomorrow.slice(0, 7), department: deptId })
    const aide = current.body.records.find(row => row.name === 'aide')
    expect(aide.absent).toBe(0)
    expect(aide.scheduled).toBeGreaterThanOrEqual(1)
    // 昨天排了班沒有來：照常算缺勤
    await schedule('aide', yesterday)
    const past = await report('admin', 'attendance', { month: yesterday.slice(0, 7), department: deptId })
    expect(past.body.records.find(row => row.name === 'aide').absent).toBe(1)

    // 工時報表：還沒到的班不列成「實際 0 小時、差 -8 小時」
    const hours = await report('admin', 'work-hours', { month: tomorrow.slice(0, 7), department: deptId })
    expect(hours.body.records.some(row => row.name === 'aide' && row.date === tomorrow)).toBe(false)
  })

  it('adds leave days up from the hours so the total agrees with the hours', async () => {
    // 八張 1 小時的假 = 8 小時 = 1 天（以前每張先四捨五入成 0.13 天，合計 1.04 天）
    for (let day = 13; day <= 20; day += 1) {
      await approvedLeave('aide', { start: at(`2026-09-${day}`, '09:00'), end: at(`2026-09-${day}`, '10:00'), hours: 1, type: '病假' })
    }
    const res = await report('admin', 'leave', { month: '2026-09', department: deptId })
    expect(res.status).toBe(200)
    expect(res.body.summary.totalLeaves).toBe(8)
    expect(res.body.summary.totalHours).toBe(8)
    expect(res.body.summary.totalDays).toBe(1)
    expect(res.body.summary.byType).toEqual([expect.objectContaining({ leaveType: '病假', count: 8, hours: 8, days: 1 })])
  })

  it('answers 400 for a malformed department or month, and never widens a supervisor to other departments', async () => {
    for (const query of [
      { month: '2026-10', department: 'abc' },
      { month: '2026-10', 'department[$ne]': otherDeptId },
      { month: '2026-10', 'department[$gte]': '000000000000000000000000' },
      { month: '2026', department: deptId },
      { month: '2026-13', department: deptId },
      { month: '+275760-09', department: deptId },
    ]) {
      const res = await report('admin', 'attendance', query)
      expect([res.status, JSON.stringify(query)]).toEqual([400, JSON.stringify(query)])
      expect(JSON.stringify(res.body)).not.toMatch(/Cast to|ObjectId|Invalid time value/)
    }
    // 部門的排班管理者用運算子查詢：不能拿到別的部門的人
    const widened = await report('head', 'attendance', { month: '2026-10', 'department[$gte]': deptId })
    expect(widened.status).toBe(400)
    expect(JSON.stringify(widened.body)).not.toContain('clerk')
    const own = await report('head', 'attendance', { month: '2026-10', department: deptId })
    expect(own.status).toBe(200)
    expect((await report('head', 'attendance', { month: '2026-10', department: otherDeptId })).status).toBe(403)
  })

  it('exports a PDF whose Chinese text is readable (embedded CJK font), or says the font is missing', async () => {
    const { resolveTraditionalChinesePdfFont } = await import('../src/services/pdfFontService.js')
    const res = await report('admin', 'leave', { month: '2026-09', department: deptId, format: 'pdf' }).buffer(true).parse((response, done) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => done(null, Buffer.concat(chunks)))
    })
    if (!resolveTraditionalChinesePdfFont()) {
      // 伺服器沒有安裝中文字型：明確回報，不產生一份全是亂碼的 PDF
      expect(res.status).toBe(503)
      return
    }
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    const pdf = res.body.toString('latin1')
    expect(pdf.startsWith('%PDF')).toBe(true)
    // 內嵌的 CID 字型（中文字）；以前只有 Helvetica，標題、表頭、姓名全部是亂碼
    expect(pdf).toMatch(/\/Subtype\s*\/Type0/)
  })
})
