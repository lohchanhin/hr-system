import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import HRManagementSystemSetting from '../src/components/backComponents/HRManagementSystemSetting.vue'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
}))

const { apiFetch } = require('../src/api')

describe('Employee form', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends licenses and trainings arrays', async () => {
    const wrapper = mount(HRManagementSystemSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.employeeForm = {
      name: 'Jane',
      department: 'HR',
      title: 'Manager',
      idNumber: 'A',
      birthDate: '1990-01-01',
      contact: '09',
      licenses: 'A,B',
      trainings: 'T1,T2',
      status: '在職'
    }
    wrapper.vm.editEmployeeIndex = null
    await wrapper.vm.saveEmployee()
    const body = JSON.parse(apiFetch.mock.calls[0][1].body)
    expect(body.licenses).toEqual(['A', 'B'])
    expect(body.trainings).toEqual(['T1', 'T2'])
  })
})

