import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))
import { apiFetch } from '../src/api'
import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

const elStubs = ['el-table','el-table-column','el-button','el-tabs','el-tab-pane','el-form','el-form-item','el-input','el-select','el-option','el-dialog','el-avatar','el-tag','el-radio','el-radio-group','el-date-picker','el-input-number','el-switch']

describe('EmployeeManagement.vue', () => {
  beforeEach(() => {
    apiFetch.mockClear()
  })

  it('fetches lists on mount', () => {
    mount(EmployeeManagement, { global: { stubs: elStubs } })
    const calls = apiFetch.mock.calls.map(c => c[0])
    expect(calls).toContain('/api/employees')
    expect(calls).toContain('/api/departments')
    expect(calls).toContain('/api/organizations')
    expect(calls).toContain('/api/sub-departments')
  })

  it('sends login info when saving employee', async () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    wrapper.vm.employeeForm = { ...wrapper.vm.employeeForm, name: 'n', username: 'u', password: 'p', role: 'admin' }
    wrapper.vm.editEmployeeIndex = null
    await wrapper.vm.saveEmployee()
    const body = JSON.parse(apiFetch.mock.calls[0][1].body)
    expect(body.username).toBe('u')
    expect(body.password).toBe('p')
    expect(body.role).toBe('admin')
    expect(apiFetch).toHaveBeenCalledWith('/api/employees', expect.objectContaining({ method: 'POST' }))
  })
})
