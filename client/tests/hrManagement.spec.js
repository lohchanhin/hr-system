import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HRSetting from '../src/components/backComponents/HRManagementSystemSetting.vue'
import AccountRoleSetting from '../src/components/backComponents/AccountRoleSetting.vue'
import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'

describe('HRManagementSystemSetting.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    localStorage.setItem('token', 'tok')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('fetches lists on mount', async () => {
    mount(HRSetting)
    expect(fetch).toHaveBeenCalledWith('/api/users', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' })
    }))
    expect(fetch).toHaveBeenCalledWith('/api/departments', expect.any(Object))
    expect(fetch).toHaveBeenCalledWith('/api/organizations', expect.any(Object))
  })

  it('creates user', async () => {
    const wrapper = mount(HRSetting)
    fetch.mockClear()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const acc = wrapper.findComponent(AccountRoleSetting)
    acc.vm.userForm = { username: 'u', password: 'p', role: 'admin', department: 'd1' }
    acc.vm.editUserIndex = null
    await acc.vm.saveUser()
    expect(fetch).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }))
  })

  it('sends new fields when saving employee', async () => {
    const wrapper = mount(HRSetting)
    fetch.mockClear()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const emp = wrapper.findComponent(EmployeeManagement)
    emp.vm.employeeForm = { ...emp.vm.employeeForm, name: 'n', username: 'u', experiences: [{ unit: 'a' }] }
    emp.vm.editEmployeeIndex = null
    await emp.vm.saveEmployee()
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.experiences).toBeDefined()
    expect(fetch).toHaveBeenCalledWith('/api/employees', expect.objectContaining({ method: 'POST' }))
  })
})
