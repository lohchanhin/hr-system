import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

// 員工簽核設定：標籤整理（K3）、角色／層級驗證、標籤詞彙表（K2）、編輯時密碼選填、
// 刪除前的簽核影響盤點。資料庫模型全部以替身取代，另有真實資料庫的檢查在手動驗證時進行。
const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  countDocuments: jest.fn(),
  distinct: jest.fn(),
  exists: jest.fn(),
}
const mockApprovalRequest = { find: jest.fn() }
const mockApprovalWorkflow = { find: jest.fn() }

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))

let app
let requestUser
let controller

beforeAll(async () => {
  const employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default
  controller = await import('../src/controllers/employeeController.js')
  app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = requestUser
    next()
  })
  app.use('/api/employees', employeeRoutes)
})

/** find().select().limit().lean() 這類鏈式查詢的替身 */
function queryChain(rows) {
  const query = {
    select: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(rows),
  }
  query.select.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  return query
}

beforeEach(() => {
  requestUser = { id: '507f1f77bcf86cd799439011', role: 'admin' }
  Object.values(mockEmployee).forEach((fn) => fn.mockReset())
  mockEmployee.countDocuments.mockResolvedValue(0)
  mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 0 })
  mockEmployee.updateOne.mockResolvedValue({ acknowledged: true })
  mockEmployee.distinct.mockResolvedValue([])
  mockEmployee.exists.mockResolvedValue({ _id: 'supervisor' })
  mockApprovalRequest.find.mockReset()
  mockApprovalRequest.find.mockReturnValue(queryChain([]))
  mockApprovalWorkflow.find.mockReset()
  mockApprovalWorkflow.find.mockReturnValue(queryChain([]))
})

describe('簽核標籤整理（K3）', () => {
  it('buildEmployeeDoc 與 buildEmployeePatch 會整理標籤：全形轉半形、去頭尾空白、去空、去重', () => {
    const tags = [' 人資', '人資 ', '', '人資', '排班負責人　', '財務　覆核', 'ＨＲ', null]
    expect(controller.buildEmployeeDoc({ signTags: tags }).signTags).toEqual([
      '人資',
      '排班負責人',
      '財務 覆核',
      'HR',
    ])
    expect(controller.buildEmployeePatch({ signTags: tags }).$set.signTags).toEqual([
      '人資',
      '排班負責人',
      '財務 覆核',
      'HR',
    ])
  })

  it('單一字串當作一個標籤，空字串清空標籤；沒帶 signTags 的更新不動它', () => {
    expect(controller.buildEmployeePatch({ signTags: ' 人資 ' }).$set.signTags).toEqual(['人資'])
    expect(controller.buildEmployeePatch({ signTags: '' }).$set.signTags).toEqual([])
    expect(controller.buildEmployeePatch({ name: 'x' }).$set).not.toHaveProperty('signTags')
    expect(controller.buildEmployeeDoc({}).signTags).toEqual([])
  })

  it('簽核角色與層級接受代碼或名稱，一律存成代碼', () => {
    expect(controller.resolveSignRole('R003')).toBe('R003')
    expect(controller.resolveSignRole('r003')).toBe('R003')
    expect(controller.resolveSignRole('覆核')).toBe('R002')
    expect(controller.resolveSignRole('財務覆核人員')).toBe('R006')
    expect(controller.resolveSignRole('')).toBe('')
    expect(controller.resolveSignRole(undefined)).toBeUndefined()
    expect(controller.resolveSignRole('banana')).toBeNull()
    expect(controller.resolveSignRole('R008')).toBeNull()
    expect(controller.resolveSignLevel('U003')).toBe('U003')
    expect(controller.resolveSignLevel('L3')).toBe('U003')
    expect(controller.resolveSignLevel('l5')).toBe('U005')
    expect(controller.resolveSignLevel('U999')).toBeNull()

    const doc = controller.buildEmployeeDoc({ signRole: '審核', signLevel: 'L2' })
    expect(doc.signRole).toBe('R003')
    expect(doc.signLevel).toBe('U002')
    // 不認得的值不會被寫進去（controller 會先擋下）
    expect(controller.buildEmployeePatch({ signRole: 'banana' }).$set).not.toHaveProperty('signRole')
  })
})

describe('PUT /api/employees/:id 簽核設定', () => {
  function stubExistingEmployee(overrides = {}) {
    const existing = { _id: '1', name: 'John', role: 'employee', status: '正職員工', accountEnabled: true, ...overrides }
    const updated = { ...existing, save: jest.fn().mockResolvedValue(undefined) }
    mockEmployee.findById.mockResolvedValueOnce(existing).mockResolvedValueOnce(updated)
    return { existing, updated }
  }

  it.each([
    ['簽核角色', { signRole: 'banana' }, /簽核角色「banana」不正確/],
    ['簽核角色代碼超出範圍', { signRole: 'R008' }, /簽核角色「R008」不正確/],
    ['簽核層級', { signLevel: 'U999' }, /簽核層級「U999」不正確/],
    ['標籤格式', { signTags: [{ name: '人資' }] }, /員工標籤格式不正確/],
    ['標籤過長', { signTags: ['長'.repeat(51)] }, /太長/],
  ])('拒絕不合法的%s並回中文錯誤，不會寫入', async (_label, body, pattern) => {
    stubExistingEmployee()
    const res = await request(app).put('/api/employees/1').send(body)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(pattern)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('標籤最多 50 個', async () => {
    stubExistingEmployee()
    const tags = Array.from({ length: 51 }, (_, i) => `標籤${i}`)
    const res = await request(app).put('/api/employees/1').send({ signTags: tags })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('員工標籤最多 50 個')
  })

  it('接受名稱並存成代碼，標籤整理後才寫入；只改標籤不會讓登入失效', async () => {
    stubExistingEmployee()
    const res = await request(app)
      .put('/api/employees/1')
      .send({ signRole: '覆核', signLevel: 'L3', signTags: [' 排班負責人 ', '人資', '人資', ''] })
    expect(res.status).toBe(200)
    expect(mockEmployee.updateOne).toHaveBeenCalledTimes(1)
    const [filter, update] = mockEmployee.updateOne.mock.calls[0]
    expect(filter).toEqual({ _id: '1' })
    expect(update.$set).toEqual({
      signRole: 'R002',
      signLevel: 'U003',
      signTags: ['排班負責人', '人資'],
    })
    // authVersion 只在角色／狀態／帳號啟用改變時才遞增
    expect(update).not.toHaveProperty('$inc')
  })

  it('空字串可以清空簽核角色與層級', async () => {
    stubExistingEmployee()
    const res = await request(app).put('/api/employees/1').send({ signRole: '', signLevel: '', signTags: [] })
    expect(res.status).toBe(200)
    expect(mockEmployee.updateOne.mock.calls[0][1].$set).toEqual({ signRole: '', signLevel: '', signTags: [] })
  })

  it.each([
    ['沒有帶密碼', {}],
    ['密碼是空字串', { password: '' }],
    ['密碼只有空白', { password: '   ' }],
    ['密碼是 null', { password: null }],
  ])('編輯時%s：維持原密碼，不呼叫 save', async (_label, extra) => {
    const { updated } = stubExistingEmployee()
    const res = await request(app)
      .put('/api/employees/1')
      .send({ signTags: ['人資'], ...extra })
    expect(res.status).toBe(200)
    expect(updated.save).not.toHaveBeenCalled()
    expect(updated.password).toBeUndefined()
    const [, update] = mockEmployee.updateOne.mock.calls[0]
    expect(update.$set).toEqual({ signTags: ['人資'] })
    expect(update).not.toHaveProperty('$inc')
  })

  it('編輯時有填新密碼才會重設密碼', async () => {
    const { updated } = stubExistingEmployee()
    const res = await request(app).put('/api/employees/1').send({ password: 'new-secret' })
    expect(res.status).toBe(200)
    expect(updated.password).toBe('new-secret')
    expect(updated.save).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/employees 簽核設定', () => {
  const basePayload = {
    name: 'Jane',
    email: 'jane@example.com',
    employeeNo: 'E001',
    username: 'jane',
    password: 'secret',
    role: 'employee',
  }

  it('拒絕不認得的簽核角色，不建立員工', async () => {
    const res = await request(app).post('/api/employees').send({ ...basePayload, signRole: 'banana' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/簽核角色/)
    expect(mockEmployee.create).not.toHaveBeenCalled()
  })

  it('建立時整理標籤並把名稱轉成代碼', async () => {
    mockEmployee.create.mockImplementation(async (doc) => ({ _id: '1', ...doc }))
    const res = await request(app)
      .post('/api/employees')
      .send({ ...basePayload, signRole: '審核', signLevel: 'L2', signTags: [' 人資', '人資 ', '業務主管'] })
    expect(res.status).toBe(201)
    const doc = mockEmployee.create.mock.calls[0][0]
    expect(doc.signRole).toBe('R003')
    expect(doc.signLevel).toBe('U002')
    expect(doc.signTags).toEqual(['人資', '業務主管'])
  })
})

describe('GET /api/employees/options（流程編輯器用）', () => {
  it('管理員的選項帶出在職狀態與帳號啟用，編輯器才能把不能簽核的人反灰', async () => {
    const lean = jest.fn().mockResolvedValue([
      { _id: 'a', name: '在職', username: 'a', status: '正職員工' },
      { _id: 'b', name: '停用', username: 'b', status: '正職員工', accountEnabled: false },
      { _id: 'c', name: '離職', username: 'c', status: '離職員工', accountEnabled: true },
    ])
    mockEmployee.find.mockReturnValue({ populate: jest.fn().mockReturnValue({ lean }) })
    const res = await request(app).get('/api/employees/options')
    expect(res.status).toBe(200)
    expect(res.body.map((item) => [item.name, item.status, item.accountEnabled])).toEqual([
      ['在職', '正職員工', true],
      ['停用', '正職員工', false],
      ['離職', '離職員工', true],
    ])
  })
})

describe('GET /api/employees/sign-tags（K2 標籤詞彙表）', () => {
  it('合併員工標籤、流程關卡引用的標籤與預設標籤，只計算可簽核的持有者，依繁中排序', async () => {
    mockEmployee.find.mockReturnValue(
      queryChain([
        { signTags: ['人資', ' 排班負責人 ', '人資'] },
        { signTags: ['人資'], status: '離職員工' },
        { signTags: ['特別小組'], accountEnabled: false },
        { signTags: ['人資', '特別小組'], status: '留職停薪' },
        { signTags: ['特別小組'] },
      ])
    )
    mockApprovalWorkflow.find.mockReturnValue(
      queryChain([
        {
          steps: [
            { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
            { approver_type: 'tag', approver_value: '人資' },
            { approver_type: 'tag', approver_value: '新標籤 ' },
          ],
        },
        { steps: [{ approver_type: 'tag', approver_value: '人資' }, { approver_type: 'tag', approver_value: '' }] },
      ])
    )

    const res = await request(app).get('/api/employees/sign-tags')

    expect(res.status).toBe(200)
    const byName = Object.fromEntries(res.body.tags.map((tag) => [tag.name, tag]))
    expect(byName['人資']).toEqual({ name: '人資', count: 1, requiredByWorkflows: 2 })
    expect(byName['排班負責人']).toEqual({ name: '排班負責人', count: 1, requiredByWorkflows: 0 })
    expect(byName['特別小組']).toEqual({ name: '特別小組', count: 1, requiredByWorkflows: 0 })
    expect(byName['新標籤']).toEqual({ name: '新標籤', count: 0, requiredByWorkflows: 1 })
    // 預設流程需要的標籤即使沒人持有也要在清單裡
    ;['支援單位主管', '財務覆核', '業務主管', '業務負責人'].forEach((name) => {
      expect(byName[name]).toEqual({ name, count: 0, requiredByWorkflows: 0 })
    })
    const names = res.body.tags.map((tag) => tag.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
    expect(new Set(names).size).toBe(names.length)
  })

  it('主管可以讀取，一般員工不行', async () => {
    mockEmployee.find.mockReturnValue(queryChain([]))
    requestUser = { id: 's1', role: 'supervisor' }
    const allowed = await request(app).get('/api/employees/sign-tags')
    expect(allowed.status).toBe(200)

    requestUser = { id: 'e1', role: 'employee' }
    const denied = await request(app).get('/api/employees/sign-tags')
    expect(denied.status).toBe(403)
  })

  it('查詢失敗時回 500 與中文訊息', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockEmployee.find.mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await request(app).get('/api/employees/sign-tags')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '載入員工標籤失敗' })
    console.error.mockRestore()
  })
})

describe('normalizeStoredSignTags 一次性整理', () => {
  it('只修正需要整理的員工，只動 signTags，重複執行不會再改', async () => {
    const rows = [
      { _id: 'e1', signTags: [' 人資', '人資 ', '財務　覆核'] },
      { _id: 'e2', signTags: ['人資'] },
      { _id: 'e3', signTags: ['', '  '] },
    ]
    mockEmployee.find.mockReturnValue(queryChain(rows))

    const updated = await controller.normalizeStoredSignTags()

    expect(updated).toBe(2)
    expect(mockEmployee.updateOne).toHaveBeenCalledTimes(2)
    expect(mockEmployee.updateOne).toHaveBeenCalledWith({ _id: 'e1' }, { $set: { signTags: ['人資', '財務 覆核'] } })
    expect(mockEmployee.updateOne).toHaveBeenCalledWith({ _id: 'e3' }, { $set: { signTags: [] } })

    // 第二次執行：資料已經整理好
    mockEmployee.updateOne.mockClear()
    mockEmployee.find.mockReturnValue(
      queryChain([{ _id: 'e1', signTags: ['人資', '財務 覆核'] }, { _id: 'e2', signTags: ['人資'] }, { _id: 'e3', signTags: [] }])
    )
    expect(await controller.normalizeStoredSignTags()).toBe(0)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })
})

describe('刪除員工前的簽核影響', () => {
  const ADMIN_ID = '507f1f77bcf86cd799439011'
  const SUP_ID = '507f1f77bcf86cd799439012'
  const HR_ID = '507f1f77bcf86cd799439013'

  function pendingRequest(approverIds, otherDecision = 'pending') {
    return {
      steps: [
        { approvers: [{ approver: approverIds[0], decision: 'approved' }] },
        {
          approvers: approverIds.map((id) => ({ approver: id, decision: otherDecision })),
        },
      ],
    }
  }

  it('computeDeleteImpact 統計等待簽核的單、部屬、指定該員工的流程關卡與失去持有者的標籤', async () => {
    mockApprovalRequest.find.mockReturnValue(
      queryChain([pendingRequest([SUP_ID, HR_ID]), pendingRequest([SUP_ID]), pendingRequest([ADMIN_ID])])
    )
    mockEmployee.countDocuments.mockResolvedValue(4)
    // 第一次：被刪除者持有的標籤；第二次：刪除後仍有人持有的標籤
    mockEmployee.distinct.mockResolvedValueOnce(['人資', '排班負責人']).mockResolvedValueOnce(['排班負責人'])
    mockApprovalWorkflow.find
      .mockReturnValueOnce(
        queryChain([
          {
            steps: [
              { approver_type: 'user', approver_value: [SUP_ID, 'someone-else'] },
              { approver_type: 'manager', approver_value: SUP_ID },
              { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        queryChain([{ steps: [{ approver_type: 'tag', approver_value: '人資' }, { approver_type: 'tag', approver_value: '人資' }] }])
      )

    const docs = new Map([
      [SUP_ID, { name: '王主管', employeeId: 'E002' }],
      [HR_ID, { name: '李人資', employeeId: 'E003' }],
    ])
    const impact = await controller.computeDeleteImpact([SUP_ID, HR_ID], docs)

    // 第三筆單等的是不在名單內的人，不算
    expect(impact.pendingRequests).toBe(2)
    expect(impact.pendingApprovers).toEqual([
      { _id: SUP_ID, name: '王主管', employeeNo: 'E002', requests: 2 },
      { _id: HR_ID, name: '李人資', employeeNo: 'E003', requests: 1 },
    ])
    expect(impact.subordinates).toBe(4)
    expect(impact.workflowSteps).toBe(2)
    expect(impact.lostTags).toEqual([{ name: '人資', requiredByWorkflows: 2 }])
    expect(impact.incomplete).toBe(false)
    expect(impact.messages).toHaveLength(4)
    expect(impact.messages[0]).toContain('2 筆進行中的簽核單')
    expect(impact.messages[0]).toContain('王主管：2 筆')
    expect(impact.messages[1]).toContain('4 位員工的直屬主管')
    expect(impact.messages[2]).toContain('2 個簽核流程關卡')
    expect(impact.messages[3]).toContain('「人資」')

    // 查詢條件：只找進行中、而且正在等這些人的單；部屬不含同時被刪除的人
    const requestFilter = mockApprovalRequest.find.mock.calls[0][0]
    expect(requestFilter.status).toBe('pending')
    expect(requestFilter.steps.$elemMatch.approvers.$elemMatch).toEqual({
      approver: { $in: [SUP_ID, HR_ID] },
      decision: 'pending',
    })
    expect(mockEmployee.countDocuments).toHaveBeenCalledWith({
      supervisor: { $in: [SUP_ID, HR_ID] },
      _id: { $nin: [SUP_ID, HR_ID] },
    })
  })

  it('標籤只算「可簽核」的持有者；沒有流程關卡使用的標籤不提醒', async () => {
    mockEmployee.distinct.mockResolvedValueOnce(['沒人用的標籤']).mockResolvedValueOnce([])
    const impact = await controller.computeDeleteImpact([SUP_ID])
    const [heldFilter] = mockEmployee.distinct.mock.calls[0].slice(1)
    expect(heldFilter.accountEnabled).toEqual({ $ne: false })
    expect(heldFilter.status).toEqual({ $nin: ['離職員工', '留職停薪'] })
    expect(impact.lostTags).toEqual([])
    expect(impact.messages).toEqual([])
  })

  it('有一段查詢失敗時，其餘照常回報並標示 incomplete，不會讓刪除失敗', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockApprovalRequest.find.mockImplementation(() => {
      throw new Error('boom')
    })
    mockEmployee.countDocuments.mockResolvedValue(2)
    const impact = await controller.computeDeleteImpact([SUP_ID])
    expect(impact.incomplete).toBe(true)
    expect(impact.subordinates).toBe(2)
    expect(impact.messages.at(-1)).toContain('無法確認')
    console.error.mockRestore()
  })

  it('沒有任何影響時不產生訊息', async () => {
    const impact = await controller.computeDeleteImpact([SUP_ID])
    expect(impact.messages).toEqual([])
    expect(await controller.computeDeleteImpact([])).toMatchObject({ pendingRequests: 0, messages: [] })
  })

  it('POST /delete-impact 預覽：管理員與操作者本人不列入，也不會刪除任何資料', async () => {
    const select = jest.fn().mockResolvedValue([
      { _id: ADMIN_ID, name: '管理員', employeeId: 'A001', role: 'admin' },
      { _id: SUP_ID, name: '王主管', employeeId: 'E002', role: 'supervisor' },
      { _id: HR_ID, name: '李人資', employeeId: 'E003', role: 'employee' },
    ])
    mockEmployee.find.mockReturnValue({ select })
    mockApprovalRequest.find.mockReturnValue(queryChain([pendingRequest([SUP_ID])]))
    requestUser = { id: HR_ID, role: 'admin' }

    const res = await request(app)
      .post('/api/employees/delete-impact')
      .send({ ids: [ADMIN_ID, SUP_ID, HR_ID] })

    expect(res.status).toBe(200)
    expect(res.body.requested).toBe(3)
    expect(res.body.impact.pendingRequests).toBe(1)
    expect(res.body.impact.pendingApprovers).toEqual([
      { _id: SUP_ID, name: '王主管', employeeNo: 'E002', requests: 1 },
    ])
    expect(mockApprovalRequest.find.mock.calls[0][0].steps.$elemMatch.approvers.$elemMatch.approver).toEqual({
      $in: [SUP_ID],
    })
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
    expect(mockEmployee.create).not.toHaveBeenCalled()
  })

  it.each([
    ['沒有 ids', {}],
    ['空清單', { ids: [] }],
    ['物件', { ids: [{ $ne: null }] }],
  ])('POST /delete-impact 拒絕不合法的 ids（%s）', async (_label, body) => {
    const res = await request(app).post('/api/employees/delete-impact').send(body)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/[一-鿿]/)
    expect(mockEmployee.find).not.toHaveBeenCalled()
  })

  it('單筆刪除：回報簽核影響並清除部屬的直屬主管', async () => {
    const deleteOne = jest.fn().mockResolvedValue(undefined)
    mockEmployee.findById.mockResolvedValue({
      _id: SUP_ID,
      name: '王主管',
      employeeId: 'E002',
      role: 'supervisor',
      deleteOne,
    })
    mockApprovalRequest.find.mockReturnValue(queryChain([pendingRequest([SUP_ID])]))
    mockEmployee.countDocuments.mockResolvedValue(3)
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 3 })

    const res = await request(app).delete(`/api/employees/${SUP_ID}`)

    expect(res.status).toBe(200)
    expect(deleteOne).toHaveBeenCalledTimes(1)
    expect(mockEmployee.updateMany).toHaveBeenCalledWith(
      { supervisor: { $in: [SUP_ID] } },
      { $unset: { supervisor: 1 } }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.unassignedSubordinates).toBe(3)
    expect(res.body.impact.pendingRequests).toBe(1)
    expect(res.body.impact.pendingApprovers[0]).toMatchObject({ name: '王主管', requests: 1 })
    expect(res.body.impact.subordinates).toBe(3)
    expect(res.body.impact.messages.length).toBeGreaterThanOrEqual(2)
    expect(res.body.warnings).toEqual([])
  })

  it('單筆刪除：清除直屬主管失敗只回警告，刪除仍算成功', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const deleteOne = jest.fn().mockResolvedValue(undefined)
    mockEmployee.findById.mockResolvedValue({ _id: SUP_ID, role: 'employee', deleteOne })
    mockEmployee.updateMany.mockRejectedValue(new Error('boom'))

    const res = await request(app).delete(`/api/employees/${SUP_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.warnings).toEqual(['部分員工的直屬主管設定未能清除，請檢查原本隸屬已刪除主管的員工'])
    console.error.mockRestore()
  })

  it('單筆刪除管理員仍被拒絕，而且不做任何盤點', async () => {
    const deleteOne = jest.fn()
    mockEmployee.findById.mockResolvedValue({ _id: ADMIN_ID, role: 'admin', deleteOne })
    const res = await request(app).delete(`/api/employees/${ADMIN_ID}`)
    expect(res.status).toBe(403)
    expect(deleteOne).not.toHaveBeenCalled()
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})

describe('直屬主管的設定要先檢查', () => {
  const SELF_ID = '507f1f77bcf86cd799439031'
  const OTHER_ID = '507f1f77bcf86cd799439032'
  const basePayload = {
    name: 'Jane',
    email: 'jane@example.com',
    employeeNo: 'E001',
    username: 'jane',
    password: 'secret',
    role: 'employee',
  }

  function stubExistingEmployee(overrides = {}) {
    const existing = { _id: SELF_ID, name: 'John', role: 'employee', ...overrides }
    mockEmployee.findById.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, save: jest.fn() })
  }

  it.each([
    ['不是合法的 id', 'not-an-object-id', /直屬主管資料不正確/],
    ['物件（NoSQL operator）', { $ne: null }, /直屬主管資料不正確/],
    ['本人', SELF_ID, /不能把自己設為直屬主管/],
  ])('編輯員工時拒絕主管是%s', async (_label, supervisor, pattern) => {
    stubExistingEmployee()
    const res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(pattern)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('編輯員工時拒絕不存在（可能已被刪除）的主管', async () => {
    stubExistingEmployee()
    mockEmployee.exists.mockResolvedValue(null)
    const res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor: OTHER_ID })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/找不到所選的直屬主管/)
    expect(mockEmployee.exists).toHaveBeenCalledWith({ _id: OTHER_ID })
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('編輯員工時可以改成存在的主管，也可以清除主管', async () => {
    stubExistingEmployee()
    let res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor: OTHER_ID })
    expect(res.status).toBe(200)
    expect(mockEmployee.updateOne.mock.calls[0][1].$set.supervisor).toBe(OTHER_ID)

    mockEmployee.updateOne.mockClear()
    stubExistingEmployee()
    res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor: '' })
    expect(res.status).toBe(200)
    expect(mockEmployee.updateOne.mock.calls[0][1].$unset).toEqual({ supervisor: 1 })
  })

  it('主管沒有變更時不檢查：原本就失效的設定不會擋住其他欄位（例如只加標籤）的儲存', async () => {
    stubExistingEmployee({ supervisor: OTHER_ID })
    mockEmployee.exists.mockResolvedValue(null)
    const res = await request(app)
      .put(`/api/employees/${SELF_ID}`)
      .send({ supervisor: OTHER_ID, signTags: ['人資'] })
    expect(res.status).toBe(200)
    expect(mockEmployee.exists).not.toHaveBeenCalled()
  })

  it('建立員工時同樣拒絕不存在或格式錯誤的主管', async () => {
    mockEmployee.exists.mockResolvedValue(null)
    let res = await request(app).post('/api/employees').send({ ...basePayload, supervisor: OTHER_ID })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/找不到所選的直屬主管/)
    res = await request(app).post('/api/employees').send({ ...basePayload, supervisor: 'nope' })
    expect(res.status).toBe(400)
    expect(mockEmployee.create).not.toHaveBeenCalled()

    mockEmployee.exists.mockResolvedValue({ _id: OTHER_ID })
    mockEmployee.create.mockImplementation(async (doc) => ({ _id: '1', ...doc }))
    res = await request(app).post('/api/employees').send({ ...basePayload, supervisor: OTHER_ID })
    expect(res.status).toBe(201)
    expect(mockEmployee.create.mock.calls[0][0].supervisor).toBe(OTHER_ID)
  })

  it('批次設定主管：全部檢查過才寫入，任何一筆有問題就一筆都不寫', async () => {
    let res = await request(app)
      .post('/api/employees/set-supervisors')
      .send({
        assignments: [
          { employee: OTHER_ID, supervisor: SELF_ID },
          { employee: SELF_ID, supervisor: SELF_ID },
        ],
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/不能把自己設為直屬主管/)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()

    res = await request(app)
      .post('/api/employees/set-supervisors')
      .send({
        assignments: [
          { employee: OTHER_ID, supervisor: SELF_ID },
          { employee: SELF_ID, supervisor: null },
        ],
      })
    expect(res.status).toBe(200)
    expect(mockEmployee.updateOne).toHaveBeenCalledTimes(2)
  })
})

describe('直屬主管必須是可簽核的人（K1），而且編輯表單可以清除主管', () => {
  const SELF_ID = '507f1f77bcf86cd799439041'
  const SUPERVISOR_ID = '507f1f77bcf86cd799439042'
  const ELIGIBLE_FILTER = {
    _id: SUPERVISOR_ID,
    accountEnabled: { $ne: false },
    status: { $nin: ['離職員工', '留職停薪'] },
  }
  const basePayload = {
    name: 'Jane',
    email: 'jane@example.com',
    employeeNo: 'E001',
    username: 'jane',
    password: 'secret',
    role: 'employee',
  }

  function stubExistingEmployee(overrides = {}) {
    const existing = { _id: SELF_ID, name: 'John', role: 'employee', ...overrides }
    mockEmployee.findById.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, save: jest.fn() })
    return existing
  }

  // 第一次查「存在而且可簽核」，查不到才查「是否存在」來分辨訊息
  function supervisorLookup({ exists, eligible }) {
    mockEmployee.exists.mockImplementation(async (filter) => {
      if (Object.keys(filter).length > 1) return eligible ? { _id: SUPERVISOR_ID } : null
      return exists ? { _id: SUPERVISOR_ID } : null
    })
  }

  it('編輯員工時拒絕已離職、停用或留職停薪的人當直屬主管，訊息和「找不到」不同', async () => {
    stubExistingEmployee()
    supervisorLookup({ exists: true, eligible: false })

    const res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor: SUPERVISOR_ID })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('所選的直屬主管已離職、停用或留職停薪，無法擔任簽核人，請重新選擇')
    expect(mockEmployee.exists).toHaveBeenNthCalledWith(1, ELIGIBLE_FILTER)
    expect(mockEmployee.exists).toHaveBeenNthCalledWith(2, { _id: SUPERVISOR_ID })
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('可簽核的主管只需要查一次，直接放行', async () => {
    stubExistingEmployee()
    supervisorLookup({ exists: true, eligible: true })

    const res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor: SUPERVISOR_ID })

    expect(res.status).toBe(200)
    expect(mockEmployee.exists).toHaveBeenCalledTimes(1)
    expect(mockEmployee.exists).toHaveBeenCalledWith(ELIGIBLE_FILTER)
    expect(mockEmployee.updateOne.mock.calls[0][1].$set.supervisor).toBe(SUPERVISOR_ID)
  })

  it('編輯表單送 supervisor 為 null 或空字串就是清除主管（$unset），而且不需要查任何人', async () => {
    for (const supervisor of [null, '']) {
      mockEmployee.updateOne.mockClear()
      mockEmployee.exists.mockClear()
      stubExistingEmployee({ supervisor: SUPERVISOR_ID })

      const res = await request(app).put(`/api/employees/${SELF_ID}`).send({ supervisor })

      expect(res.status).toBe(200)
      const update = mockEmployee.updateOne.mock.calls[0][1]
      expect(update.$unset).toEqual({ supervisor: 1 })
      expect(update.$set ?? {}).not.toHaveProperty('supervisor')
      expect(mockEmployee.exists).not.toHaveBeenCalled()
    }
  })

  it('建立員工時同樣拒絕離職、停用或留職停薪的主管', async () => {
    supervisorLookup({ exists: true, eligible: false })

    const res = await request(app).post('/api/employees').send({ ...basePayload, supervisor: SUPERVISOR_ID })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/已離職、停用或留職停薪/)
    expect(mockEmployee.create).not.toHaveBeenCalled()
  })

  it('建立員工時主管可以是 null（沒有主管）', async () => {
    mockEmployee.create.mockImplementation(async (doc) => ({ _id: '1', ...doc }))

    const res = await request(app).post('/api/employees').send({ ...basePayload, supervisor: null })

    expect(res.status).toBe(201)
    expect(mockEmployee.exists).not.toHaveBeenCalled()
  })

  it('批次設定主管：不可簽核的主管整批擋下、不寫入任何一筆', async () => {
    supervisorLookup({ exists: true, eligible: false })

    const res = await request(app)
      .post('/api/employees/set-supervisors')
      .send({ assignments: [{ employee: SELF_ID, supervisor: SUPERVISOR_ID }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/已離職、停用或留職停薪/)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('批次設定主管：null 或空字串＝清除（$unset），沒帶 supervisor 的項目不變更', async () => {
    supervisorLookup({ exists: true, eligible: true })

    const res = await request(app)
      .post('/api/employees/set-supervisors')
      .send({
        assignments: [
          { employee: SELF_ID, supervisor: null },
          { employee: '507f1f77bcf86cd799439043', supervisor: '' },
          { employee: '507f1f77bcf86cd799439044' },
          { employee: '507f1f77bcf86cd799439045', supervisor: SUPERVISOR_ID },
        ],
      })

    expect(res.status).toBe(200)
    expect(mockEmployee.updateOne.mock.calls).toEqual([
      [{ _id: SELF_ID }, { $unset: { supervisor: 1 } }],
      [{ _id: '507f1f77bcf86cd799439043' }, { $unset: { supervisor: 1 } }],
      [{ _id: '507f1f77bcf86cd799439045' }, { supervisor: SUPERVISOR_ID }],
    ])
  })
})

describe('編輯員工：已使用的特休天數不會被舊畫面蓋回去', () => {
  const EMP_ID = '507f1f77bcf86cd799439051'

  function stubExisting(annualLeave) {
    const existing = { _id: EMP_ID, name: 'John', role: 'employee', status: '正職員工', accountEnabled: true, annualLeave }
    mockEmployee.findById.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, save: jest.fn() })
  }

  it('送出的天數和目前存的相同就不寫入 usedDays（其他特休欄位照常更新）', async () => {
    stubExisting({ totalDays: 10, usedDays: 3 })

    const res = await request(app)
      .put(`/api/employees/${EMP_ID}`)
      .send({ annualLeave: { totalDays: 12, usedDays: 3, notes: '調整總天數' } })

    expect(res.status).toBe(200)
    const set = mockEmployee.updateOne.mock.calls[0][1].$set
    expect(set['annualLeave.totalDays']).toBe(12)
    expect(set['annualLeave.notes']).toBe('調整總天數')
    expect(set).not.toHaveProperty(['annualLeave.usedDays'])
  })

  it('管理員真的改了天數才寫入，而且永遠不會從編輯表單寫入 appliedApprovalRequestIds', async () => {
    stubExisting({ totalDays: 10, usedDays: 3 })

    const res = await request(app)
      .put(`/api/employees/${EMP_ID}`)
      .send({ annualLeave: { usedDays: 1, appliedApprovalRequestIds: [] } })

    expect(res.status).toBe(200)
    const set = mockEmployee.updateOne.mock.calls[0][1].$set
    expect(set['annualLeave.usedDays']).toBe(1)
    expect(JSON.stringify(set)).not.toContain('appliedApprovalRequestIds')
  })
})
