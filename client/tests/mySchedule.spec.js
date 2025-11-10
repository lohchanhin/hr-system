import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { apiFetch } from '../src/api'

const { messageMock, messageBoxMock } = vi.hoisted(() => {
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
  const box = {
    confirm: vi.fn()
  }
  return { messageMock: message, messageBoxMock: box }
})

vi.mock('element-plus', () => ({
  ElMessage: messageMock,
  ElMessageBox: messageBoxMock
}))

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: () => localStorage.getItem('token') }))

import MySchedule from '../src/views/front/MySchedule.vue'

describe('MySchedule.vue', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    localStorage.clear()
    Object.values(messageMock).forEach(fn => fn.mockReset())
    messageBoxMock.confirm.mockReset()
    messageBoxMock.confirm.mockResolvedValue()
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
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
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
        json: async () => [{ date: '2023-02-01', shiftId: '1' }]
      })
    wrapper.vm.selectedMonth = '2023-02'
    await flush()
    await flush()
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/shifts')
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/schedules/monthly?month=2023-02&employee=emp1')
    expect(wrapper.vm.schedules[0].shiftName).toBe('早班 (A1)')
    expect(wrapper.vm.schedules[0].date).toBe('2023/02/01')
    expect(wrapper.vm.schedules[0].state).toBe('draft')
  })

  it('toggles all confirmable schedules through selection helper', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp2', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
        }
      }
    })

    await flush()

    const rows = [
      { _id: 'a', state: 'pending_confirmation', employeeResponse: 'pending' },
      { _id: 'b', state: 'pending_confirmation', employeeResponse: 'pending' },
      { _id: 'c', state: 'finalized', employeeResponse: 'confirmed' }
    ]
    wrapper.vm.schedules = rows

    const toggled = []
    const tableStub = {
      clearSelection: vi.fn(),
      toggleRowSelection: (row, selected) => {
        toggled.push({ row, selected })
      }
    }
    wrapper.vm.scheduleTableRef = tableStub

    await wrapper.vm.handleSelectAllConfirmable()

    expect(tableStub.clearSelection).toHaveBeenCalledTimes(1)
    expect(toggled).toEqual([
      { row: rows[0], selected: true },
      { row: rows[1], selected: true }
    ])

    toggled.length = 0
    wrapper.vm.selection = rows.slice(0, 2)
    await flush()
    wrapper.vm.scheduleTableRef = tableStub
    tableStub.clearSelection.mockClear()

    await wrapper.vm.handleSelectAllConfirmable()

    expect(tableStub.clearSelection).not.toHaveBeenCalled()
    expect(wrapper.vm.selection.length).toBe(0)
  })

  it('confirms selected schedules in bulk', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp3', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
        }
      }
    })

    await flush()

    const confirmable = [
      { _id: 'x1', state: 'pending_confirmation', employeeResponse: 'pending', responseNote: '' },
      { _id: 'x2', state: 'pending_confirmation', employeeResponse: 'pending', responseNote: '' }
    ]
    wrapper.vm.schedules = [...confirmable]
    wrapper.vm.selection = [...confirmable]
    await flush()
    const tableStub = {
      clearSelection: vi.fn(),
      toggleRowSelection: vi.fn()
    }
    wrapper.vm.scheduleTableRef = tableStub

    apiFetch.mockReset()
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, count: 2, schedules: [] })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    await wrapper.vm.handleBulkConfirm()
    await flush()
    await flush()

    expect(messageBoxMock.confirm).toHaveBeenCalled()
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      '/api/schedules/respond/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ scheduleIds: ['x1', 'x2'], response: 'confirm', note: '' })
      })
    )
    expect(messageMock.success).toHaveBeenCalledWith('已批次確認 2 筆班表')
    expect(wrapper.vm.selection.length).toBe(0)
    expect(wrapper.vm.bulkLoading).toBe(false)
  })
})
