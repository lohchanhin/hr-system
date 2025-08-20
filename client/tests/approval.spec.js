import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Approval from '../src/views/front/Approval.vue'

describe('Approval.vue', () => {
  it('fetches list on mount', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    mount(Approval)
    await flushPromises()
    expect(window.fetch).toHaveBeenCalledWith('/api/approvals/approvals', expect.any(Object))
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
    const wrapper = mount(Approval)
    await flushPromises()
    wrapper.vm.applyState.formId = 'f1'
    window.fetch.mockClear()
    await wrapper.vm.onSelectForm()
    expect(window.fetch).toHaveBeenCalledWith('/api/approvals/forms/f1/fields', undefined)
    expect(window.fetch).toHaveBeenCalledWith('/api/approvals/forms/f1/workflow', undefined)
    expect(window.fetch).toHaveBeenCalledWith('/api/employees', undefined)
    expect(wrapper.vm.workflowSteps[0].approvers).toBe('Alice')
    window.fetch.mockRestore()
  })
})
