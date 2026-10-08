import { jest } from '@jest/globals'

const FORM_ID = '64b7f0f0f0f0f0f0f0f0a001'
const EMP_A = '64b7f0f0f0f0f0f0f0f0b001'
const EMP_B = '64b7f0f0f0f0f0f0f0f0b002'
const SUPERVISOR = '64b7f0f0f0f0f0f0f0f0b003'
const DEPT_ID = '64b7f0f0f0f0f0f0f0f0c001'
const SUB_DEPT_ID = '64b7f0f0f0f0f0f0f0f0d001'

const mockApprovalWorkflow = { findOneAndUpdate: jest.fn() }
const mockFormTemplate = { findById: jest.fn() }
const mockEmployee = { find: jest.fn() }

let setWorkflow
let validateWorkflowSteps
let getSignRoles
let getSignLevels

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  const mod = await import('../src/controllers/approvalTemplateController.js')
  setWorkflow = mod.setWorkflow
  validateWorkflowSteps = mod.validateWorkflowSteps
  getSignRoles = mod.getSignRoles
  getSignLevels = mod.getSignLevels
})

beforeEach(() => {
  mockApprovalWorkflow.findOneAndUpdate.mockReset()
  mockApprovalWorkflow.findOneAndUpdate.mockImplementation(async (filter, update) => ({ form: filter.form, ...update.$set }))
  mockFormTemplate.findById.mockReset()
  mockFormTemplate.findById.mockResolvedValue({ _id: FORM_ID })
  mockEmployee.find.mockReset()
  // 預設：被查的員工都存在，且 SUPERVISOR 是主管
  mockEmployee.find.mockImplementation((filter) => ({
    lean: async () => filter._id.$in.map((id) => ({ _id: id, role: id === SUPERVISOR ? 'supervisor' : 'employee' })),
  }))
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

function workflowReq(body, formId = FORM_ID) {
  return { params: { formId }, body }
}

function lastUpdate() {
  const [filter, update, options] = mockApprovalWorkflow.findOneAndUpdate.mock.calls.at(-1)
  return { filter, update, options }
}

describe('setWorkflow', () => {
  it('only stores the policy when no steps are sent, so the existing chain is kept', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ policy: { overdueDays: 7, overdueAction: 'autoPass' } }), res)

    const { filter, update, options } = lastUpdate()
    expect(filter).toEqual({ form: FORM_ID })
    expect(update).toEqual({ $set: { 'policy.overdueDays': 7, 'policy.overdueAction': 'autoPass' } })
    expect(update.$set).not.toHaveProperty('steps')
    expect(options).toEqual({ new: true, upsert: true, runValidators: true })
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ 'policy.overdueDays': 7 }))
  })

  it('only stores the steps when no policy is sent, so the existing policy is kept', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'manager' }] }), res)

    const { update } = lastUpdate()
    expect(Object.keys(update.$set)).toEqual(['steps'])
    expect(update.$set.steps).toEqual([
      {
        step_order: 1,
        approver_type: 'manager',
        approver_value: 'APPLICANT_SUPERVISOR',
        scope_type: 'none',
        is_required: true,
        all_must_approve: true,
        can_return: true,
      },
    ])
  })

  it('stores steps and policy together when both are sent', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({
      steps: [{ step_order: 1, approver_type: 'tag', approver_value: '人資' }],
      policy: { allowDelegate: true },
    }), res)

    const { update } = lastUpdate()
    expect(update.$set['policy.allowDelegate']).toBe(true)
    expect(update.$set.steps).toHaveLength(1)
  })

  it('accepts an explicitly empty step list (the admin removed every step)', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [] }), res)

    expect(lastUpdate().update).toEqual({ $set: { steps: [] } })
    expect(res.status).not.toHaveBeenCalled()
  })

  it('rejects a body with neither steps nor policy instead of wiping the workflow', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({}), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toContain('steps')
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty policy object (nothing to store)', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ policy: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('answers 404 for a form that does not exist and never creates an orphan workflow', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [] }, '64b7f0f0f0f0f0f0f0f0ffff'), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('answers 400 (not a crash) for a form id that is not an ObjectId', async () => {
    const castError = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' })
    mockFormTemplate.findById.mockRejectedValue(castError)
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [] }, 'not-an-id'), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確，請檢查後再試' })
  })

  it.each([
    ['a string', 'abc'],
    ['an object', { 0: { approver_type: 'tag' } }],
    ['null', null],
  ])('rejects steps that are %s', async (_label, steps) => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toContain('陣列')
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('names the step in the Chinese error for an unknown approver_type', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'bogus', approver_value: 'x' },
      ],
    }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '第2關：簽核類型「bogus」不正確，請重新選擇', step: 2 })
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('rejects a step without approver_type', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_value: '人資' }] }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].step).toBe(1)
  })

  it('rejects more than 20 steps', async () => {
    const steps = Array.from({ length: 21 }, (_, index) => ({ step_order: index + 1, approver_type: 'manager' }))
    const res = makeRes()

    await setWorkflow(workflowReq({ steps }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toContain('最多 20 關')
  })

  it('accepts exactly 20 steps', async () => {
    const steps = Array.from({ length: 20 }, (_, index) => ({ step_order: index + 1, approver_type: 'manager' }))
    const res = makeRes()

    await setWorkflow(workflowReq({ steps }), res)

    expect(res.status).not.toHaveBeenCalled()
    expect(lastUpdate().update.$set.steps).toHaveLength(20)
  })

  it.each(['galaxy', 'group'])('rejects scope_type %s', async (scope) => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'tag', approver_value: '人資', scope_type: scope }] }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].error).toContain('第1關（標籤）')
    expect(res.json.mock.calls[0][0].error).toContain('範圍')
  })

  it.each(['dept', 'org', 'none'])('accepts scope_type %s and defaults an empty one to none', async (scope) => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [
      { step_order: 1, approver_type: 'tag', approver_value: '人資', scope_type: scope },
      { step_order: 2, approver_type: 'tag', approver_value: '財務覆核', scope_type: '' },
    ] }), res)

    expect(lastUpdate().update.$set.steps.map((step) => step.scope_type)).toEqual([scope, 'none'])
  })

  it('rejects non-boolean flags and keeps booleans as sent', async () => {
    const bad = makeRes()
    await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'manager', is_required: 'yes' }] }), bad)
    expect(bad.status).toHaveBeenCalledWith(400)
    expect(bad.json.mock.calls[0][0].error).toContain('必簽')

    const good = makeRes()
    await setWorkflow(workflowReq({ steps: [
      { step_order: 1, approver_type: 'manager', is_required: false, all_must_approve: false, can_return: false },
    ] }), good)
    expect(lastUpdate().update.$set.steps[0]).toMatchObject({ is_required: false, all_must_approve: false, can_return: false })
  })

  it('drops internal client fields such as __meta and keeps the step name', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [
      { step_order: 1, approver_type: 'manager', __meta: { stepOrder: 1 }, hacker: true, name: ' 直屬主管 ' },
    ] }), res)

    const saved = lastUpdate().update.$set.steps[0]
    expect(saved).not.toHaveProperty('__meta')
    expect(saved).not.toHaveProperty('hacker')
    expect(saved.name).toBe('直屬主管')
  })

  it('renumbers steps 1..n after ordering them by step_order', async () => {
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      { step_order: 1, approver_type: 'tag', approver_value: '財務覆核' },
      { approver_type: 'tag', approver_value: '業務主管' },
    ] }), res)

    const saved = lastUpdate().update.$set.steps
    expect(saved.map((step) => [step.step_order, step.approver_value])).toEqual([
      [1, '財務覆核'], [2, '人資'], [3, '業務主管'],
    ])
  })

  describe('approver values', () => {
    it('normalises tags (NFKC, trim, inner spaces) and rejects empty or oversized ones', async () => {
      const ok = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'tag', approver_value: '  人資　 部 ' }] }), ok)
      expect(lastUpdate().update.$set.steps[0].approver_value).toBe('人資 部')

      const empty = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'tag', approver_value: '   ' }] }), empty)
      expect(empty.status).toHaveBeenCalledWith(400)
      expect(empty.json.mock.calls[0][0].error).toBe('第1關（標籤）：請選擇或輸入簽核標籤')

      const tooLong = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'tag', approver_value: 'x'.repeat(51) }] }), tooLong)
      expect(tooLong.status).toHaveBeenCalledWith(400)
    })

    it('accepts a saved tag nobody holds yet (the tag is never blocked here)', async () => {
      const res = makeRes()

      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'tag', approver_value: '排班負責人' }] }), res)

      expect(res.status).not.toHaveBeenCalled()
      expect(lastUpdate().update.$set.steps[0].approver_value).toBe('排班負責人')
    })

    it('checks that user approvers are valid ids of existing employees and de-duplicates them', async () => {
      const ok = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'user', approver_value: [EMP_A, EMP_B, EMP_A] }] }), ok)
      expect(lastUpdate().update.$set.steps[0].approver_value).toEqual([EMP_A, EMP_B])

      const none = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'user', approver_value: [] }] }), none)
      expect(none.json.mock.calls[0][0].error).toBe('第1關（員工）：請至少選擇一位員工')

      const malformed = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'user', approver_value: ['abc'] }] }), malformed)
      expect(malformed.status).toHaveBeenCalledWith(400)
      expect(malformed.json.mock.calls[0][0].error).toContain('無效的員工資料')

      mockEmployee.find.mockImplementation(() => ({ lean: async () => [{ _id: EMP_A, role: 'employee' }] }))
      const deleted = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'user', approver_value: [EMP_A, EMP_B] }] }), deleted)
      expect(deleted.status).toHaveBeenCalledWith(400)
      expect(deleted.json.mock.calls[0][0]).toEqual({ error: '第1關（員工）：找不到指定的員工，可能已被刪除，請重新選擇', step: 1 })
    })

    it('accepts a single employee id string for a user step', async () => {
      const res = makeRes()

      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'user', approver_value: EMP_A }] }), res)

      expect(lastUpdate().update.$set.steps[0].approver_value).toEqual([EMP_A])
    })

    it('treats a blank manager as the applicant supervisor and verifies a chosen manager is a supervisor', async () => {
      const blank = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'manager', approver_value: '' }] }), blank)
      expect(lastUpdate().update.$set.steps[0].approver_value).toBe('APPLICANT_SUPERVISOR')

      const supervisor = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'manager', approver_value: SUPERVISOR }] }), supervisor)
      expect(lastUpdate().update.$set.steps[0].approver_value).toBe(SUPERVISOR)

      const notSupervisor = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'manager', approver_value: EMP_A }] }), notSupervisor)
      expect(notSupervisor.status).toHaveBeenCalledWith(400)
      expect(notSupervisor.json.mock.calls[0][0].error).toBe('第1關（主管）：指定的人員目前不是主管角色，請重新選擇')

      const garbage = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'manager', approver_value: 'someone' }] }), garbage)
      expect(garbage.status).toHaveBeenCalledWith(400)
    })

    it('does not touch the database for steps that need no employee lookup', async () => {
      await setWorkflow(workflowReq({ steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ] }), makeRes())

      expect(mockEmployee.find).not.toHaveBeenCalled()
    })

    it('accepts system roles and sign-role codes, rejects anything else', async () => {
      const ok = makeRes()
      await setWorkflow(workflowReq({ steps: [
        { step_order: 1, approver_type: 'role', approver_value: 'supervisor' },
        { step_order: 2, approver_type: 'role', approver_value: 'R004' },
      ] }), ok)
      expect(lastUpdate().update.$set.steps.map((step) => step.approver_value)).toEqual(['supervisor', 'R004'])

      const bad = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'role', approver_value: 'R999' }] }), bad)
      expect(bad.status).toHaveBeenCalledWith(400)
      expect(bad.json.mock.calls[0][0].error).toBe('第1關（角色）：「R999」不是有效的角色，請重新選擇')

      const missing = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'role' }] }), missing)
      expect(missing.json.mock.calls[0][0].error).toBe('第1關（角色）：請選擇角色')
    })

    it('accepts sign-level codes only', async () => {
      const ok = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'level', approver_value: 'U003' }] }), ok)
      expect(lastUpdate().update.$set.steps[0].approver_value).toBe('U003')

      const bad = makeRes()
      await setWorkflow(workflowReq({ steps: [{ step_order: 1, approver_type: 'level', approver_value: 'L3' }] }), bad)
      expect(bad.status).toHaveBeenCalledWith(400)
      expect(bad.json.mock.calls[0][0].error).toContain('不是有效的層級')
    })

    it('requires a department id, an organization and group ids', async () => {
      const ok = makeRes()
      await setWorkflow(workflowReq({ steps: [
        { step_order: 1, approver_type: 'department', approver_value: DEPT_ID },
        { step_order: 2, approver_type: 'org', approver_value: 'org-1' },
        { step_order: 3, approver_type: 'group', approver_value: [SUB_DEPT_ID, SUB_DEPT_ID] },
      ] }), ok)
      expect(ok.status).not.toHaveBeenCalled()
      expect(lastUpdate().update.$set.steps.map((step) => step.approver_value)).toEqual([DEPT_ID, 'org-1', [SUB_DEPT_ID]])

      for (const step of [
        { approver_type: 'department', approver_value: '' },
        { approver_type: 'department', approver_value: 'sales' },
        { approver_type: 'org' },
        { approver_type: 'group', approver_value: [] },
        { approver_type: 'group', approver_value: ['x'] },
      ]) {
        const res = makeRes()
        await setWorkflow(workflowReq({ steps: [{ step_order: 1, ...step }] }), res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json.mock.calls[0][0].step).toBe(1)
      }
    })
  })

  describe('policy', () => {
    it.each([
      [{ overdueAction: 'delete-everything' }, '逾時處理方式'],
      [{ maxApprovalLevel: -7 }, '最大簽核關卡數'],
      [{ maxApprovalLevel: 21 }, '最大簽核關卡數'],
      [{ maxApprovalLevel: 2.5 }, '最大簽核關卡數'],
      [{ overdueDays: 0 }, '逾時提醒天數'],
      [{ overdueDays: 400 }, '逾時提醒天數'],
      [{ allowDelegate: 'yes' }, '代理簽核'],
    ])('rejects %j', async (policy, text) => {
      const res = makeRes()

      await setWorkflow(workflowReq({ policy }), res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json.mock.calls[0][0].error).toContain(text)
      expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('stores valid values and ignores unknown policy keys', async () => {
      const res = makeRes()

      await setWorkflow(workflowReq({
        policy: { maxApprovalLevel: 8, allowDelegate: false, overdueDays: 10, overdueAction: 'autoReject', secret: 'x' },
      }), res)

      expect(lastUpdate().update.$set).toEqual({
        'policy.maxApprovalLevel': 8,
        'policy.allowDelegate': false,
        'policy.overdueDays': 10,
        'policy.overdueAction': 'autoReject',
      })
    })

    it('does not enforce maxApprovalLevel against the number of steps (the rule is only recorded)', async () => {
      const res = makeRes()

      await setWorkflow(workflowReq({
        steps: [1, 2, 3].map((n) => ({ step_order: n, approver_type: 'manager' })),
        policy: { maxApprovalLevel: 1 },
      }), res)

      expect(res.status).not.toHaveBeenCalled()
      expect(lastUpdate().update.$set.steps).toHaveLength(3)
    })
  })

  it('maps a Mongoose validation failure to a Chinese message', async () => {
    const validationError = Object.assign(new Error('boom'), {
      name: 'ValidationError',
      errors: { 'steps.0.approver_type': { path: 'approver_type', kind: 'enum' } },
    })
    mockApprovalWorkflow.findOneAndUpdate.mockRejectedValue(validationError)
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [] }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確：「簽核類型」的值不在允許的範圍內' })
  })
})

describe('setWorkflow concurrent upsert', () => {
  it('answers a duplicate-key race on the workflow document with its own Chinese 409 (not the template-name message)', async () => {
    mockApprovalWorkflow.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('E11000 duplicate key error collection: approvalworkflows index: form_1'), { code: 11000 }))
    const res = makeRes()

    await setWorkflow(workflowReq({ steps: [] }), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: '這張表單的流程同時被其他人修改，請重新整理後再試一次' })
  })
})

describe('validateWorkflowSteps', () => {
  it('returns the cleaned and renumbered steps without touching the workflow collection', async () => {
    const result = await validateWorkflowSteps([
      { step_order: 5, approver_type: 'user', approver_value: [EMP_A] },
      { step_order: 3, approver_type: 'tag', approver_value: '人資', scope_type: 'dept' },
    ])

    expect(result.steps.map((step) => [step.step_order, step.approver_type])).toEqual([[1, 'tag'], [2, 'user']])
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('reports the first bad step with its number', async () => {
    const result = await validateWorkflowSteps([
      { approver_type: 'manager' },
      { approver_type: 'tag', approver_value: '' },
      { approver_type: 'nope' },
    ])

    expect(result).toEqual({ error: '第2關（標籤）：請選擇或輸入簽核標籤', step: 2 })
  })
})

describe('sign dictionaries', () => {
  it('returns sign roles list', async () => {
    const res = makeRes()
    await getSignRoles({}, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: 'R001', label: '填報' }),
        expect.objectContaining({ value: 'R007', label: '人資覆核' }),
      ])
    )
  })

  it('returns sign levels list', async () => {
    const res = makeRes()
    await getSignLevels({}, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: 'U001', label: 'L1' }),
        expect.objectContaining({ value: 'U005', label: 'L5' }),
      ])
    )
  })
})
