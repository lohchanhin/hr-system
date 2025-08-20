import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { createPinia, setActivePinia } from 'pinia'
import Schedule from '../src/views/front/Schedule.vue'

global.ElMessage = { error: vi.fn() }

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: () => 'tok' }))

import { apiFetch } from '../src/api'

describe('Schedule.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetch.mockReset()
    ElMessage.error.mockReset()
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
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.shifts).toEqual([{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }])
  })

  it('loads shift options when API returns object with shifts', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shifts: [{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.shifts).toEqual([{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }])
  })

  it('reverts change when update fails', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 1: { id: 'sch1', shiftId: 's1' } } }
    await wrapper.vm.onSelect('e1', 1, 's2')
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s1')
    expect(ElMessage.error).toHaveBeenCalled()
  })

  it('reverts change when creation fails', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 2: { shiftId: '' } } }
    await wrapper.vm.onSelect('e1', 2, 's1')
    expect(wrapper.vm.scheduleMap.e1[2].shiftId).toBe('')
    expect(ElMessage.error).toHaveBeenCalled()
  })

  it('shows floor column and weekday labels', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.days[0].label).toMatch(/^1\(.\)$/)
    const cols = wrapper.findAll('.col')
    expect(cols[0].attributes('data-label')).toBe('樓層／單位')
    expect(cols[1].attributes('data-label')).toBe('員工')
    expect(cols[2].attributes('data-label')).toMatch(/^1\(.\)$/)
  })
})
