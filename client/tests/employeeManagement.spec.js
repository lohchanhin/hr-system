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

const mountOptions = {
  global: {
    plugins: [ElementPlus],
    stubs: { ElTabPane: { template: '<div><slot /></div>' } }
  }
}

describe('EmployeeManagement.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters departments by organization', async () => {
    const wrapper = mount(EmployeeManagement, mountOptions)
    wrapper.vm.departmentList = [
      { _id: 'd1', name: 'D1', organization: 'o1' },
      { _id: 'd2', name: 'D2', organization: 'o2' }
    ]
    wrapper.vm.employeeForm.organization = 'o1'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredDepartments.length).toBe(1)
    expect(wrapper.vm.filteredDepartments[0]._id).toBe('d1')
  })

  it('normalizes organization id when fetching employees', async () => {
    const wrapper = mount(EmployeeManagement, mountOptions)
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          _id: 'e1',
          organization: { _id: 'o1' },
          department: { _id: 'd1' },
          subDepartment: { _id: 'sd1' }
        }
      ]
    })
    await wrapper.vm.fetchEmployees()
    expect(wrapper.vm.employeeList[0].organization).toBe('o1')
  })

  it('filters supervisor list by selected organization and department', async () => {
    const wrapper = mount(EmployeeManagement, mountOptions)
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

  it('filters subDepartments', async () => {
    const wrapper = mount(EmployeeManagement, mountOptions)
    wrapper.vm.employeeForm.department = 'd1'
    await wrapper.vm.$nextTick()
    wrapper.vm.subDepartmentList = [
      { _id: 'sd1', name: 'SD1', department: 'd1' },
      { _id: 'sd2', name: 'SD2', department: 'd2' }
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredSubDepartments.length).toBe(1)
    expect(wrapper.vm.filteredSubDepartments[0]._id).toBe('sd1')
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
        const wrapper = mount(EmployeeManagement, mountOptions)
        const spy = vi.spyOn(ElMessage, 'error')
        apiFetch.mockResolvedValueOnce({ ok: false, status: 401 })
        await wrapper.vm[fn]()
        expect(spy).toHaveBeenCalledWith('登入逾時，請重新登入')
        expect(push).toHaveBeenCalledWith('/manager/login')
        spy.mockRestore()
        wrapper.unmount()
      })
    })
  })
})
