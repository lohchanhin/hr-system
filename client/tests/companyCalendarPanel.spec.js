import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import CompanyCalendarPanel from '../src/components/backComponents/CompanyCalendarPanel.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

const YEAR = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4))

function yearItem(overrides = {}) {
  return {
    year: YEAR,
    state: 'draft',
    migrated: false,
    counts: { statutory: 16, gov_makeup_off: 6 },
    needsReview: 0,
    unlinkedMakeup: 0,
    approvedAt: null,
    approvedByName: '',
    followGovernmentAdjustments: false,
    adjustmentAgreement: { reference: '', date: null, note: '' },
    pendingSnapshot: null,
    ...overrides
  }
}

const DIFF = {
  year: YEAR,
  snapshotId: 'snap-1',
  source: 'dgpa',
  sha256: 'a'.repeat(64),
  unchanged: 20,
  counts: { add: 1, change: 1, remove: 0, conflict: 1 },
  changes: [
    { key: `${YEAR}-02-27`, date: `${YEAR}-02-27`, weekday: 5, type: 'change', current: { id: 'h1', kind: 'company_off', name: '公司休息日', hrEdited: true }, proposed: { kind: 'gov_makeup_off', name: '補假', compensatesDate: `${YEAR}-02-28` }, fields: ['kind', 'name'], conflict: true, defaultDecision: 'keep' },
    { key: `${YEAR}-12-25`, date: `${YEAR}-12-25`, weekday: 5, type: 'add', current: null, proposed: { kind: 'statutory', name: '行憲紀念日' }, fields: [], conflict: false, defaultDecision: 'accept' }
  ]
}

let routes

function respond(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body })
}

function setRoutes(overrides = {}) {
  routes = {
    'GET /api/company-calendar/years': () => respond({ years: [yearItem()], lastApprovedDate: null, notices: [], lastCheck: { lastCheckedAt: '2026-10-21T01:30:00.000Z', lastError: '' } }),
    [`GET /api/company-calendar/years/${YEAR}`]: () => respond({ year: yearItem(), days: [], links: [], warnings: [] }),
    ...overrides
  }
  apiFetch.mockImplementation((url, options = {}) => {
    const key = `${options.method || 'GET'} ${url}`
    const handler = routes[key]
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

describe('CompanyCalendarPanel.vue', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    setRoutes()
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the years, selects the current Taipei year and shows its state and last check', async () => {
    const wrapper = await mountPanel()

    expect(callsTo('GET', '/api/company-calendar/years')).toHaveLength(1)
    expect(callsTo('GET', `/api/company-calendar/years/${YEAR}`)).toHaveLength(1)
    expect(wrapper.vm.selectedYear).toBe(YEAR)
    expect(wrapper.find('[data-test="calendar-year-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="calendar-state-tag"]').text()).toBe('草稿')
    expect(wrapper.find('[data-test="calendar-last-check"]').text()).toContain('上次檢查：2026/10/21 09:30')
  })

  it.each([
    ['none', {}, `尚未建立 ${YEAR} 年公司行事曆`, 'calendar-fetch-button'],
    ['draft', {}, '草稿：請檢查假日分類後按「核定」', 'calendar-approve'],
    ['draft', { migrated: true }, '此年度由舊版資料轉換，舊版把公務機關補假也當成國定假日', 'calendar-approve'],
    ['approved', { approvedAt: '2026-10-20T02:00:00.000Z', approvedByName: '人資王' }, '已核定（人資王，2026/10/20 10:00）', 'calendar-reopen']
  ])('shows the %s banner', async (state, extra, text, button) => {
    setRoutes({ 'GET /api/company-calendar/years': () => respond({ years: [yearItem({ state, ...extra })], notices: [], lastCheck: {} }) })
    const wrapper = await mountPanel()

    const banner = wrapper.find('[data-test="calendar-state-banner"]')
    expect(banner.text()).toContain(text)
    expect(wrapper.find(`[data-test="${button}"]`).exists()).toBe(true)
  })

  it('fetches the government calendar, shows the diff and applies decisions with conflicts kept by default', async () => {
    setRoutes({
      [`POST /api/company-calendar/years/${YEAR}/fetch`]: () => respond({ year: YEAR, candidates: [{ snapshotId: 'snap-1' }], conflict: false, selected: 'snap-1', diff: DIFF }),
      [`POST /api/company-calendar/years/${YEAR}/apply`]: () => respond({ year: YEAR, applied: { added: 1, changed: 0, removed: 0, kept: 1 }, state: 'draft' })
    })
    const wrapper = await mountPanel()

    await wrapper.vm.fetchGovernment()
    await flushPromises()

    expect(wrapper.vm.diffDialogVisible).toBe(true)
    expect(wrapper.find('[data-test="calendar-diff-dialog"]').text()).toContain('HR 已修改')
    expect(wrapper.vm.decisions).toEqual({ [`${YEAR}-02-27`]: 'keep', [`${YEAR}-12-25`]: 'accept' })

    await wrapper.vm.applyDiff()
    await flushPromises()

    const [, options] = callsTo('POST', `/api/company-calendar/years/${YEAR}/apply`)[0]
    expect(JSON.parse(options.body)).toEqual({ snapshotId: 'snap-1', decisions: { [`${YEAR}-02-27`]: 'keep', [`${YEAR}-12-25`]: 'accept' } })
    expect(wrapper.vm.diffDialogVisible).toBe(false)
    expect(callsTo('GET', '/api/company-calendar/years').length).toBeGreaterThan(1)
    expect(wrapper.emitted('calendar-changed')).toBeTruthy()
  })

  it('creates a draft for a year that has none by applying the single government file directly', async () => {
    setRoutes({
      'GET /api/company-calendar/years': () => respond({ years: [yearItem({ state: 'none', counts: {} })], notices: [], lastCheck: {} }),
      [`POST /api/company-calendar/years/${YEAR}/fetch`]: () => respond({ year: YEAR, candidates: [{ snapshotId: 'snap-1' }], conflict: false, selected: 'snap-1', diff: { ...DIFF, changes: [DIFF.changes[1]] } }),
      [`POST /api/company-calendar/years/${YEAR}/apply`]: () => respond({ year: YEAR, applied: { added: 22 }, state: 'draft' })
    })
    const wrapper = await mountPanel()

    await wrapper.find('[data-test="calendar-fetch-button"]').trigger('click')
    await flushPromises()

    const [, options] = callsTo('POST', `/api/company-calendar/years/${YEAR}/apply`)[0]
    expect(JSON.parse(options.body)).toEqual({ snapshotId: 'snap-1', decisions: { [`${YEAR}-12-25`]: 'accept' } })
  })

  it('lists conflicting government files with the recommended one preselected, then opens its diff', async () => {
    setRoutes({
      [`POST /api/company-calendar/years/${YEAR}/fetch`]: () => respond({
        year: YEAR,
        conflict: true,
        selected: null,
        diff: null,
        candidates: [
          { snapshotId: 'old', resourceDescription: '114年中華民國政府行政機關辦公日曆表', counts: { statutory: 12 }, recommended: false },
          { snapshotId: 'new', resourceDescription: '114年中華民國政府行政機關辦公日曆表(1141020更新)', counts: { statutory: 15 }, recommended: true }
        ]
      }),
      'GET /api/company-calendar/snapshots/new/diff': () => respond(DIFF)
    })
    const wrapper = await mountPanel()

    await wrapper.vm.fetchGovernment()
    await flushPromises()

    const list = wrapper.find('[data-test="calendar-candidates"]')
    expect(list.text()).toContain('(1141020更新)')
    expect(list.text()).toContain('建議')
    expect(wrapper.vm.selectedCandidate).toBe('new')
    expect(wrapper.vm.diffDialogVisible).toBe(false)

    await wrapper.find('[data-test="calendar-candidate-diff"]').trigger('click')
    await flushPromises()
    expect(callsTo('GET', '/api/company-calendar/snapshots/new/diff')).toHaveLength(1)
    expect(wrapper.vm.diffDialogVisible).toBe(true)
  })

  it('asks for confirmation before approving a year with rows to review, and sends the acknowledgement', async () => {
    setRoutes({
      'GET /api/company-calendar/years': () => respond({ years: [yearItem({ needsReview: 2 })], notices: [], lastCheck: {} }),
      [`POST /api/company-calendar/years/${YEAR}/approve`]: () => respond({ year: YEAR, state: 'approved' })
    })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm')
    const wrapper = await mountPanel()

    await wrapper.vm.approveYear()
    expect(callsTo('POST', `/api/company-calendar/years/${YEAR}/approve`)).toHaveLength(0)

    await wrapper.vm.approveYear()
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[0][0]).toContain('還有 2 筆待確認的日期')
    const [, options] = callsTo('POST', `/api/company-calendar/years/${YEAR}/approve`)[0]
    expect(JSON.parse(options.body)).toEqual({ acknowledgeWarnings: true })
  })

  it('shows notices with a diff link and dismisses them', async () => {
    setRoutes({
      'GET /api/company-calendar/years': () => respond({
        years: [yearItem()],
        notices: [{ id: 'n1', type: 'revision_available', year: YEAR, message: `${YEAR} 年辦公日曆表有新版本，請檢視差異後套用`, snapshotId: 'snap-1' }],
        lastCheck: {}
      }),
      'POST /api/company-calendar/notices/n1/dismiss': () => respond({ id: 'n1', status: 'dismissed' })
    })
    const wrapper = await mountPanel()

    const notice = wrapper.find('[data-test="calendar-notice-revision_available"]')
    expect(notice.text()).toContain('有新版本')
    expect(notice.find('[data-test="calendar-notice-diff"]').exists()).toBe(true)

    await notice.find('[data-test="calendar-notice-dismiss"]').trigger('click')
    await flushPromises()
    expect(callsTo('POST', '/api/company-calendar/notices/n1/dismiss')).toHaveLength(1)
    expect(wrapper.find('[data-test="calendar-notice-revision_available"]').exists()).toBe(false)
  })

  it('explains all seven kinds in the legend', async () => {
    const wrapper = await mountPanel()

    const legend = wrapper.find('[data-test="calendar-kind-legend"]')
    expect(legend.findAll('.legend-item')).toHaveLength(7)
    for (const label of ['國定假日', '公務機關補假', '公務機關調整放假', '公務機關補行上班', '公司休息日', '公司上班日', '指定應放假日']) {
      expect(legend.text()).toContain(label)
    }
    expect(legend.text()).toContain('行政人員的建議調休日')
  })

  it('requires an agreement reference and date to follow government adjustments', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    setRoutes({ [`PUT /api/company-calendar/years/${YEAR}/settings`]: () => respond({ year: YEAR, state: 'draft' }) })
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-test="calendar-settings-follow"]').text()).toContain('只影響行政人員')
    wrapper.vm.settingsForm.followGovernmentAdjustments = true
    await wrapper.vm.saveSettings()
    expect(errorSpy).toHaveBeenCalledWith('啟用「依政府調整放假」必須填寫協議文號與同意日期')
    expect(callsTo('PUT', `/api/company-calendar/years/${YEAR}/settings`)).toHaveLength(0)

    wrapper.vm.settingsForm.reference = '勞資會議 115-3'
    wrapper.vm.settingsForm.date = `${YEAR}-01-15`
    await wrapper.vm.saveSettings()
    const [, options] = callsTo('PUT', `/api/company-calendar/years/${YEAR}/settings`)[0]
    expect(JSON.parse(options.body)).toEqual({
      followGovernmentAdjustments: true,
      adjustmentAgreement: { reference: '勞資會議 115-3', date: `${YEAR}-01-15`, note: '' }
    })
  })

  it('lets HR exclude employees from a designated day and maps duplicate errors', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    setRoutes({
      'GET /api/employees/options': () => respond([{ id: 'e1', name: '王小美' }, { id: 'e2', name: '李大華' }]),
      'POST /api/holidays': () => respond({ code: 'DUPLICATE_DAY', error: '這一天已有相同類型的行事曆紀錄' }, false, 409)
    })
    const wrapper = await mountPanel()

    wrapper.vm.openDayDialog()
    wrapper.vm.dayForm.kind = 'designated'
    wrapper.vm.onDayKindChange('designated')
    await flushPromises()
    const dialog = wrapper.find('[data-test="calendar-day-dialog"]')
    expect(dialog.text()).toContain('不適用的員工（例如沒有投票權）')
    expect(dialog.text()).toContain('只適用當天原應出勤的員工，不補假、不可調移')
    expect(wrapper.vm.employeeOptions).toEqual([{ id: 'e1', name: '王小美' }, { id: 'e2', name: '李大華' }])

    wrapper.vm.dayForm.date = `${YEAR}-11-28`
    wrapper.vm.dayForm.name = '地方公職人員選舉'
    wrapper.vm.dayForm.excludedEmployees = ['e2']
    await wrapper.vm.saveDay()

    const [, options] = callsTo('POST', '/api/holidays')[0]
    expect(JSON.parse(options.body)).toEqual({
      date: `${YEAR}-11-28`, kind: 'designated', name: '地方公職人員選舉', note: '', compensatesDate: null, excludedEmployees: ['e2']
    })
    expect(errorSpy).toHaveBeenCalledWith('這一天已有相同類型的紀錄')
    expect(wrapper.vm.dayDialogVisible).toBe(true)
  })

  it('shows the day table with kinds, links, sources and flags, and restores tombstones', async () => {
    setRoutes({
      [`GET /api/company-calendar/years/${YEAR}`]: () => respond({
        year: yearItem(),
        days: [
          { id: 'd1', date: `${YEAR}-02-27`, kind: 'gov_makeup_off', name: '補假', compensatesDate: `${YEAR}-02-28`, compensatesName: '和平紀念日', origin: 'public', hrEdited: false, archived: false, needsReview: false, excludedEmployees: [] },
          { id: 'd2', date: `${YEAR}-10-26`, kind: 'gov_makeup_off', name: '補假', compensatesDate: `${YEAR}-10-25`, origin: 'public', hrEdited: true, archived: true, excludedEmployees: [] }
        ],
        links: [],
        warnings: []
      }),
      'POST /api/holidays/d2/restore': () => respond({ id: 'd2', archived: false })
    })
    const wrapper = await mountPanel()

    const table = wrapper.find('[data-test="calendar-day-table"]')
    expect(table.text()).toContain('公務機關補假')
    expect(table.text()).toContain('補 02/28 和平紀念日')
    expect(table.text()).toContain('政府資料')
    expect(table.text()).not.toContain('10/26')

    await wrapper.find('[data-test="calendar-show-archived"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="calendar-day-table"]').text()).toContain('已刪除')

    await wrapper.vm.restoreDay({ id: 'd2' })
    expect(callsTo('POST', '/api/holidays/d2/restore')).toHaveLength(1)
  })

  it('loads the reconciliation report when the section is opened', async () => {
    setRoutes({
      'GET /api/company-calendar/reconciliation': () => respond({
        resolutions: [{ id: 'r1', employeeNo: 'N001', name: '王小美', holidayDate: `${YEAR}-02-20`, holidayName: '補假', currentKind: 'gov_makeup_off' }],
        moves: [],
        compensations: [],
        swaps: [],
        counts: { resolutions: 1, moves: 0, compensations: 0, swaps: 0 }
      })
    })
    const wrapper = await mountPanel()

    await wrapper.vm.loadReconciliation()
    await flushPromises()

    const section = wrapper.find('[data-test="calendar-reconciliation"]')
    expect(section.text()).toContain('對帳報告')
    expect(section.text()).toContain('休假處理 1')
  })

  // 待確認的日子可以直接按「確認」清掉標記，不必為了清標記而編輯（編輯會算人資修改）
  it('confirms a day that needs review without editing it', async () => {
    let confirmed = false
    setRoutes({
      [`GET /api/company-calendar/years/${YEAR}`]: () => respond({
        year: yearItem({ needsReview: confirmed ? 0 : 1 }),
        days: [
          { id: 'd7', date: `${YEAR}-07-01`, kind: 'statutory', name: '公司創立紀念日', origin: 'manual', hrEdited: false, archived: false, needsReview: !confirmed, reviewNote: '手動新增、名稱不在法定假日清單，請確認類型', excludedEmployees: [] },
          { id: 'd8', date: `${YEAR}-02-27`, kind: 'gov_makeup_off', name: '補假', origin: 'public', hrEdited: false, archived: false, needsReview: false, excludedEmployees: [] }
        ],
        links: [],
        warnings: []
      }),
      'POST /api/holidays/d7/confirm': () => {
        confirmed = true
        return respond({ id: 'd7', needsReview: false })
      }
    })
    const wrapper = await mountPanel()

    const buttons = wrapper.findAll('[data-test="calendar-day-confirm"]')
    expect(buttons).toHaveLength(1)
    await buttons[0].trigger('click')
    await flushPromises()

    expect(callsTo('POST', '/api/holidays/d7/confirm')).toHaveLength(1)
    expect(callsTo('PUT', '/api/holidays/d7')).toHaveLength(0)
    expect(wrapper.findAll('[data-test="calendar-day-confirm"]')).toHaveLength(0)
  })

  it('explains company moves whose target collides with another move or a personal holiday', async () => {
    setRoutes({
      'GET /api/company-calendar/reconciliation': () => respond({
        resolutions: [],
        moves: [
          { id: 'm1', sourceDate: `${YEAR}-02-28`, targetDate: `${YEAR}-03-02`, problem: 'duplicate_target' },
          { id: 'm1', sourceDate: `${YEAR}-02-28`, targetDate: `${YEAR}-03-02`, problem: 'target_taken' }
        ],
        compensations: [],
        swaps: [],
        counts: { resolutions: 0, moves: 2, compensations: 0, swaps: 0 }
      })
    })
    const wrapper = await mountPanel()

    await wrapper.vm.loadReconciliation()
    await flushPromises()

    const section = wrapper.find('[data-test="calendar-reconciliation"]')
    expect(section.text()).toContain('和另一筆公司調移同一天')
    expect(section.text()).toContain('調移日已是員工的個人調移日或補假日')
  })
})
