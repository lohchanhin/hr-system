import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import CompanyCalendarPanel from '../src/components/backComponents/CompanyCalendarPanel.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

const YEAR = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4))
const NEXT = YEAR + 1

function yearItem(overrides = {}) {
  return {
    year: YEAR,
    state: 'draft',
    migrated: false,
    counts: { statutory: 2, gov_makeup_off: 1 },
    needsReview: 0,
    approvedAt: null,
    approvedByName: '',
    followGovernmentAdjustments: false,
    adjustmentAgreement: { reference: '', date: null, note: '' },
    ...overrides
  }
}

function day(overrides = {}) {
  return { id: 'd1', date: `${YEAR}-01-01`, kind: 'statutory', name: '開國紀念日', origin: 'public', hrEdited: false, archived: false, needsReview: false, excludedEmployees: [], ...overrides }
}

const DAYS = [
  day(),
  day({ id: 'd2', date: `${YEAR}-02-27`, kind: 'gov_makeup_off', name: '補假', compensatesDate: `${YEAR}-02-28`, compensatesName: '和平紀念日' }),
  day({ id: 'd3', date: `${YEAR}-02-28`, name: '和平紀念日' }),
  day({ id: 'd4', date: `${YEAR}-06-15`, kind: 'company_off', name: '院慶', origin: 'manual' })
]

function respond(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body })
}

describe('CompanyCalendarPanel.vue：年度狀態與操作流程', () => {
  let routes

  function setRoutes(overrides = {}) {
    routes = {
      'GET /api/company-calendar/years': () => respond({ years: [yearItem(), yearItem({ year: NEXT, state: 'none', counts: {} })], notices: [], lastCheck: {} }),
      [`GET /api/company-calendar/years/${YEAR}`]: () => respond({ year: yearItem(), days: DAYS }),
      [`GET /api/company-calendar/years/${NEXT}`]: () => respond({ year: yearItem({ year: NEXT, state: 'none' }), days: [] }),
      ...overrides
    }
    apiFetch.mockImplementation((url, options = {}) => {
      const handler = routes[`${options.method || 'GET'} ${url}`]
      return handler ? handler(options) : respond([])
    })
  }

  function callsTo(method, url) {
    return apiFetch.mock.calls.filter(([calledUrl, options = {}]) => calledUrl === url && (options.method || 'GET') === method)
  }

  async function mountPanel() {
    const wrapper = mount(CompanyCalendarPanel, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    apiFetch.mockReset()
    setRoutes()
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('每個狀態只有一個主要動作：沒有行事曆→建立草稿、草稿→核定、已核定→修改', async () => {
    const primaryButtons = (wrapper) => wrapper.findAll('[data-test="calendar-state-banner"] .el-button--primary:not(.is-link)').map((button) => button.text())

    setRoutes({
      'GET /api/company-calendar/years': () => respond({ years: [yearItem({ state: 'none', counts: {} })], notices: [], lastCheck: {} }),
      [`GET /api/company-calendar/years/${YEAR}`]: () => respond({ year: yearItem({ state: 'none' }), days: [] })
    })
    let wrapper = await mountPanel()
    expect(primaryButtons(wrapper)).toEqual(['從政府資料建立草稿'])
    expect(wrapper.find('[data-test="calendar-fetch-government"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="calendar-day-table"]').text()).toContain('請按上方「從政府資料建立草稿」')
    wrapper.unmount()

    setRoutes()
    wrapper = await mountPanel()
    expect(primaryButtons(wrapper)).toEqual(['核定'])
    expect(wrapper.find('[data-test="calendar-fetch-government"]').text()).toBe('比對政府資料')
    wrapper.unmount()

    setRoutes({ 'GET /api/company-calendar/years': () => respond({ years: [yearItem({ state: 'approved', approvedAt: '2026-10-20T02:00:00.000Z' })], notices: [], lastCheck: {} }) })
    wrapper = await mountPanel()
    expect(primaryButtons(wrapper)).toEqual([])
    expect(wrapper.find('[data-test="calendar-reopen"]').text()).toBe('修改')
  })

  it('各類假日的長說明預設收合，類型標籤與天數同時是圖例與篩選', async () => {
    const wrapper = await mountPanel()

    // 說明還在（收合區塊內），但不是直接攤在畫面上
    const legend = wrapper.find('[data-test="calendar-kind-legend"]')
    expect(legend.find('.el-collapse-item__header').text()).toContain('各類假日說明')
    expect(legend.find('.el-collapse-item__header').classes()).not.toContain('is-active')

    const chips = wrapper.findAll('[data-test="calendar-kind-chips"] .kind-chip')
    expect(chips.map((chip) => chip.text().replace(/\s+/g, ''))).toEqual(['國定假日2', '公務機關補假1', '公司休息日1'])
    const rows = () => wrapper.findAll('[data-test="calendar-day-table"] .el-table__body .el-table__row')
    expect(rows()).toHaveLength(4)
    expect(rows()[0].text()).toContain(`${YEAR}/01/01`)

    await wrapper.find('[data-test="calendar-kind-chip-gov_makeup_off"]').trigger('click')
    expect(rows()).toHaveLength(1)
    expect(rows()[0].text()).toContain('補 02/28 和平紀念日')
    await wrapper.find('[data-test="calendar-kind-chip-gov_makeup_off"]').trigger('click')
    expect(rows()).toHaveLength(4)
  })

  it('已核定的年度只能檢視：沒有編輯、刪除與新增，按「修改」確認後才回到草稿', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    let state = 'approved'
    setRoutes({
      'GET /api/company-calendar/years': () => respond({ years: [yearItem({ state, approvedAt: '2026-10-20T02:00:00.000Z' })], notices: [], lastCheck: {} }),
      [`POST /api/company-calendar/years/${YEAR}/reopen`]: () => { state = 'draft'; return respond({ year: YEAR, state: 'draft' }) }
    })
    const wrapper = await mountPanel()

    expect(wrapper.vm.readOnly).toBe(true)
    expect(wrapper.find('[data-test="calendar-read-only-hint"]').exists()).toBe(true)
    // 只看表格內容列（Element Plus 會另外在隱藏區塊算一次欄位樣板）
    const bodyButtons = (name) => wrapper.findAll(`[data-test="calendar-day-table"] .el-table__body [data-test="${name}"]`)
    expect(bodyButtons('calendar-day-edit')).toHaveLength(0)
    expect(bodyButtons('calendar-day-delete')).toHaveLength(0)
    expect(wrapper.find('[data-test="calendar-add-day"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="calendar-reopen"]').trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0][0]).toContain(`修改後 ${YEAR} 年會回到草稿`)
    expect(callsTo('POST', `/api/company-calendar/years/${YEAR}/reopen`)).toHaveLength(0)

    confirm.mockResolvedValue('confirm')
    await wrapper.find('[data-test="calendar-reopen"]').trigger('click')
    await flushPromises()
    expect(callsTo('POST', `/api/company-calendar/years/${YEAR}/reopen`)).toHaveLength(1)
    expect(wrapper.vm.readOnly).toBe(false)
    expect(bodyButtons('calendar-day-edit')).toHaveLength(4)
    expect(wrapper.find('[data-test="calendar-approve"]').exists()).toBe(true)
  })

  it('刪除日期前確認：政府資料可以復原，手動新增的說明無法復原', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    setRoutes({ 'DELETE /api/holidays/d4': () => respond({ success: true, archived: false }) })
    const wrapper = await mountPanel()

    await wrapper.vm.deleteDay(DAYS[1])
    expect(confirm.mock.calls[0][0]).toContain(`確定刪除 ${YEAR}/02/27`)
    expect(confirm.mock.calls[0][0]).toContain('刪除後可以打開「顯示已刪除」復原')
    expect(callsTo('DELETE', '/api/holidays/d2')).toHaveLength(0)

    await wrapper.vm.deleteDay(DAYS[3])
    expect(confirm.mock.calls[1][0]).toContain('這一天是手動新增的，刪除後無法復原')

    confirm.mockResolvedValue('confirm')
    await wrapper.vm.deleteDay(DAYS[3])
    await flushPromises()
    expect(callsTo('DELETE', '/api/holidays/d4')).toHaveLength(1)
    expect(ElMessage.success).toHaveBeenCalledWith('已刪除')
  })

  // 快速切換年度時，晚回來的舊年度回應會蓋掉新年度的清單（畫面寫 2027 年、列的卻是 2026 年的日子）
  it('切換年度時，晚回來的舊年度回應不會蓋掉新年度的清單', async () => {
    let resolveOld
    const wrapper = await mountPanel()
    routes[`GET /api/company-calendar/years/${YEAR}`] = () => new Promise((resolve) => { resolveOld = () => resolve({ ok: true, json: async () => ({ days: DAYS }) }) })
    routes[`GET /api/company-calendar/years/${NEXT}`] = () => respond({ days: [day({ id: 'n1', date: `${NEXT}-01-01` })] })

    wrapper.vm.refresh() // 重新讀取目前年度（回應還沒回來）
    await flushPromises()
    await wrapper.vm.onYearSelect(NEXT)
    await flushPromises()
    expect(wrapper.vm.days.map((item) => item.id)).toEqual(['n1'])

    resolveOld()
    await flushPromises()
    expect(wrapper.vm.selectedYear).toBe(NEXT)
    expect(wrapper.vm.days.map((item) => item.id)).toEqual(['n1'])
  })

  // 以前每次重新讀取清單（確認某一天、核定、套用…）都會把還沒儲存的年度設定還原
  it('還沒儲存的年度設定不會被重新讀取清單蓋掉；切換年度前先確認', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    setRoutes({ 'POST /api/holidays/d1/confirm': () => respond({ id: 'd1' }) })
    const wrapper = await mountPanel()

    wrapper.vm.settingsForm.followGovernmentAdjustments = true
    wrapper.vm.settingsForm.reference = '勞資會議 115-3'
    await flushPromises()
    expect(wrapper.vm.settingsDirty).toBe(true)
    expect(wrapper.find('[data-test="calendar-settings-dirty"]').exists()).toBe(true)

    await wrapper.vm.confirmDay(DAYS[0])
    await flushPromises()
    expect(wrapper.vm.settingsForm).toMatchObject({ followGovernmentAdjustments: true, reference: '勞資會議 115-3' })

    await wrapper.vm.onYearSelect(NEXT)
    expect(confirm.mock.calls[0][0]).toContain(`${YEAR} 年的「依政府調整放假」設定尚未儲存`)
    expect(wrapper.vm.selectedYear).toBe(YEAR)

    confirm.mockResolvedValue('confirm')
    await wrapper.vm.onYearSelect(NEXT)
    await flushPromises()
    expect(wrapper.vm.selectedYear).toBe(NEXT)
    expect(wrapper.vm.settingsForm).toMatchObject({ followGovernmentAdjustments: false, reference: '' })
  })

  it('核定的是按下按鈕當時的年度，核定中再按一次不會送第二次', async () => {
    let resolveApprove
    setRoutes({ [`POST /api/company-calendar/years/${YEAR}/approve`]: () => new Promise((resolve) => { resolveApprove = () => resolve({ ok: true, json: async () => ({ year: YEAR, state: 'approved' }) }) }) })
    const wrapper = await mountPanel()

    const first = wrapper.vm.approveYear()
    const second = wrapper.vm.approveYear()
    await flushPromises()
    expect(callsTo('POST', `/api/company-calendar/years/${YEAR}/approve`)).toHaveLength(1)
    // 等待期間切到別的年度，成功訊息仍是原本那一年
    wrapper.vm.selectedYear = NEXT
    resolveApprove()
    await Promise.all([first, second])
    expect(ElMessage.success).toHaveBeenCalledWith(`${YEAR} 年公司行事曆已核定`)
    expect(callsTo('POST', `/api/company-calendar/years/${NEXT}/approve`)).toHaveLength(0)
  })

  it('新增日期不預先填 1 月 1 日；存到別的年度時切到那個年度', async () => {
    setRoutes({ 'POST /api/holidays': () => respond({ id: 'new' }, true, 201) })
    const wrapper = await mountPanel()

    wrapper.vm.openDayDialog()
    expect(wrapper.vm.dayForm.date).toBe('')
    await wrapper.vm.saveDay()
    expect(ElMessage.error).toHaveBeenCalledWith('請填寫日期、類型與名稱')
    expect(callsTo('POST', '/api/holidays')).toHaveLength(0)

    Object.assign(wrapper.vm.dayForm, { date: `${NEXT}-05-20`, kind: 'company_off', name: '院慶' })
    await wrapper.vm.saveDay()
    await flushPromises()
    expect(callsTo('POST', '/api/holidays')).toHaveLength(1)
    expect(wrapper.vm.selectedYear).toBe(NEXT)
    expect(ElMessage.success).toHaveBeenCalledWith(`日期已儲存到 ${NEXT} 年行事曆`)
    expect(callsTo('GET', `/api/company-calendar/years/${NEXT}`).length).toBeGreaterThan(0)
  })

  it('沒有差異時不能按「套用」；沒有行事曆的年度不能儲存年度設定', async () => {
    setRoutes({
      'GET /api/company-calendar/years': () => respond({ years: [yearItem({ state: 'none', counts: {} })], notices: [], lastCheck: {} }),
      [`POST /api/company-calendar/years/${YEAR}/fetch`]: () => respond({ year: YEAR, conflict: false, selected: 'snap-1', diff: { year: YEAR, snapshotId: 'snap-1', unchanged: 24, counts: { add: 0, change: 0, remove: 0, conflict: 0 }, changes: [] } })
    })
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-test="calendar-settings-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="calendar-settings-follow"]').text()).toContain('請先建立這個年度的行事曆')

    await wrapper.vm.fetchGovernment()
    await flushPromises()
    expect(wrapper.vm.diffDialogVisible).toBe(true)
    expect(wrapper.find('[data-test="calendar-diff-apply"]').attributes('disabled')).toBeDefined()
  })
})
