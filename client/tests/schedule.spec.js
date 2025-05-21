import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import Schedule from '../src/views/front/Schedule.vue'

describe('Schedule.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
    localStorage.setItem('token', 'tok')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('fetches units and employees on mount', () => {
    mount(Schedule, { global: { plugins: [ElementPlus] } })
    expect(fetch).toHaveBeenCalledWith('/api/departments', expect.any(Object))
    expect(fetch).toHaveBeenCalledWith('/api/employees', expect.any(Object))
  })

  it('posts schedule when assigning shift', async () => {
    const wrapper = mount(Schedule, { global: { plugins: [ElementPlus] } })
    wrapper.vm.selectedEmployee = 'e1'
    fetch.mockClear()
    await wrapper.vm.assignShift({ day: '2023-01-01' })
    expect(fetch).toHaveBeenCalledWith('/api/schedules', expect.objectContaining({ method: 'POST' }))
  })
})
