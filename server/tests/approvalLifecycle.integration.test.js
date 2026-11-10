// 簽核單的生命週期在「同時操作」下的行為：真的 Express app + 真的 MongoDB（單機 standalone，沒有交易）。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27814 npm test -- tests/approvalLifecycle.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('approval_lifecycle')

kit.describe('簽核單生命週期（同時操作）against a real MongoDB through the real app', () => {
  jest.setTimeout(180000)
  const { models } = kit
  let leave
  let general
  const leaveData = ({ start, end, hours, type = '事假' }) => ({
    [leave.fieldOf('假別')]: type,
    [leave.fieldOf('開始日期')]: start,
    [leave.fieldOf('結束日期')]: end,
    ...(hours !== undefined ? { [leave.fieldOf('時數')]: hours } : {}),
    [leave.fieldOf('事由')]: '家中有事',
  })
  const file = (key, made, data) => kit.post(key, '/api/approvals', { form_id: String(made.form._id), form_data: data })
  const fileLeave = (key, data) => file(key, leave, leaveData(data))
  const act = (key, id, decision, extra = {}) => kit.post(key, `/api/approvals/${id}/act`, { decision, ...extra })
  const cancel = (key, id) => kit.post(key, `/api/approvals/${id}/cancel`)
  const load = (id) => models.ApprovalRequest.findById(id).lean()
  const decisions = (doc) => doc.steps.map(step => step.approvers.map(item => item.decision).join('+'))
  const statuses = (responses) => responses.map(res => res.status).sort()
  const usedAnnualHours = async (key) => (await models.Employee.findById(kit.id(key)).lean()).annualLeave.usedHours

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('admin2', { role: 'admin' })
    await kit.addPerson('boss', { role: 'supervisor' })
    await kit.addPerson('hr1', { signTags: ['人資'] })
    await kit.addPerson('hr2', { signTags: ['人資'] })
    await kit.addPerson('nurse', { supervisor: kit.people.boss._id, annualLeave: { totalHours: 80, usedHours: 0 } })
    await kit.addPerson('aide', { supervisor: kit.people.boss._id })
    leave = await kit.makeForm('請假', 'leave', [
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資', all_must_approve: false },
    ], [
      { label: '假別', type_1: 'text', required: true },
      { label: '開始日期', type_1: 'date', required: true },
      { label: '結束日期', type_1: 'date', required: true },
      { label: '時數', type_1: 'number' },
      { label: '事由', type_1: 'text' },
    ])
    general = await kit.makeForm('物品請購', 'general', [
      { step_order: 1, approver_type: 'tag', approver_value: '人資', all_must_approve: true },
      { step_order: 2, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
    ], [{ label: '品項', type_1: 'text', required: true }])
    const { resetLeaveFieldCache } = await import('../src/services/leaveFieldService.js')
    resetLeaveFieldCache()
  })

  afterAll(kit.stop)

  it('files only one of two identical leave requests sent at the same moment (two tabs, a double click without the idempotency key)', async () => {
    const both = await Promise.all([
      fileLeave('aide', { start: '2027-07-05', end: '2027-07-05', hours: 8 }),
      fileLeave('aide', { start: '2027-07-05', end: '2027-07-05', hours: 8 }),
    ])
    // 以前兩筆都通過「與已申請的假單重疊」的檢查（彼此都還沒建立），同一天出現兩張簽核中的假單
    expect(statuses(both)).toEqual([201, 400])
    const refused = both.find(res => res.status === 400)
    expect(JSON.stringify(refused.body)).toContain('重疊')
    expect(await models.ApprovalRequest.countDocuments({ applicant_employee: kit.id('aide') })).toBe(1)

    // 部分重疊的兩張也一樣；不同人同一天互不影響
    const overlapping = await Promise.all([
      fileLeave('aide', { start: '2027-07-12', end: '2027-07-13', hours: 16 }),
      fileLeave('aide', { start: '2027-07-13', end: '2027-07-14', hours: 16 }),
      fileLeave('nurse', { start: '2027-07-13', end: '2027-07-13', hours: 8 }),
    ])
    expect(statuses(overlapping)).toEqual([201, 201, 400])
    expect(overlapping[2].status).toBe(201)
    // 不重疊的兩張同時送出都成功（第二張等第一張建立好再檢查，不會被擋下）
    const apart = await Promise.all([
      fileLeave('aide', { start: '2027-08-02', end: '2027-08-02', hours: 8 }),
      fileLeave('aide', { start: '2027-08-03', end: '2027-08-03', hours: 8 }),
    ])
    expect(statuses(apart)).toEqual([201, 201])
  })

  it('advances a step exactly once when its approvers act at the same moment', async () => {
    // 任一人同意的關卡：兩位人資同時核可，只有一位算數，另一位得到明確的 409
    const leaveReq = await fileLeave('nurse', { start: '2027-03-01', end: '2027-03-01', hours: 8 })
    expect(leaveReq.status).toBe(201)
    expect((await act('boss', leaveReq.body._id, 'approve')).status).toBe(200)
    const anyOne = await Promise.all([act('hr1', leaveReq.body._id, 'approve'), act('hr2', leaveReq.body._id, 'approve')])
    expect(statuses(anyOne)).toEqual([200, 409])
    let doc = await load(leaveReq.body._id)
    expect(doc.status).toBe('approved')
    expect(decisions(doc)[1].split('+').sort()).toEqual(['approved', 'skipped'])
    expect(doc.logs.filter(log => log.action === 'finish')).toHaveLength(1)

    // 需全員同意的關卡：兩位同時核可都成功，單據只前進一關
    const purchase = await file('nurse', general, { [general.fieldOf('品項')]: '手套' })
    const allMust = await Promise.all([act('hr1', purchase.body._id, 'approve'), act('hr2', purchase.body._id, 'approve')])
    expect(statuses(allMust)).toEqual([200, 200])
    doc = await load(purchase.body._id)
    expect(doc).toMatchObject({ status: 'pending', current_step_index: 1 })
    expect(decisions(doc)).toEqual(['approved+approved', 'pending'])
    expect(doc.logs.filter(log => log.action === 'move_next')).toHaveLength(1)

    // 兩位管理員同時代為核可最後一關：只結案一次
    const overrides = await Promise.all([act('admin', purchase.body._id, 'approve'), act('admin2', purchase.body._id, 'approve')])
    expect(statuses(overrides)).toEqual([200, 409])
    doc = await load(purchase.body._id)
    expect(doc.status).toBe('approved')
    expect(doc.logs.filter(log => log.action === 'finish')).toHaveLength(1)

    // 同一關一位核可、一位退簽同時送出：結果只有一種，單據不會同時前進又退回
    const mixed = await file('nurse', general, { [general.fieldOf('品項')]: '口罩' })
    const pair = await Promise.all([act('hr1', mixed.body._id, 'approve'), act('hr2', mixed.body._id, 'return', { comment: '請補規格' })])
    doc = await load(mixed.body._id)
    if (doc.status === 'returned') {
      expect(pair[1].status).toBe(200)
      expect(doc.current_step_index).toBe(0)
    } else {
      expect(doc).toMatchObject({ status: 'pending', current_step_index: 0 })
    }
    expect(doc.logs.filter(log => log.action === 'move_next')).toHaveLength(0)
  })

  it('deducts annual leave once however many approvals arrive, and refunds it once however many withdrawals arrive', async () => {
    const before = await usedAnnualHours('nurse')
    const created = await fileLeave('nurse', { start: '2027-04-05', end: '2027-04-05', hours: 8, type: '特休' })
    expect(created.status).toBe(201)
    const id = created.body._id
    await act('boss', id, 'approve')
    const finals = await Promise.all([act('hr1', id, 'approve'), act('hr2', id, 'approve'), act('admin', id, 'approve')])
    expect(statuses(finals)).toEqual([200, 409, 409])
    expect(await usedAnnualHours('nurse')).toBe(before + 8)

    const withdrawals = await Promise.all([cancel('nurse', id), cancel('nurse', id), cancel('admin', id)])
    expect(withdrawals.every(res => [200, 404, 409].includes(res.status))).toBe(true)
    expect((await load(id)).status).toBe('canceled')
    expect(await usedAnnualHours('nurse')).toBe(before)
    // 撤回之後再核可、再撤回都不會動到特休
    expect((await act('admin', id, 'approve')).status).toBe(409)
    await cancel('nurse', id)
    expect(await usedAnnualHours('nurse')).toBe(before)
  })

  it('lets an administrator finish a request whose approver left, and re-resolves approvers on resubmission', async () => {
    const created = await fileLeave('nurse', { start: '2027-05-03', end: '2027-05-03', hours: 8 })
    const id = created.body._id
    await models.Employee.updateOne({ _id: kit.id('boss') }, { status: '離職員工' })
    try {
      // 離職的主管不能再簽；管理員看得到可以代為處理
      expect((await act('boss', id, 'approve')).status).toBe(401)
      const detail = await kit.get('admin', `/api/approvals/${id}`)
      expect(detail.body.viewer).toMatchObject({ can_act: false, can_override: true })
      const returned = await act('admin', id, 'return', { comment: '主管已離職，請重新送出' })
      expect(returned.status).toBe(200)
      expect((await load(id)).status).toBe('returned')
      // 重新送出：離職的主管不再被派到，改送無上級主管時的簽核人（系統管理員）
      const resubmitted = await kit.post('nurse', `/api/approvals/${id}/resubmit`, {})
      expect(resubmitted.status).toBe(200)
      const doc = await load(id)
      expect(doc.status).toBe('pending')
      const firstStep = doc.steps[0].approvers.map(item => String(item.approver)).sort()
      expect(firstStep).toEqual([kit.id('admin'), kit.id('admin2')].sort())
      expect(firstStep).not.toContain(kit.id('boss'))
      // 撤回與核可同時送出：只會有一個結果
      const race = await Promise.all([cancel('nurse', id), act('admin', id, 'approve')])
      const after = await load(id)
      expect(['canceled', 'pending']).toContain(after.status)
      if (after.status === 'canceled') expect(race[0].status).toBe(200)
    } finally {
      await models.Employee.updateOne({ _id: kit.id('boss') }, { status: '正職員工' })
    }
  })
})
