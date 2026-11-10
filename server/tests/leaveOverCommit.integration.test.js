// 有額度的假別不能「超額預約」：送出時要把其他簽核中的時數算進去，核准時扣不到特休就不核准。
// 真的 Express app + 真的 MongoDB（單機 standalone）。預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27815 npm test -- tests/leaveOverCommit.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('leave_over_commit')

kit.describe('有額度的假別：簽核中的時數與核准時的扣減 against a real MongoDB through the real app', () => {
  jest.setTimeout(180000)
  const { models } = kit
  let leave
  const leaveData = ({ start, end, hours, type = '特休' }) => ({
    [leave.fieldOf('假別')]: type,
    [leave.fieldOf('開始日期')]: start,
    [leave.fieldOf('結束日期')]: end,
    [leave.fieldOf('時數')]: hours,
    [leave.fieldOf('事由')]: '家中有事',
  })
  const fileLeave = (key, data) => kit.post(key, '/api/approvals', { form_id: String(leave.form._id), form_data: leaveData(data) })
  const act = (key, id, decision, extra = {}) => kit.post(key, `/api/approvals/${id}/act`, { decision, ...extra })
  const load = (id) => models.ApprovalRequest.findById(id).lean()
  const annualOf = async (key) => (await models.Employee.findById(kit.id(key)).lean()).annualLeave
  const setAnnual = (key, totalHours, usedHours) => models.Employee.updateOne(
    { _id: kit.people[key]._id },
    { $set: { 'annualLeave.totalHours': totalHours, ...(usedHours === undefined ? {} : { 'annualLeave.usedHours': usedHours }) } },
  )
  const balanceItem = async (key, itemKey, year = 2099) => {
    const res = await kit.get(key, `/api/approvals/leave-balances?year=${year}`)
    expect(res.status).toBe(200)
    return res.body.items.find(item => item.key === itemKey)
  }

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('boss', { role: 'supervisor' })
    for (const key of ['amy', 'ben', 'cat', 'dan', 'eve', 'fay']) {
      await kit.addPerson(key, { supervisor: kit.people.boss._id, annualLeave: { totalHours: 16, usedHours: 0 } })
    }
    await kit.addPerson('gus', { supervisor: kit.people.boss._id })
    leave = await kit.makeForm('請假', 'leave', [
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
    ], [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number' },
      { label: '事由', type_1: 'text' },
    ])
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    resetLeaveFieldCache()
  })

  afterAll(kit.stop)

  it('refuses a second 特休 request when the first, still pending, already takes the whole balance', async () => {
    const first = await fileLeave('amy', { start: '2099-03-02', end: '2099-03-03', hours: 16 })
    expect(first.status).toBe(201)
    // 以前只和「剩餘時數」比：兩張 16 小時都送得出去、也都核准（第二張只回警告），員工就有 32 小時已核准的特休
    const second = await fileLeave('amy', { start: '2099-03-09', end: '2099-03-10', hours: 16 })
    expect(second.status).toBe(400)
    expect(second.body).toMatchObject({
      code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 16, pendingHours: 16, availableHours: 0, requestedHours: 16,
    })
    expect(second.body.error).toContain('簽核中')
    expect(await models.ApprovalRequest.countDocuments({ applicant_employee: kit.id('amy') })).toBe(1)
    expect(await balanceItem('amy', 'annual')).toMatchObject({ remainingHours: 16, pendingHours: 16, availableHours: 0 })

    expect((await act('boss', first.body._id, 'approve')).status).toBe(200)
    expect(await annualOf('amy')).toMatchObject({ usedHours: 16 })
    expect((await fileLeave('amy', { start: '2099-03-16', end: '2099-03-16', hours: 0.5 })).status).toBe(400)
  })

  it('counts pending 特休 of another year too (the balance is one counter, not a yearly quota)', async () => {
    expect((await fileLeave('ben', { start: '2100-01-04', end: '2100-01-04', hours: 8 })).status).toBe(201)
    expect((await fileLeave('ben', { start: '2099-05-04', end: '2099-05-04', hours: 8 })).status).toBe(201)
    const third = await fileLeave('ben', { start: '2099-05-11', end: '2099-05-11', hours: 4 })
    expect(third.status).toBe(400)
    expect(third.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', pendingHours: 16, availableHours: 0 })
    expect(await balanceItem('ben', 'annual')).toMatchObject({ pendingHours: 16, availableHours: 0 })
  })

  it('checks the changed hours of a returned request against the other pending requests when it is sent again', async () => {
    const kept = await fileLeave('cat', { start: '2099-04-06', end: '2099-04-06', hours: 8 })
    const other = await fileLeave('cat', { start: '2099-04-13', end: '2099-04-13', hours: 8 })
    expect([kept.status, other.status]).toEqual([201, 201])
    expect((await act('boss', other.body._id, 'return', { comment: '請確認日期' })).status).toBe(200)

    const longer = await kit.post('cat', `/api/approvals/${other.body._id}/resubmit`, {
      form_data: leaveData({ start: '2099-04-13', end: '2099-04-14', hours: 16 }),
    })
    expect(longer.status).toBe(400)
    expect(longer.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 16, pendingHours: 8, availableHours: 8, requestedHours: 16 })
    expect((await load(other.body._id)).status).toBe('returned')

    // 時數不變就可以重新送出（不會把自己算成「其他簽核中」的時數）
    const same = await kit.post('cat', `/api/approvals/${other.body._id}/resubmit`, {
      form_data: leaveData({ start: '2099-04-13', end: '2099-04-13', hours: 8 }),
    })
    expect(same.status).toBe(200)
    expect(await balanceItem('cat', 'annual')).toMatchObject({ pendingHours: 16, availableHours: 0 })
  })

  it('refuses the approval (the request stays pending) when the balance can no longer cover the deduction', async () => {
    const first = await fileLeave('dan', { start: '2099-06-01', end: '2099-06-01', hours: 8 })
    const second = await fileLeave('dan', { start: '2099-06-08', end: '2099-06-08', hours: 8 })
    expect([first.status, second.status]).toEqual([201, 201])
    // 送出之後人資把年度特休調低
    await setAnnual('dan', 8)
    // 這種狀態（簽核中的時數超過剩餘）餘額要標示超額，不是「正常」
    expect(await balanceItem('dan', 'annual')).toMatchObject({ remainingHours: 8, pendingHours: 16, availableHours: -8, status: 'over' })

    expect((await act('boss', first.body._id, 'approve')).status).toBe(200)
    const refused = await act('boss', second.body._id, 'approve')
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 0, requestedHours: 8 })
    expect(refused.body.error).toContain('特休餘額不足')
    let doc = await load(second.body._id)
    expect(doc.status).toBe('pending')
    expect(doc.steps[0].approvers[0].decision).toBe('pending')
    expect(doc.annual_leave?.state).toBeUndefined()
    expect(await annualOf('dan')).toMatchObject({ usedHours: 8 })

    // 管理員代為核可也一樣
    expect((await act('admin', second.body._id, 'approve')).status).toBe(409)
    expect((await load(second.body._id)).status).toBe('pending')

    // 人資補上時數後就可以核准，而且只扣一次
    await setAnnual('dan', 16)
    const approved = await act('boss', second.body._id, 'approve')
    expect(approved.status).toBe(200)
    expect(approved.body.warnings).toBeUndefined()
    doc = await load(second.body._id)
    expect(doc.status).toBe('approved')
    expect(doc.annual_leave).toMatchObject({ state: 'deducted', hours: 8 })
    expect(doc.logs.filter(log => log.action === 'annual_leave')).toHaveLength(1)
    expect(await annualOf('dan')).toMatchObject({ usedHours: 16 })
  })

  it('approves only as many of several over-committed requests as the balance covers, even when they are approved at the same moment', async () => {
    // 舊資料：修正前就已經超額送出的兩張單（直接寫進資料庫）
    const first = await fileLeave('eve', { start: '2099-07-06', end: '2099-07-07', hours: 16 })
    expect(first.status).toBe(201)
    const original = await load(first.body._id)
    const { _id, createdAt, updatedAt, __v, ...copy } = original
    const twin = await models.ApprovalRequest.create({
      ...copy,
      form_data: { ...original.form_data, [leave.fieldOf('開始日期')]: '2099-07-13', [leave.fieldOf('結束日期')]: '2099-07-14' },
    })
    const both = await Promise.all([act('boss', first.body._id, 'approve'), act('boss', String(twin._id), 'approve')])
    expect(both.map(res => res.status).sort()).toEqual([200, 409])
    expect(await annualOf('eve')).toMatchObject({ usedHours: 16 })
    const docs = [await load(first.body._id), await load(twin._id)]
    expect(docs.map(doc => doc.status).sort()).toEqual(['approved', 'pending'])
  })

  it('gives the hours back when the approval that reserved them does not go through', async () => {
    const created = await fileLeave('fay', { start: '2099-08-03', end: '2099-08-03', hours: 8 })
    expect(created.status).toBe(201)
    // 核准與申請人撤回同時送出：不論誰先，結果只有「已核准且扣了 8 小時」或「已撤回且沒有扣」
    const pair = await Promise.all([act('boss', created.body._id, 'approve'), kit.post('fay', `/api/approvals/${created.body._id}/cancel`)])
    const doc = await load(created.body._id)
    const used = (await annualOf('fay')).usedHours
    if (doc.status === 'approved') expect(used).toBe(8)
    else {
      expect(doc.status).toBe('canceled')
      expect(used).toBe(0)
      expect(pair[0].status).toBe(409)
    }
  })

  it('still approves 特休 of an employee whose quota was never entered, with the warning for HR', async () => {
    const created = await fileLeave('gus', { start: '2099-09-07', end: '2099-09-07', hours: 8 })
    expect(created.status).toBe(201)
    const approved = await act('boss', created.body._id, 'approve')
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe('approved')
    expect(approved.body.warnings[0].code).toBe('ANNUAL_LEAVE_DEDUCTION_FAILED')
  })

  it('counts pending hours for the yearly quotas of 事假 and 病假 as well', async () => {
    // 事假每年 14 日（112 小時），預設超額處理是「警告」
    expect((await fileLeave('gus', { start: '2099-10-05', end: '2099-10-17', hours: 104, type: '事假' })).status).toBe(201)
    const over = await fileLeave('gus', { start: '2099-11-02', end: '2099-11-03', hours: 16, type: '事假' })
    expect(over.status).toBe(201)
    expect(over.body.warnings).toEqual([expect.objectContaining({ code: 'LEAVE_QUOTA_EXCEEDED', typeKey: 'personal', remainingHours: 8, requestedHours: 16 })])
    const within = await fileLeave('gus', { start: '2099-12-01', end: '2099-12-01', hours: 8, type: '病假' })
    expect(within.status).toBe(201)
    expect(within.body.warnings).toBeUndefined()
  })
})
