import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: () => localStorage.getItem('token') }))

import MySchedule from '../src/views/front/MySchedule.vue'

describe('MySchedule.vue', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    localStorage.clear()
  })

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  it('uses selected month when loading schedules', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp1', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true
        }
      }
    })
    await flush()
    apiFetch.mockReset()
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1', name: '早班' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ date: '2023-02-01', shiftId: '1' }] })
    wrapper.vm.selectedMonth = '2023-02'
    await flush()
    await flush()
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/attendance-settings')
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/schedules/monthly?month=2023-02&employee=emp1')
    expect(wrapper.vm.schedules[0].shiftName).toBe('早班')
    expect(wrapper.vm.schedules[0].date).toBe('2023/02/01')
  })
})
