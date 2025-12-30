import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('ShiftScheduleSetting.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render removed tabs', () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    expect(wrapper.text()).not.toContain('部門排班規則')
    expect(wrapper.text()).not.toContain('中場休息設定')
  })

  it('does not fetch department managers', () => {
    mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    const calls = apiFetch.mock.calls
    expect(calls.find(c => c[0] === '/api/dept-managers')).toBeFalsy()
  })

  it('送出班別時包含休息設定', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })

    wrapper.vm.shiftForm.name = '測試班別'
    wrapper.vm.shiftForm.code = 'TEST'
    wrapper.vm.shiftForm.startTime = '09:00'
    wrapper.vm.shiftForm.endTime = '18:00'
    wrapper.vm.shiftForm.breakDuration = 90
    wrapper.vm.shiftForm.breakWindows = [{ start: '12:00', end: '13:00', label: '午休' }]

    await wrapper.vm.saveShift()

    const createCall = apiFetch.mock.calls.find((call) => call[0] === '/api/shifts' && call[1]?.method === 'POST')
    expect(createCall).toBeTruthy()
    expect(createCall[1].body).toContain('breakDuration')
    expect(createCall[1].body).toContain('午休')
  })

  it('builds ROC holidays with the local current year', () => {
    const getFullYearSpy = vi.spyOn(Date.prototype, 'getFullYear')
    const getUTCFullYearSpy = vi.spyOn(Date.prototype, 'getUTCFullYear')

    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.buildRocHolidays()

    expect(getFullYearSpy).toHaveBeenCalled()
    expect(getUTCFullYearSpy).not.toHaveBeenCalled()
  })
})
