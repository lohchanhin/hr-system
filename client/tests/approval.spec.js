import { describe, it, expect, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import Approval from '../src/views/front/Approval.vue'

const stubs = [
  'el-option','el-select','el-button','el-form-item','el-divider','el-input',
  'el-input-number','el-checkbox','el-checkbox-group','el-date-picker',
  'el-time-picker','el-upload','el-form','el-tab-pane','el-table-column',
  'el-tag','el-table','el-tabs','el-descriptions-item','el-descriptions',
  'el-timeline-item','el-timeline','el-dialog'
]

describe('Approval.vue', () => {
  it('fetches list on mount', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/approvals'), expect.any(Object))
    window.fetch.mockRestore()
  })

  it('loads fields and workflow for selected form', async () => {
    let employeeCall = 0
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/forms/f1/fields')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/forms/f1/workflow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ steps: [{ approver_type: 'user', approver_value: ['u1'] }] })
        })
      }
      if (url.includes('/employees')) {
        employeeCall++
        if (employeeCall === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ _id: 'u1', name: 'Alice' }]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    wrapper.vm.applyState.formId = 'f1'
    window.fetch.mockClear()
    await wrapper.vm.onSelectForm()
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/approvals/forms/f1/fields'), expect.any(Object))
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/approvals/forms/f1/workflow'), expect.any(Object))
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/employees'), expect.any(Object))
    expect(wrapper.vm.workflowSteps[0].approvers).toBe('Alice')
    window.fetch.mockRestore()
  })
})
