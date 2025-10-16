import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import EmployeeManagement from '../EmployeeManagement.vue'
import * as apiModule from '../../../api'
import { ElMessage } from 'element-plus'

vi.mock('element-plus', () => {
  const success = vi.fn()
  const error = vi.fn()
  const warning = vi.fn()
  return {
    ElMessage: {
      success,
      error,
      warning
    },
    ElMessageBox: {
      confirm: vi.fn(),
      alert: vi.fn()
    }
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-button': {
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-dialog': {
    template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>',
    props: ['modelValue']
  },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div class="el-form-item-stub"><slot /></div>' },
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-select': { template: '<select><slot /></select>', props: ['modelValue'] },
  'el-option': { template: '<option><slot /></option>' },
  'el-upload': { template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>' },
  'el-alert': { template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>' },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-avatar': { template: '<div class="el-avatar-stub"><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-radio-group': { template: '<div class="el-radio-group-stub"><slot /></div>' },
  'el-radio': { template: '<label class="el-radio-stub"><slot /></label>' },
  'el-date-picker': { template: '<input type="date" />', props: ['modelValue'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-table': {
    template: '<div class="el-table-stub"><slot :row="{}" :$index="0" /></div>'
  },
  'el-table-column': {
    template: '<div class="el-table-column-stub"><slot :row="{}" :$index="0" /></div>'
  }
}

function createApiResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const organizations = [{ _id: 'org-1', name: '總公司' }]
const departments = [
  { _id: 'dept-1', name: '人資部', code: 'HR', organization: 'org-1' },
  { _id: 'dept-2', name: '研發部', code: 'RD', organization: 'org-1' }
]
const subDepartmentsByDept = {
  'dept-1': [{ _id: 'sub-1', name: '薪資組', department: 'dept-1' }],
  'dept-2': [{ _id: 'sub-2', name: '系統組', department: 'dept-2' }]
}
const allSubDepartments = Object.values(subDepartmentsByDept).flat()

const employees = [
  {
    _id: 'emp-1',
    username: 'jane',
    role: 'employee',
    name: 'Jane Doe',
    department: { _id: 'dept-1' },
    subDepartment: { _id: 'sub-1' },
    organization: { _id: 'org-1' },
    salaryItems: [],
    licenses: [],
    trainings: []
  }
]

describe('EmployeeManagement - 部門與小單位聯動', () => {
  let apiFetchMock

  const mountComponent = async () => {
    const wrapper = shallowMount(EmployeeManagement, {
      global: {
        stubs: {
          transition: false,
          teleport: false,
          ...elementStubs
        }
      }
    })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(path => {
      const url = typeof path === 'string' ? new URL(path, 'http://localhost') : path
      const pathname = url instanceof URL ? url.pathname : ''
      const departmentId = url instanceof URL ? url.searchParams.get('department') : null

      if (pathname === '/api/other-control-settings/item-settings') {
        return Promise.resolve(createApiResponse({ itemSettings: {} }))
      }

      if (pathname === '/api/departments') {
        return Promise.resolve(createApiResponse(departments))
      }

      if (pathname === '/api/sub-departments') {
        const payload = departmentId ? subDepartmentsByDept[departmentId] ?? [] : allSubDepartments
        return Promise.resolve(createApiResponse(payload))
      }

      if (pathname === '/api/employees') {
        return Promise.resolve(createApiResponse(employees))
      }

      if (pathname === '/api/organizations') {
        return Promise.resolve(createApiResponse(organizations))
      }

      return Promise.resolve(createApiResponse({}))
    })

    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessage.warning.mockClear()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  it('編輯舊有員工時會保留原有的小單位', async () => {
    const wrapper = await mountComponent()

    await wrapper.vm.openEmployeeDialog(0)
    await flushPromises()

    expect(wrapper.vm.employeeForm.subDepartment).toBe('sub-1')
  })

  it('切換到無原小單位的新部門時會自動清空', async () => {
    const wrapper = await mountComponent()

    await wrapper.vm.openEmployeeDialog(0)
    await flushPromises()

    wrapper.vm.employeeForm.department = 'dept-2'
    await flushPromises()

    expect(wrapper.vm.employeeForm.subDepartment).toBe('')
  })
})

