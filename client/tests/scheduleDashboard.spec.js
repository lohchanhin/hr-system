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
    apiFetch.mockReset()
  })

  function setupApiMock({ summary = [], employees = [], shifts = [] } = {}) {
    apiFetch.mockImplementation(async url => {
      const parsed = new URL(url, 'http://localhost')
      const { pathname, searchParams } = parsed
      if (pathname === '/api/shifts') {
        return { ok: true, json: async () => shifts }
      }
      if (pathname === '/api/employees/schedule') {
        const result = searchParams.get('status') === 'unscheduled'
          ? employees.filter(employee => employee._id === 'e2')
          : employees
        return {
          ok: true,
          json: async () => ({
            employees: result,
            pagination: { page: 1, pageSize: 50, total: result.length, totalPages: 1 }
          })
        }
      }
      if (pathname === '/api/schedules/monthly') {
        return {
          ok: true,
          json: async () => ({ schedules: [], publishSummary: null })
        }
      }
      if (pathname === '/api/schedules/summary') {
        return { ok: true, json: async () => summary }
      }
      if (pathname === '/api/schedules/leave-approvals') {
        return { ok: true, json: async () => ({ approvals: [], leaves: [] }) }
      }
      return { ok: true, json: async () => [] }
    })
  }

  it('顯示 API 回傳的指標數據', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setupApiMock({
      summary: [
        { shiftCount: 1, leaveCount: 0 },
        { shiftCount: 0, leaveCount: 1 }
      ],
      employees: [
        { _id: 'e1', name: 'E1' },
        { _id: 'e2', name: 'E2' }
      ]
    })

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
    setupApiMock({
      employees: [
        { _id: 'e1', name: 'E1' },
        { _id: 'e2', name: 'E2' }
      ]
    })

    const wrapper = mountPage()
    await flush()

    wrapper.vm.statusFilter = 'unscheduled'
    await wrapper.vm.$nextTick()
    await flush()
    expect(apiFetch.mock.calls.some(([url]) =>
      url.startsWith('/api/employees/schedule?') && url.includes('status=unscheduled')
    )).toBe(true)
    expect(wrapper.vm.filteredEmployees).toHaveLength(1)
    expect(wrapper.vm.filteredEmployees[0]._id).toBe('e2')
  })

  it('建立快取後仍正確計算狀態與班別資訊', async () => {
    setupApiMock({ employees: [{ _id: 'e1', name: 'E1' }] })

    const wrapper = mountPage()
    await flush()

    wrapper.vm.shifts = [{ _id: 's1', code: 'D1', name: '白班' }]
    wrapper.vm.employees = [{ _id: 'e1', name: 'E1' }, { _id: 'e2', name: 'E2' }]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: 's1' } },
      e2: { 1: { shiftId: '' } }
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.shiftInfo('s1')).toEqual(
      expect.objectContaining({ code: 'D1', name: '白班' })
    )
    expect(wrapper.vm.employeeStatus('e1')).toBe('scheduled')
    expect(wrapper.vm.employeeStatus('e2')).toBe('unscheduled')
    expect(wrapper.vm.getCellMeta('e1', 1)).toEqual(
      expect.objectContaining({ hasShift: true, missingShift: false })
    )
    expect(wrapper.vm.getCellMeta('e2', 1)).toEqual(
      expect.objectContaining({ hasShift: false, missingShift: true })
    )
  })
})
