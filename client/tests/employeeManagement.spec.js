import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('EmployeeManagement.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters departments by organization', async () => {
    const wrapper = mount(EmployeeManagement, { global: { plugins: [ElementPlus] } })
    wrapper.vm.departmentList = [
      { _id: 'd1', name: 'D1', organization: 'o1' },
      { _id: 'd2', name: 'D2', organization: 'o2' }
    ]
    wrapper.vm.employeeForm.institution = 'o1'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredDepartments.length).toBe(1)
    expect(wrapper.vm.filteredDepartments[0]._id).toBe('d1')
  })

  it('filters supervisor list by selected institution and department', async () => {
    const wrapper = mount(EmployeeManagement, { global: { plugins: [ElementPlus] } })
    wrapper.vm.employeeForm.institution = 'o1'
    wrapper.vm.employeeForm.department = 'd1'
    wrapper.vm.employeeList = [
      { _id: 's1', name: 'SupA', role: 'supervisor', institution: 'o1', department: 'd1' },
      { _id: 's2', name: 'SupB', role: 'supervisor', institution: 'o2', department: 'd2' }
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.supervisorList.length).toBe(1)
    expect(wrapper.vm.supervisorList[0]._id).toBe('s1')
  })
})
