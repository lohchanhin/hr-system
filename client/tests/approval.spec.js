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

  it('loads fields for selected form', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const wrapper = mount(Approval)
    wrapper.vm.applyState.formId = 'f1'
    window.fetch.mockClear()
    await wrapper.vm.onSelectForm()
    expect(window.fetch).toHaveBeenCalledWith('/api/approvals/forms/f1/fields', undefined)
    window.fetch.mockRestore()
  })
})
