import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

const employees = [{ id: 'e1', name: 'Alice' }]
const workflowData = { steps: [{ step_order: 1, approver_type: 'user', approver_value: ['e1'] }] }

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'
global.ElMessage = { success: vi.fn() }

apiFetch.mockImplementation((url, opts) => {
  if (url === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => [] })
  if (url === '/api/employees/options') return Promise.resolve({ ok: true, json: async () => employees })
  if (url === '/api/roles') return Promise.resolve({ ok: true, json: async () => [] })
  if (url === '/api/approvals/forms/f1/workflow' && !opts) return Promise.resolve({ ok: true, json: async () => workflowData })
  if (url === '/api/approvals/forms/f1/workflow' && opts?.method === 'PUT') return Promise.resolve({ ok: true })
  return Promise.resolve({ ok: true, json: async () => ({}) })
})

describe('ApprovalFlowSetting approver select', () => {
  it('renders Chinese headers in workflow dialog', async () => {
    const wrapper = mount(ApprovalFlowSetting, {
      global: { plugins: [ElementPlus], stubs: { teleport: true } }
    })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    const headers = wrapper
      .findAll('.el-dialog .el-table th .cell')
      .map(h => h.text())
    expect(headers).toContain('簽核類型')
    expect(headers).toContain('簽核對象')
    expect(headers).toContain('範圍')
  })

  it('loads options and saves selected id', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees/options')
    expect(wrapper.vm.employeeOptions).toEqual(employees)
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
    expect(option.props('label')).toBe('Alice')
    wrapper.vm.workflowSteps[0].approver_value = ['e1']
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.saveWorkflow()
    const call = apiFetch.mock.calls.filter(c => c[0] === '/api/approvals/forms/f1/workflow' && c[1]?.method === 'PUT').pop()
    const body = JSON.parse(call[1].body)
    expect(body.steps[0].approver_value).toEqual(['e1'])
  })
})
