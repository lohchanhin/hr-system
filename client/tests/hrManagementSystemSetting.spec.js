import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import HRManagementSystemSetting from '../src/components/backComponents/HRManagementSystemSetting.vue'
import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'

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
    const emp = wrapper.findComponent(EmployeeManagement)
    expect(emp.vm.employeeDialogVisible).toBe(false)
    const button = wrapper.findAll('button').find(b => b.text() === '新增員工')
    await button.trigger('click')
    expect(emp.vm.employeeDialogVisible).toBe(true)
  })

  it('adds and removes experience rows', async () => {
    const wrapper = mount(HRManagementSystemSetting, {
      global: { plugins: [ElementPlus] }
    })
    const emp = wrapper.findComponent(EmployeeManagement)
    emp.vm.addExperience()
    expect(emp.vm.employeeForm.experiences.length).toBe(1)
    emp.vm.removeExperience(0)
    expect(emp.vm.employeeForm.experiences.length).toBe(0)
  })

  it('shows organization select when dialog open', async () => {
    const wrapper = mount(HRManagementSystemSetting, {
      global: { plugins: [ElementPlus] }
    })
    const emp = wrapper.findComponent(EmployeeManagement)
    emp.vm.orgList = [{ _id: '1', name: 'Org1' }]
    const button = wrapper.findAll('button').find(b => b.text() === '新增員工')
    await button.trigger('click')
    emp.vm.employeeDialogTab = 'employment'
    await emp.vm.$nextTick()
    expect(wrapper.html()).toContain('Org1')
  })
})
