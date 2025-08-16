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
          'el-table-column': { template: '<div><slot :row="{}"></slot></div>' },
          'el-select': true,
          'el-option': true
        }
      }
    })
  }

  it('reverts change when update fails', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    wrapper.vm.scheduleMap = { e1: { 1: { id: 'sch1', shiftType: '早班' } } }
    wrapper.vm.scheduleMap.e1[1].shiftType = '晚班'
    await wrapper.vm.onSelect('e1', 1, '晚班')
    expect(wrapper.vm.scheduleMap.e1[1].shiftType).toBe('早班')
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
    wrapper.vm.scheduleMap = { e1: { 2: { shiftType: '' } } }
    wrapper.vm.scheduleMap.e1[2].shiftType = '早班'
    await wrapper.vm.onSelect('e1', 2, '早班')
    expect(wrapper.vm.scheduleMap.e1[2].shiftType).toBe('')
    expect(ElMessage.error).toHaveBeenCalled()
  })
})
