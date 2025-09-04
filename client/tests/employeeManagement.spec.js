import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))
import { apiFetch } from '../src/api'
import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'
import { REQUIRED_FIELDS } from '../src/components/backComponents/requiredFields'
import Schema from 'async-validator'
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() }
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

  it('has validation rules for required fields', () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    REQUIRED_FIELDS.forEach(r => {
      expect(wrapper.vm.rules[r][0].required).toBe(true)
    })
    expect(wrapper.vm.rules.email[0].type).toBe('email')
  })

  it('rejects when required fields are empty', async () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    for (const field of REQUIRED_FIELDS) {
      const validator = new Schema({ [field]: wrapper.vm.rules[field] })
      const msg = wrapper.vm.rules[field][0].message
      await expect(validator.validate({ [field]: '' })).rejects.toMatchObject({
        errors: [{ message: msg }]
      })
    }
  })

  it('sends login info when saving employee', async () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    const validate = vi.fn(() => Promise.resolve(true))
    wrapper.vm.formRef = { validate }
    apiFetch.mockClear()
    apiFetch.mockImplementation((url, opts) =>
      Promise.resolve({ ok: true, json: async () => (opts?.method === 'POST' ? {} : []) })
    )
    wrapper.vm.employeeForm = { ...wrapper.vm.employeeForm, name: 'n', username: 'u', password: 'p', role: 'admin', organization: 'o', department: 'd', gender: 'M', email: 'a@a.com' }
    wrapper.vm.editEmployeeIndex = null
    await wrapper.vm.saveEmployee()
    expect(validate).toHaveBeenCalled()
    const postCall = apiFetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeTruthy()
    const body = JSON.parse(postCall[1].body)
    expect(body.username).toBe('u')
    expect(body.password).toBe('p')
    expect(body.role).toBe('admin')
    expect(apiFetch).toHaveBeenCalledWith('/api/employees', expect.objectContaining({ method: 'POST' }))
  })

  it('stops saving when validation fails', async () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    const validate = vi.fn(() => Promise.resolve(false))
    wrapper.vm.formRef = { validate }
    apiFetch.mockClear()
    await wrapper.vm.saveEmployee()
    expect(validate).toHaveBeenCalled()
    const postCall = apiFetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })
})
