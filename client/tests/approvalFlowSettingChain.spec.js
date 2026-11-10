import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// 簽核流程設定的新選項（docs/approval-supervisor-chain.md），用真正的 Element Plus 渲染：
// - 簽核類型「主管鏈」：簽到持有某個標籤的主管為止、最多幾級。
// - 請假表單的「適用條件」：請假滿 N 小時／N 日（日曆日）／N 個排班日才需要這一關。
// - 通用流程規則的「略過重複的簽核人」（會生效，自己的儲存按鈕）。
// - 「流程試算」：選表單、員工、請假長度，看實際送出會得到的關卡與簽核人。
// 回應內容照伺服器實際的 JSON 形狀。

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

const NURSE = '64b7f0f0f0f0f0f0f0f0c001'
const DIRECTOR = '64b7f0f0f0f0f0f0f0f0c003'
const VP = '64b7f0f0f0f0f0f0f0f0c004'

const employees = [
  { id: NURSE, name: '護理師甲', username: 'nurse', role: 'employee', signTags: [], department: { id: 'd1', name: '護理部' }, organization: 'org1', displayName: '護理師甲（nurse）' },
  { id: DIRECTOR, name: '主任丙', username: 'director', role: 'supervisor', signTags: ['一般假單決行'], department: { id: 'd0', name: '主任室' }, organization: 'org1', displayName: '主任丙（director）' },
  { id: VP, name: '副院長丁', username: 'vp', role: 'supervisor', signTags: ['長假決行'], department: { id: 'd9', name: '院部' }, organization: 'org9', displayName: '副院長丁（vp）' },
]

const LEAVE_FORM = { _id: 'f-leave', name: '請假', category: '人事', is_active: true, semanticType: 'leave' }
const OVERTIME_FORM = { _id: 'f-ot', name: '加班申請', category: '人事', is_active: true, semanticType: 'overtime' }

const customerWorkflow = () => ({
  _id: 'wf1',
  form: 'f-leave',
  policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none', skipRepeatedApprovers: true },
  steps: [
    { step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行', maxLevels: 5 }, scope_type: 'none', is_required: true, all_must_approve: true, can_return: true, resolved_count: 2 },
    { step_order: 2, approver_type: 'manager_chain', approver_value: { stopAtTag: '長假決行', maxLevels: 5 }, scope_type: 'none', is_required: false, all_must_approve: true, can_return: true, condition: { kind: 'leave_hours_gte', value: 56 }, condition_text: '請假滿 56 小時才需要' },
  ],
})

// GET /api/approvals/forms/f-leave/workflow/trial 的回應（approvalTrialController 的形狀）
const trialBody = () => ({
  form: { id: 'f-leave', name: '請假', isLeave: true, isActive: true },
  applicant: { id: NURSE, name: '護理師甲', employeeId: 'E0008', title: '照顧服務員', supervisor: { id: 'h1', name: '護理長乙', employeeId: 'E0036', title: '副護理長' } },
  leave: { hours: 56, calendarDays: 7, scheduledDays: 7, scheduledNote: '期間沒有班表，以日曆日計算', startDate: '2026-11-23', endDate: '2026-11-29' },
  warnings: [],
  ok: true,
  error: null,
  steps: [
    { step_order: 1, name: '第1級主管', source_position: 1, chain_level: 1, approvers: [{ id: 'h1', name: '護理長乙', employeeId: 'E0036', title: '副護理長' }], all_must_approve: true, is_required: true, can_return: true, fallback_text: '', note: '' },
    { step_order: 2, name: '第2級主管', source_position: 1, chain_level: 2, approvers: [{ id: DIRECTOR, name: '主任丙', employeeId: 'E0013', title: '主任' }], all_must_approve: true, is_required: true, can_return: true, fallback_text: '', note: '' },
    { step_order: 3, name: '第3級主管', source_position: 2, chain_level: 3, approvers: [{ id: VP, name: '副院長丁', employeeId: 'E0083', title: '醫療副院長' }], all_must_approve: true, is_required: false, can_return: true, fallback_text: '', note: '' },
  ],
  workflow: [
    {
      position: 1, label: '主管鏈，到「一般假單決行」為止', name: '', approver_type: 'manager_chain', is_required: true,
      condition_text: '', condition_applies: null, condition_detail: '', included: true, approvers: [], unresolved_reason: '', fallback_text: '', repeated: [], skipped_as_repeat: false,
      chain: { stop_at_tag: '一般假單決行', max_levels: 5, end: 'tag', end_text: '簽到持有停止標籤的主管為止', notes: [], levels: [
        { level: 1, label: '第1級主管', approver: { id: 'h1', name: '護理長乙', employeeId: 'E0036', title: '副護理長' }, repeated: false, stopped_by_tag: false, notes: [] },
        { level: 2, label: '第2級主管', approver: { id: DIRECTOR, name: '主任丙', employeeId: 'E0013', title: '主任' }, repeated: false, stopped_by_tag: true, notes: [] },
      ] },
    },
    {
      position: 2, label: '主管鏈，到「長假決行」為止', name: '', approver_type: 'manager_chain', is_required: false,
      condition_text: '請假滿 56 小時才需要', condition_applies: true, condition_detail: '請假滿 56 小時，本次 56 小時', included: true, approvers: [], unresolved_reason: '', fallback_text: '',
      repeated: [{ id: 'h1', name: '護理長乙', employeeId: 'E0036', title: '副護理長' }, { id: DIRECTOR, name: '主任丙', employeeId: 'E0013', title: '主任' }], skipped_as_repeat: false,
      chain: { stop_at_tag: '長假決行', max_levels: 5, end: 'tag', end_text: '簽到持有停止標籤的主管為止', notes: [], levels: [
        { level: 1, label: '第1級主管', approver: { id: 'h1', name: '護理長乙', employeeId: 'E0036', title: '副護理長' }, repeated: true, stopped_by_tag: false, notes: [] },
        { level: 2, label: '第2級主管', approver: { id: DIRECTOR, name: '主任丙', employeeId: 'E0013', title: '主任' }, repeated: true, stopped_by_tag: false, notes: [] },
        { level: 3, label: '第3級主管', approver: { id: VP, name: '副院長丁', employeeId: 'E0083', title: '醫療副院長' }, repeated: false, stopped_by_tag: true, notes: [] },
      ] },
    },
  ],
  logs: ['第2關（主管鏈，到「長假決行」為止）略過已是前面關卡簽核人的護理長乙（E0036）（第1級主管）、主任丙（E0013）（第2級主管）'],
})

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

let workflows
let forms
let trialResponse

beforeEach(() => {
  forms = [LEAVE_FORM, OVERTIME_FORM]
  workflows = {
    'f-leave': customerWorkflow(),
    'f-ot': { _id: 'wf2', form: 'f-ot', policy: {}, steps: [
      { step_order: 1, approver_type: 'manager_chain', approver_value: { maxLevels: 2 }, scope_type: 'none', condition: { kind: 'leave_hours_gte', value: 8 } },
      { step_order: 2, approver_type: 'tag', approver_value: '人資', scope_type: 'none' },
    ] },
  }
  trialResponse = () => json(trialBody())
  apiFetch.mockReset()
  apiFetch.mockImplementation((url, opts) => {
    const method = opts?.method || 'GET'
    if (method !== 'GET') return Promise.resolve(json({ ok: true }))
    if (String(url).startsWith('/api/approvals/forms/f-leave/workflow/trial')) return Promise.resolve(trialResponse(url))
    const workflowMatch = /^\/api\/approvals\/forms\/([^/]+)\/workflow$/.exec(url)
    if (workflowMatch) return Promise.resolve(json(workflows[workflowMatch[1]]))
    switch (url) {
      case '/api/approvals/forms': return Promise.resolve(json(forms))
      case '/api/employees/options': return Promise.resolve(json(employees))
      case '/api/employees/sign-tags': return Promise.resolve(json({ tags: [{ name: '一般假單決行', count: 8, requiredByWorkflows: 0 }, { name: '長假決行', count: 2, requiredByWorkflows: 0 }] }))
      case '/api/approvals/sign-roles': return Promise.resolve(json([]))
      case '/api/approvals/sign-levels': return Promise.resolve(json([]))
      case '/api/departments': return Promise.resolve(json([]))
      case '/api/organizations': return Promise.resolve(json([]))
      case '/api/sub-departments': return Promise.resolve(json([]))
      case '/api/other-control-settings': return Promise.resolve(json({ customFields: [] }))
      case '/api/other-control-settings/item-settings': return Promise.resolve(json({}))
      case '/api/other-control-settings/form-categories': return Promise.resolve(json([{ id: 'c1', name: '人事', code: '人事' }]))
      case '/api/approvals/top-level-approvers': return Promise.resolve(json({ ids: [], approvers: [], admins: [], maxCount: 50 }))
      default: return Promise.resolve(json({}, 404))
    }
  })
  vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const workflowPuts = (formId) => apiFetch.mock.calls
  .filter(([url, opts]) => url === `/api/approvals/forms/${formId}/workflow` && opts?.method === 'PUT')
  .map(([, opts]) => JSON.parse(opts.body))

async function mountPage() {
  const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

async function openDialog(wrapper, form) {
  await wrapper.vm.openWorkflowDialog(form)
  await flushPromises()
}

describe('主管鏈與適用條件：請假表單', () => {
  // 2026/11：關卡改成一關一張卡片，「適用條件」是請假表單每張卡片裡的一行（以前是表格的一欄）
  it('opens the customer workflow with its chain settings and conditions, and shows the 適用條件 line on every step', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)

    expect(wrapper.vm.workflowSteps.map(step => [step.approver_type, step.approver_value, step.condition])).toEqual([
      ['manager_chain', { stopAtTag: '一般假單決行', maxLevels: 5 }, { kind: '', value: null }],
      ['manager_chain', { stopAtTag: '長假決行', maxLevels: 5 }, { kind: 'leave_hours_gte', value: 56 }],
    ])
    const conditions = wrapper.findAll('[data-test="step-card"] [data-test="step-condition"]')
    expect(conditions).toHaveLength(2)
    expect(conditions[0].text()).toContain('適用條件')
    expect(conditions[0].text()).toContain('每張申請都要過這一關')
    expect(conditions[1].text()).toContain('小時才需要這一關')
    expect(wrapper.findAll('[data-test="chain-config"]')).toHaveLength(2)
    // 主管鏈每一級只有一位主管：不顯示「全部都要簽／任一人簽即可」
    expect(wrapper.findAll('[data-test="step-all-must"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('目前 8 位主管持有此標籤')
    expect(wrapper.text()).toContain('目前 2 位主管持有此標籤')
    expect(wrapper.vm.tagOptions.map(tag => tag.value)).toEqual(expect.arrayContaining(['一般假單決行', '長假決行']))
  })

  it('saves the chain as { stopAtTag, maxLevels } and the condition only where one is chosen', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)
    wrapper.vm.workflowSteps[0].approver_value.maxLevels = 3

    await wrapper.vm.saveWorkflow()
    await flushPromises()

    const [body] = workflowPuts('f-leave')
    expect(Object.keys(body)).toEqual(['steps'])
    expect(body.steps[0]).toMatchObject({ step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行', maxLevels: 3 }, scope_type: 'none' })
    expect(body.steps[0]).not.toHaveProperty('condition')
    expect(body.steps[1]).toMatchObject({ step_order: 2, is_required: false, condition: { kind: 'leave_hours_gte', value: 56 } })
    expect(body.steps.every(step => !('__meta' in step))).toBe(true)
  })

  it('turns a step into a chain with the defaults, and drops an empty stop tag from the payload', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)
    wrapper.vm.addStep()
    const added = wrapper.vm.workflowSteps[2]
    added.approver_type = 'manager_chain'
    wrapper.vm.handleApproverTypeChange(added)
    expect(wrapper.vm.workflowSteps[2].approver_value).toEqual({ stopAtTag: '', maxLevels: 5 })

    await wrapper.vm.saveWorkflow()
    await flushPromises()
    expect(workflowPuts('f-leave')[0].steps[2].approver_value).toEqual({ maxLevels: 5 })
  })

  it('suggests 7 days when the condition is switched to calendar days, and clears the value with the kind', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)
    const row = wrapper.vm.workflowSteps[1]

    row.condition.kind = 'leave_calendar_days_gte'
    wrapper.vm.handleConditionKindChange(row)
    expect(row.condition).toEqual({ kind: 'leave_calendar_days_gte', value: 7 })

    row.condition.kind = ''
    wrapper.vm.handleConditionKindChange(row)
    expect(row.condition).toEqual({ kind: '', value: null })
  })

  it('refuses to save when every step has a condition', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)
    wrapper.vm.workflowSteps[0].condition = { kind: 'leave_hours_gte', value: 8 }

    await wrapper.vm.saveWorkflow()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('每一關都設定了請假長度條件：至少要有一關沒有條件，不然未達條件的假單會沒有人簽核')
    expect(workflowPuts('f-leave')).toEqual([])
  })
})

describe('不是請假表單', () => {
  it('has no 適用條件 line and removes a stored condition on save, after asking', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, OVERTIME_FORM)

    expect(wrapper.findAll('[data-test="step-card"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-test="step-condition"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="steps-pane"]').text()).not.toContain('適用條件')

    await wrapper.vm.saveWorkflow()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    const confirmText = JSON.stringify(ElMessageBox.confirm.mock.calls[0][0].children)
    expect(confirmText).toContain('這張表單不是請假表單，儲存時會移除這一關的請假長度條件')
    const [body] = workflowPuts('f-ot')
    expect(body.steps[0]).toMatchObject({ approver_type: 'manager_chain', approver_value: { maxLevels: 2 } })
    expect(body.steps[0]).not.toHaveProperty('condition')
  })
})

// 2026/11：「略過重複的簽核人」是每張表單自己的規則，放在那張表單的「簽核關卡」底下，切換後立即儲存
// （以前在「通用流程規則」分頁，跟著頁面上方選的表單樣板，另有一顆儲存按鈕）
describe('這張表單的流程規則：略過重複的簽核人', () => {
  it('reads the switch of the form being edited and saves only that field', async () => {
    const wrapper = await mountPage()
    // 沒有開啟表單時不預選任何表單，也沒有開關
    expect(wrapper.vm.selectedFormId).toBe('')
    expect(wrapper.find('[data-test="skip-repeated"]').exists()).toBe(false)

    await openDialog(wrapper, LEAVE_FORM)
    expect(wrapper.vm.selectedFormId).toBe('f-leave')
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)
    expect(wrapper.find('[data-test="skip-repeated"]').text()).toContain('主管鏈')

    wrapper.vm.skipRepeatedApprovers = false
    await wrapper.vm.saveSkipRepeated()
    await flushPromises()

    expect(workflowPuts('f-leave')).toEqual([{ policy: { skipRepeatedApprovers: false } }])
    expect(ElMessage.success).toHaveBeenCalledWith('已關閉：每一關照設定簽核（主管鏈仍會略過重複的主管）')
  })

  it('starts from off for a form whose workflow has no such setting', async () => {
    const wrapper = await mountPage()
    wrapper.vm.selectedFormId = 'f-ot'
    await flushPromises()
    expect(wrapper.vm.skipRepeatedApprovers).toBe(false)
  })

  it('puts the switch back and tells the admin when the server refuses the change', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)
    const base = apiFetch.getMockImplementation()
    apiFetch.mockImplementation((url, opts) => (
      opts?.method === 'PUT' ? Promise.resolve(json({ error: '這張表單的流程同時被其他人修改，請重新整理後再試一次' }, 409)) : base(url, opts)
    ))

    wrapper.vm.skipRepeatedApprovers = false
    await wrapper.vm.saveSkipRepeated()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('儲存「略過重複的簽核人」失敗：這張表單的流程同時被其他人修改，請重新整理後再試一次')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)
  })
})

describe('流程試算', () => {
  // 2026/11：試算不再預選「頁面上方選的表單樣板」（已經沒有那個選單）；從表單清單或表單設定按「流程試算」會帶入那張表單
  async function openTrial() {
    const wrapper = await mountPage()
    wrapper.vm.openTrialFor(LEAVE_FORM)
    await flushPromises()
    expect(wrapper.vm.activeTab).toBe('trial')
    return wrapper
  }

  it('starts without a form when opened on its own, and takes the form being edited when there is one', async () => {
    const wrapper = await mountPage()
    wrapper.vm.activeTab = 'trial'
    await flushPromises()
    expect(wrapper.vm.trial.formId).toBe('')

    wrapper.vm.activeTab = 'approvalLevels'
    await openDialog(wrapper, OVERTIME_FORM)
    wrapper.vm.activeTab = 'trial'
    await flushPromises()
    expect(wrapper.vm.trial.formId).toBe('f-ot')
  })

  it('clears a previous result when another form or employee is chosen, and warns that unsaved steps are not part of the trial', async () => {
    const wrapper = await mountPage()
    await openDialog(wrapper, LEAVE_FORM)
    wrapper.vm.openTrialFor(LEAVE_FORM)
    await flushPromises()
    expect(wrapper.find('[data-test="trial-unsaved-hint"]').exists()).toBe(false)
    Object.assign(wrapper.vm.trial, { employeeId: NURSE, start: '2026-11-23' })
    await wrapper.vm.runTrial()
    await flushPromises()
    expect(wrapper.vm.trial.result).not.toBeNull()

    wrapper.vm.trial.employeeId = 'someone-else'
    await flushPromises()
    expect(wrapper.vm.trial.result).toBeNull()

    wrapper.vm.workflowSteps[0].approver_value.maxLevels = 2
    await flushPromises()
    expect(wrapper.find('[data-test="trial-unsaved-hint"]').text()).toContain('試算用的是已儲存的關卡')
  })

  it('asks the server with the employee and the leave length, and shows the chain with names', async () => {
    const wrapper = await openTrial()
    expect(wrapper.vm.trial.formId).toBe('f-leave')
    expect(wrapper.vm.trialEmployeeOptions.map(option => option.label)).toContain('護理師甲（nurse）・護理部')
    Object.assign(wrapper.vm.trial, { employeeId: NURSE, start: '2026-11-23', end: '2026-11-29', hours: 56 })

    await wrapper.vm.runTrial()
    await flushPromises()

    const trialCall = apiFetch.mock.calls.find(([url]) => String(url).startsWith('/api/approvals/forms/f-leave/workflow/trial'))
    expect(trialCall[0]).toBe(`/api/approvals/forms/f-leave/workflow/trial?employee=${NURSE}&start=2026-11-23&end=2026-11-29&hours=56`)
    expect(wrapper.find('[data-test="trial-summary"]').text())
      .toBe('護理師甲（E0008）（直屬主管：護理長乙（E0036））；請假 56 小時、7 個日曆日、7 個排班日（期間沒有班表，以日曆日計算）；送出後共 3 關')
    const rows = wrapper.findAll('[data-test="trial-steps"] .el-table__body tr').map(row => row.text())
    expect(rows[0]).toContain('第 1 關・第1級主管')
    expect(rows[0]).toContain('護理長乙（E0036）')
    expect(rows[2]).toContain('第 3 關・第3級主管')
    expect(rows[2]).toContain('副院長丁（E0083）')
    expect(wrapper.vm.trialTraceLines).toEqual([
      '第1關（主管鏈，到「一般假單決行」為止）：第1級主管 護理長乙（E0036） → 第2級主管 主任丙（E0013）；簽到持有停止標籤的主管為止',
      '第2關（主管鏈，到「長假決行」為止）：請假滿 56 小時才需要：適用（請假滿 56 小時，本次 56 小時）；'
        + '第1級主管 護理長乙（E0036）（已是前面關卡的簽核人，略過） → 第2級主管 主任丙（E0013）（已是前面關卡的簽核人，略過） → 第3級主管 副院長丁（E0083）；簽到持有停止標籤的主管為止',
    ])
    expect(wrapper.find('[data-test="trial-logs"]').text()).toContain('略過已是前面關卡簽核人的護理長乙（E0036）')
  })

  it('shows why a real submission would fail, and a refused request', async () => {
    const wrapper = await openTrial()
    Object.assign(wrapper.vm.trial, { employeeId: NURSE, start: '2026-11-23' })
    trialResponse = () => json({ ...trialBody(), ok: false, error: { message: '【請假】第1關（主管鏈，到「一般假單決行」為止）找不到可簽核的人員：申請人尚未設定直屬主管，請聯絡管理員設定', code: 'REQUIRED_APPROVER_MISSING', step: 1 }, steps: [] })
    await wrapper.vm.runTrial()
    await flushPromises()
    expect(wrapper.find('[data-test="trial-build-error"]').text()).toContain('實際送出會失敗：【請假】第1關')
    expect(wrapper.vm.trialSummary).toContain('實際送出會失敗')

    trialResponse = () => json({ error: '結束日期不可早於開始日期' }, 400)
    await wrapper.vm.runTrial()
    await flushPromises()
    expect(wrapper.vm.trial.result).toBeNull()
    expect(wrapper.find('[data-test="trial-request-error"]').text()).toBe('試算失敗：結束日期不可早於開始日期')
  })

  it('asks for the start date when only the end date is chosen, without calling the server', async () => {
    const wrapper = await openTrial()
    Object.assign(wrapper.vm.trial, { employeeId: NURSE, start: '', end: '2026-11-29' })

    await wrapper.vm.runTrial()
    await flushPromises()

    expect(apiFetch.mock.calls.some(([url]) => String(url).includes('/workflow/trial'))).toBe(false)
    expect(wrapper.vm.trial.error).toBe('請先選開始日期（同一天的請假可以只選開始日期）')
  })

  it('does not send leave dates for a form that is not a leave form', async () => {
    const wrapper = await openTrial()
    Object.assign(wrapper.vm.trial, { formId: 'f-ot', employeeId: NURSE, start: '2026-11-23', hours: 8 })
    await wrapper.vm.runTrial()
    await flushPromises()
    const call = apiFetch.mock.calls.find(([url]) => String(url).startsWith('/api/approvals/forms/f-ot/workflow/trial'))
    expect(call[0]).toBe(`/api/approvals/forms/f-ot/workflow/trial?employee=${NURSE}`)
  })
})
