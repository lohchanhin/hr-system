import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import dayjs from 'dayjs'
import Schedule from '../src/views/front/Schedule.vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

function mountPage() {
  return mount(Schedule, {
    global: {
      stubs: {
        'el-date-picker': true,
        'el-table': { template: '<div><slot></slot></div>' },
        'el-table-column': {
          props: ['label'],
          template: '<div :data-label="label"><slot :row="{}"></slot></div>'
        },
        'el-select': true,
        'el-option': true,
        'el-input': true,
        'el-card': { template: '<div><slot></slot></div>' }
      }
    }
  })
}

function flush() {
  return new Promise(resolve => setTimeout(resolve))
}

describe('排班儀表板', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('顯示 API 回傳的指標數據', async () => {
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', name: 'E1' },
          { _id: 'e2', name: 'E2' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountPage()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith(`/api/schedules/summary?month=${month}`)
    expect(wrapper.text()).toContain('直屬員工數')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('未排班員工')
    expect(wrapper.text()).toContain('1')
    expect(wrapper.text()).toContain('請假中員工')
    expect(wrapper.text()).toContain('1')
  })

  it('可依狀態篩選員工', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', name: 'E1' },
          { _id: 'e2', name: 'E2' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountPage()
    await flush()

    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: 's1' } },
      e2: { 1: { shiftId: '' } }
    }
    wrapper.vm.employees = [
      { _id: 'e1', name: 'E1' },
      { _id: 'e2', name: 'E2' }
    ]
    await wrapper.vm.$nextTick()

    wrapper.vm.statusFilter = 'unscheduled'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees).toHaveLength(1)
    expect(wrapper.vm.filteredEmployees[0]._id).toBe('e2')
  })
})
