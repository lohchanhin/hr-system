import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Approval from '../src/views/front/Approval.vue'
import { useAuthStore } from '../src/stores/auth'

// 2026/11 簽核頁介面整理：預設分頁、頁首統計、表單優先、清單（篩選、排序、手機卡片、內容摘要）、
// 明細裡直接簽核／撤回／重新送出，以及這次找到的問題（過期的回應蓋掉新清單、選的表單不見了、重複送出、欄位旁的錯誤）

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, onBeforeRouteLeave: () => {} }
})

// 提示與確認（utils/approvalNotify）：這裡直接檢查頁面呼叫了什麼
const { notifySuccess, notifyFailure, confirmAction } = vi.hoisted(() => ({
  notifySuccess: vi.fn(),
  notifyFailure: vi.fn(),
  confirmAction: vi.fn(),
}))
vi.mock('../src/utils/approvalNotify', () => ({ notifySuccess, notifyFailure, confirmAction }))

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: () => Promise.resolve(body),
  blob: () => Promise.resolve(new Blob(['x'])),
})

// 可以自己決定什麼時候回應的請求（測試回應的先後順序）
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function installFetch(routes = []) {
  const calls = []
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, method: init.method || 'GET', body: init.body })
    for (const [matcher, responder] of routes) {
      const hit = typeof matcher === 'function' ? matcher(text, init) : text.includes(matcher)
      if (hit) {
        const result = typeof responder === 'function' ? responder(text, init) : responder
        if (result instanceof Error) return Promise.reject(result)
        return Promise.resolve(result)
      }
    }
    return Promise.resolve(json([]))
  })
  return calls
}

const isInbox = (url) => url.includes('/api/approvals/inbox')
const isHistory = (url) => url.includes('/api/approvals/history')
const isMine = (url) => /\/api\/approvals\?/.test(url)
const isFormsList = (url, init) => url.includes('/api/approvals/forms?') && (init?.method || 'GET') === 'GET'
const post = (suffix) => (url, init) => init?.method === 'POST' && url.endsWith(suffix)
const count = (calls, predicate) => calls.filter(call => predicate(call.url, { method: call.method })).length

const mounted = []
async function mountPage({ role = 'employee', wait = true } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Approval, { global: { plugins: [ElementPlus, pinia] } })
  mounted.push(wrapper)
  useAuthStore().role = role
  if (wait) await flushPromises()
  return wrapper
}

function asMobile() {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
}

beforeEach(() => {
  notifySuccess.mockReset()
  notifyFailure.mockReset()
  confirmAction.mockReset()
  confirmAction.mockResolvedValue(true)
})
afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const LEAVE_ID = 'a'.repeat(24)
const OT_ID = 'b'.repeat(24)
const LEAVE = { _id: LEAVE_ID, name: '請假', category: '人事', semanticType: 'leave' }
const OVERTIME = { _id: OT_ID, name: '加班申請', category: '人事', semanticType: 'overtime' }
const leaveFields = [
  { _id: 'type', label: '假別', type_1: 'text', required: true, order: 1 },
  { _id: 'start', label: '開始時間', type_1: 'datetime', required: true, order: 2 },
  { _id: 'end', label: '結束時間', type_1: 'datetime', required: true, order: 3 },
  { _id: 'hours', label: '時數', type_1: 'number', required: true, order: 4 },
]

const inboxRow = (id, patch = {}) => ({
  _id: id,
  status: 'pending',
  form: { _id: LEAVE_ID, name: '請假', semanticType: 'leave' },
  applicant_employee: { _id: 'e1', name: '王小明' },
  current_step_index: 0,
  createdAt: '2026-11-08T01:00:00.000Z',
  form_data: { type: '事假', start: '2026-11-12T01:00:00.000Z', end: '2026-11-12T10:00:00.000Z', hours: 8 },
  steps: [{ step_order: 1, can_return: true, approvers: [{ approver: { _id: 'me', name: '我' }, decision: 'pending' }] }, { step_order: 2, approvers: [] }],
  ...patch,
})
const myRow = (id, status, patch = {}) => ({
  _id: id,
  status,
  form: { _id: OT_ID, name: '加班申請', semanticType: 'overtime' },
  applicant_employee: { _id: 'me', name: '我' },
  current_step_index: 0,
  createdAt: '2026-11-09T01:00:00.000Z',
  steps: [{ approvers: [{ approver: { _id: 'p1', name: '營運部主管' }, decision: 'pending' }] }],
  ...patch,
})

describe('預設分頁與頁首', () => {
  it('有等我簽核的單：開在「待我簽核」，分頁與頁首都顯示件數', async () => {
    installFetch([[isInbox, json([inboxRow('a1'), inboxRow('a2')])]])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.activeTab).toBe('inbox')
    expect(wrapper.vm.initializing).toBe(false)
    expect(wrapper.find('[data-test="inbox-tab-count"]').text()).toBe('2')
    expect(wrapper.find('[data-test="stat-inbox"]').text()).toMatch(/待我簽核\s*2/)
    expect(wrapper.find('[data-test="page-header"]').text()).toContain('簽核流程')
  })

  it('沒有要簽的單、但自己有被退簽的申請：開在「我的申請」', async () => {
    installFetch([[isMine, json([myRow('m1', 'approved'), myRow('m2', 'returned'), myRow('m3', 'pending')])]])
    const wrapper = await mountPage()
    expect(wrapper.vm.activeTab).toBe('mine')
    expect(wrapper.find('[data-test="inbox-tab-count"]').exists()).toBe(false)
    // 進行中 = 簽核中 + 被退簽
    expect(wrapper.find('[data-test="stat-mine"]').text()).toMatch(/進行中的申請\s*2/)
  })

  it('都沒有：直接開在「申請表單」，而且不會因為程式切換分頁又重新載入一次表單清單與餘額', async () => {
    const calls = installFetch([
      [isFormsList, json([LEAVE])],
      [isMine, json([myRow('m1', 'approved'), myRow('m3', 'pending')])],
    ])
    const wrapper = await mountPage()
    expect(wrapper.vm.activeTab).toBe('apply')
    expect(count(calls, isFormsList)).toBe(1)
    expect(count(calls, url => url.includes('/api/approvals/leave-balances'))).toBe(1)
    expect(count(calls, isInbox)).toBe(1)
    expect(count(calls, isMine)).toBe(1)
    // 之後使用者自己切換分頁，照常重新載入
    wrapper.vm.activeTab = 'mine'
    await flushPromises()
    expect(count(calls, isMine)).toBe(2)
  })

  it('載入中使用者已經自己點了分頁：載入完成後不會被改掉', async () => {
    const slowInbox = deferred()
    installFetch([[isInbox, () => slowInbox.promise]])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.initializing).toBe(true)
    wrapper.vm.goTab('history')
    await flushPromises()
    slowInbox.resolve(json([inboxRow('a1')]))
    await flushPromises()
    expect(wrapper.vm.initializing).toBe(false)
    expect(wrapper.vm.activeTab).toBe('history')
    expect(wrapper.vm.inboxList).toHaveLength(1)
  })

  it('按頁首的「進行中的申請」：到我的申請並只看進行中的單；兩種狀態都有時不篩選', async () => {
    installFetch([[isMine, json([myRow('m1', 'approved'), myRow('m3', 'pending')])]])
    const wrapper = await mountPage()
    await wrapper.find('[data-test="stat-mine"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.activeTab).toBe('mine')
    expect(wrapper.vm.myFilter.status).toBe('pending')
    expect(wrapper.vm.myRows.map(row => row._id)).toEqual(['m3'])

    wrapper.vm.myList = [myRow('m2', 'returned'), myRow('m3', 'pending')]
    wrapper.vm.showMyInProgress()
    expect(wrapper.vm.myFilter.status).toBe('')
  })
})

describe('清單：排序、篩選、內容摘要', () => {
  it('待我簽核等最久的排最前面；桌機點「送出時間」可以改成最新的在前', async () => {
    installFetch([[isInbox, json([
      inboxRow('new', { createdAt: '2026-11-10T01:00:00.000Z' }),
      inboxRow('old', { createdAt: '2026-11-01T01:00:00.000Z' }),
      inboxRow('mid', { createdAt: '2026-11-05T01:00:00.000Z' }),
    ])]])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['old', 'mid', 'new'])
    wrapper.vm.onInboxSortChange({ order: 'descending' })
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['new', 'mid', 'old'])
    wrapper.vm.onInboxSortChange({ order: null })
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['old', 'mid', 'new'])
  })

  it('依表單、申請人、送出日期（台灣日期）篩選；篩到沒有資料時說明是篩選的關係', async () => {
    installFetch([[isInbox, json([
      inboxRow('a1'),
      inboxRow('a2', { form: { _id: OT_ID, name: '加班申請' }, applicant_employee: { _id: 'e2', name: '李小華' }, createdAt: '2026-11-09T16:30:00.000Z' }),
    ])]])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.inboxFormOptions.map(option => option.label).sort()).toEqual(['加班申請', '請假'].sort())

    wrapper.vm.inboxFilter = { ...wrapper.vm.inboxFilter, formId: OT_ID }
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['a2'])
    wrapper.vm.inboxFilter = { ...wrapper.vm.inboxFilter, formId: '', keyword: '王' }
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['a1'])
    // 11/09 16:30Z 是台灣 11/10
    wrapper.vm.inboxFilter = { formId: '', status: '', keyword: '', from: '2026-11-10', to: '2026-11-10' }
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['a2'])
    wrapper.vm.inboxFilter = { formId: '', status: '', keyword: '不存在的人', from: '', to: '' }
    await flushPromises()
    expect(wrapper.vm.inboxRows).toEqual([])
    expect(wrapper.vm.inboxEmptyText).toBe('沒有符合篩選條件的申請')
    // 篩選不影響待簽的件數
    expect(wrapper.find('[data-test="inbox-tab-count"]').text()).toBe('2')
  })

  it('內容摘要：每張表單的欄位只取一次；請假單寫假別、起訖（台灣時間）與時數', async () => {
    const calls = installFetch([
      [isInbox, json([inboxRow('a1'), inboxRow('a2')])],
      [`/api/approvals/forms/${LEAVE_ID}/fields`, json(leaveFields)],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(count(calls, url => url.includes(`/forms/${LEAVE_ID}/fields`))).toBe(1)
    expect(wrapper.vm.rowSummary(wrapper.vm.inboxList[0])).toBe('事假・2026/11/12 09:00–18:00・8 小時（1 天）')
    expect(wrapper.find('#pane-inbox .row-summary').text()).toBe('事假・2026/11/12 09:00–18:00・8 小時（1 天）')

    await wrapper.vm.fetchInbox()
    await flushPromises()
    expect(count(calls, url => url.includes(`/forms/${LEAVE_ID}/fields`))).toBe(1)
  })

  it('讀不到欄位的表單（別的部門的表單回 403）只是沒有摘要，不顯示錯誤', async () => {
    installFetch([
      [isInbox, json([inboxRow('a1')])],
      [`/api/approvals/forms/${LEAVE_ID}/fields`, json({ error: '您所屬的部門未開放使用【請假】', code: 'FORM_NOT_ALLOWED' }, 403)],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.rowSummary(wrapper.vm.inboxList[0])).toBe('')
    expect(wrapper.find('#pane-inbox .row-summary').text()).toBe('—')
    expect(wrapper.vm.inboxError).toBe('')
    expect(notifyFailure).not.toHaveBeenCalled()
  })

  it('我的申請：簽核中的單寫第幾關、等誰簽；被退簽的提醒要修改', async () => {
    installFetch([[isMine, json([
      myRow('m1', 'pending', { steps: [{ approvers: [{ approver: { _id: 'p0', name: '已簽的人' }, decision: 'approved' }] }, { approvers: [{ approver: { _id: 'p1', name: '營運部主管' }, decision: 'pending' }, { approver: { _id: 'p2', name: '人資主管' }, decision: 'pending' }] }], current_step_index: 1 }),
      myRow('m2', 'returned'),
      myRow('m3', 'approved'),
    ])]])
    const wrapper = await mountPage()
    const [pending, returned, approved] = wrapper.vm.myList
    expect(wrapper.vm.myProgressText(pending)).toBe('第 2／2 關・等待 營運部主管、人資主管')
    expect(wrapper.vm.myProgressText(returned)).toBe('已被退簽，請修改後重新送出')
    expect(wrapper.vm.myProgressText(approved)).toBe('')
    // 狀態用同一套文字與顏色
    const tags = wrapper.findAll('#pane-mine .el-table__body .el-tag').map(tag => [tag.text(), tag.classes().find(name => /^el-tag--(warning|success|danger|primary|info)$/.test(name))])
    expect(tags).toEqual([['待簽核', 'el-tag--warning'], ['已退簽', 'el-tag--primary'], ['已核可', 'el-tag--success']])
  })

  // 2026/11：清單每一列帶伺服器組好的 summary，不必再為每張表單取欄位（跨部門的簽核人以前會被 FORM_NOT_ALLOWED 擋下）
  it('待我簽核用伺服器的篩選、排序（等最久的在前）與摘要；篩選時件數仍是全部待簽的單', async () => {
    const summary = {
      kind: 'leave', leaveType: '事假', hours: 8, start: '2026-11-12T01:00:00.000Z', end: '2026-11-12T10:00:00.000Z', dateOnly: false,
      items: [{ label: '假別', value: '事假' }, { label: '開始時間', value: '2026/11/12 09:00' }, { label: '結束時間', value: '2026/11/12 18:00' }, { label: '時數', value: '8 小時' }],
    }
    const calls = installFetch([
      [(url) => isInbox(url) && url.includes('limit=1&'), json({ items: [], total: 7, page: 1, limit: 1 })],
      [(url) => isInbox(url) && url.includes('limit=1'), json({ items: [], total: 7, page: 1, limit: 1 })],
      [(url) => isInbox(url) && url.includes('q='), json({ items: [inboxRow('a1', { summary })], total: 1, page: 1, limit: 20 })],
      [isInbox, json({ items: [inboxRow('a1', { summary }), inboxRow('a2', { summary: null })], total: 7, page: 1, limit: 20 })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(calls.filter(call => isInbox(call.url))[0].url).toMatch(/inbox\?page=1&limit=20&sort=oldest$/)
    expect(count(calls, url => url.includes('/fields'))).toBe(0)
    expect(wrapper.vm.rowSummary(wrapper.vm.inboxList[0])).toBe('事假・2026/11/12 09:00–18:00・8 小時（1 天）')
    expect(wrapper.vm.rowSummary(wrapper.vm.inboxList[1])).toBe('')
    // 從明細開的簽核視窗（明細沒有 summary）也找得到清單上的摘要
    expect(wrapper.vm.rowSummary({ _id: 'a1', form: inboxRow('a1').form })).toBe('事假・2026/11/12 09:00–18:00・8 小時（1 天）')
    expect(wrapper.vm.inboxCount).toBe(7)

    wrapper.vm.onInboxSortChange({ order: 'descending' })
    await flushPromises()
    expect(calls.filter(call => isInbox(call.url)).at(-1).url).toMatch(/sort=newest$/)

    wrapper.vm.inboxFilter = { ...wrapper.vm.inboxFilter, formId: LEAVE_ID, keyword: '王' }
    await flushPromises()
    const filtered = calls.filter(call => isInbox(call.url) && call.url.includes('limit=20')).at(-1).url
    expect(filtered).toContain(`form=${LEAVE_ID}`)
    expect(filtered).toContain(`q=${encodeURIComponent('王')}`)
    expect(wrapper.vm.inboxRows.map(row => row._id)).toEqual(['a1'])
    expect(wrapper.vm.inboxTotal).toBe(1)
    // 件數另外問（不帶篩選、取 1 筆），不是篩選後的 1
    expect(count(calls, url => isInbox(url) && /page=1&limit=1$/.test(url))).toBe(1)
    expect(wrapper.vm.inboxCount).toBe(7)
    expect(wrapper.find('[data-test="inbox-tab-count"]').text()).toBe('7')
  })

  // 簽核按鈕在桌機表格與手機卡片是同一個順序：次要的在左、主要的「核可」在最右（以前桌機是 核可｜否決｜退簽）
  it('待我簽核的按鈕順序在桌機與手機一致：退簽、否決、核可', async () => {
    installFetch([[isInbox, json([inboxRow('a1')])]])
    const desktop = await mountPage({ role: 'supervisor' })
    const texts = (root) => root.findAll('button').map(button => button.text()).filter(Boolean)
    expect(texts(desktop.find('#pane-inbox .action-buttons'))).toEqual(['查看', '退簽', '否決', '核可'])

    asMobile()
    const mobile = await mountPage({ role: 'supervisor' })
    expect(texts(mobile.find('[data-test="inbox-card"] .req-card__actions'))).toEqual(['退簽', '否決', '核可'])
  })

  // 2026/11：清單 API 的篩選所有角色都能用（以前只有管理員的 ?status= 有作用，其他人在前端篩）
  it('「我已簽核」的篩選交給伺服器：管理員與一般簽核人都一樣；關鍵字打完字才查', async () => {
    const calls = installFetch([[isHistory, json({ items: [], total: 0, page: 1, limit: 20 })]])
    const admin = await mountPage({ role: 'admin' })
    admin.vm.activeTab = 'history'
    await flushPromises()
    expect(calls.filter(call => isHistory(call.url)).at(-1).url).toMatch(/history\?page=1&limit=20$/)
    admin.vm.historyFilter = { ...admin.vm.historyFilter, status: 'pending' }
    await flushPromises()
    expect(calls.filter(call => isHistory(call.url)).at(-1).url).toMatch(/history\?page=1&limit=20&status=pending$/)

    const before = count(calls, isHistory)
    const employee = await mountPage({ role: 'employee' })
    employee.vm.activeTab = 'history'
    await flushPromises()
    employee.vm.historyFilter = { ...employee.vm.historyFilter, status: 'approved', formId: OT_ID }
    await flushPromises()
    const employeeCalls = calls.filter(call => isHistory(call.url)).slice(before)
    expect(employeeCalls).toHaveLength(2)
    expect(employeeCalls[1].url).toMatch(/history\?page=1&limit=20&status=approved&form=b{24}$/)

    vi.useFakeTimers()
    try {
      employee.vm.historyFilter = { ...employee.vm.historyFilter, keyword: '王' }
      employee.vm.historyFilter = { ...employee.vm.historyFilter, keyword: '王小' }
      await vi.advanceTimersByTimeAsync(299)
      expect(count(calls, isHistory) - before).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(count(calls, isHistory) - before).toBe(3)
      expect(calls.filter(call => isHistory(call.url)).at(-1).url).toContain(`q=${encodeURIComponent('王小')}`)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('手機（寬度小於 768px）', () => {
  it('待我簽核是卡片清單：表單、申請人、內容、關卡、多久以前，簽核按鈕直接在卡片上；沒有寬表格', async () => {
    asMobile()
    installFetch([
      [isInbox, json([inboxRow('a1'), inboxRow('a2', { steps: [{ can_return: false, approvers: [] }] })])],
      [`/api/approvals/forms/${LEAVE_ID}/fields`, json(leaveFields)],
      [(url) => url.endsWith('/api/approvals/a1'), json({ ...inboxRow('a1'), form: { ...LEAVE, fields: leaveFields }, logs: [], viewer: { can_act: true } })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.find('#pane-inbox .el-table').exists()).toBe(false)
    const cards = wrapper.findAll('[data-test="inbox-card"]')
    expect(cards).toHaveLength(2)
    const text = cards[0].text().replace(/\s+/g, ' ')
    expect(text).toContain('請假')
    expect(text).toContain('王小明')
    expect(text).toContain('事假・2026/11/12 09:00–18:00・8 小時（1 天）')
    expect(text).toContain('第 1／2 關')
    expect(cards[0].findAll('.req-card__actions button').map(button => button.text())).toEqual(['退簽', '否決', '核可'])
    // 這一關不允許退簽就沒有退簽
    expect(cards[1].findAll('.req-card__actions button').map(button => button.text())).toEqual(['否決', '核可'])

    // 點卡片看明細；按核可開啟簽核視窗
    await cards[0].find('.req-card__main').trigger('click')
    await flushPromises()
    expect(wrapper.vm.detail.visible).toBe(true)
    await cards[0].findAll('.req-card__actions button').at(-1).trigger('click')
    expect(wrapper.vm.actionDlg).toMatchObject({ visible: true, decision: 'approve', override: false })
  })

  it('我的申請的卡片：狀態、進度，被退簽的單有「修改並重新送出」', async () => {
    asMobile()
    installFetch([[isMine, json([myRow('m2', 'returned'), myRow('m3', 'approved')])]])
    const wrapper = await mountPage()
    const cards = wrapper.findAll('[data-test="mine-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('已退簽')
    expect(cards[0].text()).toContain('已被退簽，請修改後重新送出')
    expect(cards[0].findAll('.req-card__actions button').map(button => button.text())).toEqual(['撤回', '修改並重新送出'])
    // 已核可的加班單沒有可以做的動作
    expect(cards[1].find('.req-card__actions').exists()).toBe(false)
  })
})

describe('過期的回應不會蓋掉新的清單', () => {
  it('較早發出、較晚回來的待簽清單被忽略（剛簽完重新整理時，舊的回應不會把簽過的單放回來）', async () => {
    const wrapper = await (async () => {
      installFetch([[isInbox, json([inboxRow('a1'), inboxRow('a2')])]])
      return mountPage({ role: 'supervisor' })
    })()
    expect(wrapper.vm.inboxList).toHaveLength(2)

    const slow = deferred()
    let call = 0
    installFetch([[isInbox, () => {
      call += 1
      return call === 1 ? slow.promise : json([inboxRow('a2')])
    }]])
    const first = wrapper.vm.fetchInbox() // 舊的請求：還沒回來
    const second = wrapper.vm.fetchInbox() // 新的請求：先回來
    await second
    await flushPromises()
    expect(wrapper.vm.inboxList.map(row => row._id)).toEqual(['a2'])
    expect(wrapper.vm.inboxLoading).toBe(false)

    slow.resolve(json([inboxRow('a1'), inboxRow('a2')]))
    await first
    await flushPromises()
    expect(wrapper.vm.inboxList.map(row => row._id)).toEqual(['a2'])
    expect(wrapper.vm.inboxCount).toBe(1)
  })

  it('表單清單也一樣：較慢回來的舊回應不會蓋掉新的', async () => {
    installFetch([[isFormsList, json([LEAVE])]])
    const wrapper = await mountPage()
    const slow = deferred()
    let call = 0
    installFetch([[isFormsList, () => {
      call += 1
      return call === 1 ? slow.promise : json([LEAVE, OVERTIME])
    }]])
    const first = wrapper.vm.loadFormTemplates()
    await wrapper.vm.loadFormTemplates()
    expect(wrapper.vm.formTemplates.map(form => form.name)).toEqual(['請假', '加班申請'])
    slow.resolve(json([LEAVE]))
    await first
    expect(wrapper.vm.formTemplates.map(form => form.name)).toEqual(['請假', '加班申請'])
  })
})

describe('選好的表單不見了', () => {
  async function selectOvertime(listRef) {
    const calls = installFetch([
      [isFormsList, () => listRef.response()],
      [`/api/approvals/forms/${OT_ID}/fields`, json([{ _id: 'reason', label: '事由', type_1: 'text', required: true }])],
      [`/api/approvals/forms/${OT_ID}/workflow`, json({ steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = OT_ID
    await wrapper.vm.onSelectForm()
    await flushPromises()
    wrapper.vm.applyState.formData = { reason: '填到一半' }
    return { wrapper, calls }
  }

  it('離開申請頁再回來時表單已被停用（或部門不再開放）：清掉選擇並說明原因，不留下一張送不出去的表單', async () => {
    const listRef = { response: () => json([LEAVE, OVERTIME]) }
    const { wrapper } = await selectOvertime(listRef)
    listRef.response = () => json([LEAVE])
    wrapper.vm.activeTab = 'mine'
    await flushPromises()
    wrapper.vm.activeTab = 'apply'
    await flushPromises()

    expect(wrapper.vm.applyState.formId).toBe('')
    expect(wrapper.vm.fieldList).toEqual([])
    expect(wrapper.find('[data-test="form-gone-notice"]').text()).toContain('「加班申請」已不在可申請的表單中')
    expect(wrapper.find('[data-test="submit-apply"]').exists()).toBe(false)
  })

  it('回來時表單清單載入失敗（網路問題）：保留選擇與已填的內容，只顯示載入失敗', async () => {
    const listRef = { response: () => json([LEAVE, OVERTIME]) }
    const { wrapper } = await selectOvertime(listRef)
    listRef.response = () => json({ error: 'boom' }, 500)
    wrapper.vm.activeTab = 'mine'
    await flushPromises()
    wrapper.vm.activeTab = 'apply'
    await flushPromises()

    expect(wrapper.vm.applyState.formId).toBe(OT_ID)
    expect(wrapper.vm.applyState.formData).toEqual({ reason: '填到一半' })
    expect(wrapper.find('[data-test="form-gone-notice"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="templates-error"]').text()).toContain('表單清單載入失敗')
  })
})

describe('申請表單：欄位旁的錯誤與送出', () => {
  const routes = (extra = []) => [
    ...extra,
    [isFormsList, json([LEAVE])],
    [`/api/approvals/forms/${LEAVE_ID}/fields`, json([
      { _id: 'type', label: '假別', type_1: 'text', required: true, order: 1 },
      { _id: 'reason', label: '事由', type_1: 'textarea', required: true, order: 2 },
      { _id: 'note', label: '備註', type_1: 'text', order: 3 },
    ])],
    [`/api/approvals/forms/${LEAVE_ID}/workflow`, json({ steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }] })],
  ]
  async function openLeave(extra) {
    const calls = installFetch(routes(extra))
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = LEAVE_ID
    await wrapper.vm.onSelectForm()
    await flushPromises()
    return { wrapper, calls }
  }

  it('必填沒填：每個沒填的欄位都標出來（不是只講第一個），不送出；補上之後錯誤跟著消失', async () => {
    const { wrapper, calls } = await openLeave()
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(wrapper.vm.applyFieldErrors).toEqual({ type: '請填寫假別', reason: '請填寫事由' })
    expect(wrapper.vm.applyError).toBe('請填寫必填欄位：假別')
    expect(notifyFailure).toHaveBeenCalledWith('送出失敗', '請填寫必填欄位：假別')
    expect(count(calls, post('/api/approvals'))).toBe(0)
    expect(wrapper.vm.submitting).toBe(false)

    wrapper.vm.applyState.formData = { ...wrapper.vm.applyState.formData, type: '事假' }
    await flushPromises()
    expect(wrapper.vm.applyFieldErrors).toEqual({ reason: '請填寫事由' })
    expect(wrapper.vm.applyError).toBe('請填寫必填欄位：事由')

    wrapper.vm.applyState.formData = { ...wrapper.vm.applyState.formData, reason: '家中有事' }
    await flushPromises()
    expect(wrapper.vm.applyFieldErrors).toEqual({})
    expect(wrapper.vm.applyError).toBe('')
  })

  it('伺服器回的錯誤不會因為改了欄位就被當成必填錯誤清掉', async () => {
    const { wrapper } = await openLeave([[post('/api/approvals'), json({ error: '特休餘額不足：剩餘 8 小時（1 天），本次申請 16 小時（2 天）', code: 'ANNUAL_LEAVE_INSUFFICIENT' }, 409)]])
    wrapper.vm.applyState.formData = { type: '特休', reason: '休假', note: '' }
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(wrapper.vm.applyError).toContain('特休餘額不足')
    wrapper.vm.applyState.formData = { ...wrapper.vm.applyState.formData, note: '改一下' }
    await flushPromises()
    expect(wrapper.vm.applyError).toContain('特休餘額不足')
  })

  // 伺服器送出特休時以可用時數（剩餘 − 其他簽核中的特休）把關，回 400 ANNUAL_LEAVE_INSUFFICIENT：
  // 標題講清楚是餘額不足，訊息帶伺服器的數字並說明接下來怎麼做
  it('特休餘額不足（400）：標題是「特休餘額不足」，訊息有剩餘、簽核中、可請時數與怎麼辦', async () => {
    const error = '特休餘額不足：剩餘 16 小時（2 天）、其他簽核中的特休 8 小時（1 天），可請 8 小時（1 天），本次申請 16 小時（2 天）'
    const { wrapper } = await openLeave([[post('/api/approvals'), json({ error, code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 16, pendingHours: 8, availableHours: 8, requestedHours: 16 }, 400)]])
    wrapper.vm.applyState.formData = { type: '特休', reason: '休假', note: '' }
    await wrapper.vm.submitApply()
    await flushPromises()
    const expected = `${error}。請減少請假時數、改請其他假別，或等簽核中的特休處理完再送出。`
    expect(notifyFailure).toHaveBeenCalledWith('特休餘額不足', expected)
    expect(wrapper.vm.applyError).toBe(expected)
    // 表單留著，改完可以再送
    expect(wrapper.vm.applyState.formId).toBe(LEAVE_ID)
    expect(wrapper.vm.submitting).toBe(false)
  })

  it('送出成功：不擋畫面的訊息、回到「我的申請」並清掉那裡的篩選（才看得到剛送出的單）', async () => {
    const { wrapper } = await openLeave([[post('/api/approvals'), json({ _id: 'n1' }, 201)]])
    wrapper.vm.myFilter = { ...wrapper.vm.myFilter, status: 'approved' }
    wrapper.vm.applyState.formData = { type: '事假', reason: '家中有事', note: '' }
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(notifySuccess).toHaveBeenCalledWith('送出申請成功！', [])
    expect(wrapper.vm.activeTab).toBe('mine')
    expect(wrapper.vm.myFilter.status).toBe('')
    expect(wrapper.vm.applyState.formId).toBe('')
  })

  it('沒有任何欄位的表單也能送出（以前選了之後只看到「請先選擇表單」）', async () => {
    const calls = installFetch([
      [isFormsList, json([OVERTIME])],
      [`/api/approvals/forms/${OT_ID}/fields`, json([])],
      [`/api/approvals/forms/${OT_ID}/workflow`, json({ steps: [{ approver_type: 'tag', approver_value: '人資' }] })],
      [post('/api/approvals'), json({ _id: 'n2' }, 201)],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = OT_ID
    await wrapper.vm.onSelectForm()
    await flushPromises()
    expect(wrapper.vm.fieldsLoaded).toBe(true)
    const submit = wrapper.find('[data-test="submit-apply"]')
    expect(submit.exists()).toBe(true)
    await submit.trigger('click')
    await flushPromises()
    expect(count(calls, post('/api/approvals'))).toBe(1)
  })

  it('請假單：假別下方是一句話的餘額（沒選假別時列特休與調休），完整的餘額表收合在表單下面', async () => {
    const balances = {
      range: { start: '2026-01-01', end: '2026-12-31' },
      items: [
        { key: 'annual', name: '特休', source: 'employee', period: 'year', status: 'ok', quotaHours: 80, usedHours: 16, pendingHours: 0, remainingHours: 64, availableHours: 64, includes: [] },
        { key: 'comp', name: '調休', aliases: ['移休'], source: 'bank', period: 'none', status: 'bank', quotaHours: 24, usedHours: 16, pendingHours: 0, remainingHours: 8, availableHours: 8, includes: [] },
        { key: 'personal', name: '事假', source: 'policy', period: 'year', status: 'ok', quotaHours: 112, usedHours: 44, pendingHours: 0, remainingHours: 68, availableHours: 68, includes: [] },
      ],
      unmatched: [],
    }
    installFetch([
      ['/api/approvals/leave-balances', json(balances)],
      [isFormsList, json([LEAVE])],
      [`/api/approvals/forms/${LEAVE_ID}/fields`, json(leaveFields)],
      [`/api/approvals/forms/${LEAVE_ID}/workflow`, json({ steps: [] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = LEAVE_ID
    await wrapper.vm.onSelectForm()
    await flushPromises()

    const brief = () => wrapper.findAll('[data-test="balance-brief"] .balance-brief__item').map(node => node.text())
    expect(brief()).toEqual(['特休 可請 64 小時（8 天）', '調休 可請 8 小時（1 天）'])
    // 在假別欄位的下面
    expect(wrapper.find('[data-test="balance-brief"]').element.closest('.el-form-item').getAttribute('data-field-id')).toBe('type')

    wrapper.vm.applyState.formData = { ...wrapper.vm.applyState.formData, type: '事假' }
    await flushPromises()
    expect(brief()).toEqual(['事假 可請 68 小時（8 天 4 小時）'])

    // 餘額表在表單後面、預設收合；按「全部餘額」展開
    const form = wrapper.find('.apply-section').element
    const panel = wrapper.find('#pane-apply [data-test="leave-balance-panel"]').element
    expect(form.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.find('#pane-apply [data-test="leave-balance-body"]').element.style.display).toBe('none')
    await wrapper.find('[data-test="balance-brief"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('#pane-apply [data-test="leave-balance-body"]').element.style.display).toBe('')
    expect(wrapper.find('#pane-apply [data-test="comp-leave-body"]').element.style.display).toBe('')
  })
})

describe('簽核動作', () => {
  it('退簽沒寫原因、確認框還開著時再按一次：只問一次、只送出一次', async () => {
    const answer = deferred()
    confirmAction.mockReturnValue(answer.promise)
    const calls = installFetch([
      [isInbox, json([inboxRow('a1')])],
      [post('/a1/act'), json({ _id: 'a1', status: 'returned' })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'return')
    const first = wrapper.vm.doAction()
    const second = wrapper.vm.doAction()
    await flushPromises()
    expect(confirmAction).toHaveBeenCalledTimes(1)
    expect(confirmAction.mock.calls[0][0]).toContain('尚未填寫退簽原因')
    expect(wrapper.vm.actionDlg.loading).toBe(true)
    expect(count(calls, post('/a1/act'))).toBe(0)

    answer.resolve(true)
    await Promise.all([first, second])
    await flushPromises()
    expect(count(calls, post('/a1/act'))).toBe(1)
    expect(notifySuccess).toHaveBeenCalledWith('已送出！', [])
  })

  it('確認框選了取消：不送出，視窗留著，可以再按', async () => {
    confirmAction.mockResolvedValue(false)
    const calls = installFetch([[isInbox, json([inboxRow('a1')])]])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'return')
    await wrapper.vm.doAction()
    expect(count(calls, post('/a1/act'))).toBe(0)
    expect(wrapper.vm.actionDlg).toMatchObject({ visible: true, loading: false })
  })

  it('簽核成功：這張單馬上從待簽清單消失、件數減一，不必等清單重新載入', async () => {
    const reload = deferred()
    let inboxCalls = 0
    installFetch([
      [isInbox, () => {
        inboxCalls += 1
        return inboxCalls === 1 ? json([inboxRow('a1'), inboxRow('a2')]) : reload.promise
      }],
      [post('/a1/act'), json({ _id: 'a1', status: 'approved' })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.inboxCount).toBe(2)
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
    const acting = wrapper.vm.doAction()
    await flushPromises()
    // 清單還在重新載入中
    expect(wrapper.vm.inboxList.map(row => row._id)).toEqual(['a2'])
    expect(wrapper.vm.inboxCount).toBe(1)
    expect(wrapper.vm.actionDlg.visible).toBe(false)

    reload.resolve(json([inboxRow('a2')]))
    await acting
    await flushPromises()
    expect(wrapper.vm.inboxList.map(row => row._id)).toEqual(['a2'])
  })

  // 核准時特休已經不夠（409 ANNUAL_LEAVE_INSUFFICIENT）：單據還在簽核中，不能當成「已被別人處理」
  it('核准時特休餘額不足（409）：關掉確認視窗、單據留在待簽清單，說明原因與怎麼辦', async () => {
    const error = '特休餘額不足，無法核准：剩餘 4 小時，這張單需要 8 小時（1 天）。請人資確認特休時數，或退簽請申請人修改'
    const calls = installFetch([
      [isInbox, json([inboxRow('a1'), inboxRow('a2')])],
      [post('/a1/act'), json({ error, code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: 4, requestedHours: 8 }, 409)],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
    await wrapper.vm.doAction()
    await flushPromises()
    expect(count(calls, post('/a1/act'))).toBe(1)
    expect(wrapper.vm.actionDlg).toMatchObject({ visible: false, loading: false })
    expect(wrapper.vm.inboxList.map(row => row._id)).toEqual(['a1', 'a2'])
    // 伺服器的訊息已經寫了怎麼辦，不再重複
    expect(notifyFailure).toHaveBeenCalledWith('特休餘額不足，無法核准', `${error}。`)
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('簽核視窗寫明是哪一張單，確認鍵就是要做的動作', async () => {
    installFetch([
      [isInbox, json([inboxRow('a1')])],
      [`/api/approvals/forms/${LEAVE_ID}/fields`, json(leaveFields)],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'reject')
    await flushPromises()
    const dialog = wrapper.findAll('.el-dialog').find(node => node.text().includes('意見／備註'))
    expect(dialog.find('[data-test="action-target"]').text().replace(/\s+/g, ' ')).toContain('請假・王小明')
    expect(dialog.find('[data-test="action-target"]').text()).toContain('事假・2026/11/12 09:00–18:00・8 小時（1 天）')
    const confirm = dialog.find('[data-test="action-confirm"]')
    expect(confirm.text()).toBe('否決')
    expect(confirm.classes()).toContain('el-button--danger')
  })
})

describe('申請單明細：看完內容直接處理', () => {
  const detailDoc = (patch = {}) => ({
    ...inboxRow('a1'),
    form: { ...LEAVE, fields: leaveFields },
    logs: [],
    viewer: { is_applicant: false, can_act: true, can_override: false },
    ...patch,
  })
  const footerButtons = (wrapper) => {
    const dialog = wrapper.findAll('.el-dialog').find(node => node.text().includes('申請單明細'))
    return dialog.findAll('.el-dialog__footer button').map(button => button.text())
  }

  it('這一關的簽核人：明細下方有核可、否決，允許退簽的關卡才有退簽', async () => {
    installFetch([
      [isInbox, json([inboxRow('a1')])],
      [(url) => url.endsWith('/api/approvals/a1'), json(detailDoc())],
      [(url) => url.endsWith('/api/approvals/a2'), json(detailDoc({ _id: 'a2', steps: [{ step_order: 1, can_return: false, approvers: [] }] }))],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    await wrapper.vm.openDetail('a1')
    await flushPromises()
    expect(footerButtons(wrapper)).toEqual(['關閉', '退簽', '否決', '核可'])

    await wrapper.vm.openDetail('a2')
    await flushPromises()
    expect(footerButtons(wrapper)).toEqual(['關閉', '否決', '核可'])
  })

  it('從明細按核可：開啟簽核視窗（帶著畫面上的關卡）；按取消回到明細，成功就不回去', async () => {
    const calls = installFetch([
      [isInbox, json([inboxRow('a1')])],
      [(url) => url.endsWith('/api/approvals/a1'), json(detailDoc())],
      [post('/a1/act'), json({ _id: 'a1', status: 'pending' })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    await wrapper.vm.openDetail('a1')
    await flushPromises()
    await wrapper.find('[data-test="detail-approve"]').trigger('click')
    expect(wrapper.vm.detail.visible).toBe(false)
    expect(wrapper.vm.actionDlg).toMatchObject({ visible: true, decision: 'approve', override: false, fromDetail: true })

    // 取消：回到明細
    wrapper.vm.actionDlg.visible = false
    wrapper.vm.onActionClosed()
    expect(wrapper.vm.detail.visible).toBe(true)

    // 再按一次並送出：不帶 override，帶上關卡編號；完成後不再打開明細
    await wrapper.find('[data-test="detail-approve"]').trigger('click')
    await wrapper.vm.doAction()
    await flushPromises()
    wrapper.vm.onActionClosed()
    const body = JSON.parse(calls.find(call => call.url.endsWith('/a1/act')).body)
    expect(body).toEqual({ decision: 'approve', comment: '', step_order: 1 })
    expect(wrapper.vm.detail.visible).toBe(false)
  })

  it('申請人看自己被退簽的單：可以直接「修改並重新送出」或「撤回」，沒有簽核按鈕', async () => {
    const mine = detailDoc({ _id: 'm2', status: 'returned', viewer: { is_applicant: true, can_act: false, can_override: false } })
    const calls = installFetch([
      [isMine, json([myRow('m2', 'returned')])],
      [(url) => url.endsWith('/api/approvals/m2'), json(mine)],
      [post('/m2/cancel'), json({ ...mine, status: 'canceled' })],
    ])
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('m2')
    await flushPromises()
    expect(footerButtons(wrapper)).toEqual(['關閉', '撤回', '修改並重新送出'])

    // 修改並重新送出：關掉明細、開啟修改視窗
    await wrapper.find('[data-test="detail-resubmit"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.detail.visible).toBe(false)
    expect(wrapper.vm.editDlg).toMatchObject({ visible: true, requestId: 'm2' })
    wrapper.vm.closeEditDialog()

    // 撤回：先確認，成功後關掉明細、提示、更新清單與餘額
    await wrapper.vm.openDetail('m2')
    await flushPromises()
    const balanceCallsBefore = count(calls, url => url.includes('/api/approvals/leave-balances'))
    const listCallsBefore = count(calls, isMine)
    await wrapper.find('[data-test="detail-cancel"]').trigger('click')
    await flushPromises()
    expect(confirmAction).toHaveBeenCalledWith('確定撤回這筆申請？', expect.objectContaining({ confirmText: '撤回', danger: true }))
    expect(count(calls, post('/m2/cancel'))).toBe(1)
    expect(wrapper.vm.detail.visible).toBe(false)
    expect(notifySuccess).toHaveBeenCalledWith('已撤回')
    expect(count(calls, isMine)).toBe(listCallsBefore + 1)
    // 撤回後簽核中的時數釋放，餘額跟著重新取
    expect(count(calls, url => url.includes('/api/approvals/leave-balances'))).toBe(balanceCallsBefore + 1)
  })

  it('撤回時在確認框選了不撤回：什麼都不做，明細留著', async () => {
    confirmAction.mockResolvedValue(false)
    const mine = detailDoc({ _id: 'm3', status: 'pending', viewer: { is_applicant: true, can_act: false } })
    const calls = installFetch([[(url) => url.endsWith('/api/approvals/m3'), json(mine)]])
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('m3')
    await flushPromises()
    await wrapper.find('[data-test="detail-cancel"]').trigger('click')
    await flushPromises()
    expect(count(calls, post('/m3/cancel'))).toBe(0)
    expect(wrapper.vm.detail.visible).toBe(true)
    expect(notifySuccess).not.toHaveBeenCalled()
  })
})

describe('修改並重新送出：欄位旁的錯誤', () => {
  it('必填沒填時標在欄位下方，補上後消失；不會送出', async () => {
    const doc = {
      _id: 'm2',
      status: 'returned',
      form: { ...OVERTIME, fields: [{ _id: 'reason', label: '事由', type_1: 'text', required: true }, { _id: 'proof', label: '證明', type_1: 'file', required: true }] },
      form_data: { reason: '', proof: [{ name: 'old.pdf', url: '/upload/approvals/old.pdf' }] },
      steps: [],
      logs: [],
    }
    const calls = installFetch([[(url) => url.endsWith('/api/approvals/m2'), json(doc)]])
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow('m2', 'returned'))
    await flushPromises()
    await wrapper.vm.submitResubmit()
    await flushPromises()
    // 原本的附件還在，只缺事由
    expect(wrapper.vm.editDlg.fieldErrors).toEqual({ reason: '請填寫事由' })
    expect(wrapper.vm.editDlg.error).toBe('請填寫必填欄位：事由')
    expect(count(calls, post('/m2/resubmit'))).toBe(0)

    wrapper.vm.editDlg.formData = { ...wrapper.vm.editDlg.formData, reason: '補上了' }
    await flushPromises()
    expect(wrapper.vm.editDlg.fieldErrors).toEqual({})
  })
})
