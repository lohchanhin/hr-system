// 薪資的端到端測試：真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// 情境：2026 年 10 月（10/1 是星期四；10/10 國慶日），月薪、日薪、時薪人員，日班、小夜、跨日的大夜，
// 請假（事假、病假、特休、跨月）、加班（平日、休息日、國定假日、月底跨日）、核准的獎金申請、遲到早退、
// 月中到職、月中離職、去年離職、沒有班表、沒有薪資設定、借支超過薪水。
// 驗證同一位員工同一個月在薪資總覽、單獨計算、存檔的薪資記錄、三種匯款 Excel、月薪資總覽 PDF 的資料是同樣的數字。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27812 npm test -- tests/payrollEndToEnd.integration.test.js
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
    throw new Error('Payroll integration tests only run against a loopback MongoDB host')
  }
  uri.pathname = `/hr_payroll_e2e_${process.pid}_${Date.now()}`
  return uri.toString()
}

const MONTH = '2026-10-01'
const utc = (key) => new Date(`${key}T00:00:00.000Z`)
const tp = (key, hm) => new Date(`${key}T${hm}:00+08:00`) // 台灣時間
const nextDay = (key) => new Date(utc(key).getTime() + 86400000).toISOString().slice(0, 10)

describeIntegration('薪資計算與匯出 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let app
  let models
  let pdfService
  const people = {}
  const secret = 'integration-test-secret-integration-test-secret'

  const tokenFor = (person) => jwt.sign(
    { id: String(person._id), sub: String(person._id), role: person.role, ver: Number(person.authVersion ?? 0) },
    secret,
    { issuer: 'hr-system', audience: 'hr-system-api', expiresIn: '1h' },
  )
  const asAdmin = () => ({ Authorization: `Bearer ${tokenFor(people.admin)}` })
  const binary = (res, callback) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => callback(null, Buffer.concat(chunks)))
  }
  const overview = async () => {
    const res = await request(app).get(`/api/payroll/overview/monthly?month=${MONTH}&pageSize=100`).set(asAdmin())
    expect(res.status).toBe(200)
    return Object.fromEntries(res.body.items.map((row) => [row.name, row]))
  }
  const exportRows = async (format) => {
    const res = await request(app).post(`/api/payroll/export?month=${MONTH}&format=${format}`).set(asAdmin()).buffer(true).parse(binary)
    expect(res.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(res.body)
    const rows = []
    workbook.worksheets[0].eachRow((row) => rows.push(row.values.slice(1)))
    return rows
  }
  const money = (row) => ({
    baseSalary: row.baseSalary, laborInsuranceFee: row.laborInsuranceFee, healthInsuranceFee: row.healthInsuranceFee,
    laborPensionSelf: row.laborPensionSelf, employeeAdvance: row.employeeAdvance, debtGarnishment: row.debtGarnishment,
    otherDeductions: row.otherDeductions, netPay: row.netPay, overtimePay: row.overtimePay,
    nightShiftAllowance: row.nightShiftAllowance, performanceBonus: row.performanceBonus, otherBonuses: row.otherBonuses,
    recurringAllowance: row.recurringAllowance, totalBonus: row.totalBonus, totalPayment: row.totalPayment,
  })

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
      Organization: (await import('../src/models/Organization.js')).default,
      ShiftSchedule: (await import('../src/models/ShiftSchedule.js')).default,
      AttendanceSetting: (await import('../src/models/AttendanceSetting.js')).default,
      AttendanceRecord: (await import('../src/models/AttendanceRecord.js')).default,
      FormTemplate: (await import('../src/models/form_template.js')).default,
      FormField: (await import('../src/models/form_field.js')).default,
      ApprovalRequest: (await import('../src/models/approval_request.js')).default,
      Holiday: (await import('../src/models/Holiday.js')).default,
      PayrollRecord: (await import('../src/models/PayrollRecord.js')).default,
      LaborInsuranceRate: (await import('../src/models/LaborInsuranceRate.js')).default,
    }
    pdfService = await import('../src/services/payrollPdfExportService.js')
    const { initializeLaborInsuranceRates } = await import('../src/services/laborInsuranceService.js')
    const { DEFAULT_APPROVAL_TEMPLATES } = await import('../src/services/defaultApprovalTemplates.js')
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    await mongoose.connect(process.env.MONGODB_URI)
    await Promise.all(Object.values(models).map((model) => model.syncIndexes()))
    await initializeLaborInsuranceRates()

    const setting = await models.AttendanceSetting.create({
      shifts: [
        { name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
        { name: '小夜', code: '小', semanticType: 'work', startTime: '16:00', endTime: '00:00', breakDuration: 30, crossDay: true },
        { name: '大夜', code: '大', semanticType: 'work', startTime: '22:00', endTime: '06:00', breakDuration: 60, crossDay: true, isNightShift: true, hasAllowance: true, fixedAllowanceAmount: 300 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
        { name: '國定假日', code: '國', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
      ],
      abnormalRules: { lateGrace: 5, earlyLeaveGrace: 5, lateDeductionEnabled: true, lateDeductionAmount: 100, earlyLeaveDeductionEnabled: true, earlyLeaveDeductionAmount: 50 },
    })
    const S = Object.fromEntries(setting.shifts.map((shift) => [shift.code, shift._id]))
    await models.Holiday.create([{ name: '國慶日', date: utc('2026-10-10'), kind: 'statutory', type: '國定假日' }])
    const org = await models.Organization.create({ name: '和泰護理之家' })
    const department = await models.Department.create({ name: '護理部', organization: org._id })

    const forms = {}
    for (const key of ['leave', 'overtime', 'bonus']) {
      const template = DEFAULT_APPROVAL_TEMPLATES.find((item) => item.key === key) || DEFAULT_APPROVAL_TEMPLATES.find((item) => item.name === '獎金申請')
      const form = await models.FormTemplate.create({ name: template.name, category: template.category, semanticType: template.semanticType, semantic_type_set: true, default_key: template.key })
      const fields = await models.FormField.create(template.fields.map((field) => ({ ...field, form: form._id })))
      forms[key] = { form, f: Object.fromEntries(fields.map((field) => [field.label, String(field._id)])) }
    }
    resetLeaveFieldCache()

    let serial = 0
    const make = (name, extra) => {
      serial += 1
      return models.Employee.create({
        name, email: `pay${serial}@example.test`, username: `pay${serial}`, employeeId: `P${String(serial).padStart(3, '0')}`,
        role: 'employee', organization: String(org._id), department: department._id, ...extra,
      })
    }
    // 管理者的機構是舊資料的代碼（不是 ObjectId），本身沒有薪資設定
    people.admin = await models.Employee.create({ name: '薪資管理者', email: 'payadmin@example.test', username: 'payadmin', role: 'admin', organization: 'org-1' })
    people.monthly = await make('王月薪', {
      salaryType: '月薪', salaryAmount: 48000, autoOvertimeCalc: true, laborPensionSelf: 1000, employeeAdvance: 500,
      salaryItems: ['組長加給'], salaryItemAmounts: { 組長加給: 2000 },
      monthlySalaryAdjustments: { healthInsuranceFee: 710, performanceBonus: 1000 },
      salaryAccountA: { bank: '050', acct: '11122233344' }, salaryAccountB: { bank: '053', acct: '99988877766' },
      appointment: { hireDate: utc('2020-01-01') },
    })
    people.daily = await make('林日薪', { salaryType: '日薪', salaryAmount: 2000, autoOvertimeCalc: true, salaryAccountA: { bank: '050', acct: '222' }, salaryAccountB: { bank: '053', acct: '333' } })
    people.hourly = await make('陳時薪', { salaryType: '時薪', salaryAmount: 200, partTime: true, autoOvertimeCalc: true, salaryAccountA: { bank: '050', acct: '444' }, salaryAccountB: { bank: '053', acct: '555' } })
    people.hire = await make('新進人員', { salaryType: '月薪', salaryAmount: 40000, appointment: { hireDate: utc('2026-10-16') } })
    people.leaver = await make('月中離職', { salaryType: '月薪', salaryAmount: 40000, status: '離職員工', appointment: { hireDate: utc('2022-01-01'), resignationDate: utc('2026-10-15') } })
    people.noSchedule = await make('無班表', { salaryType: '月薪', salaryAmount: 36000 })
    people.noSalary = await make('無薪資設定', {})
    people.negative = await make('借支過多', { salaryType: '月薪', salaryAmount: 30000, employeeAdvance: 50000 })
    people.gone = await make('去年離職', { salaryType: '月薪', salaryAmount: 45000, status: '離職員工', appointment: { hireDate: utc('2019-01-01'), resignationDate: utc('2025-12-31') } })

    const schedules = []
    const punches = []
    const punch = (person, action, at) => punches.push({ employee: person._id, action, timestamp: at, source: 'import' })
    for (let day = 1; day <= 31; day += 1) {
      const key = `2026-10-${String(day).padStart(2, '0')}`
      const weekday = utc(key).getUTCDay()
      let code = weekday === 6 ? '休' : weekday === 0 ? '例' : '日'
      if (key === '2026-10-10') code = '國'
      for (const who of ['monthly', 'negative']) schedules.push({ employee: people[who]._id, date: utc(key), shiftId: S[code], state: 'finalized' })
      if (key >= '2026-10-16') schedules.push({ employee: people.hire._id, date: utc(key), shiftId: S[code], state: 'finalized' })
      if (key <= '2026-10-15') schedules.push({ employee: people.leaver._id, date: utc(key), shiftId: S[code], state: 'finalized' })
      if (code === '日') {
        punch(people.negative, 'clockIn', tp(key, '07:55')); punch(people.negative, 'clockOut', tp(key, '17:02'))
        // 王月薪：10/5 遲到 20 分、10/6 早退 30 分、10/7 沒打卡、10/12 上午事假、10/13 病假、10/14 特休、10/30 事假（跨月）
        if (!['2026-10-07', '2026-10-13', '2026-10-14', '2026-10-30'].includes(key)) {
          punch(people.monthly, 'clockIn', tp(key, key === '2026-10-05' ? '08:20' : key === '2026-10-12' ? '12:00' : '07:58'))
          punch(people.monthly, 'clockOut', tp(key, key === '2026-10-06' ? '16:30' : '17:03'))
        }
      }
      // 日薪：一三五小夜（16:00 到隔天 00:00），10/21、10/23 請假
      const dailyCode = [1, 3, 5].includes(weekday) ? '小' : weekday === 0 ? '例' : '休'
      schedules.push({ employee: people.daily._id, date: utc(key), shiftId: S[dailyCode], state: 'finalized' })
      if (dailyCode === '小' && !['2026-10-21', '2026-10-23'].includes(key)) {
        punch(people.daily, 'clockIn', tp(key, '16:00')); punch(people.daily, 'clockOut', tp(nextDay(key), '00:00'))
      }
      // 時薪：二四六大夜（22:00 到隔天 06:00），包含 10/31 跨到 11/1
      if ([2, 4, 6].includes(weekday)) {
        schedules.push({ employee: people.hourly._id, date: utc(key), shiftId: S['大'], state: 'finalized' })
        punch(people.hourly, 'clockIn', tp(key, '22:00')); punch(people.hourly, 'clockOut', tp(nextDay(key), '06:00'))
      }
    }
    // 9/30（三）的大夜下班打卡在 10/1 06:00：屬於 9 月的班，不算進 10 月
    schedules.push({ employee: people.hourly._id, date: utc('2026-09-30'), shiftId: S['大'], state: 'finalized' })
    punch(people.hourly, 'clockIn', tp('2026-09-30', '22:00')); punch(people.hourly, 'clockOut', tp('2026-10-01', '06:00'))
    await models.ShiftSchedule.insertMany(schedules)
    await models.AttendanceRecord.insertMany(punches)

    const workflow = new mongoose.Types.ObjectId()
    const approved = (form, person, formData, finishedAt, createdAt) => models.ApprovalRequest.collection.insertOne({
      form: form._id, workflow, form_data: formData, applicant_employee: person._id, status: 'approved', current_step_index: 0, steps: [],
      logs: [{ at: finishedAt, action: 'finish' }], createdAt: createdAt ?? finishedAt, updatedAt: finishedAt, __v: 0,
    })
    const L = forms.leave
    const O = forms.overtime
    const B = forms.bonus
    const leave = (person, type, start, end, hours) => approved(L.form, person, {
      [L.f['假別']]: type, [L.f['開始時間']]: start.toISOString(), [L.f['結束時間']]: end.toISOString(), [L.f['時數']]: hours,
    }, tp('2026-10-01', '10:00'))
    const overtime = (person, start, end, crossDay = false) => approved(O.form, person, {
      [O.f['開始時間']]: start.toISOString(), [O.f['結束時間']]: end.toISOString(), [O.f['是否跨日']]: crossDay,
    }, tp('2026-10-20', '10:00'))
    const bonus = (person, type, amount, finishedAt) => approved(B.form, person, { [B.f['獎金類型']]: type, [B.f['金額']]: amount }, finishedAt, new Date(finishedAt.getTime() - 3 * 86400000))

    await leave(people.monthly, '事假', tp('2026-10-12', '08:00'), tp('2026-10-12', '12:00'), 4)
    await leave(people.monthly, '病假', tp('2026-10-13', '08:00'), tp('2026-10-13', '17:00'), 8)
    await leave(people.monthly, '特休', tp('2026-10-14', '08:00'), tp('2026-10-14', '17:00'), 8)
    // 跨月事假：10/30（五）08:00 到 11/2（一）17:00，共 16 小時，10 月算一半
    await leave(people.monthly, '事假', tp('2026-10-30', '08:00'), tp('2026-11-02', '17:00'), 16)
    await overtime(people.monthly, tp('2026-10-08', '18:00'), tp('2026-10-08', '21:00')) // 平日 3 小時
    await overtime(people.monthly, tp('2026-10-17', '09:00'), tp('2026-10-17', '14:00')) // 休息日 5 小時
    await overtime(people.monthly, tp('2026-10-10', '08:00'), tp('2026-10-10', '16:00')) // 國定假日 8 小時
    await overtime(people.monthly, tp('2026-10-31', '23:00'), tp('2026-11-01', '02:00'), true) // 月底跨日：算 10/31
    await overtime(people.monthly, tp('2026-11-01', '00:30'), tp('2026-11-01', '02:30')) // 11 月的加班
    await bonus(people.monthly, '績效獎金', 3000, tp('2026-10-20', '10:00'))
    await bonus(people.monthly, '其他', 800, tp('2026-10-31', '23:50')) // 台灣 10/31 深夜核准：算 10 月
    await bonus(people.monthly, '績效獎金', 7777, tp('2026-11-01', '00:10')) // 台灣 11/1 核准：算 11 月
    await bonus(people.monthly, '夜班', 600, tp('2026-10-05', '10:00'))
    await leave(people.daily, '特休', tp('2026-10-21', '16:00'), tp('2026-10-22', '00:00'), 8)
    await leave(people.daily, '事假', tp('2026-10-23', '16:00'), tp('2026-10-24', '00:00'), 8)
    await overtime(people.daily, tp('2026-10-06', '08:00'), tp('2026-10-06', '10:00'))
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

  const EXPECTED_MONTHLY = {
    // 48000 - 無薪 16 小時（事假 4 + 病假 8 的一半 + 跨月事假在 10 月的 8）× 200
    baseSalary: 44800,
    laborInsuranceFee: 1145,
    healthInsuranceFee: 710,
    laborPensionSelf: 1000,
    employeeAdvance: 500,
    debtGarnishment: 0,
    otherDeductions: 150, // 遲到 100 + 早退 50
    netPay: 41295,
    // 平日 3h：867、休息日 5h：1533、國定假日 8h：1600、10/31（休息日）跨日 3h：867
    overtimePay: 4867,
    nightShiftAllowance: 600, // 沒有夜班，核准的夜班獎金 600
    performanceBonus: 4000, // 設定 1000 + 核准 3000（11/1 核准的 7777 不算）
    otherBonuses: 800,
    recurringAllowance: 2000,
    totalBonus: 12267,
    totalPayment: 53562,
  }

  it('薪資總覽：月薪人員的每一項金額（請假、加班、遲到早退、獎金、勞保、借支）與加總', async () => {
    const rows = await overview()

    expect(money(rows['王月薪'])).toEqual(EXPECTED_MONTHLY)
    expect(rows['王月薪']).toMatchObject({ workDays: 18, leaveHours: 28, unpaidLeaveHours: 16, leaveDeduction: 3200, overtimeHours: 19, insuranceLevel: 28, lateEarlyDeduction: 150 })
  })

  it('日薪、時薪：按出勤與有薪假給薪；月底跨日的大夜班算在班表那一天的月份', async () => {
    const rows = await overview()

    // 日薪 2000：出勤 11 天 + 特休 1 天（事假那天沒有薪水，也不再另外扣），加班 2 小時 × 250 × 4/3
    expect(rows['林日薪']).toMatchObject({ workDays: 11, baseSalary: 24000, leaveDeduction: 0, overtimePay: 667, laborInsuranceFee: 600, netPay: 23400, totalPayment: 24067 })
    // 時薪 200：10 月有 14 個大夜班（含 10/31 跨到 11/1 的那一班；9/30 的班不算），每班 7 小時
    expect(rows['陳時薪']).toMatchObject({ workDays: 14, actualWorkHours: 98, baseSalary: 19600, nightShiftDays: 14, nightShiftAllowance: 4200, laborInsuranceFee: 500, netPay: 19100, totalPayment: 23300 })
  })

  it('月中到職、月中離職按在職日數比例；去年離職的人沒有薪水；沒有班表的月薪人員照領月薪', async () => {
    const rows = await overview()

    // 10/16 到職：16 天 / 30；10/15 離職：15 天 / 30
    expect(rows['新進人員']).toMatchObject({ baseSalary: 21333 })
    expect(rows['新進人員'].employment).toMatchObject({ employed: true, employedDays: 16, reason: 'partial_month' })
    expect(rows['月中離職']).toMatchObject({ baseSalary: 20000 })
    expect(rows['去年離職']).toMatchObject({ baseSalary: 0, netPay: 0, laborInsuranceFee: 0, totalPayment: 0 })
    expect(rows['去年離職'].employment).toMatchObject({ employed: false, reason: 'after_resignation' })
    expect(rows['無班表']).toMatchObject({ baseSalary: 36000, laborInsuranceFee: 908, netPay: 35092 })
  })

  it('沒有薪資設定、借支超過薪水：不會出現 NaN 或負數，沒扣到的金額另外列出', async () => {
    const rows = await overview()

    expect(money(rows['無薪資設定'])).toEqual(Object.fromEntries(Object.keys(EXPECTED_MONTHLY).map((key) => [key, 0])))
    expect(rows['借支過多']).toMatchObject({ baseSalary: 30000, employeeAdvance: 50000, netPay: 0, deductionShortfall: 20758, totalPayment: 0 })
    Object.values(rows).forEach((row) => {
      Object.entries(money(row)).forEach(([key, value]) => {
        expect([row.name, key, Number.isInteger(value) && value >= 0]).toEqual([row.name, key, true])
      })
      expect(row.totalPayment).toBe(row.netPay + row.totalBonus)
    })
  })

  it('單獨計算（POST /calculate）與薪資總覽是同樣的數字（含核准的獎金申請）', async () => {
    const res = await request(app).post('/api/payroll/calculate').set(asAdmin()).send({ employeeId: String(people.monthly._id), month: MONTH })

    expect(res.status).toBe(200)
    expect(money(res.body)).toEqual(EXPECTED_MONTHLY)
    expect(res.body.bankAccountA).toMatchObject({ accountNumber: '11122233344' })
  })

  it('月薪資總覽 PDF 的資料與薪資總覽相同，底薪 - 扣款 = 實領', async () => {
    const rows = await overview()
    const { rows: pdfRows } = await pdfService.buildMonthlyPayrollOverviewRows(MONTH, {})

    expect(pdfRows).toHaveLength(Object.keys(rows).length)
    pdfRows.forEach((pdfRow) => {
      const row = rows[pdfRow.name]
      expect([pdfRow.name, pdfRow.baseSalary, pdfRow.overtimePay, pdfRow.nightShiftAllowance, pdfRow.netPay, pdfRow.totalBonus, pdfRow.totalPayment])
        .toEqual([row.name, row.baseSalary, row.overtimePay, row.nightShiftAllowance, row.netPay, row.totalBonus, row.totalPayment])
      if (!row.deductionShortfall) expect(pdfRow.baseSalary - pdfRow.deductions).toBe(pdfRow.netPay)
    })
    const pdf = await request(app).get(`/api/payroll/export/pdf?month=${MONTH}`).set(asAdmin()).buffer(true).parse(binary)
    expect(pdf.status).toBe(200)
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('三種匯款 Excel：名單、帳號、金額與薪資總覽一致；去年離職的人不在名單', async () => {
    const rows = await overview()
    const expectedNames = Object.keys(rows).filter((name) => name !== '去年離職').sort()

    const taichung = (await exportRows('taichung')).filter((row) => typeof row[0] === 'number')
    expect(taichung.map((row) => row[4]).sort()).toEqual(expectedNames)
    taichung.forEach((row) => {
      expect([row[4], row[9]]).toEqual([row[4], rows[row[4]].netPay.toLocaleString()])
    })
    expect(taichung.find((row) => row[4] === '王月薪')[6]).toBe('99988877766')

    const taiwan = (await exportRows('taiwan')).filter((row) => row[0] === '0002')
    expect(taiwan.map((row) => row[3]).sort()).toEqual(expectedNames)
    expect(taiwan.find((row) => row[3] === '王月薪')[2]).toBe('11122233344')
    expect(taiwan.find((row) => row[3] === '陳時薪')[2]).toBe('444')

    const slip = await exportRows('bonusSlip')
    const header = slip.find((row) => row[0] === '員工編號')
    const total = header.indexOf('獎金合計')
    slip.filter((row) => typeof row[total] === 'number' && rows[row[1]]).forEach((row) => {
      expect([row[1], row[total]]).toEqual([row[1], rows[row[1]].totalBonus])
    })
    expect(slip.find((row) => row[1] === '王月薪').slice(5, 12)).toEqual([4867, 600, 4000, 800, 2000, 0, 12267])
  })

  it('個人薪資表：小計 - 應扣項目 = 實領；機構欄存的不是 ID 的舊資料也匯得出來', async () => {
    const sheet = async (person) => {
      const res = await request(app).get(`/api/payroll/export/individual?employeeId=${person._id}&month=${MONTH}`).set(asAdmin()).buffer(true).parse(binary)
      expect(res.status).toBe(200)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(res.body)
      const rows = []
      workbook.worksheets[0].eachRow((row) => rows.push(row.values.slice(1)))
      return rows
    }

    const rows = await sheet(people.monthly)
    const byLabel = Object.fromEntries(rows.map((row) => [row[0], row]))
    expect(byLabel['本薪'][1]).toBe(48000)
    expect(byLabel['事假扣薪'][1]).toBe(-2400)
    expect(byLabel['病假扣薪'][1]).toBe(-800)
    expect(byLabel['小計'][1]).toBe(44800)
    expect(byLabel['小計'][5]).toBe(41295)
    expect(rows.find((row) => String(row[0]).startsWith('勞健保級距'))[0]).toBe('勞健保級距：職退健 45,800')
    expect(rows.find((row) => String(row[0]).startsWith('勞健保級距'))[3]).toBe('雇主勞退 6% 提繳：2,748')

    // 管理者的 organization 是 'org-1'（不是 ObjectId）：以前整張表會因為轉型錯誤回 400
    await sheet(people.admin)
  })

  it('一頁薪資總覽：班別設定、班表、打卡、勞保級距各只查一次，不是每位員工各查一次', async () => {
    const scheduleFind = jest.spyOn(models.ShiftSchedule, 'find')
    const recordFind = jest.spyOn(models.AttendanceRecord, 'find')
    const settingFindOne = jest.spyOn(models.AttendanceSetting, 'findOne')
    const rateFindOne = jest.spyOn(models.LaborInsuranceRate, 'findOne')

    await overview()

    expect(scheduleFind).toHaveBeenCalledTimes(1)
    expect(recordFind).toHaveBeenCalledTimes(1)
    expect(settingFindOne).toHaveBeenCalledTimes(1)
    expect(rateFindOne).not.toHaveBeenCalled()
  })

  it('計算並儲存兩次只有一筆薪資記錄，數字不會加倍；存檔後總覽、匯出仍然一致，名單也不會只剩有記錄的人', async () => {
    const before = await overview()
    const save = () => request(app).post('/api/payroll/calculate/save').set(asAdmin()).send({ employeeId: String(people.monthly._id), month: MONTH })

    const first = await save()
    const second = await save()

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(String(second.body._id)).toBe(String(first.body._id))
    expect(money(second.body)).toEqual(EXPECTED_MONTHLY)
    expect(await models.PayrollRecord.countDocuments({ employee: people.monthly._id })).toBe(1)
    const stored = await models.PayrollRecord.findOne({ employee: people.monthly._id }).lean()
    expect(stored.month.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(stored).toMatchObject({ insuredSalary: 45800, lateEarlyDeduction: 150, bankAccountA: { accountNumber: '11122233344' } })

    const after = await overview()
    expect(after['王月薪'].hasPayrollRecord).toBe(true)
    expect(money(after['王月薪'])).toEqual(EXPECTED_MONTHLY)
    Object.keys(before).forEach((name) => {
      expect([name, money(after[name])]).toEqual([name, money(before[name])])
    })

    const taichung = (await exportRows('taichung')).filter((row) => typeof row[0] === 'number')
    expect(taichung.map((row) => row[4]).sort()).toEqual(Object.keys(before).filter((name) => name !== '去年離職').sort())
    expect(taichung.find((row) => row[4] === '王月薪')[9]).toBe((41295).toLocaleString())
    const slip = await exportRows('bonusSlip')
    expect(slip.find((row) => row[1] === '王月薪').slice(5, 12)).toEqual([4867, 600, 4000, 800, 2000, 0, 12267])
  })

  it('存檔之後班表改了：薪資記錄的金額不變，只有夜班津貼照現在的班表（加上核准的夜班獎金）', async () => {
    const setting = await models.AttendanceSetting.findOne().lean()
    const night = setting.shifts.find((shift) => shift.code === '大')
    // 11/? 之後補排：把 10/19（一）改成大夜班
    await models.ShiftSchedule.updateOne({ employee: people.monthly._id, date: utc('2026-10-19') }, { $set: { shiftId: night._id } })

    const rows = await overview()

    expect(rows['王月薪']).toMatchObject({
      hasPayrollRecord: true, baseSalary: 44800, netPay: 41295, overtimePay: 4867, performanceBonus: 4000,
      nightShiftDays: 1, nightShiftAllowance: 300 + 600,
    })
    expect(rows['王月薪'].totalBonus).toBe(12267 + 300)
    const slip = await exportRows('bonusSlip')
    expect(slip.find((row) => row[1] === '王月薪')[6]).toBe(900)
  })

  it('月份不是每月第一天、員工編號不合法：回 400，不會存下查不到的薪資記錄', async () => {
    const count = await models.PayrollRecord.countDocuments()
    const midMonth = await request(app).post('/api/payroll/calculate/save').set(asAdmin()).send({ employeeId: String(people.daily._id), month: '2026-10-15' })
    const badList = await request(app).get('/api/payroll?month=abc').set(asAdmin())
    const badEmployee = await request(app).get(`/api/payroll/export/individual?employeeId=not-an-id&month=${MONTH}`).set(asAdmin())

    expect(midMonth.status).toBe(400)
    expect(badList.status).toBe(400)
    expect(badEmployee.status).toBe(400)
    expect(await models.PayrollRecord.countDocuments()).toBe(count)
  })
})
