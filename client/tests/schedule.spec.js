import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import dayjs from 'dayjs'
import Schedule from '../src/views/front/Schedule.vue'

vi.mock('../src/api', () => {
  const apiFetch = vi.fn()
  apiFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ([{ _id: 'e1', name: 'E1' }]) })
    .mockResolvedValueOnce({ ok: true, json: async () => ([] ) })
  return { apiFetch }
})
vi.mock('../src/utils/tokenService', () => ({ getToken: () => 'tok' }))

describe('Schedule.vue', () => {
  it('fetches employees and schedules on mount', () => {
    const { apiFetch } = require('../src/api')
    localStorage.setItem('employeeId', 's1')
    mount(Schedule)
    const month = dayjs().format('YYYY-MM')
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/employees?supervisor=s1', expect.any(Object))
    expect(apiFetch).toHaveBeenNthCalledWith(2, `/api/schedules/monthly?month=${month}&supervisor=s1`, expect.any(Object))
  })
})
