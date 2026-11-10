// 流程試算要和實際送出得到同樣的關卡：真的 Express app + 真的 MongoDB（單機 standalone）。
// 沒有「假別」欄位的請假表單（客戶自建，只有日期與時數）：實際送出時讀不到假別就整個不看請假長度，
// 有條件的關卡（請假滿 24 小時才需要人資）一律要簽；流程試算卻照輸入的長度判斷，8 小時的假顯示不需要人資。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27815 npm test -- tests/approvalTrialSamePath.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('approval_trial_path')

kit.describe('流程試算與實際送出 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const forms = {}
  const steps = [
    { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
    { step_order: 2, approver_type: 'tag', approver_value: '人資', all_must_approve: false, condition: { kind: 'leave_hours_gte', value: 24 } },
  ]
  const trial = (form, query) => kit.get('admin', `/api/approvals/forms/${form.form._id}/workflow/trial`).query({ employee: kit.id('nurse'), ...query })
  const file = (form, data) => kit.post('nurse', '/api/approvals', {
    form_id: String(form.form._id),
    form_data: Object.fromEntries(Object.entries(data).map(([label, value]) => [form.fieldOf(label), value])),
  })
  const approverCounts = (body) => body.steps.map(step => step.approvers.length)

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('boss', { role: 'supervisor' })
    await kit.addPerson('hr', { signTags: ['人資'] })
    await kit.addPerson('nurse', { supervisor: kit.people.boss._id })
    forms.noType = await kit.makeForm('休假申請單', 'leave', steps, [
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number' },
      { label: '說明', type_1: 'text' },
    ])
    forms.typed = await kit.makeForm('請假', 'leave', steps, [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number' },
    ])
    forms.noLength = await kit.makeForm('外出申請', 'leave', steps, [{ label: '說明', type_1: 'text' }])
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    resetLeaveFieldCache()
  })

  afterAll(kit.stop)

  it('a leave form without a 假別 field gets the same steps when filed as the trial shows', async () => {
    // 8 小時：不到 24 小時，不需要人資
    const shortTrial = await trial(forms.noType, { start: '2099-03-02', end: '2099-03-02', hours: 8 })
    expect(shortTrial.status).toBe(200)
    expect(shortTrial.body.steps).toHaveLength(1)
    const shortFiled = await file(forms.noType, { 開始日期: '2099-03-02', 結束日期: '2099-03-02', 時數: 8 })
    expect(shortFiled.status).toBe(201)
    // 以前實際送出是兩關（讀不到假別就不看請假長度，有條件的關卡一律要簽）
    expect(approverCounts(shortFiled.body)).toEqual(approverCounts(shortTrial.body))
    expect(shortFiled.body.logs.map(log => log.message).join('\n')).toContain('不適用')

    // 24 小時：兩邊都要人資
    const longTrial = await trial(forms.noType, { start: '2099-03-09', end: '2099-03-11', hours: 24 })
    const longFiled = await file(forms.noType, { 開始日期: '2099-03-09', 結束日期: '2099-03-11', 時數: 24 })
    expect(longFiled.status).toBe(201)
    expect(longTrial.body.steps).toHaveLength(2)
    expect(approverCounts(longFiled.body)).toEqual([1, 1])

    // 沒有填時數：兩邊都依日期推算（三天 24 小時）
    const datesTrial = await trial(forms.noType, { start: '2099-03-16', end: '2099-03-18' })
    const datesFiled = await file(forms.noType, { 開始日期: '2099-03-16', 結束日期: '2099-03-18' })
    expect(datesFiled.status).toBe(201)
    expect(datesTrial.body.leave.hours).toBe(24)
    expect(approverCounts(datesFiled.body)).toEqual(approverCounts(datesTrial.body))
    expect(datesFiled.body.steps).toHaveLength(2)
  })

  it('a leave form with a 假別 field is unchanged', async () => {
    const shortTrial = await trial(forms.typed, { start: '2099-04-01', end: '2099-04-01', hours: 8 })
    const shortFiled = await file(forms.typed, { 假別: '病假', 開始日期: '2099-04-01', 結束日期: '2099-04-01', 時數: 8 })
    expect(shortFiled.status).toBe(201)
    expect(approverCounts(shortFiled.body)).toEqual(approverCounts(shortTrial.body))
    expect(shortFiled.body.steps).toHaveLength(1)
  })

  it('a leave form with no dates or hours at all keeps every conditional step (nothing to measure)', async () => {
    const filed = await file(forms.noLength, { 說明: '外出洽公' })
    expect(filed.status).toBe(201)
    expect(filed.body.steps).toHaveLength(2)
  })
})
