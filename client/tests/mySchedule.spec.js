import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
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

  it('fetches schedules for current user', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp1', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ date: '2023-01-01', shiftId: 'A' }] })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true
        }
      }
    })
    await flush()
    expect(apiFetch).toHaveBeenCalledWith(`/api/schedules/monthly?month=${dayjs().format('YYYY-MM')}&employee=emp1`)
    expect(wrapper.vm.schedules).toHaveLength(1)
  })
})
