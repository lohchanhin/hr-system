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

  it('imports ROC holidays for the local current year and writes no built-in fallback list', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockClear()
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    const getFullYearSpy = vi.spyOn(Date.prototype, 'getFullYear')
    const getUTCFullYearSpy = vi.spyOn(Date.prototype, 'getUTCFullYear')

    await wrapper.vm.loadRocHolidays()

    const importCall = apiFetch.mock.calls.find(([url]) => String(url).startsWith('/api/holidays/import/roc'))
    expect(importCall?.[0]).toBe(`/api/holidays/import/roc?year=${new Date().getFullYear()}`)
    expect(importCall?.[1]).toMatchObject({ method: 'POST' })
    expect(getFullYearSpy).toHaveBeenCalled()
    expect(getUTCFullYearSpy).not.toHaveBeenCalled()
    expect(successSpy).toHaveBeenCalled()
    expect(wrapper.vm.loadingHolidays).toBe(false)
  })

  it('shows an error and writes no fake holidays when the ROC holiday import fails', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    apiFetch.mockImplementation((url) => {
      if (String(url).startsWith('/api/holidays/import/roc')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: '遠端連線失敗: 503' }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockClear()

    await wrapper.vm.loadRocHolidays()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('未寫入任何資料'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('遠端連線失敗: 503'))
    expect(successSpy).not.toHaveBeenCalled()
    // 不再退回內建的（錯誤的）假日清單，也不逐筆寫入 /api/holidays
    expect(apiFetch.mock.calls.filter(([url, options]) => url === '/api/holidays' && options?.method === 'POST')).toHaveLength(0)
    expect(wrapper.vm.loadingHolidays).toBe(false)
  })

  it('shows an error when the ROC holiday import request itself throws', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockImplementation((url) => {
      if (String(url).startsWith('/api/holidays/import/roc')) return Promise.reject(new Error('Failed to fetch'))
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    await wrapper.vm.loadRocHolidays()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'))
    expect(apiFetch.mock.calls.filter(([url, options]) => url === '/api/holidays' && options?.method === 'POST')).toHaveLength(0)
  })

  it('shows the server error and keeps the dialog open when saving a holiday is rejected', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockImplementation((url, options = {}) => {
      if (url === '/api/holidays' && options.method === 'POST') {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: '需要管理員權限' }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    wrapper.vm.openCalendarDialog()
    wrapper.vm.calendarForm = { name: '', date: '2026/06/19', type: '國定假日', desc: '端午節' }

    await wrapper.vm.saveHoliday()

    expect(errorSpy).toHaveBeenCalledWith('需要管理員權限')
    expect(wrapper.vm.calendarDialogVisible).toBe(true)
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
