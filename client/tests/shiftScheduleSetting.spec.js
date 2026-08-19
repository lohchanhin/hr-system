import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('ShiftScheduleSetting.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    apiFetch.mockReset()
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }))
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

  it('說明班別代碼用於公版匯入', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })

    wrapper.vm.openShiftDialog()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('公版班表日期欄填寫此代碼')
    expect(wrapper.text()).toContain('代碼是匯入識別鍵')
  })

  it('前端阻擋重複班別名稱且不送出 API', async () => {
    const messageSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockClear()
    wrapper.vm.shiftList = [{ _id: 's1', code: 'D', name: '日班' }]
    wrapper.vm.openShiftDialog()
    wrapper.vm.shiftForm.code = 'E'
    wrapper.vm.shiftForm.name = ' 日班 '
    wrapper.vm.shiftForm.startTime = '09:00'
    wrapper.vm.shiftForm.endTime = '18:00'

    await wrapper.vm.saveShift()

    expect(apiFetch.mock.calls.find(call => call[0] === '/api/shifts' && call[1]?.method === 'POST')).toBeFalsy()
    expect(messageSpy).toHaveBeenCalledWith(expect.stringContaining('班別名稱'))
    expect(wrapper.vm.shiftDialogVisible).toBe(true)
  })

  it('在列表上列出既有的重複班別代碼', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.shiftList = [
      { _id: 's1', code: '日', name: '08-17(休1)' },
      { _id: 's2', code: '日', name: '09-18(休1)' }
    ]
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.shiftIdentityConflicts).toHaveLength(1)
    expect(wrapper.text()).toContain('不可用於公版班表匯入')
    expect(wrapper.text()).toContain('08-17(休1)／09-18(休1)')
  })

  it('builds ROC holidays with the local current year', () => {
    const getFullYearSpy = vi.spyOn(Date.prototype, 'getFullYear')
    const getUTCFullYearSpy = vi.spyOn(Date.prototype, 'getUTCFullYear')

    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.buildRocHolidays()

    expect(getFullYearSpy).toHaveBeenCalled()
    expect(getUTCFullYearSpy).not.toHaveBeenCalled()
  })

  it('creates a same-month national holiday move through the settings API', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).toContain('國定假日挪移')
    wrapper.vm.holidayMoveForm.sourceDate = '2036-04-07'
    wrapper.vm.holidayMoveForm.targetDate = '2036-04-20'
    wrapper.vm.holidayMoveForm.reason = '院內排班調整'
    wrapper.vm.holidayMoveForm.needSignature = true
    wrapper.vm.holidayMoveForm.agreementReference = 'LABOR-MEETING-2036-04'
    wrapper.vm.holidayMoveForm.agreementDate = '2036-03-20'
    await wrapper.vm.saveHolidayMove()

    const call = apiFetch.mock.calls.find((entry) => (
      entry[0] === '/api/holiday-move-settings' && entry[1]?.method === 'POST'
    ))
    expect(call).toBeTruthy()
    expect(JSON.parse(call[1].body)).toEqual({
      enableHolidayMove: true,
      sourceDate: '2036-04-07',
      targetDate: '2036-04-20',
      reason: '院內排班調整',
      needSignature: true,
      needMakeup: false,
      agreementReference: 'LABOR-MEETING-2036-04',
      agreementDate: '2036-03-20',
      makeupConfirmed: false
    })
  })
})
