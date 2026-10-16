import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import LeaveBalancePanel from '../src/components/LeaveBalancePanel.vue'
import LeaveRequestHint from '../src/components/LeaveRequestHint.vue'

globalThis.ResizeObserver = globalThis.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

const balances = (patch = {}) => ({
  employee: { _id: 'e1', name: '小美', employeeId: 'A001' },
  year: 2026,
  range: { start: '2026-01-01', end: '2026-12-31' },
  maxHoursPerDay: 8,
  minUnitHours: 0.5,
  dayHours: 8,
  items: [
    { key: 'annual', name: '特休', source: 'employee', period: 'year', enforcement: 'block', status: 'ok', quotaHours: 80, usedHours: 16, pendingHours: 8, remainingHours: 64, availableHours: 56, includes: [], expiryDate: '2026-12-31T00:00:00.000Z' },
    { key: 'personal', name: '事假', source: 'policy', period: 'year', enforcement: 'warn', status: 'ok', quotaHours: 112, usedHours: 44, pendingHours: 0, remainingHours: 68, availableHours: 68, includes: [{ key: 'family_care', name: '家庭照顧假', hours: 8 }] },
    { key: 'sick', name: '病假', source: 'policy', period: 'year', enforcement: 'warn', status: 'over', quotaHours: 240, usedHours: 250, pendingHours: 0, remainingHours: -10, availableHours: -10, includes: [] },
    { key: 'marriage', name: '婚假', source: 'policy', period: 'event', enforcement: 'warn', status: 'ok', quotaHours: 64, usedHours: 24, pendingHours: 0, remainingHours: null, availableHours: null, includes: [] },
    { key: 'official', name: '公假', source: 'policy', period: 'none', enforcement: 'none', status: 'unlimited', quotaHours: null, usedHours: 8, pendingHours: 0, remainingHours: null, availableHours: null, includes: [] },
    { key: 'comp', name: '補休', source: 'employee-manual', period: 'none', enforcement: 'none', status: 'manual', quotaHours: 6, usedHours: 0, pendingHours: 0, remainingHours: 6, availableHours: 6, includes: [] },
  ],
  unmatched: [{ name: '神祕假', usedHours: 3, pendingHours: 0 }],
  ...patch,
})

const mounted = []
function mountPanel(props = {}) {
  const wrapper = mount(LeaveBalancePanel, { props, global: { plugins: [ElementPlus] } })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
})

describe('LeaveBalancePanel', () => {
  it('shows every leave type in hours with the day equivalent, the period and the footer about 1 day = 8 hours', async () => {
    const wrapper = mountPanel({ balances: balances(), title: '申請人假別餘額' })
    await flushPromises()
    const text = wrapper.text()

    expect(text).toContain('申請人假別餘額')
    expect(text).toContain('2026/01/01-12/31')
    for (const name of ['特休', '事假', '病假', '婚假', '公假', '補休']) expect(text).toContain(name)
    expect(text).toContain('80 小時（10 天）') // 特休額度
    expect(text).toContain('64 小時（8 天）') // 特休剩餘
    expect(text).toContain('含家庭照顧假 8 小時')
    expect(text).toContain('每次上限 64 小時')
    expect(text).toContain('不設上限')
    expect(text).toContain('人資維護')
    expect(text).toContain('已超出 10 小時')
    expect(text).toContain('1 天 = 8 小時')
    expect(text).toContain('「神祕假」尚未設定額度：已使用 3 小時')
  })

  // 伺服器 composeLeaveBalanceItems 對「事假已核准 8 + 家庭照顧假已核准 4、簽核中 2」實際回傳的 JSON（節錄）
  const serverItems = () => [
    { key: 'personal', name: '事假', aliases: ['事假申請'], period: 'year', enforcement: 'warn', builtin: true, note: '',
      includes: [{ key: 'family_care', name: '家庭照顧假', approvedHours: 4, pendingHours: 2, hours: 6 }],
      usedHours: 12, pendingHours: 2, quotaHours: 112, remainingHours: 100, availableHours: 98, source: 'policy', status: 'ok', countsAgainst: null,
      quotaDays: 14, usedDays: 1.5, pendingDays: 0.25, remainingDays: 12.5, availableDays: 12.25 },
    { key: 'family_care', name: '家庭照顧假', aliases: ['家庭照顧'], period: 'year', enforcement: 'warn', builtin: true, note: '',
      includes: [], usedHours: 4, pendingHours: 2, quotaHours: 56, remainingHours: 52, availableHours: 50, source: 'policy', status: 'ok',
      countsAgainst: { key: 'personal', exemptHours: 0 }, quotaDays: 7, usedDays: 0.5, pendingDays: 0.25, remainingDays: 6.5, availableDays: 6.25 },
  ]

  it('real server JSON: 已使用 only carries the approved part of the included type, the pending part is shown in the 簽核中 cell', async () => {
    const wrapper = mountPanel({ balances: balances({ items: serverItems(), unmatched: [] }) })
    await flushPromises()

    const personal = wrapper.findAll('.el-table__body tr')[0] // 事假
    const cells = personal.findAll('td')
    const [, , used, pending] = cells.map(cell => cell.text())
    expect(used).toContain('12 小時')
    expect(used).toContain('含家庭照顧假 4 小時（4 小時）')
    expect(used).not.toContain('含家庭照顧假 6 小時') // 簽核中的 2 小時不算進已使用的「含家庭照顧假」（合計 6 小時）
    expect(used).not.toContain('含家庭照顧假 2 小時')
    expect(pending).toContain('2 小時')
    expect(pending).toContain('含家庭照顧假 2 小時（2 小時）')
    expect(wrapper.findAll('[data-test="leave-balance-includes"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-test="leave-balance-includes-pending"]')).toHaveLength(1)
  })

  it('an included type that is only pending shows nothing under 已使用, and one that is only approved shows nothing under 簽核中', async () => {
    const items = serverItems()
    items[0].includes = [{ key: 'family_care', name: '家庭照顧假', approvedHours: 0, pendingHours: 3, hours: 3 }]
    const onlyPending = mountPanel({ balances: balances({ items, unmatched: [] }) })
    await flushPromises()
    expect(onlyPending.findAll('[data-test="leave-balance-includes"]')).toHaveLength(0)
    expect(onlyPending.findAll('[data-test="leave-balance-includes-pending"]').map(node => node.text())).toEqual(['含家庭照顧假 3 小時（3 小時）'])

    const approvedItems = serverItems()
    approvedItems[0].includes = [{ key: 'family_care', name: '家庭照顧假', approvedHours: 8, pendingHours: 0, hours: 8 }]
    const onlyApproved = mountPanel({ balances: balances({ items: approvedItems, unmatched: [] }) })
    await flushPromises()
    expect(onlyApproved.findAll('[data-test="leave-balance-includes"]').map(node => node.text())).toEqual(['含家庭照顧假 8 小時（1 天）'])
    expect(onlyApproved.findAll('[data-test="leave-balance-includes-pending"]')).toHaveLength(0)
  })

  it('an older server that only sends the combined hours of the included type keeps the old display (under 已使用)', async () => {
    const wrapper = mountPanel({ balances: balances() })
    await flushPromises()

    expect(wrapper.findAll('[data-test="leave-balance-includes"]').map(node => node.text())).toEqual(['含家庭照顧假 8 小時（1 天）'])
    expect(wrapper.findAll('[data-test="leave-balance-includes-pending"]')).toHaveLength(0)
  })

  it('shows the effect of the request being looked at above the table and marks its row', async () => {
    const wrapper = mountPanel({
      balances: balances({ focus: { typeKey: 'personal', typeName: '事假', requestedHours: 80, remainingBefore: 68, remainingAfter: -12, exceeded: true, message: '事假今年額度 112 小時，將超出 12 小時' } }),
    })
    await flushPromises()

    const note = wrapper.find('[data-test="leave-balance-focus"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('本次申請：事假 80 小時')
    expect(note.text()).toContain('核准前剩 68 小時')
    expect(note.text()).toContain('將超出 12 小時')
    expect(wrapper.findAll('.focus-row')).toHaveLength(1)
    expect(wrapper.text()).toContain('本次申請')
  })

  it('does not call the server when the balances are given, and loads them itself when they are not', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json(balances()))
    mountPanel({ balances: balances() })
    await flushPromises()
    expect(fetchSpy).not.toHaveBeenCalled()

    const wrapper = mountPanel({ employeeId: 'e1', year: 2026 })
    await flushPromises()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/approvals/leave-balances?employeeId=e1&year=2026')
    expect(wrapper.text()).toContain('事假')
  })

  it('asks for the caller\'s own balances when no employee is given and offers a refresh', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json(balances()))
    const wrapper = mountPanel()
    await flushPromises()
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/approvals\/leave-balances$/)

    await wrapper.find('[data-test="leave-balance-refresh"]').trigger('click')
    await flushPromises()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('reloads when the employee changes', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json(balances()))
    const wrapper = mountPanel({ employeeId: 'e1' })
    await flushPromises()
    await wrapper.setProps({ employeeId: 'e2' })
    await flushPromises()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(String(fetchSpy.mock.calls[1][0])).toContain('employeeId=e2')
  })

  it('tolerates a failing server: one quiet line with a retry, never an exception', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValueOnce(json({ error: 'boom' }, 500))
    const wrapper = mountPanel({ employeeId: 'e1' })
    await flushPromises()
    expect(wrapper.find('[data-test="leave-balance-error"]').text()).toContain('假別餘額暫時無法載入')

    fetchSpy.mockResolvedValueOnce(json(balances()))
    await wrapper.find('[data-test="leave-balance-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="leave-balance-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('事假')

    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('offline'))
    const offline = mountPanel({ employeeId: 'e9' })
    await flushPromises()
    expect(offline.find('[data-test="leave-balance-error"]').exists()).toBe(true)
  })

  it('tolerates payloads that are not balances (an empty array, null, no items)', async () => {
    for (const body of [[], null, {}, { items: 'x' }]) {
      vi.spyOn(window, 'fetch').mockResolvedValue(json(body))
      const wrapper = mountPanel({ employeeId: 'e1' })
      await flushPromises()
      expect(wrapper.find('.balance-table').exists()).toBe(false)
      expect(wrapper.find('[data-test="leave-balance-error"]').exists()).toBe(false)
      vi.restoreAllMocks()
    }
    const empty = mountPanel({ balances: balances({ items: [], unmatched: [] }) })
    expect(empty.find('[data-test="leave-balance-empty"]').exists()).toBe(true)
  })

  it('compact mode leaves out the pending and note columns', async () => {
    const full = mountPanel({ balances: balances() })
    const compact = mountPanel({ balances: balances(), compact: true })
    await flushPromises()
    expect(full.text()).toContain('簽核中')
    expect(full.text()).toContain('備註')
    expect(compact.text()).not.toContain('簽核中')
    expect(compact.text()).not.toContain('備註')
    expect(compact.text()).toContain('事假')
  })
})

describe('LeaveRequestHint', () => {
  const items = balances().items.map(entry => ({ ...entry, aliases: [] }))

  function mountHint(props) {
    const wrapper = mount(LeaveRequestHint, { props, global: { plugins: [ElementPlus] } })
    mounted.push(wrapper)
    return wrapper
  }

  it('shows the remaining hours and what is left after the request', () => {
    const wrapper = mountHint({ items, typeText: '事假', hours: 8 })
    expect(wrapper.text()).toContain('事假：目前可請 68 小時')
    expect(wrapper.text()).toContain('核准後剩 60 小時')
  })

  it('warns when the request would exceed the quota', () => {
    const wrapper = mountHint({ items, typeText: '事假', hours: 80 })
    expect(wrapper.find('.el-alert--warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('將超出 12 小時')
  })

  it('is an error when a blocking type is exceeded', () => {
    const wrapper = mountHint({ items, typeText: '特休', hours: 100 })
    expect(wrapper.find('.el-alert--error').exists()).toBe(true)
    expect(wrapper.text()).toContain('無法送出')
  })

  it('shows nothing without hours, without a type, or for a type that has no rule', () => {
    expect(mountHint({ items, typeText: '事假', hours: null }).find('.leave-request-hint').exists()).toBe(false)
    expect(mountHint({ items, typeText: '', hours: 8 }).find('.leave-request-hint').exists()).toBe(false)
    expect(mountHint({ items, typeText: '神祕假', hours: 8 }).find('.leave-request-hint').exists()).toBe(false)
  })
})
