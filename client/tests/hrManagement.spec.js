import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HRSetting from '../src/components/backComponents/HRManagementSystemSetting.vue'

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
  })

  it('creates user', async () => {
    const wrapper = mount(HRSetting)
    fetch.mockClear()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    wrapper.vm.userForm = { username: 'u', password: 'p', role: 'hr', department: 'd1' }
    wrapper.vm.editUserIndex = null
    await wrapper.vm.saveUser()
    expect(fetch).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }))
  })

  it('deletes department', async () => {
    const wrapper = mount(HRSetting)
    fetch.mockClear()
    wrapper.vm.departmentList = [{ _id: '1', label: 'HR', value: 'D' }]
    fetch.mockResolvedValueOnce({ ok: true })
    await wrapper.vm.deleteDept(0)
    expect(fetch).toHaveBeenCalledWith('/api/departments/1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('sends new fields when saving employee', async () => {
    const wrapper = mount(HRSetting)
    fetch.mockClear()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    wrapper.vm.employeeForm = { ...wrapper.vm.employeeForm, name: 'n', username: 'u', experiences: [{ unit: 'a' }] }
    wrapper.vm.editEmployeeIndex = null
    await wrapper.vm.saveEmployee()
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.experiences).toBeDefined()
    expect(fetch).toHaveBeenCalledWith('/api/employees', expect.objectContaining({ method: 'POST' }))
  })
})
