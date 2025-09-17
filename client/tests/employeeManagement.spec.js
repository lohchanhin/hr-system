import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))
import { apiFetch } from '../src/api'
import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'
import { REQUIRED_FIELDS } from '../src/components/backComponents/requiredFields'
import Schema from 'async-validator'
import { ElMessageBox } from 'element-plus'
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { alert: vi.fn() }
}))

const elStubs = ['el-table','el-table-column','el-button','el-tabs','el-tab-pane','el-form','el-form-item','el-input','el-select','el-option','el-dialog','el-avatar','el-tag','el-radio','el-radio-group','el-date-picker','el-input-number','el-upload','el-switch']

describe('EmployeeManagement.vue', () => {
  beforeEach(() => {
    apiFetch.mockClear()
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }))
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
    wrapper.vm.employeeForm = {
      ...wrapper.vm.employeeForm,
      name: 'n',
      username: 'u',
      password: 'p',
      role: 'admin',
      organization: 'o',
      department: 'd',
      gender: 'M',
      email: 'a@a.com',
      serviceType: '志願役',
      militaryBranch: '陸軍',
      militaryRank: '上兵',
      dischargeYear: '2020'
    }
    wrapper.vm.editEmployeeIndex = null
    await wrapper.vm.saveEmployee()
    expect(validate).toHaveBeenCalled()
    const postCall = apiFetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeTruthy()
    const body = JSON.parse(postCall[1].body)
    expect(body.username).toBe('u')
    expect(body.password).toBe('p')
    expect(body.role).toBe('admin')
    expect(body.serviceType).toBe('志願役')
    expect(body.militaryBranch).toBe('陸軍')
    expect(body.militaryRank).toBe('上兵')
    expect(body.dischargeYear).toBe(2020)
    expect(apiFetch).toHaveBeenCalledWith('/api/employees', expect.objectContaining({ method: 'POST' }))
  })

  it('alerts missing fields when validation fails', async () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    const validate = vi.fn(() =>
      Promise.reject({
        gender: [{ message: '請選擇性別' }],
        email: [{ message: '請輸入有效 Email' }]
      })
    )
    wrapper.vm.formRef = { validate }
    apiFetch.mockClear()
    await wrapper.vm.saveEmployee()
    expect(validate).toHaveBeenCalled()
    expect(ElMessageBox.alert).toHaveBeenCalled()
    const msg = ElMessageBox.alert.mock.calls[0][0]
    expect(msg).toContain('性別')
    expect(msg).toContain('Email')
    const postCall = apiFetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('填入體檢資料並顯示於編輯表單', async () => {
    const responses = {
      '/api/departments': [],
      '/api/organizations': [],
      '/api/sub-departments': [],
      '/api/sub-departments?department=dep1': [],
      '/api/employees': [
        {
          _id: 'e1',
          name: '測試員工',
          organization: 'org1',
          department: 'dep1',
          subDepartment: 'sub1',
          medicalCheck: { height: 172.5, weight: 65.3, bloodType: 'B' },
          licenses: [
            {
              name: '專業證照',
              number: 'LIC-1',
              startDate: '2024-01-01',
              endDate: '2025-01-01',
              fileList: ['https://file.example/license.png']
            }
          ],
          trainings: [
            {
              course: '院內教育',
              courseNo: 'TR-01',
              date: '2024-06-01',
              category: ['院內'],
              score: 4,
              fileList: ['https://file.example/train.pdf']
            }
          ]
        }
      ]
    }
    apiFetch.mockImplementation(url =>
      Promise.resolve({ ok: true, json: async () => responses[url] ?? [] })
    )

    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    await flushPromises()
    await wrapper.vm.openEmployeeDialog(0)

    expect(wrapper.vm.employeeForm.height).toBe(172.5)
    expect(wrapper.vm.employeeForm.weight).toBe(65.3)
    expect(wrapper.vm.employeeForm.medicalBloodType).toBe('B')
    expect(wrapper.vm.employeeForm.licenses).toHaveLength(1)
    expect(wrapper.vm.employeeForm.licenses[0].fileList[0].url).toBe('https://file.example/license.png')
    expect(wrapper.vm.employeeForm.trainings[0].category).toEqual(['院內'])
    expect(wrapper.vm.employeeForm.trainings[0].score).toBe(4)
    expect(wrapper.vm.employeeForm.trainings[0].fileList[0].url).toBe('https://file.example/train.pdf')
  })

  it('儲存時會帶入證照與訓練檔案連結', async () => {
    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    const validate = vi.fn(() => Promise.resolve(true))
    wrapper.vm.formRef = { validate }
    apiFetch.mockClear()
    apiFetch.mockImplementation((url, opts) =>
      Promise.resolve({ ok: true, json: async () => (opts?.method === 'POST' ? {} : []) })
    )

    wrapper.vm.employeeForm = {
      ...wrapper.vm.employeeForm,
      name: '測試員工',
      username: 'user1',
      password: 'pass1',
      role: 'employee',
      organization: 'org1',
      department: 'dep1',
      gender: 'M',
      email: 'user1@example.com',
      licenses: [
        {
          name: '專業證照',
          number: 'L-1',
          startDate: '2024-01-01',
          endDate: '2025-01-01',
          fileList: [
            { name: 'l1', url: 'https://file.example/license.png' },
            { response: { data: { url: 'https://file.example/license2.png' } } }
          ]
        },
        { name: '', number: '', startDate: '', endDate: '', fileList: [] }
      ],
      trainings: [
        {
          course: '教育訓練',
          courseNo: 'TR-01',
          date: '2024-06-01',
          category: ['院內', '線上'],
          score: 3,
          fileList: [{ response: { url: 'https://file.example/train.pdf' } }]
        },
        { course: '', courseNo: '', date: '', category: [], score: null, fileList: [] }
      ]
    }
    wrapper.vm.editEmployeeIndex = null
    await wrapper.vm.saveEmployee()

    expect(validate).toHaveBeenCalled()
    const postCall = apiFetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeTruthy()
    const body = JSON.parse(postCall[1].body)
    expect(body.licenses).toEqual([
      {
        name: '專業證照',
        number: 'L-1',
        startDate: '2024-01-01',
        endDate: '2025-01-01',
        fileList: [
          'https://file.example/license.png',
          'https://file.example/license2.png'
        ]
      }
    ])
    expect(body.trainings).toEqual([
      {
        course: '教育訓練',
        courseNo: 'TR-01',
        date: '2024-06-01',
        category: ['院內', '線上'],
        score: 3,
        fileList: ['https://file.example/train.pdf']
      }
    ])
  })

  it('填入役別資訊並顯示於編輯表單', async () => {
    const responses = {
      '/api/departments': [],
      '/api/organizations': [],
      '/api/sub-departments': [],
      '/api/sub-departments?department=dep1': [],
      '/api/employees': [
        {
          _id: 'e1',
          name: '測試員工',
          organization: 'org1',
          department: 'dep1',
          subDepartment: 'sub1',
          militaryService: {
            serviceType: '義務役',
            branch: '海軍',
            rank: '一等兵',
            dischargeYear: 2018
          }
        }
      ]
    }
    apiFetch.mockImplementation(url =>
      Promise.resolve({ ok: true, json: async () => responses[url] ?? [] })
    )

    const wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    await flushPromises()
    await wrapper.vm.openEmployeeDialog(0)

    expect(wrapper.vm.employeeForm.serviceType).toBe('義務役')
    expect(wrapper.vm.employeeForm.militaryBranch).toBe('海軍')
    expect(wrapper.vm.employeeForm.militaryRank).toBe('一等兵')
    expect(wrapper.vm.employeeForm.dischargeYear).toBe(2018)
  })
})
