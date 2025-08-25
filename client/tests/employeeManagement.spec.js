import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'
import { apiFetch } from '../src/api'

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
    wrapper.vm.employeeForm.organization = 'o1'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredDepartments.length).toBe(1)
    expect(wrapper.vm.filteredDepartments[0]._id).toBe('d1')
  })

  it('filters supervisor list by selected organization and department', async () => {
    const wrapper = mount(EmployeeManagement, { global: { plugins: [ElementPlus] } })
    wrapper.vm.employeeForm.organization = 'o1'
    wrapper.vm.employeeForm.department = 'd1'
    wrapper.vm.employeeList = [
      { _id: 's1', name: 'SupA', role: 'supervisor', organization: 'o1', department: 'd1' },
      { _id: 's2', name: 'SupB', role: 'supervisor', organization: 'o2', department: 'd2' }
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.supervisorList.length).toBe(1)
    expect(wrapper.vm.supervisorList[0]._id).toBe('s1')
  })

  it('filters subDepartments and renders select field', async () => {
    const wrapper = mount(EmployeeManagement, { global: { plugins: [ElementPlus] } })
    wrapper.vm.employeeForm.department = 'd1'
    await wrapper.vm.$nextTick()
    wrapper.vm.subDepartmentList = [
      { _id: 'sd1', name: 'SD1', department: 'd1' },
      { _id: 'sd2', name: 'SD2', department: 'd2' }
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredSubDepartments.length).toBe(1)
    expect(wrapper.vm.filteredSubDepartments[0]._id).toBe('sd1')
    wrapper.vm.openEmployeeDialog()
    await wrapper.vm.$nextTick()
    const subDeptItem = wrapper
      .findAllComponents({ name: 'ElFormItem' })
      .find(w => w.props('label') === '小單位/區域(C02-1)')
    expect(subDeptItem.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
  })

  it('loads subDepartments when editing employee with department name', async () => {
    const wrapper = mount(EmployeeManagement, { global: { plugins: [ElementPlus] } })
    const deptSpy = vi
      .spyOn(wrapper.vm, 'fetchDepartments')
      .mockImplementation(async () => {
        wrapper.vm.departmentList = [{ _id: 'd1', name: 'D1' }]
      })
    const subSpy = vi
      .spyOn(wrapper.vm, 'fetchSubDepartments')
      .mockImplementation(async dept => {
        wrapper.vm.subDepartmentList = [
          { _id: 'sd1', name: 'SD1', department: dept }
        ]
      })
    wrapper.vm.employeeList = [
      { _id: 'e1', name: 'E1', department: 'D1', subDepartment: 'sd1' }
    ]
    await wrapper.vm.openEmployeeDialog(0)
    expect(deptSpy).toHaveBeenCalled()
    expect(subSpy).toHaveBeenCalledWith('d1')
    expect(wrapper.vm.employeeForm.department).toBe('d1')
    expect(wrapper.vm.subDepartmentList[0].department).toBe('d1')
  })

  describe('401 handling', () => {
    const fns = ['fetchDepartments', 'fetchSubDepartments', 'fetchOrganizations', 'fetchEmployees']

    beforeEach(() => {
      push.mockReset()
      apiFetch.mockReset()
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    })

    fns.forEach(fn => {
      it(`${fn} redirects to login on 401`, async () => {
        const wrapper = mount(EmployeeManagement, { global: { plugins: [ElementPlus] } })
        const spy = vi.spyOn(ElMessage, 'error')
        apiFetch.mockResolvedValueOnce({ ok: false, status: 401 })
        await wrapper.vm[fn]()
        expect(spy).toHaveBeenCalledWith('登入逾時，請重新登入')
        expect(push).toHaveBeenCalledWith('/login')
        spy.mockRestore()
        wrapper.unmount()
      })
    })
  })
})
