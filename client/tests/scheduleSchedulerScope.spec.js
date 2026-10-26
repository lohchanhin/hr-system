import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useProfileStore } from '../src/stores/profile'

// 排班頁的排班人員視角（R1／R3）：員工角色的排班人員只看得到被指定的部門與小單位，可以切換部門；
// 班別選單、套用班別與圖例只列小單位的「使用班別」（沒有設定代表全部）；只有主管身分時維持原本的畫面。

vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: { alert: vi.fn(), confirm: vi.fn() },
  ElLoading: { service: vi.fn(() => ({ close: vi.fn() })) }
}))
vi.mock('../src/api', () => ({ apiFetch: vi.fn(), importScheduleRecords: vi.fn() }))
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return { ...actual, useRouter: () => ({ push: vi.fn() }) }
})

import { apiFetch } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

const token = role => `stub.${Buffer.from(JSON.stringify({ role }), 'utf8').toString('base64')}.sig`
const ok = body => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })

const SHIFTS = [
  { _id: 'day', code: 'D', name: '白班', startTime: '08:00', endTime: '16:00', semanticType: 'work' },
  { _id: 'night', code: 'N', name: '大夜', startTime: '00:00', endTime: '08:00', semanticType: 'work' },
  { _id: 'rest', code: '休', name: '休息日', startTime: '00:00', endTime: '00:00', semanticType: 'rest_day' }
]
const DEPARTMENTS = [
  { _id: 'dA', name: 'A 部門' },
  { _id: 'dB', name: 'B 部門' },
  { _id: 'dC', name: 'C 部門' }
]
const UNITS = [
  { _id: 'uA1', name: 'A1 病房', department: 'dA', allowedShiftIds: [] },
  { _id: 'uA2', name: 'A2 病房', department: 'dA', allowedShiftIds: [] },
  { _id: 'uB1', name: 'B1 病房', department: 'dB', allowedShiftIds: ['night', 'rest'] },
  { _id: 'uC1', name: 'C1 門診', department: 'dC', allowedShiftIds: [] }
]
const EMPLOYEES = {
  uA1: [{ _id: 'nA', name: '護理甲', department: 'dA', subDepartment: 'uA1' }],
  uB1: [{ _id: 'nC', name: '護理丙', department: 'dB', subDepartment: 'uB1' }]
}

function mockApi() {
  apiFetch.mockImplementation(url => {
    const [path, queryString = ''] = String(url).split('?')
    const query = new URLSearchParams(queryString)
    if (path === '/api/shifts') return ok(SHIFTS)
    if (path === '/api/departments') return ok(DEPARTMENTS)
    if (path === '/api/sub-departments') {
      const dept = query.get('department')
      return ok(dept ? UNITS.filter(unit => unit.department === dept) : UNITS)
    }
    if (path === '/api/employees/schedule') {
      const list = EMPLOYEES[query.get('subDepartment')] || []
      return ok({ employees: list, pagination: { total: list.length, page: 1, pageSize: 50, totalPages: 1 } })
    }
    if (path === '/api/schedules/monthly') {
      return ok({ schedules: [], employees: [], publishSummary: { status: 'draft', pendingEmployees: [], disputedEmployees: [], hasSchedules: false } })
    }
    if (path === '/api/schedules/leave-approvals') return ok({ approvals: [], leaves: [] })
    if (path === '/api/holiday-calendar/headers') return ok({ entries: [] })
    return ok([])
  })
}

const SelectStub = {
  name: 'ElSelect',
  props: ['modelValue', 'disabled'],
  template: '<select v-bind="$attrs" :disabled="disabled"><slot></slot></select>'
}
const OptionStub = { name: 'ElOption', props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' }

function mountSchedule() {
  return shallowMount(Schedule, {
    global: {
      stubs: {
        'el-select': SelectStub,
        'el-option': OptionStub,
        'el-button': { template: '<button v-bind="$attrs"><slot></slot></button>' },
        'el-table': { template: '<div><slot></slot></div>' },
        'el-table-column': { template: '<div></div>' },
        ScheduleDashboard: { template: '<div></div>' }
      }
    }
  })
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise(resolve => setTimeout(resolve))
}

function signIn(role, scheduleAccess) {
  localStorage.setItem('token', token(role))
  sessionStorage.setItem('employeeId', 'me')
  useProfileStore().setProfile({ id: 'me', name: '我', scheduleAccess })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  apiFetch.mockReset()
  mockApi()
})

describe('Schedule.vue for a scheduler of two units in different departments', () => {
  const access = { canSchedule: true, supervisorScope: false, subDepartmentIds: ['uA1', 'uB1'], departmentIds: ['dA', 'dB'], wholeDepartmentIds: [] }

  it('offers only the assigned departments and units, lets them switch department and edit', async () => {
    signIn('employee', access)
    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.vm.departments.map(dept => dept._id)).toEqual(['dA', 'dB'])
    expect(wrapper.vm.selectedDepartment).toBe('dA')
    expect(wrapper.vm.subDepartments.map(sub => sub._id)).toEqual(['uA1'])
    expect(wrapper.vm.selectedSubDepartment).toBe('uA1')
    expect(wrapper.vm.canEditSchedule).toBe(true)
    expect(wrapper.find('[data-test="schedule-department-select"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.vm.employees.map(employee => employee.name)).toEqual(['護理甲'])
    // 員工角色不帶 supervisor 參數：名單由伺服器依排班範圍決定
    const employeeCalls = apiFetch.mock.calls.map(([url]) => url).filter(url => url.startsWith('/api/employees/schedule'))
    expect(employeeCalls.length).toBeGreaterThan(0)
    expect(employeeCalls.every(url => !url.includes('supervisor='))).toBe(true)

    wrapper.vm.selectedDepartment = 'dB'
    await wrapper.vm.onDepartmentChange()
    await flush()
    expect(wrapper.vm.subDepartments.map(sub => sub._id)).toEqual(['uB1'])
    expect(wrapper.vm.selectedSubDepartment).toBe('uB1')
    expect(wrapper.vm.employees.map(employee => employee.name)).toEqual(['護理丙'])
    wrapper.unmount()
  })

  it('limits the shift dropdowns and legend to the 使用班別 of the viewed unit (empty means all)', async () => {
    signIn('employee', access)
    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.vm.availableShifts.map(shift => shift._id)).toEqual(['day', 'night', 'rest'])

    wrapper.vm.batchShiftId = 'day'
    wrapper.vm.selectedDepartment = 'dB'
    await wrapper.vm.onDepartmentChange()
    await flush()
    expect(wrapper.vm.availableShifts.map(shift => shift._id)).toEqual(['night', 'rest'])
    expect(wrapper.vm.legendShifts.map(item => item.key)).toEqual(['night', 'rest'])
    const batchOptions = wrapper.find('[data-test="batch-shift-select"]').findAll('option').map(option => option.attributes('value'))
    expect(batchOptions).toEqual(['night', 'rest'])
    // 原本選的「套用班別」不在可用班別內就清掉
    expect(wrapper.vm.batchShiftId).toBe('')
    // 既有班表的班別仍用完整的班別設定顯示
    expect(wrapper.vm.shifts).toHaveLength(3)
    wrapper.unmount()
  })
})

describe('Schedule.vue for an administrator', () => {
  it('lists every department, lets the administrator switch, and never limits the roster to their own reports', async () => {
    signIn('admin', { canSchedule: true, supervisorScope: false, subDepartmentIds: [], departmentIds: [], wholeDepartmentIds: [] })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.departments.map(dept => dept._id)).toEqual(['dA', 'dB', 'dC'])
    expect(wrapper.find('[data-test="schedule-department-select"]').attributes('disabled')).toBeUndefined()
    const urls = apiFetch.mock.calls.map(([url]) => url)
    expect(urls.filter(url => url.startsWith('/api/employees/schedule') || url.startsWith('/api/schedules/monthly'))
      .every(url => !url.includes('supervisor='))).toBe(true)
    wrapper.unmount()
  })
})

describe('Schedule.vue keeps today\'s screens for supervisors and plain employees', () => {
  it('keeps the department fixed for a supervisor without scheduler assignments', async () => {
    signIn('supervisor', { canSchedule: true, supervisorScope: true, subDepartmentIds: [], departmentIds: [], wholeDepartmentIds: [] })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.canEditSchedule).toBe(true)
    expect(wrapper.find('[data-test="schedule-department-select"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('does not let a supervisor cut off by scheduler_only edit, nor an employee without an assignment', async () => {
    signIn('supervisor', { canSchedule: false, supervisorScope: false })
    const cut = mountSchedule()
    await flush()
    expect(cut.vm.canEditSchedule).toBe(false)
    cut.unmount()

    setActivePinia(createPinia())
    signIn('employee', { canSchedule: false })
    const plain = mountSchedule()
    await flush()
    expect(plain.vm.canEditSchedule).toBe(false)
    plain.unmount()
  })
})
