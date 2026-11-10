// PUT /api/attendance-settings 的遲到／早退扣款設定（abnormalRules.lateDeduction* / earlyLeaveDeduction*）：
// 薪資依「次數 × 每次金額」扣款，存進去的值要原樣保留並回傳；型別不對（字串、負數、小數）要回 400 中文訊息，
// 不能被 Mongoose 轉型後存成別的值，或丟 CastError 回 500 英文訊息。
// 需要 APPROVAL_ENGINE_TEST_MONGODB_URI（見 helpers/realAppKit.js）。
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

jest.setTimeout(60000)

const kit = createRealAppKit('attendance_setting_deduction')

kit.describe('PUT /api/attendance-settings 遲到／早退扣款', () => {
  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin' })
  })
  afterAll(kit.stop)

  const DEDUCTION = {
    lateDeductionEnabled: true,
    lateDeductionAmount: 150,
    earlyLeaveDeductionEnabled: true,
    earlyLeaveDeductionAmount: 0,
  }

  it('keeps and returns the four deduction fields, also after another section is saved', async () => {
    const saved = await kit.put('admin', '/api/attendance-settings', { abnormalRules: { lateGrace: 3, ...DEDUCTION } })
    expect(saved.status).toBe(200)
    expect(saved.body.abnormalRules).toMatchObject({ lateGrace: 3, ...DEDUCTION })

    // 只存別的區塊（或只改寬限分鐘）時扣款設定不變
    await kit.put('admin', '/api/attendance-settings', { overtimeRules: { holidayRate: 2 } })
    await kit.put('admin', '/api/attendance-settings', { abnormalRules: { lateGrace: 4 } })
    const read = await kit.get('admin', '/api/attendance-settings')
    expect(read.body.abnormalRules).toMatchObject({ lateGrace: 4, ...DEDUCTION })
    const stored = await kit.models.AttendanceSetting.findOne().lean()
    expect(stored.abnormalRules).toMatchObject({ lateGrace: 4, ...DEDUCTION })
  })

  it.each([
    ['lateDeductionEnabled', 'yes', '遲到扣款的「啟用」只能是 true 或 false'],
    ['earlyLeaveDeductionEnabled', 1, '早退扣款的「啟用」只能是 true 或 false'],
    ['lateDeductionAmount', -50, '遲到每次扣款金額必須是 0 到 100000 的整數'],
    ['lateDeductionAmount', '100', '遲到每次扣款金額必須是 0 到 100000 的整數'],
    ['earlyLeaveDeductionAmount', 12.5, '早退每次扣款金額必須是 0 到 100000 的整數'],
    ['earlyLeaveDeductionAmount', 'abc', '早退每次扣款金額必須是 0 到 100000 的整數'],
    ['lateDeductionAmount', 100001, '遲到每次扣款金額必須是 0 到 100000 的整數'],
  ])('rejects %s = %p with a Chinese 400 and stores nothing', async (field, value, message) => {
    const before = (await kit.models.AttendanceSetting.findOne().lean()).abnormalRules
    const res = await kit.put('admin', '/api/attendance-settings', { abnormalRules: { [field]: value } })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: message, code: 'INVALID_DEDUCTION_SETTING', field: `abnormalRules.${field}` })
    expect((await kit.models.AttendanceSetting.findOne().lean()).abnormalRules).toEqual(before)
  })

  it('labor rule checks answer in Chinese with a code', async () => {
    const res = await kit.put('admin', '/api/attendance-settings', { laborRules: { extendedOvertimeEnabled: true } })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '延長每月加班上限必須填寫核准文件編號', code: 'EXTENDED_OVERTIME_APPROVAL_REQUIRED' })
  })
})
