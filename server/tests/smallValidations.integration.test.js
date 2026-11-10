// 幾個小的輸入檢查（2026-11 複查，在真的伺服器重現過）：真的 Express app + 真的 MongoDB。
// V1 GET /api/schedules/can-finalize?month=zzz 回 500。
// V2 GET /api/payroll?employee=zzz 不認得 employee 參數，回整份薪資記錄（200）。
// V3 GET /api/schedules 不帶條件時把整個資料表的班表回給管理員。
// V4 POST /api/employees/set-supervisors 沒有檢查 employee：沒帶（或帶查詢條件物件）時改到資料庫裡第一位員工的主管。
// V5 加班費計算把員工所有已核准的單都讀出來。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27815 npm test -- tests/smallValidations.integration.test.js
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('small_validations')
const utc = (key) => new Date(`${key}T00:00:00.000Z`)

kit.describe('小的輸入檢查 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const { models } = kit
  let PayrollRecord
  let shiftId

  beforeAll(async () => {
    await kit.start()
    PayrollRecord = (await import('../src/models/PayrollRecord.js')).default
    const setting = await models.AttendanceSetting.create({
      shifts: [{ name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 }],
    })
    shiftId = setting.shifts[0]._id
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('boss', { role: 'supervisor' })
    await kit.addPerson('amy', { supervisor: kit.people.boss._id })
    await kit.addPerson('ben', { supervisor: kit.people.boss._id })
  })

  afterAll(kit.stop)

  it('V1：can-finalize 的月份格式不對回 400', async () => {
    const bad = await kit.get('admin', '/api/schedules/can-finalize?month=zzz')
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/Invalid month format/)
    expect((await kit.get('admin', '/api/schedules/can-finalize?month=2026-13')).status).toBe(400)
    expect((await kit.get('admin', '/api/schedules/can-finalize?month=2026-10')).status).toBe(200)
  })

  it('V2：薪資記錄清單的員工條件（employeeId 或 employee）格式不對回 400，對了就只列那位員工的', async () => {
    await PayrollRecord.create([
      { employee: kit.people.amy._id, month: utc('2026-10-01'), baseSalary: 30000, netPay: 30000 },
      { employee: kit.people.ben._id, month: utc('2026-10-01'), baseSalary: 32000, netPay: 32000 },
    ])
    // 以前不認得 employee 參數：回 200 與所有人的薪資記錄
    expect((await kit.get('admin', '/api/payroll?employee=zzz')).status).toBe(400)
    expect((await kit.get('admin', '/api/payroll?employeeId=zzz')).status).toBe(400)
    expect((await kit.get('admin', '/api/payroll?employee[$ne]=x')).status).toBe(400)
    const mine = await kit.get('admin', `/api/payroll?employee=${kit.id('amy')}`)
    expect(mine.status).toBe(200)
    expect(mine.body.map(row => row.baseSalary)).toEqual([30000])
    expect((await kit.get('admin', `/api/payroll?employeeId=${kit.id('ben')}`)).body.map(row => row.baseSalary)).toEqual([32000])
    expect((await kit.get('admin', '/api/payroll')).body).toHaveLength(2)
  })

  it('V3：班表清單可以指定月份或日期範圍；管理員不帶條件時只回最近三個月，不是整個資料表', async () => {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
    const thisMonth = now.toISOString().slice(0, 7)
    await models.ShiftSchedule.create([
      { employee: kit.people.amy._id, date: utc('2020-01-06'), shiftId },
      { employee: kit.people.amy._id, date: utc('2026-10-05'), shiftId },
      { employee: kit.people.amy._id, date: utc('2026-10-06'), shiftId },
      { employee: kit.people.ben._id, date: utc(`${thisMonth}-01`), shiftId },
    ])
    const dates = (res) => res.body.map(row => row.date).sort()

    const everything = await kit.get('admin', '/api/schedules')
    expect(everything.status).toBe(200)
    // 以前四筆都回（整個資料表）；2020 年與 2026/10 的不在最近三個月內（除非現在就是那幾個月）
    expect(dates(everything)).toContain(`${thisMonth.replace('-', '/')}/01`)
    expect(dates(everything)).not.toContain('2020/01/06')

    expect(dates(await kit.get('admin', '/api/schedules?month=2026-10'))).toEqual(['2026/10/05', '2026/10/06'])
    expect(dates(await kit.get('admin', '/api/schedules?start=2026-10-06&end=2026-10-31'))).toEqual(['2026/10/06'])
    expect(dates(await kit.get('admin', '/api/schedules?start=2020-01-01&end=2020-01-31'))).toEqual(['2020/01/06'])
    expect((await kit.get('admin', '/api/schedules?month=zzz')).status).toBe(400)
    expect((await kit.get('admin', '/api/schedules?start=2026-10-31&end=2026-10-01')).status).toBe(400)
    expect((await kit.get('admin', '/api/schedules?start=2020-01-01&end=2026-10-01')).status).toBe(400)
    // 員工看自己的班表：不帶條件照舊是自己的全部
    expect(dates(await kit.get('amy', '/api/schedules'))).toEqual(['2020/01/06', '2026/10/05', '2026/10/06'])
    expect(dates(await kit.get('amy', '/api/schedules?month=2026-10'))).toEqual(['2026/10/05', '2026/10/06'])
  })

  it('V4：批次設定主管時每一筆的員工都要是存在的員工，否則整批不做', async () => {
    const supervisorOf = async (key) => String((await models.Employee.findById(kit.id(key)).lean()).supervisor ?? '')
    const set = (assignments) => kit.post('admin', '/api/employees/set-supervisors', { assignments })
    const boss = kit.id('boss')

    // 以前這三種都回 success，而且把資料庫裡第一位（或條件符合的第一位）員工的主管清掉
    for (const employee of [undefined, { $ne: null }, '', 'zzz', String(new mongoose.Types.ObjectId())]) {
      const res = await set([{ employee: kit.id('amy'), supervisor: '' }, { employee, supervisor: '' }])
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/員工/)
    }
    // 前面那一筆有效的也沒有被套用
    expect(await supervisorOf('amy')).toBe(boss)
    expect(await supervisorOf('ben')).toBe(boss)
    for (const key of ['admin', 'boss']) expect(await supervisorOf(key)).toBe('')

    expect((await set([{ employee: kit.id('amy'), supervisor: '' }])).status).toBe(200)
    expect(await supervisorOf('amy')).toBe('')
    expect((await set([{ employee: kit.id('amy'), supervisor: boss }])).status).toBe(200)
    expect(await supervisorOf('amy')).toBe(boss)
  })

  it('V5：加班費只讀薪資月份前一年以內送出的單，很久以前的單不再每次都讀出來，金額不變', async () => {
    const overtime = await kit.makeForm('加班申請', 'overtime', [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }], [
      { label: '開始時間', type_1: 'datetime', required: true },
      { label: '結束時間', type_1: 'datetime', required: true },
    ])
    const other = await kit.makeForm('物品請購', 'general', [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }], [{ label: '品項', type_1: 'text' }])
    await models.Employee.updateOne({ _id: kit.people.ben._id }, { $set: { salaryType: '月薪', salaryAmount: 48000, autoOvertimeCalc: true } })
    const approved = (form, formData, createdAt) => models.ApprovalRequest.collection.insertOne({
      form: form.form._id, workflow: form.workflow._id, form_data: formData, applicant_employee: kit.people.ben._id,
      status: 'approved', current_step_index: 0, steps: [], logs: [], createdAt, updatedAt: createdAt, __v: 0,
    })
    const ot = (start, end) => ({ [overtime.fieldOf('開始時間')]: start, [overtime.fieldOf('結束時間')]: end })
    // 2026/10/08 平日加班 2 小時：一張 10 月送出、一張隔月才補送；另外是三年前的加班與一張不是加班的單
    await approved(overtime, ot('2026-10-08T10:00:00.000Z', '2026-10-08T12:00:00.000Z'), new Date('2026-10-07T02:00:00.000Z'))
    await approved(overtime, ot('2026-10-15T10:00:00.000Z', '2026-10-15T12:00:00.000Z'), new Date('2026-11-03T02:00:00.000Z'))
    await approved(overtime, ot('2023-10-08T10:00:00.000Z', '2023-10-08T12:00:00.000Z'), new Date('2023-10-07T02:00:00.000Z'))
    await approved(other, { [other.fieldOf('品項')]: '手套' }, new Date('2026-10-07T02:00:00.000Z'))

    const { calculateOvertimePay } = await import('../src/services/workHoursCalculationService.js')
    const find = jest.spyOn(models.ApprovalRequest, 'find')
    const result = await calculateOvertimePay(kit.id('ben'), '2026-10-01')
    const filter = find.mock.calls[0][0]
    find.mockRestore()

    expect(result.overtimeRecords.map(record => [record.date, record.hours]).sort()).toEqual([['2026-10-08', 2], ['2026-10-15', 2]])
    expect(result.overtimeHours).toBe(4)
    // 以前四張都讀（這位員工所有已核准的單）；現在三年前的那一張不讀
    expect(await models.ApprovalRequest.countDocuments(filter)).toBe(3)

    // 整批計算（薪資總覽、匯出）另外只讀加班表單的單：不是加班的那一張也不讀
    const { loadPayrollBatchData, createCalculationContext } = await import('../src/services/payrollBatchService.js')
    const employee = await models.Employee.findById(kit.id('ben')).lean()
    const context = createCalculationContext(await loadPayrollBatchData([employee], '2026-10-01'), employee, { employees: [employee] })
    const batchFind = jest.spyOn(models.ApprovalRequest, 'find')
    const batched = await calculateOvertimePay(kit.id('ben'), '2026-10-01', context)
    const batchFilter = batchFind.mock.calls[0][0]
    batchFind.mockRestore()
    expect(batched.overtimeHours).toBe(4)
    expect(batched.overtimePay).toBe(result.overtimePay)
    expect(await models.ApprovalRequest.countDocuments(batchFilter)).toBe(2)

    // 沒有送簽時間的舊單照樣讀得到
    await models.ApprovalRequest.collection.insertOne({
      form: overtime.form._id, workflow: overtime.workflow._id, applicant_employee: kit.people.ben._id, status: 'approved',
      form_data: ot('2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'), current_step_index: 0, steps: [], logs: [], __v: 0,
    })
    expect((await calculateOvertimePay(kit.id('ben'), '2026-10-01')).overtimeHours).toBe(5)
  })
})
