import { jest } from '@jest/globals'
import { createFakeEmployeeModel, oid } from './helpers/approvalTestKit.js'

// 簽核流程設定的新選項（approvalTemplateController）：
// - 儲存流程：主管鏈的設定整理成 { stopAtTag, maxLevels }、請假長度條件只有請假表單可以設定、至少一關沒有條件；
//   通用流程規則的「略過重複的簽核人」（skipRepeatedApprovers）。
// - 流程預覽：主管鏈展開的每一級（只有級數，沒有姓名）、條件文字、會被略過的重複簽核人；舊的關卡內容和以前一樣。
const FORM = oid(100)
const NURSE = oid(1)
const HEAD = oid(2)
const DIRECTOR = oid(3)
const VP = oid(4)
const ADMIN = oid(5)

const seedEmployees = () => [
  { _id: NURSE, name: '護理師', employeeId: 'N001', role: 'employee', supervisor: HEAD, signTags: [] },
  { _id: HEAD, name: '護理長', employeeId: 'N002', role: 'supervisor', supervisor: DIRECTOR, signTags: [] },
  { _id: DIRECTOR, name: '主任', employeeId: 'N003', role: 'supervisor', supervisor: VP, signTags: ['一般假單決行'] },
  { _id: VP, name: '醫療副院長', employeeId: 'N004', role: 'supervisor', supervisor: null, signTags: ['長假決行'] },
  { _id: ADMIN, name: '系統管理員', employeeId: 'S001', role: 'admin', signTags: [] },
]

const mockFormTemplate = { find: jest.fn(), findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn(), findOneAndUpdate: jest.fn() }
const mockApprovalRequest = { countDocuments: jest.fn() }
const mockDepartment = {
  findById: jest.fn(() => {
    const query = { select: () => query, lean: async () => null, then: (resolve, reject) => Promise.resolve(null).then(resolve, reject) }
    return query
  }),
}
const mockEmployee = createFakeEmployeeModel([])
const baseFind = mockEmployee.find
// 儲存流程時會用 Employee.find(...).lean() 確認指定的員工存在
mockEmployee.find = jest.fn((...args) => {
  const result = baseFind(...args)
  return Object.assign(result, { lean: () => result })
})
const mockGetSettings = jest.fn()

let controller

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: { find: jest.fn(async () => []) } }))
  await jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ resetLeaveFieldCache: jest.fn() }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: jest.fn().mockResolvedValue([]),
  }))
  controller = await import('../src/controllers/approvalTemplateController.js')
})

beforeEach(() => {
  mockEmployee.rows.splice(0, mockEmployee.rows.length, ...seedEmployees())
  mockEmployee.find.mockClear()
  mockFormTemplate.findById.mockReset()
  mockFormTemplate.findById.mockResolvedValue({ _id: FORM, name: '請假', semanticType: 'leave' })
  mockApprovalWorkflow.findOne.mockReset()
  mockApprovalWorkflow.findOneAndUpdate.mockReset()
  mockApprovalWorkflow.findOneAndUpdate.mockImplementation(async (filter, update) => ({ form: filter.form, ...update.$set }))
  mockGetSettings.mockReset()
  mockGetSettings.mockResolvedValue({})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() })

async function save(body) {
  const res = makeRes()
  await controller.setWorkflow({ params: { formId: FORM }, body }, res)
  const status = res.status.mock.calls[0]?.[0] ?? 200
  return { status, body: res.json.mock.calls[0]?.[0], update: mockApprovalWorkflow.findOneAndUpdate.mock.calls.at(-1)?.[1] }
}

const chain = (value, extra = {}) => ({ approver_type: 'manager_chain', approver_value: value, ...extra })
const customerSteps = () => [
  chain({ stopAtTag: '一般假單決行', maxLevels: 5 }, { step_order: 1 }),
  chain({ stopAtTag: '長假決行' }, { step_order: 2, is_required: false, condition: { kind: 'leave_hours_gte', value: 56 } }),
]

describe('儲存流程：主管鏈', () => {
  it('stores the chain as { stopAtTag, maxLevels }, normalising the tag and defaulting to five levels', async () => {
    const { status, update } = await save({ steps: [chain({ stopAtTag: ' 一般假單決行 ' }), chain({}), chain(undefined, { approver_value: undefined })] })

    expect(status).toBe(200)
    expect(update.$set.steps.map(item => item.approver_value)).toEqual([
      { stopAtTag: '一般假單決行', maxLevels: 5 },
      { maxLevels: 5 },
      { maxLevels: 5 },
    ])
    expect(update.$set.steps[0]).toMatchObject({ step_order: 1, approver_type: 'manager_chain', scope_type: 'none', is_required: true })
  })

  it.each([
    [{ maxLevels: 0 }, '第1關（主管鏈）：最多層數必須是 1 到 10 的整數'],
    [{ maxLevels: 11 }, '第1關（主管鏈）：最多層數必須是 1 到 10 的整數'],
    [{ maxLevels: 2.5 }, '第1關（主管鏈）：最多層數必須是 1 到 10 的整數'],
    [{ stopAtTag: ['一般假單決行'] }, '第1關（主管鏈）：「簽到持有標籤的主管為止」格式不正確，請重新選擇'],
    ['一般假單決行', '第1關（主管鏈）：主管鏈的設定格式不正確，請重新設定'],
  ])('refuses %j in Chinese', async (value, message) => {
    const { status, body } = await save({ steps: [chain(value)] })

    expect(status).toBe(400)
    expect(body).toEqual({ error: message, step: 1 })
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })
})

describe('儲存流程：請假長度條件', () => {
  it('stores the customer configuration on a leave form', async () => {
    const { status, update } = await save({ steps: customerSteps() })

    expect(status).toBe(200)
    expect(update.$set.steps[0].condition).toBeUndefined()
    expect(update.$set.steps[1]).toMatchObject({ is_required: false, condition: { kind: 'leave_hours_gte', value: 56 } })
  })

  it('treats an empty condition as no condition', async () => {
    const { update } = await save({ steps: [chain({}, { condition: { kind: '' } }), chain({}, { condition: null })] })

    expect(update.$set.steps.every(item => item.condition === undefined)).toBe(true)
  })

  it('refuses a condition on a form that is not a leave form', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: FORM, name: '加班申請', semanticType: 'overtime' })

    const { status, body } = await save({ steps: customerSteps() })

    expect(status).toBe(400)
    expect(body.error).toBe('第2關（主管鏈）：只有表單性質為「請假」的表單可以設定請假長度條件，請先移除這一關的適用條件')
  })

  it.each([
    [{ kind: 'leave_hours_gte', value: 0 }, '第2關（主管鏈）：請假時數條件必須是 0.5 到 2928 小時'],
    [{ kind: 'leave_hours_gte', value: 56.3 }, '第2關（主管鏈）：請假時數條件必須是 0.5 小時的倍數'],
    [{ kind: 'leave_calendar_days_gte', value: 6.5 }, '第2關（主管鏈）：請假日數（日曆日）條件必須是整數日'],
    [{ kind: 'leave_scheduled_days_gte', value: 400 }, '第2關（主管鏈）：請假日數（排班日）條件必須是 1 到 366 日'],
    [{ kind: 'leave_weeks_gte', value: 1 }, '第2關（主管鏈）：適用條件「leave_weeks_gte」不正確，請重新選擇'],
    ['7日', '第2關（主管鏈）：適用條件格式不正確'],
  ])('refuses the condition %j', async (condition, message) => {
    const steps = customerSteps()
    steps[1].condition = condition

    const { status, body } = await save({ steps })

    expect(status).toBe(400)
    expect(body).toEqual({ error: message, step: 2 })
  })

  it('needs at least one step without a condition (otherwise a short leave has no approver)', async () => {
    const steps = customerSteps()
    steps[0].condition = { kind: 'leave_calendar_days_gte', value: 1 }

    const { status, body } = await save({ steps })

    expect(status).toBe(400)
    expect(body.error).toBe('每一關都設定了請假長度條件：至少要有一關沒有條件，不然未達條件的假單會沒有人簽核')
  })

  it('accepts a day value sent as text by a form field', async () => {
    const steps = customerSteps()
    steps[1].condition = { kind: 'leave_calendar_days_gte', value: '7' }

    const { update } = await save({ steps })

    expect(update.$set.steps[1].condition).toEqual({ kind: 'leave_calendar_days_gte', value: 7 })
  })
})

describe('通用流程規則：略過重複的簽核人', () => {
  it('stores only the switch when it is the only policy field sent', async () => {
    const { status, update } = await save({ policy: { skipRepeatedApprovers: true } })

    expect(status).toBe(200)
    expect(update.$set).toEqual({ 'policy.skipRepeatedApprovers': true })
  })

  it('refuses anything but a boolean', async () => {
    const { status, body } = await save({ policy: { skipRepeatedApprovers: 'yes' } })

    expect(status).toBe(400)
    expect(body.error).toBe('「略過重複的簽核人」必須是開或關')
  })
})

describe('流程預覽：主管鏈與條件', () => {
  function stored(steps, policy = {}) {
    const plain = { _id: oid(300), form: FORM, steps, policy }
    return { ...plain, toJSON: () => ({ ...plain }) }
  }
  async function preview(steps, policy, user = { id: NURSE, role: 'employee' }) {
    mockApprovalWorkflow.findOne.mockResolvedValue(stored(steps, policy))
    const res = makeRes()
    await controller.getWorkflow({ params: { formId: FORM }, user }, res)
    return res.json.mock.calls[0]?.[0]
  }

  it('lists the levels of each chain without names, the condition text, and the repeats that will be skipped', async () => {
    const body = await preview(customerSteps().map((item, index) => ({ ...item, step_order: index + 1, scope_type: 'none' })))

    expect(body.steps[0]).toMatchObject({
      resolved_count: 2,
      unresolved_reason: null,
      chain_levels: [{ level: 1, label: '第1級主管', repeated: false }, { level: 2, label: '第2級主管', repeated: false }],
    })
    expect(body.steps[0].condition_text).toBeUndefined()
    expect(body.steps[1]).toMatchObject({
      condition_text: '請假滿 56 小時才需要',
      resolved_count: 3,
      repeated_count: 2,
      chain_levels: [
        { level: 1, label: '第1級主管', repeated: true },
        { level: 2, label: '第2級主管', repeated: true },
        { level: 3, label: '第3級主管', repeated: false },
      ],
    })
    expect(JSON.stringify(body)).not.toMatch(/護理長|主任|醫療副院長|N00/)
  })

  it('explains the top-level fallback for a chain without any supervisor', async () => {
    const body = await preview([chain({ stopAtTag: '一般假單決行' }, { step_order: 1 })], {}, { id: VP, role: 'supervisor' })

    expect(body.steps[0]).toMatchObject({
      resolved_count: 1,
      fallback_text: '無上級主管，改由系統管理員簽核（任一位核准即可）',
      fallback_reason: '申請人沒有設定直屬主管',
    })
    expect(body.steps[0].chain_levels).toBeUndefined()
  })

  it('marks a step that the switch skipRepeatedApprovers will drop', async () => {
    const steps = [
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', scope_type: 'none', is_required: true },
      { step_order: 2, approver_type: 'user', approver_value: [HEAD], scope_type: 'none', is_required: true },
    ]

    const off = await preview(steps)
    expect(off.steps[1]).toEqual({ ...steps[1], resolved_count: 1, unresolved_reason: null, fallback_text: null, fallback_reason: null })

    const on = await preview(steps, { skipRepeatedApprovers: true })
    expect(on.steps[1]).toMatchObject({ resolved_count: 1, repeated_count: 1, skipped_as_repeat: true })
  })
})
