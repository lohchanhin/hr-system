import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

const DAY = { _id: 's-day', code: 'D', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60, breakWindows: [], crossDay: false, bgColor: '#dbeafe', color: '#1e3a8a' }
const NIGHT_NO_ALLOWANCE = { _id: 's-night', code: 'N', name: '大夜', semanticType: 'work', startTime: '22:00', endTime: '06:00', breakDuration: 30, breakWindows: [{ start: '02:00', end: '02:30', label: '' }], crossDay: true, isNightShift: true, hasAllowance: false, fixedAllowanceAmount: 0 }
const OFF = { _id: 's-off', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00', breakDuration: 0, crossDay: false }

function respond(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body })
}

describe('ShiftScheduleSetting.vue：班別與挪移的防呆', () => {
  let wrapper
  let routes

  function setRoutes(overrides = {}) {
    routes = { 'GET /api/shifts': () => respond([DAY, NIGHT_NO_ALLOWANCE, OFF]), ...overrides }
    apiFetch.mockImplementation((url, options = {}) => {
      const handler = routes[`${options.method || 'GET'} ${url}`]
      return handler ? handler(options) : respond([])
    })
  }

  function callsTo(method, url) {
    return apiFetch.mock.calls.filter(([calledUrl, options = {}]) => calledUrl === url && (options.method || 'GET') === method)
  }

  async function mountSetting() {
    wrapper = mount(ShiftScheduleSetting, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    apiFetch.mockReset()
    setRoutes()
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('頁首用共用的 PageHeader，統計數字放在頁首，沒有漸層大橫幅', async () => {
    await mountSetting()

    const header = wrapper.find('[data-test="page-header"]')
    expect(header.find('h1').text()).toBe('排班表設定')
    expect(header.find('[data-test="stat-shift-count"]').text()).toBe('3')
    expect(header.find('[data-test="stat-move-count"]').text()).toBe('0')
    expect(wrapper.find('.header-stats').exists()).toBe(false)
  })

  it('列表顯示班別色塊、跨日、休息與實際工時（與伺服器的算法相同）', async () => {
    await mountSetting()

    const rows = wrapper.findAll('[data-test="shift-table"] .el-table__body .el-table__row')
    expect(rows).toHaveLength(3)
    expect(rows[0].find('[data-test="shift-chip"]').text()).toBe('D')
    expect(rows[0].find('[data-test="shift-chip"]').attributes('style')).toContain('color: rgb(30, 58, 138)')
    expect(rows[0].text()).toContain('08:00–17:00')
    expect(rows[0].find('[data-test="shift-work-hours"]').text()).toBe('8 小時')
    expect(rows[1].text()).toContain('22:00–次日 06:00')
    expect(rows[1].text()).toContain('夜班')
    expect(rows[1].text()).not.toContain('津貼')
    expect(rows[1].find('[data-test="shift-work-hours"]').text()).toBe('7.5 小時')
    // 不需上班的班別不顯示 00:00–00:00
    expect(rows[2].text()).not.toContain('00:00')
    expect(rows[2].find('[data-test="shift-work-hours"]').exists()).toBe(false)
  })

  it('「跨日」標記和時間不一致的舊資料會在列表上提醒', async () => {
    setRoutes({ 'GET /api/shifts': () => respond([{ ...NIGHT_NO_ALLOWANCE, crossDay: false }, { ...DAY, _id: 's-early', code: 'E', name: '大夜早', startTime: '00:00', endTime: '08:00', crossDay: true }, DAY]) })
    await mountSetting()

    expect(wrapper.findAll('[data-test="shift-crossday-mismatch"]')).toHaveLength(2)
  })

  // 以前用 watch 連動夜班與津貼：表單內容一換（開啟另一筆班別）就把津貼自動打開，存檔時不是被擋就是不小心開了津貼
  it('編輯「夜班但沒有津貼」的班別不會自動把津貼打開', async () => {
    setRoutes({ 'PUT /api/shifts/s-night': () => respond(NIGHT_NO_ALLOWANCE) })
    await mountSetting()

    wrapper.vm.openShiftDialog(0)
    await flushPromises()
    wrapper.vm.openShiftDialog(1)
    await flushPromises()
    expect(wrapper.vm.shiftForm).toMatchObject({ isNightShift: true, hasAllowance: false, fixedAllowanceAmount: 0 })

    await wrapper.vm.saveShift()
    await flushPromises()
    const body = JSON.parse(callsTo('PUT', '/api/shifts/s-night')[0][1].body)
    expect(body).toMatchObject({ isNightShift: true, hasAllowance: false })
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('管理者自己打開夜班時預設開啟津貼，金額沒填不能存；關掉夜班清掉津貼', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    Object.assign(wrapper.vm.shiftForm, { code: 'N2', name: '小夜', startTime: '16:00', endTime: '00:00', isNightShift: true })
    wrapper.vm.onNightShiftChange(true)
    expect(wrapper.vm.shiftForm.hasAllowance).toBe(true)

    await wrapper.vm.saveShift()
    expect(ElMessage.error).toHaveBeenCalledWith('啟用夜班津貼時，固定津貼金額必須大於 0')
    expect(callsTo('POST', '/api/shifts')).toHaveLength(0)

    wrapper.vm.shiftForm.fixedAllowanceAmount = 300
    wrapper.vm.shiftForm.isNightShift = false
    wrapper.vm.onNightShiftChange(false)
    expect(wrapper.vm.shiftForm).toMatchObject({ hasAllowance: false, fixedAllowanceAmount: 0 })
  })

  it('儲存時「跨日」依時間決定：22:00–06:00 一定跨日、00:00–08:00 一定不跨日', async () => {
    setRoutes({ 'POST /api/shifts': () => respond({ _id: 'new' }) })
    await mountSetting()

    wrapper.vm.openShiftDialog()
    Object.assign(wrapper.vm.shiftForm, { code: 'X1', name: '測試夜', startTime: '22:00', endTime: '06:00', crossDay: false })
    await wrapper.vm.saveShift()
    await flushPromises()
    expect(JSON.parse(callsTo('POST', '/api/shifts')[0][1].body).crossDay).toBe(true)

    wrapper.vm.openShiftDialog()
    Object.assign(wrapper.vm.shiftForm, { code: 'X2', name: '測試早', startTime: '00:00', endTime: '08:00', crossDay: true })
    await wrapper.vm.saveShift()
    await flushPromises()
    expect(JSON.parse(callsTo('POST', '/api/shifts')[1][1].body).crossDay).toBe(false)
  })

  it('上下班時間相同時才出現「24 小時的班」選項，勾了才能存', async () => {
    setRoutes({ 'POST /api/shifts': () => respond({ _id: 'new' }) })
    await mountSetting()
    wrapper.vm.openShiftDialog()
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-full-day"]')).toBeNull()

    Object.assign(wrapper.vm.shiftForm, { code: 'F', name: '全日', startTime: '08:00', endTime: '08:00', breakDuration: 120 })
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-full-day"]')).not.toBeNull()
    await wrapper.vm.saveShift()
    expect(callsTo('POST', '/api/shifts')).toHaveLength(0)

    wrapper.vm.shiftForm.crossDay = true
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-computed-summary"]').textContent).toContain('08:00–次日 08:00，休息 120 分鐘，實際工時 22 小時')
    await wrapper.vm.saveShift()
    await flushPromises()
    expect(JSON.parse(callsTo('POST', '/api/shifts')[0][1].body)).toMatchObject({ startTime: '08:00', endTime: '08:00', crossDay: true })
  })

  it('即時顯示工時；休息時段不在上班時間內或休息比班別長時不能存', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    Object.assign(wrapper.vm.shiftForm, { code: 'D2', name: '日班二', startTime: '09:00', endTime: '18:00', breakDuration: 90 })
    await flushPromises()
    const summary = () => document.body.querySelector('[data-test="shift-computed-summary"]').textContent
    expect(summary()).toContain('09:00–18:00，休息 90 分鐘，實際工時 7.5 小時')

    // 有填休息時段：以時段合計為準，並提醒「休息時長」不會被使用
    wrapper.vm.shiftForm.breakWindows = [{ start: '12:00', end: '13:00', label: '午休' }]
    await flushPromises()
    expect(summary()).toContain('休息 60 分鐘，實際工時 8 小時')
    expect(document.body.querySelector('[data-test="shift-break-from-windows"]').textContent).toContain('60 分鐘')

    wrapper.vm.shiftForm.breakWindows = [{ start: '19:00', end: '20:00', label: '' }]
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-time-problems"]').textContent).toContain('第 1 筆休息時段不在上班時間內')
    await wrapper.vm.saveShift()
    expect(ElMessage.error).toHaveBeenCalledWith('第 1 筆休息時段不在上班時間內')

    wrapper.vm.shiftForm.breakWindows = []
    wrapper.vm.shiftForm.breakDuration = 600
    await wrapper.vm.saveShift()
    expect(ElMessage.error).toHaveBeenCalledWith('休息時間不可等於或超過上班到下班的時間')
    expect(callsTo('POST', '/api/shifts')).toHaveLength(0)
  })

  // 顏色選擇器清除後是 null；伺服器把 null 當成「沒送」而保留舊顏色，自訂顏色永遠清不掉
  it('清除顏色時送出空字串；文字和底色太接近時提醒並可改用自動顏色', async () => {
    setRoutes({ 'PUT /api/shifts/s-day': () => respond(DAY) })
    await mountSetting()
    wrapper.vm.openShiftDialog(0)
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-contrast-warning"]')).toBeNull()

    wrapper.vm.shiftForm.color = '#e0f2fe'
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-contrast-warning"]').textContent).toContain('看不清楚')
    document.body.querySelector('[data-test="shift-auto-text-color"]').click()
    await flushPromises()
    expect(wrapper.vm.shiftForm.color).toBe('')
    expect(document.body.querySelector('[data-test="shift-contrast-warning"]')).toBeNull()

    wrapper.vm.shiftForm.color = null
    wrapper.vm.shiftForm.bgColor = null
    await wrapper.vm.saveShift()
    await flushPromises()
    const body = JSON.parse(callsTo('PUT', '/api/shifts/s-day')[0][1].body)
    expect(body.color).toBe('')
    expect(body.bgColor).toBe('')
  })

  it('儲存中再按一次不會送第二次', async () => {
    let resolvePost
    setRoutes({ 'POST /api/shifts': () => new Promise((resolve) => { resolvePost = () => resolve({ ok: true, status: 201, json: async () => ({ _id: 'new' }) }) }) })
    await mountSetting()
    wrapper.vm.openShiftDialog()
    Object.assign(wrapper.vm.shiftForm, { code: 'Z', name: '測試', startTime: '09:00', endTime: '18:00' })

    const first = wrapper.vm.saveShift()
    const second = wrapper.vm.saveShift()
    await flushPromises()
    expect(callsTo('POST', '/api/shifts')).toHaveLength(1)
    resolvePost()
    await Promise.all([first, second])
    expect(wrapper.vm.shiftDialogVisible).toBe(false)
  })

  it('關閉有未儲存變更的班別對話框前先確認；沒有變更直接關閉', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await mountSetting()

    wrapper.vm.openShiftDialog(0)
    await wrapper.vm.closeShiftDialog()
    expect(confirm).not.toHaveBeenCalled()
    expect(wrapper.vm.shiftDialogVisible).toBe(false)

    wrapper.vm.openShiftDialog(0)
    wrapper.vm.shiftForm.name = '日班（改）'
    await wrapper.vm.closeShiftDialog()
    expect(confirm).toHaveBeenCalledWith('班別內容尚未儲存，確定要關閉嗎？', '尚未儲存', expect.any(Object))
    expect(wrapper.vm.shiftDialogVisible).toBe(true)

    confirm.mockResolvedValue('confirm')
    await wrapper.vm.closeShiftDialog()
    expect(wrapper.vm.shiftDialogVisible).toBe(false)
    // 取消編輯不會改到列表上的資料
    expect(wrapper.vm.shiftList[0].name).toBe('日班')
  })

  // 以前按「刪除」不問就刪，伺服器拒絕（還有班表在用）時畫面也沒有任何訊息
  it('刪除班別前確認並說明影響；取消就不刪', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    setRoutes({
      'GET /api/sub-departments': () => respond([
        { _id: 'u1', name: '護理一組', allowedShiftIds: ['s-day', 's-night'] },
        { _id: 'u2', name: '行政組', allowedShiftIds: [] }
      ]),
      'DELETE /api/shifts/s-day': () => respond(null, true, 204)
    })
    await mountSetting()

    await wrapper.vm.deleteShift(0)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('確定刪除班別「日班」嗎？已經排進班表的班別不能刪除。')
    expect(confirm.mock.calls[0][0]).toContain('小單位「護理一組」的「使用班別」有勾選這個班別')
    expect(callsTo('DELETE', '/api/shifts/s-day')).toHaveLength(0)

    confirm.mockResolvedValue('confirm')
    await wrapper.vm.deleteShift(0)
    await flushPromises()
    expect(callsTo('DELETE', '/api/shifts/s-day')).toHaveLength(1)
    expect(ElMessage.success).toHaveBeenCalledWith('班別已刪除')
  })

  it('還有班表在用時顯示伺服器說明的原因，班別留在列表上', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const reason = '「日班」還有 12 筆班表在使用（最近一筆 2026-11-30），不能刪除；請先把這些班表改成其他班別'
    setRoutes({ 'DELETE /api/shifts/s-day': () => respond({ error: reason, code: 'SHIFT_IN_USE', scheduleCount: 12 }, false, 409) })
    await mountSetting()

    await wrapper.vm.deleteShift(0)
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith(expect.objectContaining({ message: reason }))
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(wrapper.vm.shiftList).toHaveLength(3)
  })

  it('讀取班別失敗時顯示錯誤，不是空白的列表', async () => {
    setRoutes({ 'GET /api/shifts': () => respond({ error: '資料庫連線失敗' }, false, 500) })
    await mountSetting()

    expect(wrapper.find('[data-test="shift-load-error"]').text()).toContain('讀取班別失敗：資料庫連線失敗')
  })

  it('挪移：沒有功能的「需經簽核」「安排補班」不再顯示，舊資料的值照原樣送回', async () => {
    setRoutes({
      'GET /api/holiday-move-settings': () => respond([{ _id: 'm1', enableHolidayMove: true, sourceDate: '2027-02-28T00:00:00.000Z', targetDate: '2027-03-02T00:00:00.000Z', reason: '', needMakeup: true, makeupConfirmed: true, agreementReference: 'A-1', agreementDate: '2027-01-20T00:00:00.000Z' }]),
      'PUT /api/holiday-move-settings/m1': () => respond({ _id: 'm1' })
    })
    await mountSetting()

    expect(wrapper.find('[data-test="holiday-move-table"]').text()).toContain('2027/02/28（日）')
    expect(wrapper.find('[data-test="holiday-move-table"]').text()).toContain('2027/03/02（二）')
    expect(wrapper.text()).not.toContain('需補班')
    wrapper.vm.openHolidayMoveDialog(0)
    await flushPromises()
    expect(document.body.textContent).not.toContain('需經簽核')
    expect(document.body.textContent).not.toContain('安排補班')

    wrapper.vm.holidayMoveForm.reason = '更新原因'
    await wrapper.vm.saveHolidayMove()
    await flushPromises()
    expect(JSON.parse(callsTo('PUT', '/api/holiday-move-settings/m1')[0][1].body)).toEqual({
      enableHolidayMove: true,
      sourceDate: '2027-02-28',
      targetDate: '2027-03-02',
      reason: '更新原因',
      needSignature: true,
      needMakeup: true,
      agreementReference: 'A-1',
      agreementDate: '2027-01-20',
      makeupConfirmed: true
    })
  })

  it('挪移：伺服器的英文檢查訊息換成中文；同一天不能挪給自己', async () => {
    let error = { error: 'targetDate is already a holiday' }
    setRoutes({ 'POST /api/holiday-move-settings': () => respond(error, false, 400) })
    await mountSetting()
    Object.assign(wrapper.vm.holidayMoveForm, { sourceDate: '2027-02-28', targetDate: '2027-02-28', agreementReference: 'A-1', agreementDate: '2027-01-20' })

    await wrapper.vm.saveHolidayMove()
    expect(ElMessage.error).toHaveBeenCalledWith('改放的日期不能和原國定假日同一天')
    expect(callsTo('POST', '/api/holiday-move-settings')).toHaveLength(0)

    wrapper.vm.holidayMoveForm.targetDate = '2027-03-01'
    await wrapper.vm.saveHolidayMove()
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('改放的那一天已經是假日（國定假日、指定應放假日或公務機關補假），請改選其他日子')

    error = { error: 'E11000 duplicate key error collection: hr.holidaymovesettings index: sourceDate_1 dup key' }
    await wrapper.vm.saveHolidayMove()
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('這個國定假日已經設定過挪移，請直接編輯原本那一筆')

    // 伺服器已經是中文的訊息照原樣顯示
    error = { error: '這一天已是另一筆全公司調移的調移日，請改選其他日子', code: 'TARGET_TAKEN' }
    await wrapper.vm.saveHolidayMove()
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('這一天已是另一筆全公司調移的調移日，請改選其他日子')
  })

  it('挪移：刪除前確認，取消就不刪', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    setRoutes({
      'GET /api/holiday-move-settings': () => respond([{ _id: 'm1', enableHolidayMove: true, sourceDate: '2027-02-28', targetDate: '2027-03-02', agreementReference: 'A-1', agreementDate: '2027-01-20' }]),
      'DELETE /api/holiday-move-settings/m1': () => respond({ success: true })
    })
    await mountSetting()

    await wrapper.vm.deleteHolidayMove(0)
    expect(confirm.mock.calls[0][0]).toContain('2027/02/28（日） 恢復為國定假日')
    expect(callsTo('DELETE', '/api/holiday-move-settings/m1')).toHaveLength(0)

    confirm.mockResolvedValue('confirm')
    await wrapper.vm.deleteHolidayMove(0)
    await flushPromises()
    expect(callsTo('DELETE', '/api/holiday-move-settings/m1')).toHaveLength(1)
    expect(ElMessage.success).toHaveBeenCalledWith('國定假日挪移已刪除')
  })
})
