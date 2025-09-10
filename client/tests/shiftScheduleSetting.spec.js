import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('ShiftScheduleSetting.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render removed tabs', () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    expect(wrapper.text()).not.toContain('部門排班規則')
    expect(wrapper.text()).not.toContain('中場休息設定')
  })

  it('does not fetch department managers', () => {
    mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    const calls = apiFetch.mock.calls
    expect(calls.find(c => c[0] === '/api/dept-managers')).toBeFalsy()
  })
})
