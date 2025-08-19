import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

const employees = [{ _id: 'e1', name: 'Alice', title: 'Manager' }]
const workflowData = { steps: [{ step_order: 1, approver_type: 'user', approver_value: 'e1' }] }

const apiFetch = vi.fn((url, opts) => {
  if (url === '/api/forms') return Promise.resolve({ ok: true, json: async () => [] })
  if (url === '/api/employees/options') return Promise.resolve({ ok: true, json: async () => employees })
  if (url === '/api/roles') return Promise.resolve({ ok: true, json: async () => [] })
  if (url === '/api/forms/f1/workflow' && !opts) return Promise.resolve({ ok: true, json: async () => workflowData })
  if (url === '/api/forms/f1/workflow' && opts?.method === 'PUT') return Promise.resolve({ ok: true })
  return Promise.resolve({ ok: true, json: async () => ({}) })
})

vi.mock('../src/api', () => ({ apiFetch }))

describe('ApprovalFlowSetting approver select', () => {
  it('loads options and saves selected id', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees/options')
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()
    expect(wrapper.vm.workflowSteps[0].approver_value).toBe('e1')
    wrapper.vm.workflowSteps[0].approver_value = 'e1'
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.saveWorkflow()
    const call = apiFetch.mock.calls.find(c => c[0] === '/api/forms/f1/workflow' && c[1]?.method === 'PUT')
    const body = JSON.parse(call[1].body)
    expect(body.steps[0].approver_value).toBe('e1')
  })
})
