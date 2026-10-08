import { jest } from '@jest/globals'
import { createFakeEmployeeModel, oid } from './helpers/approvalTestKit.js'

// GET /api/approvals/forms/:formId/workflow 的流程預覽：每一關加上 resolved_count / unresolved_reason，
// 讓員工在填表前就知道某一關會找不到人。以「目前登入的人」當申請人解析，只回傳人數與原因。
const FORM = oid(100)
const DEPT_A = oid(9001)
const DEPT_B = oid(9002)

const APPLICANT = oid(1)
const BOSS = oid(2)
const HR_A1 = oid(3)
const HR_A2 = oid(4)
const HR_B = oid(5)
const HR_LEFT = oid(6)
const NO_DEPT = oid(7)
const SUP_X = oid(8)

const seedEmployees = () => [
  { _id: APPLICANT, name: '申請人甲', role: 'employee', department: DEPT_A, organization: 'org-1', supervisor: BOSS, signTags: [] },
  { _id: BOSS, name: '王主管', role: 'supervisor', department: DEPT_A, organization: 'org-1', signTags: [] },
  { _id: HR_A1, name: '人資一', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資'], signRole: 'R007' },
  { _id: HR_A2, name: '人資二', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資 '], signRole: 'R007' },
  { _id: HR_B, name: '人資乙', role: 'employee', department: DEPT_B, organization: 'org-2', signTags: ['人資'] },
  { _id: HR_LEFT, name: '離職人資', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資'], status: '離職員工' },
  { _id: NO_DEPT, name: '無部門', role: 'employee', supervisor: BOSS, signTags: [] },
  { _id: SUP_X, name: '指定主管', role: 'supervisor', department: DEPT_B, organization: 'org-2', signTags: [] },
]

const mockFormTemplate = { find: jest.fn(), findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn() }
const mockApprovalRequest = { countDocuments: jest.fn() }
const mockSubDepartment = { find: jest.fn() }
const mockEmployee = createFakeEmployeeModel([])
mockEmployee.findById = jest.fn(mockEmployee.findById)

let controller

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ resetLeaveFieldCache: jest.fn() }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: jest.fn().mockResolvedValue({ itemSettings: {} }),
    getDictionaryItems: jest.fn().mockResolvedValue([]),
  }))
  controller = await import('../src/controllers/approvalTemplateController.js')
})

beforeEach(() => {
  mockEmployee.rows.splice(0, mockEmployee.rows.length, ...seedEmployees())
  mockEmployee.find.mockClear()
  mockEmployee.findById.mockClear()
  mockApprovalWorkflow.findOne.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() })

// 像 Mongoose 文件：res.json(wf) 時會呼叫 toJSON
function storedWorkflow(steps, extra = {}) {
  const plain = { _id: oid(300), form: FORM, steps, policy: { maxApprovalLevel: 5, allowDelegate: false }, ...extra }
  return { ...plain, toJSON: () => ({ ...plain }) }
}

async function readWorkflow(steps, user = { id: APPLICANT, role: 'employee' }, extra) {
  mockApprovalWorkflow.findOne.mockResolvedValue(storedWorkflow(steps, extra))
  const res = makeRes()
  await controller.getWorkflow({ params: { formId: FORM }, user }, res)
  return { res, body: res.json.mock.calls[0]?.[0] }
}

const step = (extra) => ({ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', scope_type: 'none', is_required: true, all_must_approve: true, can_return: true, ...extra })

describe('getWorkflow preview', () => {
  it('adds resolved_count and unresolved_reason to every step, for the caller as the applicant', async () => {
    const { res, body } = await readWorkflow([
      step({ step_order: 1 }),
      step({ step_order: 2, approver_type: 'tag', approver_value: '人資' }),
      step({ step_order: 3, approver_type: 'tag', approver_value: '沒有人持有' }),
      step({ step_order: 4, approver_type: 'role', approver_value: 'R007', is_required: false }),
      step({ step_order: 5, approver_type: 'level', approver_value: 'U005' }),
    ])

    expect(res.status).not.toHaveBeenCalled()
    expect(body.steps.map(item => [item.step_order, item.resolved_count, item.unresolved_reason])).toEqual([
      [1, 1, null], // 直屬主管
      [2, 3, null], // 人資 / 「人資 」（舊資料未整理）都算：HR_A1、HR_A2、HR_B；離職的不算
      [3, 0, '目前沒有在職員工持有「沒有人持有」標籤'],
      [4, 2, null], // R007：HR_A1、HR_A2
      [5, 0, '目前沒有符合此層級的在職員工'],
    ])
  })

  it('keeps every stored field of the workflow and its steps', async () => {
    const original = step({ step_order: 2, approver_type: 'tag', approver_value: '人資', name: '人資覆核', scope_type: 'org', all_must_approve: false })
    const { body } = await readWorkflow([original], undefined, { policy: { maxApprovalLevel: 3 } })

    expect(body).toMatchObject({ _id: oid(300), form: FORM, policy: { maxApprovalLevel: 3 } })
    expect(body.steps[0]).toMatchObject(original)
    expect(body.toJSON).toBeUndefined()
  })

  it('resolves for the person who asks: scope follows the caller, and a caller without a department gets the reason', async () => {
    const scoped = [step({ approver_type: 'tag', approver_value: '人資', scope_type: 'dept' })]

    const inDeptA = await readWorkflow(scoped, { id: APPLICANT, role: 'employee' })
    expect(inDeptA.body.steps[0]).toMatchObject({ resolved_count: 2, unresolved_reason: null })

    const lonely = await readWorkflow(scoped, { id: NO_DEPT, role: 'employee' })
    expect(lonely.body.steps[0]).toMatchObject({ resolved_count: 0, unresolved_reason: '申請人尚未設定所屬部門' })
  })

  it('never lists the caller as an approver of their own request', async () => {
    const { body } = await readWorkflow([step({ approver_type: 'tag', approver_value: '人資' })], { id: HR_A1, role: 'employee' })

    expect(body.steps[0]).toMatchObject({ resolved_count: 2 }) // HR_A2、HR_B；HR_A1 自己不算
  })

  it('explains why a step has nobody (no supervisor, left supervisor, specific manager gone, bad setting)', async () => {
    const asNoSupervisor = await readWorkflow([step({ step_order: 1 })], { id: SUP_X, role: 'supervisor' })
    expect(asNoSupervisor.body.steps[0]).toMatchObject({ resolved_count: 0, unresolved_reason: '申請人尚未設定直屬主管' })

    mockEmployee.rows.find(row => row._id === APPLICANT).supervisor = HR_LEFT
    const leftSupervisor = await readWorkflow([step({ step_order: 1 })])
    expect(leftSupervisor.body.steps[0]).toMatchObject({ resolved_count: 0, unresolved_reason: '申請人的直屬主管已離職、停用或留職停薪' })

    const others = await readWorkflow([
      step({ step_order: 2, approver_type: 'manager', approver_value: oid(999) }),
      step({ step_order: 3, approver_type: 'user', approver_value: [HR_LEFT] }),
      step({ step_order: 4, approver_type: 'role', approver_value: 'banana' }),
    ])
    expect(others.body.steps.map(item => item.unresolved_reason)).toEqual([
      '指定的主管已離職、停用，或不具主管身分',
      '指定的員工已離職、停用或不存在',
      '此關卡的簽核設定不完整',
    ])
  })

  it('answers with counts and reasons only: nothing about who the approvers are', async () => {
    const { body } = await readWorkflow([
      step({ step_order: 1 }),
      step({ step_order: 2, approver_type: 'tag', approver_value: '人資' }),
      step({ step_order: 3, approver_type: 'role', approver_value: 'R007' }),
    ])

    const text = JSON.stringify(body)
    for (const needle of ['人資一', '人資二', '人資乙', '王主管', HR_A1, HR_A2, HR_B, BOSS]) {
      expect(text).not.toContain(needle)
    }
    body.steps.forEach(item => {
      expect(Object.keys(item).filter(key => /^(resolved|unresolved)/.test(key)).sort()).toEqual(['resolved_count', 'unresolved_reason'])
    })
  })

  it('gives null (unknown), not 0, when the caller cannot be identified, without failing', async () => {
    const unknownCaller = await readWorkflow([step()], { id: oid(11), role: 'employee' }) // 登入資料有效但查無此員工
    expect(unknownCaller.res.status).not.toHaveBeenCalled()
    expect(unknownCaller.body.steps[0]).toMatchObject({ resolved_count: null, unresolved_reason: null })

    mockEmployee.findById.mockClear()
    mockApprovalWorkflow.findOne.mockResolvedValue(storedWorkflow([step()]))
    const res = makeRes()
    await controller.getWorkflow({ params: { formId: FORM } }, res) // 沒有登入資料
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].steps[0]).toMatchObject({ resolved_count: null, unresolved_reason: null })
    expect(mockEmployee.findById).not.toHaveBeenCalled()
  })

  it('a step that cannot be resolved does not break the whole response (only its error name is logged)', async () => {
    mockEmployee.find.mockImplementationOnce(async () => { throw Object.assign(new Error('secret connection string'), { name: 'MongoServerError' }) })
    const { res, body } = await readWorkflow([
      step({ step_order: 1, approver_type: 'tag', approver_value: '人資' }),
      step({ step_order: 2 }),
    ])

    expect(res.status).not.toHaveBeenCalled()
    expect(body.steps[0]).toMatchObject({ resolved_count: null, unresolved_reason: null })
    expect(body.steps[1]).toMatchObject({ resolved_count: 1 })
    expect(console.error).toHaveBeenCalledWith('[approval-template] preview step failed: MongoServerError')
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('secret connection string')
  })

  it('a workflow without steps comes back as it is, without asking for the caller', async () => {
    const { body } = await readWorkflow([])

    expect(body.steps).toEqual([])
    expect(mockEmployee.findById).not.toHaveBeenCalled()
  })

  it('works for an admin too', async () => {
    const { body } = await readWorkflow([step({ approver_type: 'tag', approver_value: '人資' })], { id: BOSS, role: 'admin' })

    expect(body.steps[0].resolved_count).toBe(3)
  })

  it('still answers 404 for a form with no workflow and 400 for a malformed id, before looking at anyone', async () => {
    mockApprovalWorkflow.findOne.mockResolvedValue(null)
    const missing = makeRes()
    await controller.getWorkflow({ params: { formId: FORM }, user: { id: APPLICANT, role: 'employee' } }, missing)
    expect(missing.status).toHaveBeenCalledWith(404)
    expect(missing.json).toHaveBeenCalledWith({ error: '這張表單還沒有簽核流程' })

    const bad = makeRes()
    await controller.getWorkflow({ params: { formId: 'zzz' }, user: { id: APPLICANT, role: 'employee' } }, bad)
    expect(bad.status).toHaveBeenCalledWith(400)
    expect(bad.json).toHaveBeenCalledWith({ error: '表單編號格式不正確' })
    expect(mockEmployee.findById).not.toHaveBeenCalled()
  })
})
