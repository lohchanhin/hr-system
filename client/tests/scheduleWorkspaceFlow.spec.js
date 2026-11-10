import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// 排班頁 2026/11 的版面與操作流程（頁首、發布狀態列、批次操作列、單格儲存狀態與復原），
// 以及這一輪修掉的問題：切換月份的競態、切換範圍後殘留的選取、新增班表後發布狀態沒更新、空範圍匯出。

const elementPlus = vi.hoisted(() => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: { alert: vi.fn(), confirm: vi.fn() },
  ElLoading: { service: vi.fn(() => ({ close: vi.fn() })) }
}))
vi.mock('element-plus', () => elementPlus)
vi.mock('../src/api', () => ({ apiFetch: vi.fn(), importScheduleRecords: vi.fn() }))
const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

import { apiFetch } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

const { ElMessage, ElMessageBox } = elementPlus
const token = role => `stub.${Buffer.from(JSON.stringify({ role }), 'utf8').toString('base64')}.sig`
const json = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
  blob: async () => new Blob(['x'])
})

const SHIFTS = [
  { _id: 's1', code: 'D', name: '白班', startTime: '08:00', endTime: '16:00', semanticType: 'work' },
  { _id: 's2', code: 'N', name: '大夜', startTime: '22:00', endTime: '06:00', crossDay: true, semanticType: 'work' }
]
const DEPARTMENTS = [
  { _id: 'd1', name: '護理部' },
  { _id: 'd2', name: '行政部' }
]
const UNITS = [
  { _id: 'u1', name: 'A 病房', department: 'd1' },
  { _id: 'u2', name: '總務', department: 'd2' }
]
const EMPLOYEES = {
  u1: [
    { _id: 'e1', employeeId: 'A001', name: '王小明', department: 'd1', subDepartment: 'u1' },
    { _id: 'e2', employeeId: 'A002', name: '李小華', department: 'd1', subDepartment: 'u1' }
  ],
  u2: [{ _id: 'e9', employeeId: 'B001', name: '陳總務', department: 'd2', subDepartment: 'u2' }]
}
const draftSummary = (hasSchedules = false) => ({
  status: 'draft',
  pendingEmployees: [],
  disputedEmployees: [],
  publishedAt: null,
  hasSchedules,
  totalEmployees: 0,
  allEmployeesConfirmed: false
})

// 可以個別擋住、之後再放行的回應（模擬較慢的請求）
function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

let handlers
function mockApi() {
  handlers = {
    monthly: () => json({ schedules: [], publishSummary: draftSummary(false) }),
    summary: () => json({ stats: { direct: 2, unscheduled: 2, onLeave: 0 } }),
    employees: query => {
      const list = EMPLOYEES[query.get('subDepartment')] || []
      return json({ employees: list, pagination: { total: list.length, page: 1, pageSize: 50, totalPages: 1 } })
    },
    memos: () => json([]),
    headers: () => json({ entries: [] }),
    write: () => json({ _id: 'new-1', shiftId: 's1' })
  }
  apiFetch.mockImplementation(async (url, options = {}) => {
    const [path, queryString = ''] = String(url).split('?')
    const query = new URLSearchParams(queryString)
    const method = String(options.method || 'GET').toUpperCase()
    if (path === '/api/shifts') return json(SHIFTS)
    if (path === '/api/departments') return json(DEPARTMENTS)
    if (path === '/api/sub-departments') {
      const dept = query.get('department')
      return json(dept ? UNITS.filter(unit => unit.department === dept) : UNITS)
    }
    if (path === '/api/employees/schedule') return handlers.employees(query, url)
    if (path === '/api/schedules/monthly') return handlers.monthly(query, url)
    if (path === '/api/schedules/summary') return handlers.summary(query, url)
    if (path === '/api/schedules/memos') return handlers.memos(query, url)
    if (path === '/api/schedules/leave-approvals') return json({ approvals: [], leaves: [] })
    if (path === '/api/holiday-calendar/headers') return handlers.headers(query, url)
    if (path === '/api/schedules/rules/validate') return json({ ok: true, count: 0, violations: [] })
    if (path === '/api/schedules/export') return handlers.export ? handlers.export(query, url) : json({})
    if (path.startsWith('/api/schedules') && method !== 'GET') return handlers.write(url, options)
    return json([])
  })
}

const SelectStub = {
  name: 'ElSelect',
  props: ['modelValue', 'disabled'],
  template: '<select v-bind="$attrs" :disabled="disabled"><slot></slot></select>'
}
const stubs = {
  PageHeader: false,
  'el-select': SelectStub,
  'el-option': { name: 'ElOption', props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-button': { name: 'ElButton', template: '<button v-bind="$attrs"><slot></slot></button>' },
  'el-popover': { name: 'ElPopover', template: '<div class="popover-stub"><slot name="reference"></slot><slot></slot></div>' },
  'el-table': { name: 'ElTable', template: '<div class="table-stub"><slot></slot></div>' },
  'el-table-column': { name: 'ElTableColumn', template: '<div class="column-stub"><slot name="header"></slot></div>' },
  'el-badge': { name: 'ElBadge', template: '<span><slot></slot></span>' },
  'el-icon': { name: 'ElIcon', template: '<i></i>' },
  'el-steps': { name: 'ElSteps', template: '<div class="steps-stub"><slot></slot></div>' },
  'el-step': { name: 'ElStep', template: '<div></div>' },
  ScheduleDashboard: { name: 'ScheduleDashboard', props: ['summary'], template: '<div class="dashboard-stub">{{ summary.direct }}</div>' }
}

const mounted = []
async function mountAdmin() {
  localStorage.setItem('token', token('admin'))
  const wrapper = shallowMount(Schedule, { global: { stubs } })
  mounted.push(wrapper)
  await flush()
  return wrapper
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise(resolve => setTimeout(resolve))
}

const hidden = node => (node.attributes('style') || '').includes('display: none')

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  apiFetch.mockReset()
  pushMock.mockReset()
  Object.values(ElMessage).forEach(fn => fn.mockReset())
  ElMessageBox.alert.mockReset()
  ElMessageBox.confirm.mockReset()
  ElMessageBox.confirm.mockResolvedValue()
  mockApi()
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})

describe('排班頁的版面（2026/11 介面規範）', () => {
  it('頁首放標題、統計與月份／部門／單位；發布狀態只佔一列，流程詳情預設收合', async () => {
    const wrapper = await mountAdmin()

    const header = wrapper.find('[data-test="page-header"]')
    expect(header.exists()).toBe(true)
    expect(header.text()).toContain('排班管理')
    expect(header.find('.dashboard-stub').exists()).toBe(true)
    expect(header.find('[data-test="schedule-department-select"]').exists()).toBe(true)
    expect(header.find('[data-test="schedule-subdepartment-select"]').exists()).toBe(true)
    expect(header.find('[data-test="month-prev"]').exists()).toBe(true)

    // 尚未發布：只有一個主要按鈕「發送待確認」，不能按的原因用一行字說明
    const buttons = wrapper.findAll('.publish-btn')
    expect(buttons.map(button => button.text())).toEqual(['發送待確認'])
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="publish-disable-reasons"]').text()).toContain('沒有可發布班表')
    expect(hidden(wrapper.find('[data-test="publish-detail"]'))).toBe(true)

    await wrapper.find('[data-test="publish-detail-toggle"]').trigger('click')
    expect(hidden(wrapper.find('[data-test="publish-detail"]'))).toBe(false)
  })

  it('已發送過的月份：主要按鈕是「完成發布」，另外可以重新發送；完成發布後不再顯示按鈕', async () => {
    handlers.monthly = () => json({
      schedules: [],
      publishSummary: { ...draftSummary(true), status: 'pending', pendingEmployees: [{ id: 'e1', name: '王小明', pendingCount: 3 }] }
    })
    const wrapper = await mountAdmin()

    expect(wrapper.findAll('.publish-btn').map(button => button.text())).toEqual(['重新發送', '完成發布'])
    expect(wrapper.find('[data-test="finalize-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="publish-button"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="publish-disable-reasons"]').text()).toContain('尚未回覆')
    expect(wrapper.find('[data-test="publish-pending-chip"]').text()).toContain('待回覆 3 筆')

    handlers.monthly = () => json({ schedules: [], publishSummary: { ...draftSummary(true), status: 'finalized' } })
    await wrapper.vm.refreshScheduleData({ reset: true })
    await flush()
    expect(wrapper.findAll('.publish-btn')).toHaveLength(0)
    expect(wrapper.find('[data-test="publish-status-badge"]').text()).toContain('已完成發布')
  })

  it('批次操作只在有選取時出現，取代同一列的圖例與搜尋；Esc 取消選取', async () => {
    const wrapper = await mountAdmin()
    const idle = () => wrapper.find('.grid-toolbar__idle')
    const bar = () => wrapper.find('[data-test="selection-bar"]')

    expect(hidden(idle())).toBe(false)
    expect(hidden(bar())).toBe(true)

    wrapper.vm.toggleCell('e1', 3, true)
    await wrapper.vm.$nextTick()
    expect(hidden(idle())).toBe(true)
    expect(hidden(bar())).toBe(false)
    expect(wrapper.find('[data-test="selection-scope-hint"]').text()).toBe('已選取 1 格')

    wrapper.vm.toggleEmployee('e2', true)
    await wrapper.vm.$nextTick()
    const days = wrapper.vm.days.length
    expect(wrapper.find('[data-test="selection-scope-hint"]').text()).toBe(`已選取 ${days + 1} 格（1 位員工）`)

    wrapper.vm.handlePageKeydown({ key: 'Escape', target: document.body })
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.hasAnySelection).toBe(false)
    expect(hidden(bar())).toBe(true)
  })

  it('Esc 在輸入框、下拉選單裡不取消選取', async () => {
    const wrapper = await mountAdmin()
    wrapper.vm.toggleCell('e1', 3, true)
    const input = document.createElement('input')
    input.type = 'text'
    wrapper.vm.handlePageKeydown({ key: 'Escape', target: input })
    expect(wrapper.vm.hasAnySelection).toBe(true)
  })

  it('相關簽核預設收合，只顯示筆數；「查看簽核」會展開', async () => {
    const wrapper = await mountAdmin()
    expect(wrapper.find('.approval-count').text()).toBe('0 項')
    expect(hidden(wrapper.find('[data-test="approval-body"]'))).toBe(true)

    wrapper.vm.jumpToApprovalSection()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.approvalCollapsed).toBe(false)
    expect(hidden(wrapper.find('[data-test="approval-body"]'))).toBe(false)
  })

  it('行事曆尚未核定的提醒只有一行；管理員可以直接前往行事曆設定', async () => {
    handlers.headers = () => json({ entries: [], status: { provisional: true, message: '尚未建立 2026 年公司行事曆' } })
    const wrapper = await mountAdmin()

    const notice = wrapper.find('[data-test="calendar-provisional-alert"]')
    expect(notice.text()).toContain('尚未建立 2026 年公司行事曆')
    await wrapper.find('[data-test="calendar-settings-link"]').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/manager/shift-schedule-setting')
  })

  it('沒有員工時說明下一步；有搜尋條件時提示調整條件', async () => {
    const wrapper = await mountAdmin()
    expect(wrapper.vm.gridEmptyText).toBe('這個單位目前沒有員工，請切換部門或單位')
    wrapper.vm.statusFilter = 'unscheduled'
    await flush()
    expect(wrapper.vm.gridEmptyText).toBe('沒有符合條件的員工，請調整搜尋或狀態篩選')
  })
})

describe('切換月份、部門時不留下上一個範圍的資料', () => {
  it('換月的當下就清掉班表、備忘錄與選取，新月份的資料回來前不會顯示上個月的班別', async () => {
    handlers.monthly = () => json({
      schedules: [{ _id: 'old-5', employee: 'e1', date: `${dayjsMonth()}-05T00:00:00.000Z`, shiftId: 's1' }],
      publishSummary: draftSummary(true)
    })
    handlers.memos = () => json([{ date: `${dayjsMonth()}-03T00:00:00.000Z`, content: '上個月的備忘錄' }])
    const wrapper = await mountAdmin()
    expect(wrapper.vm.scheduleMap.e1[5]).toMatchObject({ id: 'old-5', shiftId: 's1' })
    expect(wrapper.vm.dayMemos[3]).toBe('上個月的備忘錄')
    wrapper.vm.toggleCell('e1', 5, true)
    wrapper.vm.toggleDay(7, true)
    expect(wrapper.vm.hasAnySelection).toBe(true)

    const gate = deferred()
    handlers.monthly = () => gate.promise
    handlers.memos = () => json([])
    const changing = wrapper.vm.onMonthChange('2031-02')
    await flush()

    // 新月份的班表還沒回來：畫面上不能留著上個月 5 號的班別（那時點格子會改到上個月的班表）
    expect(wrapper.vm.currentMonth).toBe('2031-02')
    expect(wrapper.vm.scheduleMap.e1?.[5]).toBeUndefined()
    expect(wrapper.vm.dayMemos[3]).toBeUndefined()
    expect(wrapper.vm.hasAnySelection).toBe(false)
    expect(wrapper.vm.selectedDays.size).toBe(0)

    gate.resolve(json({ schedules: [], publishSummary: draftSummary(false) }))
    await changing
    await flush()
    expect(wrapper.vm.scheduleMap.e1[5]).toMatchObject({ shiftId: '' })
    expect(wrapper.vm.scheduleMap.e1[5].id).toBeUndefined()
  })

  it('上一個月較慢的回應不會蓋掉現在這個月的班表與發布狀態', async () => {
    const wrapper = await mountAdmin()

    const slow = deferred()
    handlers.monthly = query => {
      if (query.get('month') === '2031-03') return slow.promise
      return json({ schedules: [], publishSummary: draftSummary(false) })
    }
    const toMarch = wrapper.vm.onMonthChange('2031-03')
    await flush()
    const toApril = wrapper.vm.onMonthChange('2031-04')
    await toApril
    await flush()
    expect(wrapper.vm.currentMonth).toBe('2031-04')

    // 三月的回應這時才回來：已經鎖定、5 號有班——都不能寫進四月的畫面
    slow.resolve(json({
      schedules: [{ _id: 'march-5', employee: 'e1', date: '2031-03-05T00:00:00.000Z', shiftId: 's2', state: 'finalized' }],
      publishSummary: { ...draftSummary(true), status: 'finalized' }
    }))
    await toMarch
    await flush()

    expect(wrapper.vm.scheduleMap.e1[5]).toMatchObject({ shiftId: '' })
    expect(wrapper.vm.scheduleMap.e1[5].id).toBeUndefined()
    expect(wrapper.vm.publishSummary.status).toBe('draft')
    expect(wrapper.vm.rawSchedules).toEqual([])
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('上一個範圍較慢的統計、假日標示、員工名單都不會蓋掉最新的', async () => {
    const wrapper = await mountAdmin()

    // 統計：先發出的請求較慢
    const slowSummary = deferred()
    let summaryCalls = 0
    handlers.summary = () => {
      summaryCalls += 1
      return summaryCalls === 1 ? slowSummary.promise : json({ stats: { direct: 9, unscheduled: 1, onLeave: 0 } })
    }
    const first = wrapper.vm.fetchSummary()
    const second = wrapper.vm.fetchSummary()
    await second
    slowSummary.resolve(json({ stats: { direct: 2, unscheduled: 2, onLeave: 2 } }))
    await first
    expect(wrapper.vm.summary).toEqual({ direct: 9, unscheduled: 1, onLeave: 0 })

    // 假日標示：上一個月的回應較慢
    const slowHeaders = deferred()
    handlers.headers = query => (query.get('month') === '2031-05'
      ? slowHeaders.promise
      : json({ entries: [{ date: '2031-06-10', name: '六月的假日', displayKind: 'holiday', kind: 'holiday', isHoliday: true }] }))
    wrapper.vm.currentMonth = '2031-05'
    const mayHeaders = wrapper.vm.fetchHolidays()
    wrapper.vm.currentMonth = '2031-06'
    await wrapper.vm.fetchHolidays()
    const juneHolidays = wrapper.vm.holidays
    slowHeaders.resolve(json({ entries: [{ date: '2031-05-01', name: '五月的假日' }], status: { provisional: true, message: '五月的提醒' } }))
    await mayHeaders
    expect(wrapper.vm.holidays).toBe(juneHolidays)
    expect(wrapper.vm.calendarStatus).toBeNull()

    // 員工名單：搜尋框連續輸入，較早的查詢較慢
    const slowEmployees = deferred()
    handlers.employees = query => {
      if (query.get('search') === '王') return slowEmployees.promise
      return json({ employees: [EMPLOYEES.u1[1]], pagination: { total: 1, page: 1, pageSize: 50, totalPages: 1 } })
    }
    wrapper.vm.employeeSearch = '王'
    await wrapper.vm.$nextTick()
    wrapper.vm.employeeSearch = '李小華'
    await flush()
    slowEmployees.resolve(json({ employees: [EMPLOYEES.u1[0]], pagination: { total: 1, page: 1, pageSize: 50, totalPages: 1 } }))
    await flush()
    expect(wrapper.vm.employees.map(employee => employee.name)).toEqual(['李小華'])
  })

  it('連續切換部門：上一個部門較慢的單位清單不會把畫面換回去', async () => {
    const wrapper = await mountAdmin()
    expect(wrapper.vm.selectedSubDepartment).toBe('u1')

    const slowUnits = deferred()
    const baseImplementation = apiFetch.getMockImplementation()
    apiFetch.mockImplementation(async (url, options) => {
      if (String(url) === '/api/sub-departments?department=d2') return slowUnits.promise
      return baseImplementation(url, options)
    })
    wrapper.vm.selectedDepartment = 'd2'
    const toD2 = wrapper.vm.onDepartmentChange()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    await wrapper.vm.onDepartmentChange()
    await flush()
    slowUnits.resolve(json([UNITS[1]]))
    await toD2
    await flush()

    expect(wrapper.vm.subDepartments.map(unit => unit._id)).toEqual(['u1'])
    expect(wrapper.vm.selectedSubDepartment).toBe('u1')
  })

  it('換部門或單位時取消選取：勾好的日期不會套到另一個單位的人', async () => {
    const wrapper = await mountAdmin()
    wrapper.vm.toggleDay(4, true)
    wrapper.vm.toggleEmployee('e1', true)
    expect(wrapper.vm.hasAnySelection).toBe(true)

    wrapper.vm.selectedDepartment = 'd2'
    await wrapper.vm.onDepartmentChange()
    await flush()

    expect(wrapper.vm.employees.map(employee => employee._id)).toEqual(['e9'])
    expect(wrapper.vm.selectedDays.size).toBe(0)
    expect(wrapper.vm.selectedEmployees.size).toBe(0)
    expect(wrapper.vm.hasAnySelection).toBe(false)
  })

  it('有狀態篩選時換月會重新查名單（缺班的名單每個月不同）', async () => {
    const wrapper = await mountAdmin()
    wrapper.vm.statusFilter = 'unscheduled'
    await flush()
    apiFetch.mockClear()

    await wrapper.vm.onMonthChange('2031-07')
    const employeeCalls = apiFetch.mock.calls.map(([url]) => String(url)).filter(url => url.startsWith('/api/employees/schedule'))
    expect(employeeCalls.some(url => url.includes('month=2031-07') && url.includes('status=unscheduled'))).toBe(true)
  })
})

describe('班表日期不依瀏覽器時區換算', () => {
  it('伺服器的 UTC 午夜日期直接對應到那一天的格子', async () => {
    const month = dayjsMonth()
    handlers.monthly = () => json({
      schedules: [
        { _id: 'first', employee: 'e1', date: `${month}-01T00:00:00.000Z`, shiftId: 's1' },
        { _id: 'last', employee: 'e1', date: `${month}-28T00:00:00.000Z`, shiftId: 's2' }
      ],
      publishSummary: draftSummary(true)
    })
    handlers.memos = () => json([{ date: `${month}-01T00:00:00.000Z`, content: '一號的備忘錄' }])
    const wrapper = await mountAdmin()

    expect(wrapper.vm.scheduleMap.e1[1]).toMatchObject({ id: 'first', shiftId: 's1' })
    expect(wrapper.vm.scheduleMap.e1[28]).toMatchObject({ id: 'last', shiftId: 's2' })
    expect(wrapper.vm.dayMemos[1]).toBe('一號的備忘錄')
    expect(wrapper.vm.formatDisputeDate(`${month}-01T00:00:00.000Z`)).toBe(`${month.slice(5)}/01`)
  })
})

describe('單格排班：儲存狀態、失敗原因與復原', () => {
  it('儲存成功：格子標示已儲存，工具列顯示變更並可復原；新增第一筆班表後可以發送待確認', async () => {
    const wrapper = await mountAdmin()
    expect(wrapper.vm.publishDisabled).toBe(true)

    const gate = deferred()
    handlers.write = () => gate.promise
    const saving = wrapper.vm.onSelect('e1', 3, 's1')
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.getRenderedCell('e1', 3).saveState).toBe('saving')
    expect(wrapper.vm.lastChange).toMatchObject({ status: 'saving' })

    gate.resolve(json({ _id: 'created-1', shiftId: 's1' }))
    await saving
    expect(wrapper.vm.scheduleMap.e1[3]).toMatchObject({ id: 'created-1', shiftId: 's1' })
    expect(wrapper.vm.getRenderedCell('e1', 3).saveState).toBe('saved')
    const month = Number(dayjsMonth().slice(5))
    expect(wrapper.vm.lastChange).toEqual({ status: 'saved', text: `已儲存：王小明 ${month}/3 D(白班)` })
    expect(wrapper.vm.canUndoLastChange).toBe(true)
    // 以前新增後發布狀態不更新，「發送待確認」要重新整理頁面才能按
    expect(wrapper.vm.publishDisabled).toBe(false)
  })

  it('復原上一次變更：把那一格改回原本的班別（空格子就是刪除剛新增的班表）', async () => {
    const wrapper = await mountAdmin()
    handlers.write = () => json({ _id: 'created-1', shiftId: 's1' })
    await wrapper.vm.onSelect('e1', 3, 's1')

    const calls = []
    handlers.write = (url, options) => {
      calls.push([String(url), options.method])
      return json({})
    }
    await wrapper.vm.undoLastChange()
    expect(calls).toEqual([['/api/schedules/created-1', 'DELETE']])
    expect(wrapper.vm.scheduleMap.e1[3]).toMatchObject({ id: '', shiftId: '' })

    // Ctrl+Z 也可以復原（這次是把剛清空的班別排回去）
    handlers.write = () => json({ _id: 'created-2', shiftId: 's1' })
    const preventDefault = vi.fn()
    wrapper.vm.handlePageKeydown({ key: 'z', ctrlKey: true, target: document.body, preventDefault })
    await flush()
    expect(preventDefault).toHaveBeenCalled()
    expect(wrapper.vm.scheduleMap.e1[3]).toMatchObject({ id: 'created-2', shiftId: 's1' })
  })

  it('伺服器拒絕：格子維持原本的班別並標示未儲存，原因是伺服器的中文訊息', async () => {
    handlers.monthly = () => json({
      schedules: [{ _id: 'row-4', employee: 'e1', date: `${dayjsMonth()}-04T00:00:00.000Z`, shiftId: 's1' }],
      publishSummary: draftSummary(true)
    })
    const wrapper = await mountAdmin()
    const reason = '「A 病房」沒有開放使用這個班別，請改選小單位設定的使用班別'
    handlers.write = () => json({ error: reason, code: 'SHIFT_NOT_ALLOWED' }, { status: 400 })

    await wrapper.vm.onSelect('e1', 4, 's2')

    expect(wrapper.vm.scheduleMap.e1[4]).toMatchObject({ id: 'row-4', shiftId: 's1' })
    const view = wrapper.vm.getRenderedCell('e1', 4)
    expect(view.saveState).toBe('failed')
    expect(view.saveMessage).toBe(reason)
    expect(wrapper.vm.lastChange.status).toBe('failed')
    expect(wrapper.vm.lastChange.text).toContain(reason)
    expect(wrapper.vm.canUndoLastChange).toBe(false)
    expect(ElMessageBox.alert).toHaveBeenCalledWith(reason, '排班操作失敗', expect.any(Object))
  })

  it('把範圍內的班表全部清空後，發布狀態回到尚未發布（不再顯示清空前的待回覆筆數）', async () => {
    const month = dayjsMonth()
    handlers.monthly = () => json({
      schedules: [
        { _id: 'row-1', employee: 'e1', date: `${month}-01T00:00:00.000Z`, shiftId: 's1', state: 'pending_confirmation' },
        { _id: 'row-2', employee: 'e2', date: `${month}-02T00:00:00.000Z`, shiftId: 's1', state: 'pending_confirmation' }
      ],
      publishSummary: {
        ...draftSummary(true),
        status: 'pending',
        publishedAt: `${month}-01T02:00:00.000Z`,
        pendingEmployees: [{ id: 'e1', name: '王小明', pendingCount: 1 }, { id: 'e2', name: '李小華', pendingCount: 1 }]
      }
    })
    const wrapper = await mountAdmin()
    expect(wrapper.vm.publishSummary.status).toBe('pending')

    // 只清掉其中一筆：還有班表，狀態不動
    handlers.write = () => json({})
    await wrapper.vm.onSelect('e1', 1, '')
    expect(wrapper.vm.publishSummary.status).toBe('pending')

    // 批次清空剩下的那一筆：範圍內已經沒有班表
    wrapper.vm.toggleCell('e2', 2, true)
    handlers.write = () => json({ ids: ['row-2'], deleted: 1 })
    await wrapper.vm.clearSelectedSchedules()
    expect(wrapper.vm.publishSummary).toMatchObject({ status: 'draft', hasSchedules: false, pendingEmployees: [] })
    expect(wrapper.vm.publishDisabled).toBe(true)
    expect(wrapper.vm.pendingCount).toBe(0)
  })

  it('連線失敗：格子標示未儲存並提示確認網路', async () => {
    const wrapper = await mountAdmin()
    handlers.write = () => Promise.reject(new Error('network'))

    await wrapper.vm.onSelect('e1', 6, 's1')

    expect(wrapper.vm.scheduleMap.e1[6].shiftId).toBe('')
    expect(wrapper.vm.getRenderedCell('e1', 6)).toMatchObject({ saveState: 'failed', saveMessage: '新增排班失敗，請確認網路連線後再試' })
    expect(ElMessage.error).toHaveBeenCalledWith('新增排班失敗')
  })

  it('內容沒變的格子沿用同一個顯示物件，改一格不會讓其他格重新渲染', async () => {
    const wrapper = await mountAdmin()
    const untouched = wrapper.vm.getRenderedCell('e2', 9)
    const before = wrapper.vm.getRenderedCell('e1', 9)

    wrapper.vm.toggleCell('e1', 9, true)
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.getRenderedCell('e2', 9)).toBe(untouched)
    expect(wrapper.vm.getRenderedCell('e1', 9)).not.toBe(before)
    expect(wrapper.vm.getRenderedCell('e1', 9).isManualSelected).toBe(true)
  })
})

describe('範圍選取與匯出', () => {
  function clickCell(wrapper, empId, day, { shiftKey = false, checked = true } = {}) {
    const cell = document.createElement('div')
    cell.dataset.scheduleCell = '1'
    cell.dataset.empId = empId
    cell.dataset.day = String(day)
    const label = document.createElement('label')
    label.className = 'cell-selection'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cell-manual-checkbox'
    input.checked = checked
    label.appendChild(input)
    cell.appendChild(label)
    wrapper.vm.handleTableDelegatedClick({ target: input, shiftKey })
    return input
  }

  it('按住 Shift 點第二格：選取兩格之間的整塊範圍', async () => {
    const wrapper = await mountAdmin()

    clickCell(wrapper, 'e1', 3)
    expect(wrapper.vm.allSelectedCells.size).toBe(1)

    const input = clickCell(wrapper, 'e2', 6, { shiftKey: true, checked: true })
    expect([...wrapper.vm.allSelectedCells].sort()).toEqual(
      ['e1::3', 'e1::4', 'e1::5', 'e1::6', 'e2::3', 'e2::4', 'e2::5', 'e2::6'].sort()
    )
    expect(input.checked).toBe(true)
  })

  it('點掉一格只取消那一格；不能選的格子核取方塊會改回沒勾', async () => {
    const wrapper = await mountAdmin()
    clickCell(wrapper, 'e1', 3)
    clickCell(wrapper, 'e1', 3, { checked: false })
    expect(wrapper.vm.allSelectedCells.size).toBe(0)

    // 不在名單上的員工：沒有格子可以選
    const input = clickCell(wrapper, 'nobody', 3)
    expect(wrapper.vm.allSelectedCells.size).toBe(0)
    expect(input.checked).toBe(false)
  })

  it('目前範圍沒有員工時不能匯出，並說明原因', async () => {
    handlers.employees = () => json({ employees: [], pagination: { total: 0, page: 1, pageSize: 50, totalPages: 1 } })
    const wrapper = await mountAdmin()

    expect(wrapper.vm.exportDisabled).toBe(true)
    expect(wrapper.vm.exportDisabledReason).toBe('目前範圍沒有員工可以匯出')
    expect(wrapper.find('[data-test="schedule-export-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="export-excel-button"]').attributes('disabled')).toBeDefined()
  })

  it('匯出失敗顯示看得懂的原因，匯出中不重複送出', async () => {
    const wrapper = await mountAdmin()
    expect(wrapper.vm.exportDisabled).toBe(false)

    handlers.export = () => json({ error: 'forbidden' }, { status: 403 })
    await wrapper.vm.exportSchedules('excel')
    expect(ElMessage.error).toHaveBeenCalledWith('匯出失敗：目前的排班範圍沒有可以匯出的員工')

    ElMessage.error.mockReset()
    handlers.export = () => json({ error: '匯出檔案產生失敗，請稍後再試' }, { status: 500 })
    await wrapper.vm.exportSchedules('pdf')
    expect(ElMessage.error).toHaveBeenCalledWith('匯出失敗：匯出檔案產生失敗，請稍後再試')

    // 伺服器缺少 pdfkit：現在回中文訊息與 code，原樣顯示
    ElMessage.error.mockReset()
    handlers.export = () => json({ error: '伺服器缺少產生 PDF 檔所需的元件（pdfkit），請聯絡系統管理員', code: 'PDF_MODULE_MISSING' }, { status: 500 })
    await wrapper.vm.exportSchedules('pdf')
    expect(ElMessage.error).toHaveBeenCalledWith('匯出失敗：伺服器缺少產生 PDF 檔所需的元件（pdfkit），請聯絡系統管理員')

    // 舊版伺服器的英文技術訊息不直接顯示
    ElMessage.error.mockReset()
    handlers.export = () => json({ error: 'pdfkit module not installed' }, { status: 500 })
    await wrapper.vm.exportSchedules('pdf')
    expect(ElMessage.error).toHaveBeenCalledWith('匯出失敗')

    const gate = deferred()
    let exportCalls = 0
    handlers.export = () => {
      exportCalls += 1
      return gate.promise
    }
    const running = wrapper.vm.exportSchedules('excel')
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.isExporting).toBe('excel')
    await wrapper.vm.exportSchedules('excel')
    expect(exportCalls).toBe(1)
    gate.resolve(json({ error: 'x' }, { status: 500 }))
    await running
    expect(wrapper.vm.isExporting).toBe('')
  })
})

describe('全螢幕', () => {
  it('瀏覽器拒絕全螢幕時改用版面全螢幕，再按一次可以退出', async () => {
    const original = HTMLElement.prototype.requestFullscreen
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error('fullscreen denied')))
    try {
      const wrapper = await mountAdmin()

      wrapper.vm.toggleTableFullscreen()
      await flush()
      expect(wrapper.vm.isTableFullscreen).toBe(true)
      expect(wrapper.find('[data-test="schedule-card"]').classes()).toContain('is-fullscreen')

      // 以前第二次按會再要求一次全螢幕、又被拒絕，永遠停在全螢幕
      wrapper.vm.toggleTableFullscreen()
      await flush()
      expect(wrapper.vm.isTableFullscreen).toBe(false)
      expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1)
    } finally {
      if (original) HTMLElement.prototype.requestFullscreen = original
      else delete HTMLElement.prototype.requestFullscreen
    }
  })
})

// 排班頁預設看下個月（與 Schedule.vue 的 currentMonth 相同）
function dayjsMonth() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

// 伺服器的發布狀態（server/src/controllers/schedule/schedulePublishSummary.js）：已發送或已完成發布的月份改一格，
// 那一格回到「尚未發送」（unpublishedCount）。以前改完格子不重讀發布狀態，要重新整理才知道還有異動沒發送
describe('發布狀態：改格子後的未發送筆數、發送結果與錯誤', () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const readySummary = (extra = {}) => ({
    ...draftSummary(true),
    status: 'ready',
    publishedAt: `${dayjsMonth()}-01T02:00:00.000Z`,
    totalEmployees: 2,
    allEmployeesConfirmed: true,
    ...extra
  })

  // 按鈕的樣式（el-button 的 type）：替身按鈕把 type 放在 $attrs
  const buttonType = (wrapper, dataTest) => wrapper.findAllComponents({ name: 'ElButton' })
    .find(button => button.attributes('data-test') === dataTest)?.vm.$attrs.type

  it('改一格之後重新讀發布狀態：顯示「有 N 筆異動尚未發送」，重新發送變成主要按鈕', async () => {
    let monthlyCalls = 0
    let summary = readySummary()
    handlers.monthly = () => {
      monthlyCalls += 1
      return json({ schedules: [], publishSummary: summary })
    }
    const wrapper = await mountAdmin()
    expect(wrapper.find('[data-test="publish-unsent-chip"]').exists()).toBe(false)
    expect(buttonType(wrapper, 'finalize-button')).toBe('primary')
    const before = monthlyCalls

    summary = readySummary({ unpublishedCount: 1 })
    handlers.write = () => json({ _id: 'created-1', shiftId: 's1' })
    await wrapper.vm.onSelect('e1', 3, 's1')
    await wrapper.vm.onSelect('e1', 4, 's1')
    await wait(450)
    await flush()

    // 連續改兩格只重讀一次，而且只更新發布狀態
    expect(monthlyCalls).toBe(before + 1)
    expect(wrapper.vm.scheduleMap.e1[3]).toMatchObject({ id: 'created-1' })
    expect(wrapper.find('[data-test="publish-unsent-chip"]').text()).toBe('有 1 筆異動尚未發送')
    expect(buttonType(wrapper, 'publish-button')).toBe('primary')
    expect(buttonType(wrapper, 'finalize-button')).toBe('default')
  })

  it('完成發布之後又改：伺服器回 draft 與筆數，按鈕回到「發送待確認」並提示未發送', async () => {
    handlers.monthly = () => json({ schedules: [], publishSummary: { ...readySummary(), status: 'draft', allEmployeesConfirmed: false, unpublishedCount: 2 } })
    const wrapper = await mountAdmin()
    expect(wrapper.findAll('.publish-btn').map(button => button.text())).toEqual(['發送待確認'])
    expect(wrapper.find('[data-test="publish-unsent-chip"]').text()).toBe('有 2 筆異動尚未發送')
  })

  it('發送成功的訊息寫出發送筆數與沒有重送的已確認筆數', async () => {
    handlers.monthly = () => json({ schedules: [], publishSummary: readySummary({ status: 'pending', pendingEmployees: [{ id: 'e1', name: '王小明', pendingCount: 1 }] }) })
    const wrapper = await mountAdmin()
    handlers.write = () => json({ updated: 2, keptConfirmed: 9, employees: [], publishedMonth: dayjsMonth() })
    await wrapper.vm.confirmPublish()
    await flush()
    expect(ElMessage.success).toHaveBeenCalledWith('已將 2 筆班表發送給員工確認；員工已確認的 9 筆沒有變動，不必重新確認')
  })

  it('沒有需要發送的異動（409 NOTHING_TO_PUBLISH）：顯示伺服器的中文原因並重新讀發布狀態', async () => {
    let monthlyCalls = 0
    handlers.monthly = () => {
      monthlyCalls += 1
      return json({ schedules: [], publishSummary: readySummary({ status: 'pending', pendingEmployees: [{ id: 'e1', name: '王小明', pendingCount: 1 }] }) })
    }
    const wrapper = await mountAdmin()
    const before = monthlyCalls
    const error = '這個範圍的班表員工都已確認，沒有新增或異動的班表需要發送；可以直接完成發布'
    handlers.write = () => json({ error, code: 'NOTHING_TO_PUBLISH' }, { status: 409 })
    await wrapper.vm.confirmPublish()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith(error)
    expect(monthlyCalls).toBeGreaterThan(before)

    // 舊版伺服器的英文訊息換成中文
    handlers.write = () => json({ error: 'no schedules found' }, { status: 404 })
    await wrapper.vm.confirmPublish()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('這個範圍沒有可以發送的班表，請先排班')
  })

  it('完成發布被擋（409 UNCONFIRMED_EMPLOYEES）：顯示中文原因；舊版英文訊息也換成中文', async () => {
    handlers.monthly = () => json({ schedules: [], publishSummary: readySummary() })
    const wrapper = await mountAdmin()
    handlers.write = () => json({ error: '仍有員工尚未確認或提出異議，無法完成發布', code: 'UNCONFIRMED_EMPLOYEES', pendingEmployees: [], disputedEmployees: [] }, { status: 409 })
    await wrapper.vm.confirmFinalize()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('仍有員工尚未確認或提出異議，無法完成發布')

    ElMessage.warning.mockReset()
    handlers.write = () => json({ error: 'unconfirmed employees' }, { status: 409 })
    await wrapper.vm.confirmFinalize()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('仍有員工尚未確認或提出異議，無法完成發布')
  })
})
