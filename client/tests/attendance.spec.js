import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Attendance from '../src/views/front/Attendance.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({
  getToken: () => localStorage.getItem('token')
}))

describe('Attendance.vue availability', () => {
  const flush = () => new Promise(resolve => setTimeout(resolve))

  beforeEach(() => {
    apiFetch.mockReset()
    localStorage.clear()
    const token = `x.${btoa(JSON.stringify({ id: 'emp1', role: 'employee' }))}.y`
    localStorage.setItem('token', token)
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
  })

  function mountComponent() {
    return mount(Attendance, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-tooltip': { template: '<div><slot></slot></div>' },
          'el-button': { template: '<button><slot></slot></button>' },
          'el-input': { template: '<input />' }
        }
      }
    })
  }

  it('disables clock-in before allowed window and enables later', async () => {
    const wrapper = mountComponent()
    await flush()
    wrapper.vm.shiftDefinitions = [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    wrapper.vm.monthlySchedules = [{ date: '2024/01/01', shiftId: 'shift1' }]
    wrapper.vm.updateAvailability(new Date('2023-12-31T23:30:00.000Z'))
    await wrapper.vm.$nextTick()
    let cards = wrapper.findAll('.punch-card')
    expect(cards[0].classes()).toContain('disabled')
    expect(cards[1].classes()).toContain('disabled')

    wrapper.vm.updateAvailability(new Date('2024-01-01T02:30:00.000Z'))
    await wrapper.vm.$nextTick()
    cards = wrapper.findAll('.punch-card')
    expect(cards[0].classes()).not.toContain('disabled')
    expect(cards[1].classes()).toContain('disabled')
  })
})
