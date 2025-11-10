import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { apiFetch } from '../src/api'

const elementPlusMock = vi.hoisted(() => {
  const confirmMock = vi.fn().mockResolvedValue()
  const messageMock = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }
  return {
    module: {
      ElMessage: messageMock,
      ElMessageBox: { confirm: confirmMock },
    },
    messageMock,
    confirmMock,
  }
})

vi.mock('element-plus', () => elementPlusMock.module)
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          month: dayjs().format('YYYY-MM'),
          schedules: [],
          meta: { state: 'draft', employeeStatuses: [] },
        })
      })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-input': true,
        }
      }
    })
    await flush()
    apiFetch.mockReset()
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: '1', name: '早班', code: 'A1' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          month: '2023-02',
          schedules: [{ date: '2023-02-01', shiftId: '1' }],
          meta: { state: 'pending_confirmation', employeeStatuses: [] },
        })
      })
    wrapper.vm.selectedMonth = '2023-02'
    await flush()
    await flush()
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/shifts')
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/schedules/monthly?month=2023-02&employee=emp1')
    expect(wrapper.vm.schedules[0].shiftName).toBe('早班 (A1)')
    expect(wrapper.vm.schedules[0].date).toBe('2023/02/01')
  })
})
