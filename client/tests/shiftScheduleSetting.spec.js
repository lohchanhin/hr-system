import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import CompanyCalendarPanel from '../src/components/backComponents/CompanyCalendarPanel.vue'
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

  // 舊版「一鍵載入當年國定假日」直接把政府資料全部存成國定假日（2026 年 22 天）；
  // 現在改成「行事曆設定」面板：每年由政府辦公日曆表建立草稿、檢視差異、人資核定
  it('no longer offers the one-click current-year ROC import and shows the company calendar panel instead', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).not.toContain('一鍵載入當年國定假日')
    expect(wrapper.vm.loadRocHolidays).toBeUndefined()
    expect(wrapper.findComponent(CompanyCalendarPanel).exists()).toBe(true)
    expect(apiFetch.mock.calls.some(([url]) => url === '/api/company-calendar/years')).toBe(true)
    expect(apiFetch.mock.calls.some(([url]) => String(url).startsWith('/api/holidays/import/roc'))).toBe(false)
  })

  it('shows this year\'s statutory holiday count in the header', async () => {
    const year = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4))
    apiFetch.mockImplementation((url) => {
      if (url === '/api/company-calendar/years') {
        return Promise.resolve({ ok: true, json: async () => ({ years: [{ year, state: 'draft', counts: { statutory: 16, gov_makeup_off: 6 } }], notices: [], lastCheck: {} }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.find('[data-test="stat-statutory-this-year"]').text()).toBe('16')
    expect(wrapper.text()).toContain('國定假日（今年）')
  })

  it('shows an error and writes no holidays when building a draft from the government calendar fails', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    apiFetch.mockImplementation((url) => {
      if (String(url).endsWith('/fetch')) {
        return Promise.resolve({ ok: false, status: 502, json: async () => ({ code: 'SOURCE_UNAVAILABLE', error: '無法取得政府辦公日曆表，請稍後再試' }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockClear()

    await wrapper.findComponent(CompanyCalendarPanel).vm.createDraftFromGovernment()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('未寫入任何資料'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('無法取得政府辦公日曆表'))
    expect(successSpy).not.toHaveBeenCalled()
    // 不會套用、也不會逐筆寫入 /api/holidays
    expect(apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/apply'))).toHaveLength(0)
    expect(apiFetch.mock.calls.filter(([url, options]) => url === '/api/holidays' && options?.method === 'POST')).toHaveLength(0)
  })

  it('shows an error when the government calendar request itself throws', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockImplementation((url) => {
      if (String(url).endsWith('/fetch')) return Promise.reject(new Error('Failed to fetch'))
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    await wrapper.findComponent(CompanyCalendarPanel).vm.createDraftFromGovernment()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'))
    expect(apiFetch.mock.calls.filter(([url, options]) => url === '/api/holidays' && options?.method === 'POST')).toHaveLength(0)
  })

  it('shows the server error and keeps the dialog open when saving a calendar day is rejected', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    apiFetch.mockImplementation((url, options = {}) => {
      if (url === '/api/holidays' && options.method === 'POST') {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: '需要管理員權限' }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const panel = wrapper.findComponent(CompanyCalendarPanel)
    panel.vm.openDayDialog()
    panel.vm.dayForm = { id: '', date: '2026-06-19', kind: 'statutory', name: '端午節', compensatesDate: '', excludedEmployees: [], note: '' }

    await panel.vm.saveDay()

    expect(errorSpy).toHaveBeenCalledWith('需要管理員權限')
    expect(panel.vm.dayDialogVisible).toBe(true)
  })

  it('explains that this tab is the company-wide move and where individual moves are recorded', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const hint = wrapper.find('[data-test="holiday-move-hint"]').text()
    expect(hint).toContain('全公司統一調移（可跨月）')
    expect(hint).toContain('個別員工的調移需本人同意')
    expect(hint).toContain('排班頁「國定假日休假」的「個人調移」')
  })

  // 舊規則只能同月挪移、勾選簽核才要協議資料；新規則可以跨月，協議文號與日期一律必填
  it('creates a cross-month national holiday move through the settings API', async () => {
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).toContain('國定假日挪移')
    wrapper.vm.holidayMoveForm.sourceDate = '2027-02-28'
    wrapper.vm.holidayMoveForm.targetDate = '2027-03-02'
    wrapper.vm.holidayMoveForm.reason = '院內排班調整'
    wrapper.vm.holidayMoveForm.agreementReference = 'LABOR-MEETING-2027-01'
    wrapper.vm.holidayMoveForm.agreementDate = '2027-01-20'
    await wrapper.vm.saveHolidayMove()

    const call = apiFetch.mock.calls.find((entry) => (
      entry[0] === '/api/holiday-move-settings' && entry[1]?.method === 'POST'
    ))
    expect(call).toBeTruthy()
    expect(JSON.parse(call[1].body)).toEqual({
      enableHolidayMove: true,
      sourceDate: '2027-02-28',
      targetDate: '2027-03-02',
      reason: '院內排班調整',
      needSignature: true,
      needMakeup: false,
      agreementReference: 'LABOR-MEETING-2027-01',
      agreementDate: '2027-01-20',
      makeupConfirmed: false
    })
  })

  it('requires the agreement reference and date before saving a move', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.holidayMoveForm.sourceDate = '2027-02-28'
    wrapper.vm.holidayMoveForm.targetDate = '2027-03-02'

    await wrapper.vm.saveHolidayMove()

    expect(errorSpy).toHaveBeenCalledWith('請填寫同意文件編號與同意日期')
    expect(apiFetch.mock.calls.some(([url, options]) => url === '/api/holiday-move-settings' && options?.method === 'POST')).toBe(false)
  })

  it('offers only statutory days of last, this and next year as move sources and flags old moves without agreement data', async () => {
    apiFetch.mockImplementation((url) => {
      if (String(url).startsWith('/api/holidays?kind=statutory')) {
        const year = String(url).match(/year=(\d{4})/)[1]
        return Promise.resolve({ ok: true, json: async () => [{ _id: `h-${year}`, date: `${year}-02-28T00:00:00.000Z`, name: '和平紀念日', kind: 'statutory' }] })
      }
      if (url === '/api/holiday-move-settings') {
        return Promise.resolve({ ok: true, json: async () => [{ _id: 'm1', enableHolidayMove: true, sourceDate: '2026-04-04', targetDate: '2026-04-07', agreementReference: '', agreementDate: null }] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(ShiftScheduleSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const year = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4))
    expect(apiFetch.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      `/api/holidays?kind=statutory&year=${year - 1}`,
      `/api/holidays?kind=statutory&year=${year}`,
      `/api/holidays?kind=statutory&year=${year + 1}`,
    ]))
    expect(wrapper.vm.movableHolidayOptions.map((holiday) => holiday.date)).toEqual([`${year - 1}-02-28`, `${year}-02-28`, `${year + 1}-02-28`])
    expect(wrapper.find('[data-test="holiday-move-missing-agreement"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('缺少協議資料')
  })
})
