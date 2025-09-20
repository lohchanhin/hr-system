import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { createPinia, setActivePinia } from 'pinia'
global.ElMessage = { error: vi.fn(), success: vi.fn(), warning: vi.fn() }

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
const encodeBase64 = data => Buffer.from(data, 'utf8').toString('base64')
const createToken = payload => `stub.${encodeBase64(JSON.stringify(payload ?? {}))}.sig`
const setRoleToken = role => {
  if (role) {
    localStorage.setItem('token', createToken({ role }))
  } else {
    localStorage.removeItem('token')
  }
}
const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

import { apiFetch } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

describe('Schedule.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetch.mockReset()
    ElMessage.error.mockReset()
    ElMessage.success.mockReset()
    ElMessage.warning.mockReset()
    pushMock.mockReset()
    sessionStorage.clear()
    localStorage.clear()
    setRoleToken('employee')
  })

  function mountSchedule() {
    return shallowMount(Schedule, {
      global: {
        stubs: {
          'el-date-picker': true,
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': {
            props: ['label'],
            template: '<div class="col" :data-label="label"><slot :row="{}"></slot></div>'
          },
          'el-select': true,
          'el-option': true,
          'el-input': true,
          ScheduleDashboard: { name: 'ScheduleDashboard', template: '<div class="dashboard-stub"></div>', props: ['summary'] }
        }
      }
    })
  }

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  it('includes supervisor id in requests when present', async () => {
    const month = dayjs().format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 'sup1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees?supervisor=sup1')
    const employeesCall = apiFetch.mock.calls
      .map(([url]) => url)
      .find(url => url.startsWith('/api/employees?') && url.includes('department='))
    expect(employeesCall).toBe('/api/employees?supervisor=sup1&department=d1&subDepartment=sd1')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toBe(`/api/schedules/monthly?month=${month}&supervisor=sup1`)
  })

  it('omits supervisor param when id missing', async () => {
    const month = dayjs().format('YYYY-MM')
    setRoleToken('employee')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    mountSchedule()
    await flush()
    const employeesCall = apiFetch.mock.calls.find(([url]) => url.startsWith('/api/employees'))
    expect(employeesCall?.[0]).toBe('/api/employees')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toBe(`/api/schedules/monthly?month=${month}`)
  })

  it('does not append supervisor param for employee role even when id exists', async () => {
    const month = dayjs().format('YYYY-MM')
    setRoleToken('employee')
    localStorage.setItem('employeeId', 'sup1')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    mountSchedule()
    await flush()
    const employeesCall = apiFetch.mock.calls.find(([url]) => url.startsWith('/api/employees'))
    expect(employeesCall?.[0]).toBe('/api/employees')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toBe(`/api/schedules/monthly?month=${month}`)
  })

  it('fetches summary and passes to dashboard', async () => {
    const month = dayjs().format('YYYY-MM')
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { shiftCount: 1, leaveCount: 0 },
          { shiftCount: 0, leaveCount: 1 }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith(`/api/schedules/summary?month=${month}`)
    const dash = wrapper.findComponent({ name: 'ScheduleDashboard' })
    expect(dash.props('summary')).toEqual({ direct: 2, unscheduled: 1, onLeave: 1 })
  })

  it('loads shift options when API returns array directly', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.shifts).toEqual([{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }])
  })

  it('loads shift options when API returns object with shifts', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shifts: [{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.shifts).toEqual([{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }])
  })

  it('filters subDepartments by department id', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    expect(wrapper.vm.filteredSubDepartments).toEqual([
      { _id: 'sd1', name: 'Sub A', department: 'd1' }
    ])
  })

  it('locks department options to supervisor department', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup2')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 'sup2',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd2', name: 'Sub B' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd2', name: 'Sub B' } }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'd1', name: 'Dept A' },
          { _id: 'd2', name: 'Dept B' }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd2', name: 'Sub B', department: { _id: 'd1' } },
          { _id: 'sd3', name: 'Sub C', department: { _id: 'd2' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees?supervisor=sup2')
    expect(wrapper.vm.departments).toEqual([{ _id: 'd1', name: 'Dept A' }])
    expect(wrapper.vm.selectedDepartment).toBe('d1')
    expect(wrapper.vm.subDepartments).toEqual([
      { _id: 'sd2', name: 'Sub B', department: 'd1' }
    ])
    expect(wrapper.vm.selectedSubDepartment).toBe('sd2')
  })

  it('keeps all sub-departments for admin role', async () => {
    setRoleToken('admin')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd2', name: 'Sub B', department: 'd1' },
          { _id: 'sd3', name: 'Sub C', department: 'd1' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.subDepartments).toEqual([
      { _id: 'sd2', name: 'Sub B', department: 'd1' },
      { _id: 'sd3', name: 'Sub C', department: 'd1' }
    ])
  })

  it('fetches sub-departments when department changes', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '', subDepartment: '' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    await wrapper.vm.onDepartmentChange()
    expect(apiFetch).toHaveBeenCalledWith('/api/sub-departments?department=d1')
    expect(wrapper.vm.subDepartments).toEqual([
      { _id: 'sd1', name: 'Sub A', department: 'd1' }
    ])
  })

  it('filters employees by name', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', name: 'Alice', department: '', subDepartment: '' },
          { _id: 'e2', name: 'Bob', department: '', subDepartment: '' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employeeSearch = 'Ali'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees.length).toBe(1)
    expect(wrapper.vm.filteredEmployees[0].name).toBe('Alice')
  })

  it('filters employees by status', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', name: 'A', department: '', subDepartment: '' },
      { _id: 'e2', name: 'B', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: '', department: '', subDepartment: '' } },
      e2: { 1: { shiftId: 's1', department: '', subDepartment: '', leave: {} } }
    }
    wrapper.vm.statusFilter = 'unscheduled'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees.map(e => e._id)).toEqual(['e1'])
    wrapper.vm.statusFilter = 'onLeave'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees.map(e => e._id)).toEqual(['e2'])
  })

  it('toggles row expansion in lazy mode', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = Array.from({ length: 51 }, (_, i) => ({
      _id: 'e' + i,
      name: 'E' + i,
      department: '',
      subDepartment: ''
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.lazyMode).toBe(true)
    wrapper.vm.toggleRow('e1')
    expect(wrapper.vm.expandedRows.has('e1')).toBe(true)
  })

  it('reverts change when update fails', async () => {
    setRoleToken('supervisor')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 's1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 1: { id: 'sch1', shiftId: 's1', department: 'd1', subDepartment: 'sd1' } } }
    await wrapper.vm.onSelect('e1', 1, 's2')
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s1')
  })

  it('reverts change when creation fails', async () => {
    setRoleToken('supervisor')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 's1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 2: { shiftId: '', department: 'd1', subDepartment: 'sd1' } } }
    await wrapper.vm.onSelect('e1', 2, 's1')
    expect(wrapper.vm.scheduleMap.e1?.[2]?.shiftId ?? '').toBe('')
  })

  it('shows floor column and weekday labels', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.days[0].label).toMatch(/^1\(.\)$/)
    const cols = wrapper.findAll('.col')
    expect(cols[0].attributes('data-label')).toBe('部門／單位')
    expect(cols[1].attributes('data-label')).toBe('員工姓名')
    expect(cols[2].attributes('data-label')).toMatch(/^1\(.\)$/)
  })

  it('displays leave label when leave data exists', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: undefined, name: 'E1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = { undefined: { 1: { leave: {} } } }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.leave-indicator').text()).toBe('請假中')
  })

  it('maps department ids to names', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.employees).toEqual([
      {
        _id: 'e1',
        name: 'E1',
        departmentId: 'd1',
        subDepartmentId: 'sd1',
        department: 'Dept A',
        subDepartment: 'Sub A'
      }
    ])
  })

  it('creates schedule after selecting department and unit', async () => {
    const month = dayjs().format('YYYY-MM')
    setRoleToken('supervisor')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 's1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ _id: 'sch1', employee: 'e1', shiftId: 's1', date: `${month}-01` })
      })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.selectedDepartment = 'd1'
    await wrapper.vm.onDepartmentChange()
    wrapper.vm.selectedSubDepartment = 'sd1'
    await wrapper.vm.onSubDepartmentChange()
    wrapper.vm.scheduleMap = { e1: { 1: { shiftId: '', department: 'd1', subDepartment: 'sd1' } } }
    await wrapper.vm.onSelect('e1', 1, 's1')

    const employeeUrls = apiFetch.mock.calls
      .map(([url]) => url)
      .filter(url => url.startsWith('/api/employees?') && url.includes('department='))
    expect(employeeUrls).toEqual([
      '/api/employees?supervisor=s1&department=d1&subDepartment=sd1',
      '/api/employees?supervisor=s1&department=d1&subDepartment=sd1',
      '/api/employees?supervisor=s1&department=d1&subDepartment=sd1'
    ])
    expect(apiFetch).toHaveBeenCalledWith('/api/employees?supervisor=s1')
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/api/schedules',
      expect.objectContaining({
        body: JSON.stringify({
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 's1',
          department: 'd1',
          subDepartment: 'sd1'
        })
      })
    )
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s1')
  })

  it('saves all schedules with selected department', async () => {
    const month = dayjs().format('YYYY-MM')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sch1' }] })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: 's1', department: 'd2', subDepartment: 'sd2' }
      }
    }
    await wrapper.vm.saveAll()
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/api/schedules/batch',
      expect.objectContaining({
        body: JSON.stringify({
          schedules: [
            {
              employee: 'e1',
              date: `${month}-01`,
              shiftId: 's1',
              department: 'd2',
              subDepartment: 'sd2'
            }
          ]
        })
      })
    )
  })

  it('warns and aborts save when missing shifts exist', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: '', department: '', subDepartment: '' } }
    }
    await wrapper.vm.saveAll()
    expect(ElMessage.warning).toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalledWith('/api/schedules/batch', expect.anything())
  })

  it('stores data and navigates when previewing month', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 1: { shiftId: 's1' } } }
    wrapper.vm.employees = [{ _id: 'e1', name: 'E1' }]
    wrapper.vm.shifts = [{ _id: 's1', code: 'A' }]
    await wrapper.vm.preview('month')
    const stored = JSON.parse(sessionStorage.getItem('schedulePreview'))
    expect(stored.scheduleMap.e1[1].shiftId).toBe('s1')
    expect(pushMock).toHaveBeenCalledWith({ name: 'PreviewMonth' })
  })

  it('exports pdf and triggers download', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) })

    const wrapper = mountSchedule()
    await flush()
    const click = vi.fn()
    const origCreate = document.createElement
    document.createElement = tag => (tag === 'a' ? { href: '', download: '', click } : origCreate(tag))
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    global.URL.revokeObjectURL = vi.fn()
    await wrapper.vm.exportSchedules('pdf')
    expect(apiFetch).toHaveBeenCalledWith(
      `/api/schedules/export?month=${dayjs().format('YYYY-MM')}&format=pdf`
    )
    expect(click).toHaveBeenCalled()
    document.createElement = origCreate
  })
})
