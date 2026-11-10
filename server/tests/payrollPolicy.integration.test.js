// 薪資政策（月中到職／離職的比例、加班費倍率、新進員工自動計算加班費）的整合測試：
// 真的 Express app（src/index.js）+ 真的 JWT + 真的 MongoDB（單機 standalone）。
// 也驗證薪資總覽的 summary、舊薪資記錄的工時來源、匯款 Excel 的範圍篩選、整批設定自動計算加班費。
// 預設略過；要執行時指定一個本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27817 npm test -- tests/payrollPolicy.integration.test.js
import { jest } from '@jest/globals'
import ExcelJS from 'exceljs'
import mongoose from 'mongoose'
import request from 'supertest'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('payroll_policy')
const MONTH = '2026-10-01'
const utc = (key) => new Date(`${key}T00:00:00.000Z`)
const tp = (key, hm) => new Date(`${key}T${hm}:00+08:00`)

kit.describe('薪資政策 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  let PayrollRecord
  let PayrollPolicy
  let departments
  const binary = (res, callback) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => callback(null, Buffer.concat(chunks)))
  }
  const overview = async (query = '') => {
    const res = await kit.get('admin', `/api/payroll/overview/monthly?month=${MONTH}&pageSize=100${query}`)
    expect(res.status).toBe(200)
    return { rows: Object.fromEntries(res.body.items.map((row) => [row.name, row])), body: res.body }
  }
  const putPolicy = (body) => kit.put('admin', '/api/payroll/policy', body)

  beforeAll(async () => {
    await kit.start()
    PayrollRecord = (await import('../src/models/PayrollRecord.js')).default
    PayrollPolicy = (await import('../src/models/PayrollPolicy.js')).default
    const Organization = (await import('../src/models/Organization.js')).default
    const Department = (await import('../src/models/Department.js')).default
    const { DEFAULT_APPROVAL_TEMPLATES } = await import('../src/services/defaultApprovalTemplates.js')
    await Promise.all([PayrollRecord.syncIndexes(), PayrollPolicy.syncIndexes()])

    const setting = await kit.models.AttendanceSetting.create({
      shifts: [
        { name: '日班', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
        { name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
      ],
    })
    const S = Object.fromEntries(setting.shifts.map((shift) => [shift.code, shift._id]))
    const org = await Organization.create({ name: '政策測試機構' })
    departments = {
      nursing: await Department.create({ name: '護理部', organization: org._id }),
      office: await Department.create({ name: '行政部', organization: org._id }),
    }
    const template = DEFAULT_APPROVAL_TEMPLATES.find((item) => item.key === 'overtime')
    const overtimeForm = await kit.models.FormTemplate.create({ name: template.name, category: template.category, semanticType: template.semanticType, semantic_type_set: true, default_key: template.key })
    const overtimeFields = await kit.models.FormField.create(template.fields.map((field) => ({ ...field, form: overtimeForm._id })))
    const f = Object.fromEntries(overtimeFields.map((field) => [field.label, String(field._id)]))

    await kit.addPerson('admin', { role: 'admin', department: departments.office._id })
    await kit.addPerson('staff', { role: 'employee', department: departments.office._id })
    const monthly = (key, extra) => kit.addPerson(key, { salaryType: '月薪', salaryAmount: 40000, department: departments.nursing._id, organization: String(org._id), ...extra })
    await monthly('hire', { appointment: { hireDate: utc('2026-10-16') } })
    await monthly('leaver', { status: '離職員工', appointment: { hireDate: utc('2020-01-01'), resignationDate: utc('2026-10-15') } })
    await monthly('future', { appointment: { hireDate: utc('2026-11-03') } })
    await monthly('overtimer', { salaryAmount: 48000, autoOvertimeCalc: true })
    await monthly('legacy', { salaryAmount: 33000 })
    await monthly('gone', { status: '離職員工', autoOvertimeCalc: false, appointment: { hireDate: utc('2019-01-01'), resignationDate: utc('2025-12-31') } })

    const schedules = []
    const punches = []
    for (let day = 1; day <= 31; day += 1) {
      const key = `2026-10-${String(day).padStart(2, '0')}`
      const weekday = utc(key).getUTCDay()
      const code = weekday === 6 ? '休' : weekday === 0 ? '例' : '日'
      for (const who of ['overtimer', 'legacy']) {
        schedules.push({ employee: kit.people[who]._id, date: utc(key), shiftId: S[code], state: 'finalized' })
        if (code === '日') {
          punches.push({ employee: kit.people[who]._id, action: 'clockIn', timestamp: tp(key, '07:55'), source: 'import' })
          punches.push({ employee: kit.people[who]._id, action: 'clockOut', timestamp: tp(key, '17:02'), source: 'import' })
        }
      }
    }
    await kit.models.ShiftSchedule.insertMany(schedules)
    await kit.models.AttendanceRecord.insertMany(punches)
    // 10/8（星期四）平日加班 4 小時：預設倍率 2×200×4/3 + 2×200×5/3 = 1200
    const finishedAt = tp('2026-10-20', '10:00')
    await kit.models.ApprovalRequest.collection.insertOne({
      form: overtimeForm._id, workflow: new mongoose.Types.ObjectId(), applicant_employee: kit.people.overtimer._id,
      status: 'approved', current_step_index: 0, steps: [], logs: [{ at: finishedAt, action: 'finish' }],
      form_data: { [f['開始時間']]: tp('2026-10-08', '18:00').toISOString(), [f['結束時間']]: tp('2026-10-08', '22:00').toISOString(), [f['是否跨日']]: false },
      createdAt: finishedAt, updatedAt: finishedAt, __v: 0,
    })
    // 舊式的薪資記錄（種子資料、手動建立）：只有金額，工時欄位都是 0
    await PayrollRecord.create({ employee: kit.people.legacy._id, month: utc(MONTH), baseSalary: 33000, netPay: 32000, overtimePay: 111, totalBonus: 111, totalPayment: 32111 })
  })
  afterAll(kit.stop)

  it('沒有存過設定：GET 回傳預設值（就是以前寫死的做法）與在職員工的開關人數；只有管理員能讀寫', async () => {
    const res = await kit.get('admin', '/api/payroll/policy')
    expect(res.status).toBe(200)
    expect(res.body.proration).toEqual({ method: 'days30' })
    expect(res.body.overtime).toEqual({
      rates: {
        weekdayFirst2: 4 / 3, weekdayAfter2: 5 / 3, restDayFirst2: 4 / 3, restDayHours3To8: 5 / 3, restDayHours9To12: 8 / 3,
        holidayWithin8: 1, holidayAfter8First2: 4 / 3, holidayAfter10: 5 / 3,
      },
      newEmployeeAutoCalc: true,
    })
    expect(res.body.defaults).toEqual({ proration: res.body.proration, overtime: res.body.overtime })
    expect(res.body.customized).toEqual({ prorationMethod: false, overtimeRates: [], newEmployeeAutoCalc: false })
    expect(res.body.options.prorationMethods.map((option) => option.value)).toEqual(['days30', 'calendarDays', 'none'])
    expect(res.body.options.overtimeRates).toHaveLength(8)
    // 在職（不是離職員工）：admin、staff、hire、future、overtimer、legacy；開啟的只有 overtimer
    expect(res.body.stats).toEqual({ activeEmployees: 6, autoOvertimeCalcOn: 1, autoOvertimeCalcOff: 5 })
    expect(await PayrollPolicy.countDocuments()).toBe(0)

    expect((await kit.get('staff', '/api/payroll/policy')).status).toBe(403)
    expect((await kit.put('staff', '/api/payroll/policy', { proration: { method: 'none' } })).status).toBe(403)
  })

  it('PUT 驗證：不認得的欄位、倍率超出範圍或位數、不認得的算法都回中文 400，不寫入', async () => {
    for (const body of [
      {}, { foo: 1 }, { proration: { method: 'weekly' } }, { proration: 'none' },
      { overtime: { rates: { weekdayFirst2: 0.5 } } }, { overtime: { rates: { weekdayFirst2: 5.5 } } },
      { overtime: { rates: { weekdayFirst2: 1.234 } } }, { overtime: { rates: { weekday: 2 } } },
      { overtime: { rates: { weekdayFirst2: 'abc' } } }, { overtime: { newEmployeeAutoCalc: 'yes' } },
    ]) {
      const res = await putPolicy(body)
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/[一-鿿]/)
    }
    expect(await PayrollPolicy.countDocuments()).toBe(0)
  })

  it('三種比例算法：月中到職、月中離職的本薪依設定計算；整月不在職一律沒有本薪；改回預設就恢復', async () => {
    const { rows: before } = await overview()
    expect(before.hire.baseSalary).toBe(Math.round(40000 * 16 / 30))
    expect(before.leaver.baseSalary).toBe(20000)
    expect(before.hire.employment).toMatchObject({ method: 'days30', basisDays: 30, employedDays: 16, reason: 'partial_month' })

    const calendar = await putPolicy({ proration: { method: 'calendarDays' } })
    expect(calendar.status).toBe(200)
    expect(calendar.body.proration.method).toBe('calendarDays')
    expect(calendar.body.customized.prorationMethod).toBe(true)
    let { rows } = await overview()
    expect(rows.hire.baseSalary).toBe(Math.round(40000 * 16 / 31))
    expect(rows.leaver.baseSalary).toBe(Math.round(40000 * 15 / 31))
    expect(rows.hire.employment).toMatchObject({ method: 'calendarDays', basisDays: 31 })
    const calc = await kit.post('admin', '/api/payroll/calculate', { employeeId: kit.id('leaver'), month: MONTH })
    expect(calc.body).toMatchObject({ baseSalary: Math.round(40000 * 15 / 31), appliedPolicy: { prorationMethod: 'calendarDays' } })

    await putPolicy({ proration: { method: 'none' } })
    ;({ rows } = await overview())
    expect(rows.hire.baseSalary).toBe(40000)
    expect(rows.leaver.baseSalary).toBe(40000)
    expect(rows.future.baseSalary).toBe(0)
    expect(rows.future.employment).toMatchObject({ employed: false, reason: 'before_hire', method: 'none' })
    expect(rows.gone.baseSalary).toBe(0)
    const detail = await kit.get('admin', `/api/payroll/complete-data/${kit.id('hire')}/${MONTH}`)
    expect(detail.body).toMatchObject({ baseSalary: 40000, employment: { method: 'none', basisDays: null, ratio: 1 } })

    const reset = await putPolicy({ proration: { method: 'days30' } })
    expect(reset.body.customized.prorationMethod).toBe(false)
    ;({ rows } = await overview())
    expect(rows.hire.baseSalary).toBe(before.hire.baseSalary)
    expect(rows.leaver.baseSalary).toBe(before.leaver.baseSalary)
  })

  it('加班費倍率：改倍率加班費照新倍率算（總覽、明細、獎金紙條一致），送回預設值就恢復；已存的薪資記錄不變', async () => {
    const { rows: before } = await overview()
    expect(before.overtimer.overtimePay).toBe(1200)
    const changed = await putPolicy({ overtime: { rates: { weekdayFirst2: 2, weekdayAfter2: '2.5' } } })
    expect(changed.status).toBe(200)
    expect(changed.body.overtime.rates).toMatchObject({ weekdayFirst2: 2, weekdayAfter2: 2.5, restDayFirst2: 4 / 3 })
    expect(changed.body.customized.overtimeRates).toEqual(['weekdayFirst2', 'weekdayAfter2'])

    const { rows } = await overview()
    expect(rows.overtimer.overtimePay).toBe(2 * 200 * 2 + 2 * 200 * 2.5)
    expect(rows.overtimer.totalPayment - before.overtimer.totalPayment).toBe(1800 - 1200)
    expect(rows.legacy).toMatchObject({ overtimePay: 111, netPay: 32000, totalPayment: 32111, hasPayrollRecord: true })
    const detail = await kit.get('admin', `/api/payroll/complete-data/${kit.id('overtimer')}/${MONTH}`)
    expect(detail.body.overtimePay).toBe(1800)
    expect(detail.body.overtimeRates).toMatchObject({ weekdayFirst2: 2, weekdayAfter2: 2.5 })
    expect(detail.body.overtimeRecords[0].rateSegments.map((segment) => [segment.rateKey, segment.multiplier])).toEqual([['weekdayFirst2', 2], ['weekdayAfter2', 2.5]])
    const slip = await kit.post('admin', `/api/payroll/export?month=${MONTH}&format=bonusSlip`).buffer(true).parse(binary)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(slip.body)
    let slipOvertime = null
    workbook.worksheets[0].eachRow((row) => { if (row.values[2] === 'overtimer') slipOvertime = row.values[6] })
    expect(slipOvertime).toBe(1800)

    const defaults = (await kit.get('admin', '/api/payroll/policy')).body.defaults
    const restored = await putPolicy({ overtime: { rates: defaults.overtime.rates } })
    expect(restored.body.customized.overtimeRates).toEqual([])
    expect((await overview()).rows.overtimer.overtimePay).toBe(1200)
    // 送 null 也是回到預設；分數字串 4/3 等於預設
    await putPolicy({ overtime: { rates: { weekdayFirst2: 3 } } })
    const viaNull = await putPolicy({ overtime: { rates: { weekdayFirst2: null, weekdayAfter2: '5/3' } } })
    expect(viaNull.body.customized.overtimeRates).toEqual([])
    const stored = await PayrollPolicy.findOne().lean()
    expect(stored.overtime?.rates ?? {}).toEqual({})
  })

  it('新增員工：沒送自動計算加班費就用設定的預設值，有送就照送的值；需要排班也能寫入；不合格的值回 400', async () => {
    const create = (suffix, extra = {}) => kit.post('admin', '/api/employees', {
      name: `新人${suffix}`, email: `new${suffix}@example.test`, username: `new${suffix}`, employeeId: `NEW${suffix}`,
      password: 'integration-password-1', role: 'employee', ...extra,
    })
    const a = await create('a')
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ autoOvertimeCalc: true, requiresScheduling: true })
    const b = await create('b', { autoOvertimeCalc: false, requiresScheduling: false })
    expect(b.body).toMatchObject({ autoOvertimeCalc: false, requiresScheduling: false })
    expect((await putPolicy({ overtime: { newEmployeeAutoCalc: false } })).body.customized.newEmployeeAutoCalc).toBe(true)
    expect((await create('c')).body.autoOvertimeCalc).toBe(false)
    expect((await create('d', { autoOvertimeCalc: true })).body.autoOvertimeCalc).toBe(true)
    const bad = await create('e', { autoOvertimeCalc: 'maybe' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/自動計算加班費/)
    await putPolicy({ overtime: { newEmployeeAutoCalc: null } })

    const edited = await kit.put('admin', `/api/employees/${a.body._id}`, { autoOvertimeCalc: false, requiresScheduling: false })
    expect(edited.body).toMatchObject({ autoOvertimeCalc: false, requiresScheduling: false })
    expect((await kit.put('admin', `/api/employees/${a.body._id}`, { requiresScheduling: 'sometimes' })).status).toBe(400)
    await kit.put('admin', `/api/employees/${a.body._id}`, { name: '新人a改名' })
    const reread = await kit.get('admin', `/api/employees/${a.body._id}`)
    expect(reread.body).toMatchObject({ autoOvertimeCalc: false, requiresScheduling: false })
    const listed = await kit.get('admin', '/api/employees?pageSize=100')
    const items = listed.body.items ?? listed.body.employees ?? listed.body.data ?? listed.body
    expect(items.find((item) => String(item._id) === String(a.body._id))).toMatchObject({ autoOvertimeCalc: false, requiresScheduling: false })
    await kit.models.Employee.deleteMany({ username: { $in: ['newa', 'newb', 'newc', 'newd'] } })
  })

  it('整批設定：dryRun 只回人數不寫入；沒指定員工時是所有不是離職員工的人；指定員工時只改那些人', async () => {
    const dry = await kit.post('admin', '/api/employees/auto-overtime-calc', { enabled: true, dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body).toEqual({ enabled: true, dryRun: true, scope: 'active', matched: 6, willChange: 5 })
    expect((await kit.get('admin', '/api/payroll/policy')).body.stats.autoOvertimeCalcOn).toBe(1)

    const selected = await kit.post('admin', '/api/employees/auto-overtime-calc', { enabled: true, employeeIds: [kit.id('gone'), kit.id('legacy'), '0123456789abcdef01234567'] })
    expect(selected.body).toMatchObject({ scope: 'selected', matched: 2, willChange: 2, changed: 2, notFound: 1 })
    expect((await kit.models.Employee.findById(kit.people.gone._id).lean()).autoOvertimeCalc).toBe(true)

    const all = await kit.post('admin', '/api/employees/auto-overtime-calc', { enabled: false })
    expect(all.body).toMatchObject({ scope: 'active', matched: 6, willChange: 2, changed: 2, stats: { activeEmployees: 6, autoOvertimeCalcOn: 0, autoOvertimeCalcOff: 6 } })
    // 離職員工不在「所有在職員工」裡：剛才指定開啟的離職員工維持開啟
    expect((await kit.models.Employee.findById(kit.people.gone._id).lean()).autoOvertimeCalc).toBe(true)

    for (const body of [{ enabled: 'true' }, { enabled: true, employeeIds: [] }, { enabled: true, employeeIds: ['abc'] }, { enabled: true, dryRun: 1 }, { enabled: true, everyone: true }]) {
      expect((await kit.post('admin', '/api/employees/auto-overtime-calc', body)).status).toBe(400)
    }
    expect((await kit.post('staff', '/api/employees/auto-overtime-calc', { enabled: true, dryRun: true })).status).toBe(403)
    await kit.post('admin', '/api/employees/auto-overtime-calc', { enabled: true, employeeIds: [kit.id('overtimer')] })
    await kit.models.Employee.updateOne({ _id: kit.people.gone._id }, { $set: { autoOvertimeCalc: false } })
  })

  it('薪資總覽：舊薪資記錄的工時用出勤資料，summary 是整個篩選結果的合計（summary=true 時跨頁也算）', async () => {
    const { rows, body } = await overview()
    expect(rows.legacy).toMatchObject({ hasPayrollRecord: true, hoursSource: 'attendance', workDays: 22, netPay: 32000 })
    expect(rows.legacy.actualWorkHours).toBeGreaterThan(0)
    expect(rows.overtimer).toMatchObject({ hasPayrollRecord: false, hoursSource: 'calculated', overtimeHours: 4 })
    // 一頁就是全部：summary 一定有
    const items = Object.values(rows)
    expect(body.summary.headCount).toBe(items.length)
    expect(body.summary.totals.netPay).toBe(items.reduce((sum, row) => sum + Math.round(row.netPay), 0))
    expect(body.summary.totals.totalPayment).toBe(items.reduce((sum, row) => sum + Math.round(row.totalPayment), 0))
    expect(body.summary.withPayrollRecord).toBe(1)

    const paged = await kit.get('admin', `/api/payroll/overview/monthly?month=${MONTH}&pageSize=2&page=2&summary=true`)
    expect(paged.status).toBe(200)
    expect(paged.body.items).toHaveLength(2)
    expect(paged.body.summary).toEqual(body.summary)
    const plain = await kit.get('admin', `/api/payroll/overview/monthly?month=${MONTH}&pageSize=2&page=2`)
    expect(plain.body.summary).toBeNull()
    expect(plain.body.items.map((row) => [row.name, row.totalPayment])).toEqual(paged.body.items.map((row) => [row.name, row.totalPayment]))
  })

  it('銀行匯款 Excel 接受與薪資總覽相同的部門篩選，不認得的條件回 400', async () => {
    const countRows = async (query) => {
      const res = await kit.post('admin', `/api/payroll/export?month=${MONTH}&format=taichung${query}`).buffer(true).parse(binary)
      if (res.status !== 200) return { status: res.status }
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(res.body)
      const names = []
      workbook.worksheets[0].eachRow((row) => { if (typeof row.values[1] === 'number' && typeof row.values[5] === 'string') names.push(row.values[5]) })
      return { status: 200, names }
    }
    const all = await countRows('')
    const nursing = await countRows(`&department=${departments.nursing._id}`)
    expect(all.names).toEqual(expect.arrayContaining(['admin', 'staff', 'overtimer']))
    expect(nursing.names.sort()).toEqual(['hire', 'leaver', 'legacy', 'overtimer'])
    expect((await countRows('&dept=x')).status).toBe(400)
    expect((await countRows('&department=not-an-id')).status).toBe(400)
    expect((await countRows(`&department=${new mongoose.Types.ObjectId()}`)).status).toBe(400)
  })

  it('啟動紀錄：只讀筆數，沒存過設定時是預設值', async () => {
    const { describePayrollPolicyForStartup } = await import('../src/services/payrollPolicyService.js')
    await PayrollPolicy.deleteMany({})
    await kit.models.Employee.updateOne({ _id: kit.people.staff._id }, { $unset: { autoOvertimeCalc: '' } })
    const summary = await describePayrollPolicyForStartup()
    expect(summary).toMatchObject({ saved: false, prorationMethod: 'days30', customizedRates: [], newEmployeeAutoCalc: true, activeEmployees: 6, autoOvertimeCalcOn: 1, autoOvertimeCalcOff: 5 })
  })
})
