import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import HRManagementSystemSetting from '../src/components/backComponents/HRManagementSystemSetting.vue'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('HRManagementSystemSetting.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toggles employee dialog when clicking 新增員工', async () => {
    const wrapper = mount(HRManagementSystemSetting, {
      global: { plugins: [ElementPlus] }
    })
    expect(wrapper.vm.employeeDialogVisible).toBe(false)
    const button = wrapper.findAll('button').find(b => b.text() === '新增員工')
    await button.trigger('click')
    expect(wrapper.vm.employeeDialogVisible).toBe(true)
  })

  it('adds and removes experience rows', async () => {
    const wrapper = mount(HRManagementSystemSetting, {
      global: { plugins: [ElementPlus] }
    })
    wrapper.vm.addExperience()
    expect(wrapper.vm.employeeForm.experiences.length).toBe(1)
    wrapper.vm.removeExperience(0)
    expect(wrapper.vm.employeeForm.experiences.length).toBe(0)
  })
})
