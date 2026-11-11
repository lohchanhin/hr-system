import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useProfileStore } from '../src/stores/profile'

// 排班頁的班別選單與圖例：小單位的「使用班別」限制所有班別，休息日、例假、國定假日、請假也一樣
// （客戶 2026/11/11「全部都呈現，都要能管控」；之前的規則是這些班別一律列出）

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

// GET /api/shifts 的樣子（班別設定，含班別性質）
const SHIFTS = [
  { _id: 'day', code: 'D', name: '白班', startTime: '08:00', endTime: '16:00', semanticType: 'work' },
  { _id: 'night', code: 'N', name: '大夜', startTime: '00:00', endTime: '08:00', semanticType: 'work' },
  { _id: 'rest', code: '休', name: '休息日', startTime: '00:00', endTime: '00:00', semanticType: 'rest_day' },
  { _id: 'regular', code: '例', name: '例假', startTime: '00:00', endTime: '00:00', semanticType: 'regular_rest' },
  { _id: 'holiday', code: '國', name: '國定假日', startTime: '00:00', endTime: '00:00', semanticType: 'holiday' },
  { _id: 'personal', code: '事', name: '事假', startTime: '00:00', endTime: '00:00', semanticType: 'leave' }
]
const NON_WORK = ['rest', 'regular', 'holiday', 'personal']
const DEPARTMENTS = [{ _id: 'dA', name: 'A 部門' }]
// A1 只選了大夜（沒有休息類）、A2 是舊設定（選了白班與休息日）、A3 沒有設定（全部）
const UNITS = [
  { _id: 'uA1', name: 'A1 病房', department: 'dA', allowedShiftIds: ['night'] },
  { _id: 'uA2', name: 'A2 病房', department: 'dA', allowedShiftIds: ['day', 'rest'] },
  { _id: 'uA3', name: 'A3 病房', department: 'dA', allowedShiftIds: [] }
]

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
      const unit = query.get('subDepartment')
      const list = unit ? [{ _id: `n-${unit}`, name: `${unit} 護理師`, department: 'dA', subDepartment: unit }] : []
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
        ScheduleDashboard: { template: '<div></div>' },
        // 排班頁改用共用頁首：shallowMount 會把它換成空殼，月份／部門／單位與統計就不會畫出來，所以用真的元件
        PageHeader: false
      }
    }
  })
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise(resolve => setTimeout(resolve))
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  apiFetch.mockReset()
  mockApi()
  localStorage.setItem('token', token('employee'))
  sessionStorage.setItem('employeeId', 'me')
  useProfileStore().setProfile({
    id: 'me',
    name: '我',
    scheduleAccess: { canSchedule: true, supervisorScope: false, subDepartmentIds: ['uA1', 'uA2', 'uA3'], departmentIds: ['dA'], wholeDepartmentIds: [] }
  })
})

const batchOptionValues = wrapper =>
  wrapper.find('[data-test="batch-shift-select"]').findAll('option').map(option => option.attributes('value'))

async function viewUnit(wrapper, unitId) {
  wrapper.vm.selectedSubDepartment = unitId
  await flush()
}

describe('Schedule.vue shift lists of a unit with a 使用班別 selection', () => {
  it('offers only the selected shifts, rest-type shifts included', async () => {
    const wrapper = mountSchedule()
    await flush()

    // 只選了大夜：休假類的班別也不列出
    await viewUnit(wrapper, 'uA1')
    expect(wrapper.vm.availableShifts.map(shift => shift._id)).toEqual(['night'])
    expect(wrapper.vm.legendShifts.map(item => item.key)).toEqual(['night'])
    expect(batchOptionValues(wrapper)).toEqual(['night'])

    // 選了白班與休息日：就是這兩種，其他休假類不會自動加上
    await viewUnit(wrapper, 'uA2')
    expect(wrapper.vm.availableShifts.map(shift => shift._id)).toEqual(['day', 'rest'])
    expect(NON_WORK).toContain('rest')

    // 沒有設定：全部
    await viewUnit(wrapper, 'uA3')
    expect(wrapper.vm.availableShifts.map(shift => shift._id)).toEqual(SHIFTS.map(shift => shift._id))
    wrapper.unmount()
  })

  it('clears the chosen 套用班別 when switching to a unit that did not select it, rest-type shifts included', async () => {
    const wrapper = mountSchedule()
    await flush()
    await viewUnit(wrapper, 'uA2')
    wrapper.vm.batchShiftId = 'rest'
    await viewUnit(wrapper, 'uA1')
    expect(wrapper.vm.batchShiftId).toBe('')
    // 上班的班別不在這個小單位的使用班別內也清掉
    wrapper.vm.batchShiftId = 'night'
    await viewUnit(wrapper, 'uA2')
    expect(wrapper.vm.batchShiftId).toBe('')
    wrapper.unmount()
  })
})
