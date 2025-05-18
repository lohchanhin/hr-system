import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Approval from '../src/views/front/Approval.vue'

describe('Approval.vue', () => {
  it('fetches list on mount', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    mount(Approval)
    expect(window.fetch).toHaveBeenCalledWith('/api/approvals', expect.any(Object))
    window.fetch.mockRestore()
  })
})
