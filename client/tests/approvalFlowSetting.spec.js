import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

const employees = [
  {
    id: 'e1',
    name: 'Alice',
    username: 'alice',
    signRole: 'R003',
    signLevel: 'U002',
    signTags: ['人資'],
    organization: 'org1',
    department: { id: 'd1', name: '人資部' },
    role: 'supervisor',
    displayName: 'Alice（alice）',
  },
  {
    id: 'e2',
    name: 'Bob',
    username: 'bob',
    signRole: 'R002',
    signLevel: 'U001',
    signTags: ['業務'],
    organization: { id: 'org2' },
    department: { id: 'd2', name: '業務部' },
    role: 'employee',
    displayName: 'Bob（bob）',
  },
]
const organizations = [
  { _id: 'org1', name: '台北總部' },
  { _id: 'org2', name: '新竹園區' },
]
const workflowData = { steps: [{ step_order: 1, approver_type: 'user', approver_value: ['e1'] }] }
const customFields = [
  { fieldKey: 'custom_phone', label: '緊急聯絡電話', type: 'text', required: true, placeholder: '請輸入電話' }
]
const signRoles = [
  { value: 'R001', label: '填報' },
  { value: 'R002', label: '覆核' },
  { value: 'R003', label: '審核' },
]
const signLevels = [
  { value: 'U001', label: 'L1' },
  { value: 'U002', label: 'L2' },
]
const SUB_DEPT_ID_1 = '507f1f77bcf86cd799439011'
const SUB_DEPT_ID_2 = '507f1f77bcf86cd799439012'
const subDepartments = [
  { _id: SUB_DEPT_ID_1, name: '人資一組', department: { name: '人資部' } },
  { _id: SUB_DEPT_ID_2, name: '人資二組', department: { name: '人資部' } },
]

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'
global.ElMessage = { success: vi.fn(), error: vi.fn() }

beforeEach(() => {
  apiFetch.mockClear()
  global.ElMessage = { success: vi.fn(), error: vi.fn() }
})

apiFetch.mockImplementation((url, opts) => {
  if (url === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => [] })
  if (url === '/api/employees/options') return Promise.resolve({ ok: true, json: async () => employees })
  if (url === '/api/approvals/sign-roles') return Promise.resolve({ ok: true, json: async () => signRoles })
  if (url === '/api/approvals/sign-levels') return Promise.resolve({ ok: true, json: async () => signLevels })
  if (url === '/api/sub-departments') return Promise.resolve({ ok: true, json: async () => subDepartments })
  if (url === '/api/other-control-settings') return Promise.resolve({ ok: true, json: async () => ({ customFields }) })
  if (url === '/api/organizations') return Promise.resolve({ ok: true, json: async () => organizations })
  if (url === '/api/approvals/forms/f1/workflow' && !opts) return Promise.resolve({ ok: true, json: async () => workflowData })
  if (url === '/api/approvals/forms/f1/workflow' && opts?.method === 'PUT') return Promise.resolve({ ok: true })
  return Promise.resolve({ ok: true, json: async () => ({}) })
})

describe('ApprovalFlowSetting approver select', () => {
  it('renders Chinese headers in workflow dialog', async () => {
    const wrapper = mount(ApprovalFlowSetting, {
      global: { plugins: [ElementPlus] }
    })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    expect(wrapper.vm.workflowDialogVisible).toBe(true)
    const columns = wrapper.findAllComponents({ name: 'ElTableColumn' })
    const labels = columns.map(col => col.props('label'))
    expect(labels).toContain('簽核類型')
    expect(labels).toContain('簽核對象')
    expect(labels).toContain('範圍')
  })

  it('loads options and saves selected id', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/sub-departments')
    expect(apiFetch).toHaveBeenCalledWith('/api/employees/options')
    expect(apiFetch).toHaveBeenCalledWith('/api/organizations')
    expect(apiFetch).toHaveBeenCalledWith('/api/approvals/sign-roles')
    expect(apiFetch).toHaveBeenCalledWith('/api/approvals/sign-levels')
    expect(wrapper.vm.employeeOptions[0]).toMatchObject({ id: 'e1', username: 'alice', displayName: 'Alice（alice）' })
    expect(wrapper.vm.employeeOptions[0].organization).toEqual({ id: 'org1', name: '台北總部' })
    expect(wrapper.vm.userApproverOptions[0]).toEqual({ value: 'e1', label: 'Alice（alice）' })
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    expect(wrapper.vm.workflowSteps[0].approver_value).toEqual(['e1'])
    wrapper.vm.workflowSteps[0].approver_value = ['e1']
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.saveWorkflow()
    const call = apiFetch.mock.calls.filter(c => c[0] === '/api/approvals/forms/f1/workflow' && c[1]?.method === 'PUT').pop()
    const body = JSON.parse(call[1].body)
    expect(body.steps[0].approver_value).toEqual(['e1'])
  })

  it('adds step with default user type and saves array', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    wrapper.vm.addStep()
    expect(wrapper.vm.workflowSteps[1].approver_type).toBe('user')
    wrapper.vm.workflowSteps[1].approver_value = ['e1']
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.saveWorkflow()
    const call = apiFetch.mock.calls.filter(c => c[0] === '/api/approvals/forms/f1/workflow' && c[1]?.method === 'PUT').pop()
    const body = JSON.parse(call[1].body)
    expect(body.steps[1].approver_value).toEqual(['e1'])
  })

  it('selects named employee and saves workflow', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    const option = wrapper.findAllComponents({ name: 'ElOption' }).find(o => o.props('value') === 'e1')
    expect(option.props('label')).toBe('Alice（alice）')
    wrapper.vm.workflowSteps[0].approver_value = ['e1']
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.saveWorkflow()
    const call = apiFetch.mock.calls.filter(c => c[0] === '/api/approvals/forms/f1/workflow' && c[1]?.method === 'PUT').pop()
    const body = JSON.parse(call[1].body)
    expect(body.steps[0].approver_value).toEqual(['e1'])
  })

  it('derives selectable lists from employees with帳號', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(new Set(wrapper.vm.tagOptions.map((opt) => opt.value))).toEqual(new Set(['人資', '業務']))
    expect(wrapper.vm.managerApproverOptions.map((opt) => opt.value)).toEqual(['APPLICANT_SUPERVISOR', 'e1'])
    expect(new Set(wrapper.vm.departmentOptions.map((opt) => opt.value))).toEqual(new Set(['d1', 'd2']))
    expect(wrapper.vm.organizationOptions).toEqual([
      { value: 'org1', label: '台北總部' },
      { value: 'org2', label: '新竹園區' },
    ])
    expect(wrapper.vm.departmentOptions).toEqual([
      { value: 'd1', label: '人資部' },
      { value: 'd2', label: '業務部' },
    ])
    expect(wrapper.vm.managerApproverOptions[0]).toEqual({ value: 'APPLICANT_SUPERVISOR', label: '申請者的主管' })
    expect(wrapper.vm.groupOptions.map((opt) => opt.value)).toEqual([SUB_DEPT_ID_1, SUB_DEPT_ID_2])
  })

  it('顯示機構名稱作為選項標籤', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    const step = wrapper.vm.workflowSteps[0]
    step.approver_type = 'org'
    wrapper.vm.handleApproverTypeChange(step)
    await flushPromises()
    const orgOptions = wrapper.vm.organizationOptions
    expect(orgOptions).toEqual([
      { value: 'org1', label: '台北總部' },
      { value: 'org2', label: '新竹園區' },
    ])
  })

  it('normalizes group selections and saves ids', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    const step = wrapper.vm.workflowSteps[0]
    step.approver_type = 'group'
    wrapper.vm.handleApproverTypeChange(step)
    step.approver_value = [SUB_DEPT_ID_1, SUB_DEPT_ID_2]
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.saveWorkflow()
    const call = apiFetch.mock.calls.filter(
      (c) => c[0] === '/api/approvals/forms/f1/workflow' && c[1]?.method === 'PUT'
    ).pop()
    const body = JSON.parse(call[1].body)
    expect(body.steps[0].approver_value).toEqual([SUB_DEPT_ID_1, SUB_DEPT_ID_2])
  })

  it('移除簽核對象時顯示錯誤並阻止送出', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()

    wrapper.vm.selectedFormId = 'f1'
    wrapper.vm.workflowSteps[0].approver_value = []

    await wrapper.vm.saveWorkflow()

    const putCalls = apiFetch.mock.calls.filter(
      ([url, opts]) => url === '/api/approvals/forms/f1/workflow' && opts?.method === 'PUT'
    )

    expect(global.ElMessage.error).toHaveBeenCalledTimes(1)
    expect(global.ElMessage.error.mock.calls[0][0]).toContain('第1關')
    expect(putCalls.length).toBe(0)
    expect(global.ElMessage.success).not.toHaveBeenCalled()
  })

  it('normalizes role selections using sign role dictionary', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    const step = wrapper.vm.workflowSteps[0]
    step.approver_type = 'role'
    step.approver_value = 'R999'
    wrapper.vm.handleApproverTypeChange(step)
    expect(step.approver_value).toBe('')
    step.approver_value = 'R003'
    wrapper.vm.handleApproverTypeChange(step)
    expect(step.approver_value).toBe('R003')
  })

  it('keeps applicant supervisor option while allowing manual manager selection', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()

    const step = wrapper.vm.workflowSteps[0]
    step.approver_type = 'manager'
    step.approver_value = 'APPLICANT_SUPERVISOR'
    wrapper.vm.handleApproverTypeChange(step)
    expect(step.approver_value).toBe('APPLICANT_SUPERVISOR')

    step.approver_value = 'e1'
    wrapper.vm.handleApproverTypeChange(step)
    expect(step.approver_value).toBe('e1')
  })

  it('offers custom field options and fills dialog after selection', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/other-control-settings')

    wrapper.vm.openFieldDialog()
    await flushPromises()

    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((s) => s.props('placeholder') === '選擇自訂欄位')
    expect(select).toBeTruthy()
    const option = wrapper.findAllComponents({ name: 'ElOption' }).find((o) => o.props('value') === customFields[0].fieldKey)
    expect(option?.props('label')).toContain(customFields[0].label)

    wrapper.vm.handleCustomFieldSelect(customFields[0].fieldKey)
    await flushPromises()

    expect(wrapper.vm.fieldDialog.field_key).toBe(customFields[0].fieldKey)
    expect(wrapper.vm.fieldDialog.label).toBe(customFields[0].label)
    expect(wrapper.vm.fieldDialog.type_1).toBe(customFields[0].type)
    expect(wrapper.vm.fieldDialog.required).toBe(true)
    expect(wrapper.vm.fieldDialog.placeholder).toBe(customFields[0].placeholder)
  })
})
