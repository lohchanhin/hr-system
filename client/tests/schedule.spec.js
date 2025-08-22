import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { createPinia, setActivePinia } from 'pinia'
global.ElMessage = { error: vi.fn(), success: vi.fn() }

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: () => 'tok' }))
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
    pushMock.mockReset()
    sessionStorage.clear()
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
          'el-option': true
        }
      }
    })
  }

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  it('loads shift options when API returns array directly', async () => {
    apiFetch
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

  it('filters subDepartments by stringified department id', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd1', name: 'Sub A', department: { toString: () => 'd1' } }
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

  it('reverts change when update fails', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 1: { id: 'sch1', shiftId: 's1' } } }
    await wrapper.vm.onSelect('e1', 1, 's2')
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s1')
  })

  it('reverts change when creation fails', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 2: { shiftId: '' } } }
    await wrapper.vm.onSelect('e1', 2, 's1')
    expect(wrapper.vm.scheduleMap.e1[2].shiftId).toBe('')
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
    expect(cols[0].attributes('data-label')).toBe('樓層／單位')
    expect(cols[1].attributes('data-label')).toBe('員工')
    expect(cols[2].attributes('data-label')).toMatch(/^1\(.\)$/)
  })

  it('maps department ids to names', async () => {
    apiFetch
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
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
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
    wrapper.vm.scheduleMap = { e1: { 1: { shiftId: '' } } }
    await wrapper.vm.onSelect('e1', 1, 's1')

    expect(apiFetch).toHaveBeenNthCalledWith(4, `/api/employees?supervisor=s1`)
    expect(apiFetch).toHaveBeenNthCalledWith(
      7,
      `/api/employees?supervisor=s1&department=d1`
    )
    expect(apiFetch).toHaveBeenNthCalledWith(
      10,
      `/api/employees?supervisor=s1&department=d1&subDepartment=sd1`
    )
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

  it('stores data and navigates when previewing month', async () => {
    apiFetch
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
