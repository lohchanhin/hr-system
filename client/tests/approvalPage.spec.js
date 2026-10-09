import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Approval from '../src/views/front/Approval.vue'
import { useAuthStore } from '../src/stores/auth'

// 頁面沒有掛在 router-view 底下，攔截離開頁面的守衛直接測
const { leaveGuards } = vi.hoisted(() => ({ leaveGuards: [] }))
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, onBeforeRouteLeave: (guard) => { leaveGuards.push(guard) } }
})

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  blob: () => Promise.resolve(new Blob(['x'])),
})

/**
 * 依網址與方法回應的假 fetch。routes: [[matcher, responder]]，先符合先用；
 * matcher 是字串（網址包含）或函式 (url, init) => boolean；其餘一律回空陣列。
 */
function installFetch(routes = []) {
  const calls = []
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, method: init.method || 'GET', body: init.body, headers: init.headers })
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

const post = (suffix) => (url, init) => init?.method === 'POST' && url.endsWith(suffix)
const callsTo = (calls, predicate) => calls.filter(predicate)

const mounted = []
async function mountPage({ role = 'employee' } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Approval, { global: { plugins: [ElementPlus, pinia] } })
  mounted.push(wrapper)
  useAuthStore().role = role
  await flushPromises()
  return wrapper
}

let alertSpy
let confirmSpy
beforeEach(() => {
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  // 卸載頁面，避免 window 上殘留 beforeunload 監聽影響其他測試
  while (mounted.length) mounted.pop().unmount()
  leaveGuards.length = 0
  vi.restoreAllMocks()
})

const tabLabels = (wrapper) => wrapper.findAll('.el-tabs__item').map(item => item.text())

describe('Approval.vue 分頁（C1）', () => {
  it.each(['employee', 'supervisor', 'admin'])('%s 都看得到「我已簽核」分頁', async (role) => {
    installFetch()
    const wrapper = await mountPage({ role })
    expect(tabLabels(wrapper)).toEqual(['申請表單', '待我簽核', '我已簽核', '我的申請'])
  })

  it('切到「我已簽核」才載入歷史，且顯示伺服器回傳的紀錄', async () => {
    const calls = installFetch([
      ['/api/approvals/history', json([{
        _id: 'h1',
        status: 'approved',
        form: { _id: 'f1', name: '請假' },
        applicant_employee: { name: '王小明' },
        my_approvals: [{ decision: 'approved', decided_at: '2026-06-19T01:00:00.000Z', comment: '同意' }],
      }])],
    ])
    const wrapper = await mountPage({ role: 'employee' })
    expect(callsTo(calls, c => c.url.includes('/api/approvals/history'))).toHaveLength(0)

    wrapper.vm.activeTab = 'history'
    await flushPromises()
    expect(callsTo(calls, c => c.url.includes('/api/approvals/history'))).toHaveLength(1)
    expect(wrapper.vm.historyList).toHaveLength(1)
    const text = wrapper.text()
    expect(text).toContain('王小明')
    expect(text).toContain('2026/06/19 09:00')
  })

  it('沒有權限看歷史時只在分頁內顯示中文提示，不跳出對話框', async () => {
    installFetch([['/api/approvals/history', json({ error: 'Forbidden' }, 403)]])
    const wrapper = await mountPage({ role: 'employee' })
    wrapper.vm.activeTab = 'history'
    await flushPromises()
    expect(wrapper.vm.historyError).toBe('您沒有權限查看歷史簽核紀錄')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('我的申請使用伺服器回傳的表單名稱，不再逐筆查明細（無 N+1）', async () => {
    const calls = installFetch([
      [(url) => /\/api\/approvals\?/.test(url), json([
        { _id: 'r1', status: 'pending', form: { _id: 'f1', name: '請假' }, current_step_index: 0, steps: [{}], createdAt: '2026-06-19T01:00:00.000Z' },
        { _id: 'r2', status: 'approved', form: { _id: 'f2', name: '加班申請' }, current_step_index: 0, steps: [{}], createdAt: '2026-06-18T01:00:00.000Z' },
      ])],
    ])
    const wrapper = await mountPage()
    expect(wrapper.vm.myList).toHaveLength(2)
    expect(callsTo(calls, c => /\/api\/approvals\/r\d/.test(c.url))).toHaveLength(0)
    const text = wrapper.text()
    expect(text).toContain('請假')
    expect(text).toContain('加班申請')
    // 建立時間用台灣時間與中文格式
    expect(text).toContain('2026/06/19 09:00')
  })

  it('伺服器回傳分頁格式時顯示分頁並可換頁；純陣列則不分頁', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      _id: `r${i}`, status: 'pending', form: { name: '請假' }, current_step_index: 0, steps: [{}], createdAt: '2026-06-19T01:00:00.000Z',
    }))
    const calls = installFetch([
      [(url) => /\/api\/approvals\?page=1/.test(url), json({ items, total: 45, page: 1, limit: 20 })],
      [(url) => /\/api\/approvals\?page=2/.test(url), json({ items: items.slice(0, 5), total: 45, page: 2, limit: 20 })],
    ])
    const wrapper = await mountPage()
    expect(wrapper.vm.myList).toHaveLength(20)
    expect(wrapper.vm.myPage).toMatchObject({ total: 45, paged: true, page: 1 })
    expect(wrapper.find('.list-pagination').exists()).toBe(true)

    await wrapper.vm.fetchMyList(2)
    await flushPromises()
    expect(wrapper.vm.myList).toHaveLength(5)
    expect(wrapper.vm.myPage.page).toBe(2)
    expect(callsTo(calls, c => /\/api\/approvals\?page=2&limit=20/.test(c.url))).toHaveLength(1)
  })

  it('純陣列回應不顯示分頁元件', async () => {
    installFetch([[(url) => /\/api\/approvals\?/.test(url), json([{ _id: 'r1', status: 'pending', form: { name: '請假' }, current_step_index: 0, steps: [{}] }])]])
    const wrapper = await mountPage()
    expect(wrapper.vm.myPage.paged).toBe(false)
    expect(wrapper.find('.list-pagination').exists()).toBe(false)
  })
})

describe('Approval.vue 待我簽核與簽核動作（C2、C3）', () => {
  const inboxRow = (id, canReturn) => ({
    _id: id,
    status: 'pending',
    form: { _id: 'f1', name: '請假' },
    applicant_employee: { _id: 'e1', name: '王小明' },
    current_step_index: 0,
    createdAt: '2026-06-19T01:00:00.000Z',
    steps: [{ can_return: canReturn, approvers: [{ approver: { _id: 'me', name: '我' }, decision: 'pending' }] }],
  })

  it('只有該關允許退簽時才顯示退簽按鈕', async () => {
    installFetch([['/api/approvals/inbox', json([inboxRow('a1', true), inboxRow('a2', false)])]])
    const wrapper = await mountPage({ role: 'supervisor' })
    expect(wrapper.vm.canReturnRow(inboxRow('x', true))).toBe(true)
    expect(wrapper.vm.canReturnRow(inboxRow('x', false))).toBe(false)
    const rows = wrapper.findAll('.el-table__body tr').filter(tr => tr.text().includes('王小明'))
    expect(rows).toHaveLength(2)
    const hasReturn = (tr) => tr.findAll('button').some(b => b.text().includes('退簽'))
    expect(rows.map(hasReturn).sort()).toEqual([false, true])
  })

  it('核可被檢核擋下時，對話框一條一行列出原因，而不是只有「送簽資料檢核未通過」', async () => {
    installFetch([
      ['/api/approvals/inbox', json([inboxRow('a1', true)])],
      [post('/a1/act'), json({
        error: '送簽資料檢核未通過',
        violations: [{ rule: 'proof', message: '請假申請必須附上相關證明' }, { rule: 'reason', message: '事假必須填寫事由' }],
      }, 400)],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
    await wrapper.vm.doAction()
    await flushPromises()

    expect(wrapper.vm.errorDlg.visible).toBe(true)
    expect(wrapper.vm.errorDlg.lines).toEqual(['請假申請必須附上相關證明', '事假必須填寫事由'])
    expect(wrapper.vm.errorDlg.title).toBe('動作失敗')
    const items = wrapper.findAll('.error-lines li').map(li => li.text())
    expect(items).toEqual(['請假申請必須附上相關證明', '事假必須填寫事由'])
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('單子已被別人處理（409）時顯示中文、關閉對話框並重新整理待簽清單', async () => {
    const calls = installFetch([
      ['/api/approvals/inbox', json([inboxRow('a1', true)])],
      [post('/a1/act'), json({ error: 'not step approver or already acted' }, 409)],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    const inboxBefore = callsTo(calls, c => c.url.includes('/api/approvals/inbox')).length
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
    await wrapper.vm.doAction()
    await flushPromises()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    const message = alertSpy.mock.calls[0][0]
    expect(message).toContain('動作失敗')
    expect(message).toContain('此單已被處理')
    expect(message).not.toMatch(/not step approver/)
    expect(wrapper.vm.actionDlg.visible).toBe(false)
    expect(callsTo(calls, c => c.url.includes('/api/approvals/inbox')).length).toBeGreaterThan(inboxBefore)
  })

  it('網路中斷時顯示通用中文訊息，對話框保持開啟並結束載入中', async () => {
    const calls = installFetch([
      ['/api/approvals/inbox', json([inboxRow('a1', true)])],
      [post('/a1/act'), new TypeError('Failed to fetch')],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'reject')
    await wrapper.vm.doAction()
    await flushPromises()

    expect(alertSpy.mock.calls[0][0]).toContain('網路連線異常')
    expect(wrapper.vm.actionDlg.loading).toBe(false)
    expect(wrapper.vm.actionDlg.visible).toBe(true)
    // 失敗也重新整理清單
    expect(callsTo(calls, c => c.url.includes('/api/approvals/inbox')).length).toBeGreaterThan(1)
  })

  it('成功後關閉對話框、重新載入清單並提示', async () => {
    const calls = installFetch([
      ['/api/approvals/inbox', json([inboxRow('a1', true)])],
      [post('/a1/act'), json({ _id: 'a1', status: 'approved' })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'return')
    wrapper.vm.actionDlg.comment = '用途請寫清楚'
    await wrapper.vm.doAction()
    await flushPromises()
    const actCall = callsTo(calls, c => c.url.endsWith('/a1/act'))[0]
    // 一律帶上畫面看到的關卡編號（step_order），一般退簽不帶 override
    expect(JSON.parse(actCall.body)).toEqual({ decision: 'return', comment: '用途請寫清楚', step_order: 1 })
    expect(wrapper.vm.actionDlg.visible).toBe(false)
    expect(alertSpy).toHaveBeenCalledWith('已送出！')
  })

  describe('送出簽核時帶上畫面看到的關卡（step_order），過期的分頁會被伺服器擋下', () => {
    // 停在第 2 關（索引 1）：關卡自己的編號是 5，不是索引 + 1
    const stepTwoRow = (id = 'a2') => ({
      ...inboxRow(id, true),
      current_step_index: 1,
      steps: [
        { step_order: 1, can_return: true, approvers: [{ approver: { _id: 'other', name: '前一關' }, decision: 'approved' }] },
        { step_order: 5, can_return: true, approvers: [{ approver: { _id: 'me', name: '我' }, decision: 'pending' }] },
      ],
    })
    const actBody = (calls, id) => JSON.parse(callsTo(calls, c => c.url.endsWith(`/${id}/act`))[0].body)

    it('關卡資料有 step_order 就用目前這關的 step_order', async () => {
      const calls = installFetch([
        ['/api/approvals/inbox', json([stepTwoRow()])],
        [post('/a2/act'), json({ _id: 'a2', status: 'pending' })],
      ])
      const wrapper = await mountPage({ role: 'supervisor' })
      wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
      await wrapper.vm.doAction()
      await flushPromises()
      expect(actBody(calls, 'a2')).toEqual({ decision: 'approve', comment: '', step_order: 5 })
    })

    it('關卡沒有 step_order（舊資料）就用 current_step_index + 1', async () => {
      const row = { ...stepTwoRow('a3'), current_step_index: 2, steps: [{ approvers: [] }, { approvers: [] }, { can_return: true, approvers: [] }] }
      const calls = installFetch([
        ['/api/approvals/inbox', json([row])],
        [post('/a3/act'), json({ _id: 'a3', status: 'pending' })],
      ])
      const wrapper = await mountPage({ role: 'supervisor' })
      wrapper.vm.openAction(wrapper.vm.inboxList[0], 'reject')
      await wrapper.vm.doAction()
      await flushPromises()
      expect(actBody(calls, 'a3')).toEqual({ decision: 'reject', comment: '', step_order: 3 })
    })

    it('清單列沒有 current_step_index 時不帶 step_order（不亂猜關卡）', async () => {
      installFetch()
      const wrapper = await mountPage({ role: 'supervisor' })
      expect(wrapper.vm.displayedStepOrder({ _id: 'x', steps: [{ step_order: 1 }] })).toBeUndefined()
      expect(wrapper.vm.displayedStepOrder({ current_step_index: null })).toBeUndefined()
      expect(wrapper.vm.displayedStepOrder({ current_step_index: 0 })).toBe(1)
    })

    it.each(['approve', 'reject', 'return'])('一般的「%s」不帶 override（即使登入的是管理員）', async (decision) => {
      const calls = installFetch([
        ['/api/approvals/inbox', json([inboxRow('a1', true)])],
        [post('/a1/act'), json({ _id: 'a1', status: 'pending' })],
      ])
      const wrapper = await mountPage({ role: 'admin' })
      wrapper.vm.openAction(wrapper.vm.inboxList[0], decision)
      wrapper.vm.actionDlg.comment = '意見'
      await wrapper.vm.doAction()
      await flushPromises()
      const body = actBody(calls, 'a1')
      expect(body).toEqual({ decision, comment: '意見', step_order: 1 })
      expect(Object.prototype.hasOwnProperty.call(body, 'override')).toBe(false)
    })

    it('另一個分頁已經處理過這一關：伺服器回 409 CONFLICT，顯示伺服器的中文說明、關閉對話框並重新載入待簽清單', async () => {
      const calls = installFetch([
        ['/api/approvals/inbox', json([inboxRow('a1', true)])],
        [post('/a1/act'), json({ error: '這張簽核單剛被其他人更新，請重新整理後再試', code: 'CONFLICT' }, 409)],
      ])
      const wrapper = await mountPage({ role: 'supervisor' })
      const inboxBefore = callsTo(calls, c => c.url.includes('/api/approvals/inbox')).length
      wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
      await wrapper.vm.doAction()
      await flushPromises()

      expect(actBody(calls, 'a1').step_order).toBe(1)
      expect(alertSpy).toHaveBeenCalledTimes(1)
      expect(alertSpy.mock.calls[0][0]).toBe('動作失敗：這張簽核單剛被其他人更新，請重新整理後再試')
      expect(wrapper.vm.actionDlg.visible).toBe(false)
      expect(callsTo(calls, c => c.url.includes('/api/approvals/inbox')).length).toBeGreaterThan(inboxBefore)
    })

    it('管理員代為處理的對話框才帶 override: true，並帶上單據目前的關卡', async () => {
      const row = {
        _id: 'p9', status: 'pending', oversight: true, current_step_index: 1,
        form: { _id: 'f1', name: '請假' }, applicant_employee: { name: '王小明' }, my_approvals: [],
      }
      const calls = installFetch([
        ['/api/approvals/history', json({ items: [row], total: 1, page: 1, limit: 20 })],
        [post('/p9/act'), json({ _id: 'p9', status: 'pending' })],
      ])
      const wrapper = await mountPage({ role: 'admin' })
      wrapper.vm.openAction(row, 'approve', { override: true })
      await wrapper.vm.doAction()
      await flushPromises()
      expect(actBody(calls, 'p9')).toEqual({ decision: 'approve', comment: '', step_order: 2, override: true })

      // 再開一般對話框（沒有 override）就不能沿用上一次的代簽旗標
      calls.length = 0
      wrapper.vm.openAction(row, 'reject')
      await wrapper.vm.doAction()
      await flushPromises()
      expect(actBody(calls, 'p9')).toEqual({ decision: 'reject', comment: '', step_order: 2 })
    })

    it('從明細按「代為核可」遇到 409：重新打開最新的明細，並顯示伺服器的說明', async () => {
      let detailLoads = 0
      const doc = (stepIndex) => ({
        _id: 'p1', status: 'pending', form: { name: '請假', fields: [] }, form_data: {},
        applicant_employee: { name: '王小明' }, current_step_index: stepIndex,
        steps: [{ step_order: 1, approvers: [] }, { step_order: 2, approvers: [] }], logs: [],
        viewer: { can_override: true, can_act: false, is_applicant: false },
      })
      const calls = installFetch([
        [(url) => url.endsWith('/api/approvals/p1'), () => json(doc(detailLoads++ === 0 ? 0 : 1))],
        [post('/p1/act'), json({ error: '這張簽核單剛被其他人更新，請重新整理後再試', code: 'CONFLICT' }, 409)],
      ])
      const wrapper = await mountPage({ role: 'admin' })
      await wrapper.vm.openDetail('p1')
      await flushPromises()
      expect(wrapper.vm.detail.doc.current_step_index).toBe(0)

      wrapper.vm.overrideFromDetail('approve')
      await wrapper.vm.doAction()
      await flushPromises()

      expect(actBody(calls, 'p1')).toEqual({ decision: 'approve', comment: '', step_order: 1, override: true })
      expect(alertSpy).toHaveBeenCalledWith('動作失敗：這張簽核單剛被其他人更新，請重新整理後再試')
      // 明細重新載入，顯示的是已經前進到第 2 關的單據
      expect(detailLoads).toBe(2)
      expect(wrapper.vm.detail.visible).toBe(true)
      expect(wrapper.vm.detail.doc.current_step_index).toBe(1)
    })
  })

  it('退簽沒填原因時先確認；不同意就不送出', async () => {
    const calls = installFetch([['/api/approvals/inbox', json([inboxRow('a1', true)])]])
    confirmSpy.mockReturnValue(false)
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'return')
    await wrapper.vm.doAction()
    expect(confirmSpy).toHaveBeenCalled()
    expect(callsTo(calls, c => c.url.endsWith('/a1/act'))).toHaveLength(0)
    expect(wrapper.vm.actionDlg.visible).toBe(true)
  })
})

describe('Approval.vue 申請表單（C3、C4）', () => {
  const fields = [
    { _id: 'amount', label: '金額', type_1: 'number', required: true, order: 1 },
    { _id: 'reason', label: '事由', type_1: 'textarea', required: false, order: 2 },
    { _id: 'cross', label: '是否跨日', type_1: 'checkbox', required: true, order: 3 },
    { _id: 'hidden', label: '停用欄位', type_1: 'text', required: true, is_active: false, order: 4 },
  ]
  const baseRoutes = () => [
    ['/api/approvals/forms/f1/fields', json(fields)],
    ['/api/approvals/forms/f1/workflow', json({ steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }] })],
  ]

  async function selectForm(wrapper, formId = 'f1') {
    wrapper.vm.applyState.formId = formId
    await wrapper.vm.onSelectForm()
    await flushPromises()
  }

  it('停用的表單不會出現在選單，請求也只要啟用中的表單', async () => {
    const calls = installFetch([
      ['/api/approvals/forms?', json([
        { _id: 'f1', name: '請假', category: '人事' },
        { _id: 'f2', name: '舊表單', category: '其他', is_active: false },
      ])],
    ])
    const wrapper = await mountPage()
    expect(wrapper.vm.formTemplates.map(f => f._id)).toEqual(['f1'])
    expect(callsTo(calls, c => c.url.includes('/api/approvals/forms?is_active=true'))).toHaveLength(1)
  })

  it('回到申請頁時重新取得表單清單，新增的表單不必重新整理整頁', async () => {
    let templates = [{ _id: 'f1', name: '請假', category: '人事' }]
    installFetch([['/api/approvals/forms?', () => json(templates)]])
    const wrapper = await mountPage()
    expect(wrapper.vm.formTemplates.map(f => f._id)).toEqual(['f1'])

    templates = [...templates, { _id: 'f2', name: '新表單', category: '其他' }]
    wrapper.vm.activeTab = 'mine'
    await flushPromises()
    wrapper.vm.activeTab = 'apply'
    await flushPromises()
    expect(wrapper.vm.formTemplates.map(f => f._id)).toEqual(['f1', 'f2'])
  })

  it('表單清單載入失敗時在申請頁顯示中文原因', async () => {
    installFetch([['/api/approvals/forms?', json({ error: 'boom' }, 500)]])
    const wrapper = await mountPage()
    expect(wrapper.vm.templatesError).toContain('系統暫時發生問題')
    expect(wrapper.text()).toContain('系統暫時發生問題')
  })

  it('數字欄位一開始是空白、單一勾選為 false，停用欄位不出現', async () => {
    installFetch(baseRoutes())
    const wrapper = await mountPage()
    await selectForm(wrapper)
    expect(wrapper.vm.fieldList.map(f => f._id)).toEqual(['amount', 'reason', 'cross'])
    expect(wrapper.vm.applyState.formData).toEqual({ amount: null, reason: '', cross: false })
    const numberInput = wrapper.find('.el-input-number input')
    expect(numberInput.element.value).toBe('')
    expect(wrapper.findAll('.form-fields input[type="checkbox"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('停用欄位')
  })

  it('必填的數字沒填時在本機擋下，不上傳也不送出', async () => {
    const calls = installFetch(baseRoutes())
    const wrapper = await mountPage()
    await selectForm(wrapper)
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(wrapper.vm.applyError).toBe('請填寫必填欄位：金額')
    expect(callsTo(calls, c => c.method === 'POST')).toHaveLength(0)
    expect(alertSpy).toHaveBeenCalledWith('送出失敗：請填寫必填欄位：金額')
  })

  it('必填的複選群組沒選時擋下，選了才放行；填 0 的數字算已填', async () => {
    const calls = installFetch([
      ['/api/approvals/forms/g1/fields', json([
        { _id: 'amount', label: '金額', type_1: 'number', required: true },
        { _id: 'kind', label: '類別', type_1: 'checkbox', required: true, options: ['甲', '乙'] },
      ])],
      [post('/api/approvals'), json({ _id: 'new1' }, 201)],
    ])
    const wrapper = await mountPage()
    await selectForm(wrapper, 'g1')
    wrapper.vm.applyState.formData = { amount: 0, kind: [] }
    await wrapper.vm.submitApply()
    expect(wrapper.vm.applyError).toBe('請填寫必填欄位：類別')
    wrapper.vm.applyState.formData = { amount: 0, kind: ['甲'] }
    await wrapper.vm.submitApply()
    await flushPromises()
    const postCall = callsTo(calls, c => c.method === 'POST')[0]
    expect(JSON.parse(postCall.body).form_data).toEqual({ amount: 0, kind: ['甲'] })
  })

  it('送出被檢核擋下時，內嵌訊息與對話框都列出每一條原因', async () => {
    installFetch([
      ...baseRoutes(),
      [post('/api/approvals'), json({
        error: '送簽資料檢核未通過',
        violations: [{ message: '必填欄位不可空白：代理人' }, { message: '加班申請必須先有當日班表' }],
      }, 400)],
    ])
    const wrapper = await mountPage()
    await selectForm(wrapper)
    wrapper.vm.applyState.formData = { amount: 5, reason: '', cross: false }
    await wrapper.vm.submitApply()
    await flushPromises()

    expect(wrapper.vm.applyError).toBe('送簽資料檢核未通過')
    expect(wrapper.vm.applyErrorLines).toEqual(['必填欄位不可空白：代理人', '加班申請必須先有當日班表'])
    expect(wrapper.vm.errorDlg.visible).toBe(true)
    expect(wrapper.vm.errorDlg.title).toBe('送出失敗')
    const items = wrapper.findAll('.error-lines li').map(li => li.text())
    expect(items).toContain('必填欄位不可空白：代理人')
    expect(items).toContain('加班申請必須先有當日班表')
  })

  it('找不到簽核人時顯示伺服器的中文說明（標籤與關卡）', async () => {
    installFetch([
      ...baseRoutes(),
      [post('/api/approvals'), json({
        error: '【獎金申請】第2關（標籤：財務覆核）找不到可簽核的人員，請聯絡管理員設定',
        code: 'REQUIRED_APPROVER_MISSING',
        step: 2,
      }, 400)],
    ])
    const wrapper = await mountPage()
    await selectForm(wrapper)
    wrapper.vm.applyState.formData = { amount: 5, reason: '', cross: false }
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(wrapper.vm.applyError).toContain('標籤：財務覆核')
    expect(alertSpy.mock.calls[0][0]).toContain('第2關')
  })

  it('舊版伺服器的英文錯誤也會翻成中文', async () => {
    installFetch([
      ...baseRoutes(),
      [post('/api/approvals'), json({ error: 'required approval step 2 has no approver', code: 'REQUIRED_APPROVER_MISSING' }, 400)],
    ])
    const wrapper = await mountPage()
    await selectForm(wrapper)
    wrapper.vm.applyState.formData = { amount: 5, reason: '', cross: false }
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(wrapper.vm.applyError).toBe('第 2 關找不到可簽核的人員，請聯絡管理員設定')
  })

  it('送出時網路中斷顯示通用訊息', async () => {
    installFetch([...baseRoutes(), [post('/api/approvals'), new TypeError('Failed to fetch')]])
    const wrapper = await mountPage()
    await selectForm(wrapper)
    wrapper.vm.applyState.formData = { amount: 5, reason: '', cross: false }
    await wrapper.vm.submitApply()
    await flushPromises()
    expect(wrapper.vm.applyError).toContain('網路連線異常')
    expect(wrapper.vm.submitting).toBe(false)
  })

  it('送出成功後整張表單清空、舊錯誤清除、金鑰換新，並切到我的申請', async () => {
    const calls = installFetch([...baseRoutes(), [post('/api/approvals'), json({ _id: 'new1' }, 201)]])
    const wrapper = await mountPage()
    await selectForm(wrapper)
    wrapper.vm.applyError = '舊的錯誤'
    wrapper.vm.applyState.formData = { amount: 5, reason: 'x', cross: true }
    await wrapper.vm.submitApply()
    await flushPromises()

    expect(wrapper.vm.applyState.formId).toBe('')
    expect(wrapper.vm.applyState.formData).toEqual({})
    expect(wrapper.vm.fieldList).toEqual([])
    expect(wrapper.vm.workflowSteps).toEqual([])
    expect(wrapper.vm.fileBuffers).toEqual({})
    expect(wrapper.vm.applyError).toBe('')
    expect(wrapper.vm.activeTab).toBe('mine')
    expect(alertSpy).toHaveBeenCalledWith('送出申請成功！')

    // 再選一次同一張表單送出，必須使用新的 Idempotency-Key（不會被當成重複請求）
    await selectForm(wrapper)
    wrapper.vm.applyState.formData = { amount: 6, reason: '', cross: false }
    await wrapper.vm.submitApply()
    await flushPromises()
    const keys = callsTo(calls, c => c.method === 'POST' && c.url.endsWith('/api/approvals')).map(c => c.headers['Idempotency-Key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('切換表單會清掉上一張表單的錯誤訊息', async () => {
    installFetch(baseRoutes())
    const wrapper = await mountPage()
    wrapper.vm.applyError = '送出失敗'
    wrapper.vm.applyErrorLines = ['某條原因']
    await selectForm(wrapper)
    expect(wrapper.vm.applyError).toBe('')
    expect(wrapper.vm.applyErrorLines).toEqual([])
  })

  it('重新載入：有填寫內容時先確認，取消就保留；確認後重新取得表單清單與欄位', async () => {
    const calls = installFetch([
      ['/api/approvals/forms?', json([{ _id: 'f1', name: '獎金申請', category: '薪資' }])],
      ...baseRoutes(),
    ])
    const wrapper = await mountPage()
    await selectForm(wrapper)
    wrapper.vm.applyState.formData = { amount: 100, reason: '', cross: false }
    confirmSpy.mockReturnValue(false)
    await wrapper.vm.reloadSelectedForm()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.applyState.formData.amount).toBe(100)

    confirmSpy.mockReturnValue(true)
    const listCallsBefore = callsTo(calls, c => c.url.includes('/api/approvals/forms?')).length
    await wrapper.vm.reloadSelectedForm()
    await flushPromises()
    expect(callsTo(calls, c => c.url.includes('/api/approvals/forms?')).length).toBe(listCallsBefore + 1)
    expect(wrapper.vm.applyState.formData.amount).toBeNull()
  })

  it('沒有填任何東西時重新載入不用確認', async () => {
    installFetch(baseRoutes())
    const wrapper = await mountPage()
    await selectForm(wrapper)
    await wrapper.vm.reloadSelectedForm()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('Approval.vue 簽核流程預覽（C4）', () => {
  it('顯示中文名稱（標籤、申請者的主管、部門名稱、角色），不顯示內部代碼', async () => {
    installFetch([
      ['/api/departments', json([{ _id: 'd1', name: '護理部' }])],
      // 伺服器實際回的選項形狀（approvalTemplateController getSignRoles / getSignLevels）
      ['/api/approvals/sign-roles', json([
        { value: 'R003', label: '審核', description: '評估申請是否符合政策與規範' },
        { value: 'R004', label: '核定', description: '做出最終核准或駁回決策' },
      ])],
      ['/api/approvals/sign-levels', json([
        { value: 'U001', label: 'L1', description: '單位承辦或第一層主管' },
        { value: 'U002', label: 'L2', description: '部門主管或組長' },
      ])],
      ['/api/approvals/forms/f1/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f1/workflow', json({ steps: [
        { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
        { approver_type: 'tag', approver_value: '人資', name: '人資核定' },
        { approver_type: 'department', approver_value: 'd1' },
        { approver_type: 'role', approver_value: 'R003' },
        { approver_type: 'level', approver_value: 'U002', scope_type: 'dept' },
        { approver_type: 'role', approver_value: 'supervisor' },
      ] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    expect(wrapper.vm.workflowSteps).toEqual([
      { label: '第 1 關', approvers: '申請者的主管', warning: '' },
      { label: '人資核定', approvers: '標籤：人資', warning: '' },
      { label: '第 3 關', approvers: '部門：護理部', warning: '' },
      { label: '第 4 關', approvers: '角色：審核', warning: '' },
      { label: '第 5 關', approvers: '層級：L2（部門主管或組長）（限申請者同部門）', warning: '' },
      { label: '第 6 關', approvers: '角色：主管', warning: '' },
    ])
    const html = wrapper.find('.workflow-preview').text()
    expect(html).not.toContain('APPLICANT_SUPERVISOR')
    expect(html).not.toContain('R003')
    expect(html).not.toContain('U002')
  })

  it('沒有流程的表單提示尚未設定；伺服器回報某關沒有人時顯示警示', async () => {
    installFetch([
      ['/api/approvals/forms/f1/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f1/workflow', json({ error: '這張表單還沒有簽核流程' }, 404)],
      ['/api/approvals/forms/f2/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f2/workflow', json({ steps: [{ approver_type: 'tag', approver_value: '人資', eligible_count: 0 }] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    await flushPromises()
    expect(wrapper.vm.workflowWarning).toContain('尚未設定簽核流程')

    wrapper.vm.applyState.formId = 'f2'
    await wrapper.vm.onSelectForm()
    await flushPromises()
    expect(wrapper.vm.workflowWarning).toBe('')
    expect(wrapper.vm.workflowSteps[0].warning).toContain('找不到可簽核的人員')
  })

  it('伺服器帶 resolved_count / unresolved_reason：必簽的關卡找不到人時，填表前就顯示原因', async () => {
    installFetch([
      ['/api/approvals/forms/f1/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f1/workflow', json({ steps: [
        { approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', is_required: true, resolved_count: 0, unresolved_reason: '申請人尚未設定直屬主管' },
        { approver_type: 'tag', approver_value: '人資', is_required: true, resolved_count: 2, unresolved_reason: null },
        { approver_type: 'tag', approver_value: '排班負責人', is_required: false, resolved_count: 0, unresolved_reason: null },
      ] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    const [noSupervisor, found, optionalEmpty] = wrapper.vm.workflowSteps
    expect(noSupervisor.warning).toBe('此關目前找不到可簽核的人員：申請人尚未設定直屬主管，送出申請會失敗，請聯絡管理員設定')
    expect(found.warning).toBe('')
    expect(optionalEmpty.warning).toBe('')
    const warnings = wrapper.findAll('.workflow-preview .step-warning').map(node => node.text())
    expect(warnings).toEqual([noSupervisor.warning])
  })
})

describe('Approval.vue 表單種類：快速請假與「連接薪資」標籤不再看表單名稱', () => {
  const forms = [
    { _id: 'leave1', name: '請假單', category: '請假類', semanticType: 'leave', default_key: 'leave' },
    { _id: 'ot1', name: '加班單', category: '人事', semanticType: 'overtime', default_key: 'overtime' },
    { _id: 'bonus1', name: '年終獎金', category: '人事', semanticType: 'general', default_key: 'bonus' },
    { _id: 'cert1', name: '在職證明', category: '人事', semanticType: 'general', default_key: 'employment_certificate' },
  ]
  const routes = (list = forms) => [
    ['/api/approvals/forms?', json(list)],
    ['/api/approvals/forms/leave1/fields', json([{ _id: 'reason', label: '事由', type_1: 'text' }])],
    ['/api/approvals/forms/leave1/workflow', json({ steps: [{ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }] })],
  ]

  it('預設請假單改名成「請假單」後，快速請假仍然可以用並選到該表單', async () => {
    installFetch(routes())
    const wrapper = await mountPage()
    expect(wrapper.vm.leaveFormId).toBe('leave1')
    wrapper.vm.activeTab = 'apply'
    await flushPromises()
    const quick = wrapper.findAll('button').find(b => b.text().includes('快速請假'))
    expect(quick).toBeTruthy()

    wrapper.vm.selectLeave()
    await flushPromises()
    expect(wrapper.vm.applyState.formId).toBe('leave1')
    expect(wrapper.vm.fieldList.map(f => f._id)).toEqual(['reason'])
  })

  it('沒有 default_key 時看表單性質，兩者都沒有的舊資料才找名稱「請假」；沒有請假單就不顯示按鈕', async () => {
    installFetch(routes([{ _id: 'x1', name: '員工休假', category: '人事', semanticType: 'leave' }]))
    let wrapper = await mountPage()
    expect(wrapper.vm.leaveFormId).toBe('x1')
    wrapper.unmount()
    mounted.pop()

    installFetch(routes([{ _id: 'old', name: '請假', category: '人事' }, { _id: 'y', name: '支援申請', category: '人事' }]))
    wrapper = await mountPage()
    expect(wrapper.vm.leaveFormId).toBe('old')
    wrapper.unmount()
    mounted.pop()

    installFetch(routes([{ _id: 'y', name: '支援申請', category: '人事' }]))
    wrapper = await mountPage()
    expect(wrapper.vm.leaveFormId).toBe('')
    wrapper.vm.activeTab = 'apply'
    await flushPromises()
    expect(wrapper.findAll('button').some(b => b.text().includes('快速請假'))).toBe(false)
  })

  it('「連接薪資」標籤依表單性質與固定代號顯示，改名的請假 / 加班 / 獎金單也有，其他表單沒有', async () => {
    installFetch(routes())
    const wrapper = await mountPage()

    wrapper.vm.showFormHelp()
    await flushPromises()
    const taggedNames = wrapper.findAll('.form-help-item')
      .filter(item => item.text().includes('連接薪資'))
      .map(item => item.find('.form-help-title').text().replace('連接薪資', '').trim())
    expect(taggedNames).toEqual(['請假單', '加班單', '年終獎金'])
    expect(wrapper.findAll('.form-help-item')).toHaveLength(4)
  })
})

describe('Approval.vue 附件（C7）', () => {
  const uploadRoutes = (postResult) => [
    ['/api/approvals/forms/f1/fields', json([{ _id: 'proof', label: '證明', type_1: 'file', required: true }])],
    ['/api/approvals/forms/f1/workflow', json({ steps: [{ approver_type: 'tag', approver_value: '人資' }] })],
    [post('/api/approvals/attachments'), json({ files: [{ name: 'a.pdf', url: '/upload/approvals/gen.pdf' }] }, 201)],
    [post('/api/approvals'), postResult],
  ]
  const pdf = () => new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' })

  it('必填附件沒選檔時，在本機擋下而不上傳', async () => {
    const calls = installFetch(uploadRoutes(json({ _id: 'n' }, 201)))
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    await wrapper.vm.submitApply()
    expect(wrapper.vm.applyError).toBe('請填寫必填欄位：證明')
    expect(callsTo(calls, c => c.method === 'POST')).toHaveLength(0)
  })

  it('送出失敗後重試，同一批檔案不會重複上傳', async () => {
    let attempt = 0
    const calls = installFetch(uploadRoutes(() => {
      attempt += 1
      return attempt === 1 ? json({ error: 'workflow not configured' }, 400) : json({ _id: 'n' }, 201)
    }))
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    wrapper.vm.fileBuffers = { proof: [{ name: 'a.pdf', raw: pdf() }] }

    await wrapper.vm.submitApply()
    expect(wrapper.vm.applyError).toContain('尚未設定簽核流程')
    await wrapper.vm.submitApply()
    await flushPromises()

    expect(callsTo(calls, c => c.url.endsWith('/api/approvals/attachments'))).toHaveLength(1)
    const posts = callsTo(calls, c => c.method === 'POST' && c.url.endsWith('/api/approvals'))
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1].body).form_data.proof).toEqual([{ name: 'a.pdf', url: '/upload/approvals/gen.pdf' }])
  })

  it('換了檔案就重新上傳', async () => {
    const calls = installFetch(uploadRoutes(json({ error: 'workflow not configured' }, 400)))
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    wrapper.vm.fileBuffers = { proof: [{ name: 'a.pdf', raw: pdf() }] }
    await wrapper.vm.submitApply()
    wrapper.vm.fileBuffers = { proof: [{ name: 'b.pdf', raw: new File(['%PDF-1.7 b'], 'b.pdf', { type: 'application/pdf' }) }] }
    await wrapper.vm.submitApply()
    expect(callsTo(calls, c => c.url.endsWith('/api/approvals/attachments'))).toHaveLength(2)
  })

  it('附件上傳失敗時顯示中文原因', async () => {
    installFetch([
      ['/api/approvals/forms/f1/fields', json([{ _id: 'proof', label: '證明', type_1: 'file' }])],
      [post('/api/approvals/attachments'), json({ error: 'File too large' }, 413)],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f1'
    await wrapper.vm.onSelectForm()
    wrapper.vm.fileBuffers = { proof: [{ name: 'a.pdf', raw: pdf() }] }
    await wrapper.vm.submitApply()
    expect(wrapper.vm.applyError).toBe('附件上傳失敗：檔案太大，無法上傳')
  })

  it('有選好還沒送出的附件時，關閉 / 重新整理頁面會提醒；沒有附件則不提醒', async () => {
    installFetch(uploadRoutes(json({ _id: 'n' }, 201)))
    const wrapper = await mountPage()
    const empty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(empty)
    expect(empty.defaultPrevented).toBe(false)

    wrapper.vm.fileBuffers = { proof: [{ name: 'a.pdf', raw: pdf() }] }
    const withFiles = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(withFiles)
    expect(withFiles.defaultPrevented).toBe(true)

    wrapper.unmount()
    const afterUnmount = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
  })
})

describe('Approval.vue 管理員檢視與代為處理', () => {
  const oversightRow = {
    _id: 'p1',
    status: 'pending',
    oversight: true,
    form: { _id: 'f1', name: '請假' },
    applicant_employee: { name: '王小明' },
    updatedAt: '2026-06-19T01:00:00.000Z',
    my_approvals: [],
    pending_approvers: [{ _id: 'u2', name: 'Alice' }],
  }
  const doneRow = {
    _id: 'p2',
    status: 'approved',
    oversight: false,
    form: { _id: 'f1', name: '加班申請' },
    applicant_employee: { name: '李小華' },
    my_approvals: [{ decision: 'approved', decided_at: '2026-06-18T01:00:00.000Z', comment: '同意' }],
  }

  it('管理員的歷史清單顯示進行中單據目前狀態與等待的人，只有進行中的單可代為處理', async () => {
    installFetch([['/api/approvals/history', json({ items: [oversightRow, doneRow], total: 2, page: 1, limit: 20 })]])
    const wrapper = await mountPage({ role: 'admin' })
    wrapper.vm.activeTab = 'history'
    await flushPromises()

    expect(wrapper.vm.historyDecisionText(oversightRow)).toBe('待簽核')
    expect(wrapper.vm.historyDecisionText(doneRow)).toBe('已核可')
    expect(wrapper.vm.canOverrideRow(oversightRow)).toBe(true)
    expect(wrapper.vm.canOverrideRow(doneRow)).toBe(false)
    expect(wrapper.text()).toContain('等待：Alice')
    const overrideButtons = wrapper.findAll('button').map(b => b.text()).filter(t => t.startsWith('代為'))
    expect(overrideButtons).toEqual(['代為核可', '代為否決', '代為退簽'])
  })

  it('代為處理使用同一個簽核動作，對話框註明是管理員代為處理', async () => {
    const calls = installFetch([
      ['/api/approvals/history', json({ items: [oversightRow], total: 1, page: 1, limit: 20 })],
      [post('/p1/act'), json({ _id: 'p1', status: 'approved' })],
    ])
    const wrapper = await mountPage({ role: 'admin' })
    wrapper.vm.activeTab = 'history'
    await flushPromises()
    wrapper.vm.openAction(oversightRow, 'approve', { override: true })
    await flushPromises()
    expect(wrapper.vm.actionTitle).toBe('管理員代為核可')
    expect(wrapper.text()).toContain('管理員代為處理')
    await wrapper.vm.doAction()
    await flushPromises()
    const actCall = callsTo(calls, c => c.url.endsWith('/p1/act'))[0]
    expect(JSON.parse(actCall.body).decision).toBe('approve')
    // 看過歷史，所以處理後歷史清單也重新載入
    expect(callsTo(calls, c => c.url.includes('/api/approvals/history')).length).toBeGreaterThan(1)
  })

  it('單據明細 viewer.can_override 時在對話框底部提供代為處理', async () => {
    installFetch([[(url) => url.endsWith('/api/approvals/p1'), json({
      _id: 'p1', status: 'pending', form: { name: '請假', fields: [] }, form_data: {},
      applicant_employee: { name: '王小明' }, steps: [], logs: [], viewer: { can_override: true, can_act: false, is_applicant: false },
    })]])
    const wrapper = await mountPage({ role: 'admin' })
    await wrapper.vm.openDetail('p1')
    await flushPromises()
    const names = wrapper.findAll('button').map(b => b.text())
    expect(names).toContain('代為核可')
    wrapper.vm.overrideFromDetail('reject')
    expect(wrapper.vm.detail.visible).toBe(false)
    expect(wrapper.vm.actionDlg).toMatchObject({ visible: true, decision: 'reject', override: true })
    expect(wrapper.vm.actionDlg.target._id).toBe('p1')
  })

  it('一般簽核人的明細不顯示代為處理', async () => {
    installFetch([[(url) => url.endsWith('/api/approvals/p1'), json({
      _id: 'p1', status: 'pending', form: { name: '請假', fields: [] }, form_data: {},
      applicant_employee: { name: '王小明' }, steps: [], logs: [], viewer: { can_override: false, can_act: true },
    })]])
    const wrapper = await mountPage({ role: 'supervisor' })
    await wrapper.vm.openDetail('p1')
    await flushPromises()
    expect(wrapper.findAll('button').map(b => b.text())).not.toContain('代為核可')
  })

  it('伺服器附帶的提醒（例如特休扣減失敗）會一併顯示給簽核人', async () => {
    installFetch([
      ['/api/approvals/inbox', json([{
        _id: 'a1', status: 'pending', form: { name: '請假' }, applicant_employee: { name: '王小明' },
        current_step_index: 0, steps: [{ can_return: true, approvers: [] }],
      }])],
      [post('/a1/act'), json({ _id: 'a1', status: 'approved', warnings: [{ code: 'X', message: '特休天數扣減失敗，請聯絡人資' }] })],
    ])
    const wrapper = await mountPage({ role: 'supervisor' })
    wrapper.vm.openAction(wrapper.vm.inboxList[0], 'approve')
    await wrapper.vm.doAction()
    await flushPromises()
    expect(alertSpy).toHaveBeenCalledWith('已送出！\n特休天數扣減失敗，請聯絡人資')
  })
})

describe('Approval.vue 離開頁面提醒（C7）', () => {
  it('站內切換頁面時，有未送出的附件才詢問；選擇留下就取消離開', async () => {
    installFetch()
    const wrapper = await mountPage()
    const guard = leaveGuards.at(-1)
    expect(typeof guard).toBe('function')

    expect(guard()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()

    wrapper.vm.fileBuffers = { proof: [{ name: 'a.pdf', raw: new File(['x'], 'a.pdf') }] }
    confirmSpy.mockReturnValue(false)
    expect(guard()).toBe(false)
    expect(confirmSpy.mock.calls[0][0]).toContain('附件')
    confirmSpy.mockReturnValue(true)
    expect(guard()).toBe(true)
  })
})

describe('Approval.vue 退簽後修改並重新送出（C2）', () => {
  const returnedDoc = () => ({
    _id: 'r1',
    status: 'returned',
    form: {
      _id: 'f1',
      name: '請假',
      category: '人事',
      fields: [
        { _id: 'reason', label: '事由', type_1: 'text', required: true, order: 1 },
        { _id: 'days', label: '天數', type_1: 'number', required: true, order: 2 },
        { _id: 'proof', label: '證明', type_1: 'file', required: true, order: 3 },
      ],
    },
    form_data: { reason: '家中有事', days: 2, proof: [{ name: 'old.pdf', url: '/upload/approvals/old.pdf' }] },
    applicant_employee: { _id: 'me', name: '我' },
    current_step_index: 0,
    steps: [{ approvers: [{ approver: { _id: 'u2', name: 'Alice' }, decision: 'pending' }] }],
    logs: [
      { action: 'create', message: '建立送審單', at: '2026-06-19T00:00:00.000Z' },
      { action: 'return', by_employee: { _id: 'u2', name: 'Alice' }, message: '事由寫太簡略，請補充', at: '2026-06-19T02:00:00.000Z' },
    ],
  })
  const myRow = { _id: 'r1', status: 'returned', form: { name: '請假' }, current_step_index: 0, steps: [{}], createdAt: '2026-06-19T00:00:00.000Z' }
  const routes = (extra = []) => [
    [(url) => /\/api\/approvals\?/.test(url), json([myRow])],
    [(url) => url.endsWith('/api/approvals/r1'), json(returnedDoc())],
    ...extra,
  ]

  it('被退簽的申請顯示「修改並重新送出」，不是原本的原樣重送', async () => {
    installFetch(routes())
    const wrapper = await mountPage()
    wrapper.vm.activeTab = 'mine'
    await flushPromises()
    const buttons = wrapper.findAll('button').map(b => b.text())
    expect(buttons).toContain('修改並重新送出')
    expect(buttons).not.toContain('重新送出')
  })

  it('開啟後帶入原本的內容與退簽原因', async () => {
    installFetch(routes())
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()

    expect(wrapper.vm.editDlg.visible).toBe(true)
    expect(wrapper.vm.editDlg.formData).toMatchObject({ reason: '家中有事', days: 2 })
    expect(wrapper.vm.editDlg.returnInfo.message).toBe('事由寫太簡略，請補充')
    expect(wrapper.vm.editDlg.kept.proof).toEqual([{ name: 'old.pdf', url: '/upload/approvals/old.pdf' }])
    const dialog = wrapper.findAll('.el-dialog').find(d => d.text().includes('修改並重新送出'))
    expect(dialog.text()).toContain('事由寫太簡略，請補充')
    expect(dialog.text()).toContain('old.pdf')
  })

  it('修改後以編輯過的 form_data 呼叫 resubmit，成功後關閉並重新載入清單', async () => {
    const calls = installFetch(routes([[post('/r1/resubmit'), json({ _id: 'r1', status: 'pending' })]]))
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()
    wrapper.vm.editDlg.formData = { ...wrapper.vm.editDlg.formData, reason: '家中有事，需照顧家人', days: 3 }
    const listCallsBefore = callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length
    await wrapper.vm.submitResubmit()
    await flushPromises()

    const call = callsTo(calls, c => c.url.endsWith('/r1/resubmit'))[0]
    expect(call.method).toBe('POST')
    expect(JSON.parse(call.body)).toEqual({
      form_data: {
        reason: '家中有事，需照顧家人',
        days: 3,
        // 沒選新檔案就保留原附件
        proof: [{ name: 'old.pdf', url: '/upload/approvals/old.pdf' }],
      },
    })
    expect(wrapper.vm.editDlg.visible).toBe(false)
    expect(alertSpy).toHaveBeenCalledWith('已重新送出！')
    expect(callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length).toBeGreaterThan(listCallsBefore)
  })

  it('單一勾選照伺服器存的 [false] / [true] 帶入，沒動就重新送出時答案不變（否不會變成是）', async () => {
    for (const stored of [[false], [true]]) {
      const doc = returnedDoc()
      doc.form.fields = [
        { _id: 'urgent', label: '是否加急', type_1: 'checkbox', required: false, order: 1 },
        { _id: 'reason', label: '事由', type_1: 'text', required: true, order: 2 },
      ]
      doc.form_data = { urgent: stored, reason: '原因' }
      const calls = installFetch([
        [(url) => /\/api\/approvals\?/.test(url), json([myRow])],
        [(url) => url.endsWith('/api/approvals/r1'), json(doc)],
        [post('/r1/resubmit'), json({ _id: 'r1', status: 'pending' })],
      ])
      const wrapper = await mountPage()
      await wrapper.vm.resubmitMyRequest(myRow)
      await flushPromises()

      expect(wrapper.vm.editDlg.formData.urgent).toBe(stored[0])
      const checkbox = wrapper.findAll('.el-dialog input[type="checkbox"]').find(node => node.element.closest('.el-form-item')?.textContent.includes('是否加急'))
      expect(checkbox.element.checked).toBe(stored[0])

      await wrapper.vm.submitResubmit()
      await flushPromises()
      const call = callsTo(calls, c => c.url.endsWith('/r1/resubmit'))[0]
      expect(JSON.parse(call.body).form_data).toEqual({ urgent: stored[0], reason: '原因' })
      wrapper.unmount()
      mounted.pop()
    }
  })

  it('選了新附件就以新附件取代', async () => {
    const calls = installFetch(routes([
      [post('/api/approvals/attachments'), json({ files: [{ name: 'new.pdf', url: '/upload/approvals/new.pdf' }] }, 201)],
      [post('/r1/resubmit'), json({ _id: 'r1' })],
    ]))
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()
    wrapper.vm.editDlg.files = { proof: [{ name: 'new.pdf', raw: new File(['%PDF-1.7'], 'new.pdf', { type: 'application/pdf' }) }] }
    await wrapper.vm.submitResubmit()
    const call = callsTo(calls, c => c.url.endsWith('/r1/resubmit'))[0]
    expect(JSON.parse(call.body).form_data.proof).toEqual([{ name: 'new.pdf', url: '/upload/approvals/new.pdf' }])
  })

  it('必填欄位被清空時在本機擋下', async () => {
    const calls = installFetch(routes())
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()
    wrapper.vm.editDlg.formData = { ...wrapper.vm.editDlg.formData, reason: '' }
    await wrapper.vm.submitResubmit()
    expect(wrapper.vm.editDlg.error).toBe('請填寫必填欄位：事由')
    expect(callsTo(calls, c => c.url.endsWith('/r1/resubmit'))).toHaveLength(0)
  })

  it('重新送出被檢核擋下時，在對話框列出每一條原因，對話框保持開啟', async () => {
    installFetch(routes([[post('/r1/resubmit'), json({
      error: '送簽資料檢核未通過',
      violations: [{ message: '事假必須填寫事由' }, { message: '請假申請必須附上相關證明' }],
    }, 400)]]))
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()
    await wrapper.vm.submitResubmit()
    await flushPromises()
    expect(wrapper.vm.editDlg.visible).toBe(true)
    expect(wrapper.vm.editDlg.error).toBe('送簽資料檢核未通過')
    expect(wrapper.vm.editDlg.errorLines).toEqual(['事假必須填寫事由', '請假申請必須附上相關證明'])
    expect(wrapper.vm.errorDlg.lines).toEqual(['事假必須填寫事由', '請假申請必須附上相關證明'])
  })

  it('單子已不是退簽狀態（409）時關閉對話框、顯示中文並重新整理清單', async () => {
    const calls = installFetch(routes([[post('/r1/resubmit'), json({ error: 'request is not returned' }, 409)]]))
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()
    const listCallsBefore = callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length
    await wrapper.vm.submitResubmit()
    await flushPromises()
    expect(wrapper.vm.editDlg.visible).toBe(false)
    expect(alertSpy.mock.calls[0][0]).toContain('此單不是退簽狀態')
    expect(callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length).toBeGreaterThan(listCallsBefore)
  })

  it('取消對話框會清掉還沒送出的附件清單', async () => {
    installFetch(routes())
    const wrapper = await mountPage()
    await wrapper.vm.resubmitMyRequest(myRow)
    await flushPromises()
    wrapper.vm.editDlg.files = { proof: [{ name: 'x.pdf', raw: new File(['x'], 'x.pdf') }] }
    wrapper.vm.closeEditDialog()
    await flushPromises()
    expect(wrapper.vm.editDlg.visible).toBe(false)
    expect(Object.values(wrapper.vm.editDlg.files).every(list => list.length === 0)).toBe(true)
  })

  it('撤回失敗（例如單子已被處理）時顯示中文並重新整理清單', async () => {
    const calls = installFetch(routes([[post('/r1/cancel'), json({ error: 'request cannot be canceled' }, 409)]]))
    const wrapper = await mountPage()
    const listCallsBefore = callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length
    await wrapper.vm.cancelMyRequest(myRow)
    await flushPromises()
    expect(alertSpy.mock.calls[0][0]).toContain('此單目前無法撤回')
    expect(callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length).toBeGreaterThan(listCallsBefore)
  })
})

describe('Approval.vue 已核可請假單的撤回（特休返還）', () => {
  const row = (id, status, form, extra = {}) => ({
    _id: id,
    status,
    form,
    applicant_employee: { _id: 'me', name: '我' },
    current_step_index: 0,
    steps: [{}],
    createdAt: '2026-06-19T01:00:00.000Z',
    updatedAt: '2026-06-19T01:00:00.000Z',
    ...extra,
  })
  const leaveForm = { _id: 'f1', name: '請假單', semanticType: 'leave' }
  const overtimeForm = { _id: 'f2', name: '加班申請', semanticType: 'overtime' }
  const paneButtons = (wrapper, pane) => wrapper.find(`#pane-${pane}`).findAll('button').map(b => b.text())
  const cancelCount = (wrapper, pane) => paneButtons(wrapper, pane).filter(text => text === '撤回').length
  const listRoute = (items) => [(url) => /\/api\/approvals\?/.test(url), json(items)]

  it('我的申請：已核可的請假單也有撤回；已核可的加班單、已撤回的單沒有；處理中與被退簽照舊', async () => {
    installFetch([[(url) => /\/api\/approvals\?/.test(url), json([
      row('a1', 'approved', leaveForm),
      row('a2', 'approved', overtimeForm),
      row('a3', 'canceled', leaveForm),
      row('a4', 'pending', overtimeForm),
      row('a5', 'returned', overtimeForm),
      row('a6', 'rejected', leaveForm),
    ])]])
    const wrapper = await mountPage()
    wrapper.vm.activeTab = 'mine'
    await flushPromises()

    expect(wrapper.vm.myList.map(item => [item._id, wrapper.vm.canCancelMine(item)])).toEqual([
      ['a1', true], ['a2', false], ['a3', false], ['a4', true], ['a5', true], ['a6', false],
    ])
    expect(cancelCount(wrapper, 'mine')).toBe(3)
  })

  it('清單的表單沒有表單性質時，用表單清單裡的固定代號（改名後的預設請假單）判斷', async () => {
    installFetch([
      ['/api/approvals/forms?', json([{ _id: 'f1', name: '請假單', category: '請假類', default_key: 'leave' }])],
      listRoute([row('a1', 'approved', { _id: 'f1', name: '請假單' })]),
    ])
    const wrapper = await mountPage()
    expect(wrapper.vm.canCancelMine(wrapper.vm.myList[0])).toBe(true)
  })

  it('撤回已核可的請假：先確認，成功後重新載入並顯示伺服器記下的結果（返還天數）', async () => {
    const doc = { ...row('a1', 'canceled', leaveForm), logs: [{ action: 'cancel', message: '已撤回已核准的特休，返還 2 天' }] }
    const calls = installFetch([
      [post('/a1/cancel'), json(doc)],
      listRoute([row('a1', 'approved', leaveForm)]),
    ])
    const wrapper = await mountPage()
    const listCallsBefore = callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length

    await wrapper.vm.cancelMyRequest(wrapper.vm.myList[0])
    await flushPromises()

    expect(confirmSpy.mock.calls.at(-1)[0]).toContain('已經核可')
    expect(callsTo(calls, c => c.url.endsWith('/a1/cancel'))).toHaveLength(1)
    expect(callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length).toBeGreaterThan(listCallsBefore)
    expect(alertSpy).toHaveBeenCalledWith('已撤回已核准的特休，返還 2 天')
  })

  it('假期已開始等伺服器拒絕時，顯示伺服器的中文原因並重新整理清單', async () => {
    const reason = '假期已經開始（或無法判斷開始時間），無法自行撤回，請聯絡管理員'
    const calls = installFetch([
      [post('/a1/cancel'), json({ error: reason, code: 'LEAVE_STARTED' }, 409)],
      listRoute([row('a1', 'approved', leaveForm)]),
    ])
    const wrapper = await mountPage()
    const listCallsBefore = callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length

    await wrapper.vm.cancelMyRequest(wrapper.vm.myList[0])
    await flushPromises()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy.mock.calls[0][0]).toBe(`操作失敗：${reason}`)
    expect(callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length).toBeGreaterThan(listCallsBefore)
  })

  it('取消確認視窗就不送出', async () => {
    const calls = installFetch([listRoute([row('a1', 'approved', leaveForm)])])
    confirmSpy.mockReturnValue(false)
    const wrapper = await mountPage()
    await wrapper.vm.cancelMyRequest(wrapper.vm.myList[0])
    expect(callsTo(calls, c => c.url.endsWith('/a1/cancel'))).toHaveLength(0)
  })

  describe('管理員在「我已簽核」', () => {
    const historyItems = () => [
      { ...row('h1', 'approved', leaveForm), oversight: false, my_approvals: [{ decision: 'approved', decided_at: '2026-06-18T01:00:00.000Z' }] },
      { ...row('h2', 'approved', overtimeForm), oversight: false, my_approvals: [{ decision: 'approved', decided_at: '2026-06-18T02:00:00.000Z' }] },
      { ...row('h3', 'pending', leaveForm), oversight: true, my_approvals: [], pending_approvers: [{ _id: 'u2', name: 'Alice' }] },
    ]
    const historyRoute = () => ['/api/approvals/history', json({ items: historyItems(), total: 3, page: 1, limit: 20 })]

    it('已核可的請假單有撤回，加班單與進行中的單沒有；一般簽核人完全沒有', async () => {
      installFetch([historyRoute()])
      const admin = await mountPage({ role: 'admin' })
      admin.vm.activeTab = 'history'
      await flushPromises()
      const verdicts = Object.fromEntries(admin.vm.historyList.map(item => [item._id, admin.vm.canCancelApprovedRow(item)]))
      expect(verdicts).toEqual({ h1: true, h2: false, h3: false })
      expect(cancelCount(admin, 'history')).toBe(1)

      installFetch([historyRoute()])
      const supervisor = await mountPage({ role: 'supervisor' })
      supervisor.vm.activeTab = 'history'
      await flushPromises()
      expect(cancelCount(supervisor, 'history')).toBe(0)
    })

    it('撤回後歷史與我的申請都重新載入，並顯示返還結果', async () => {
      const doc = { ...row('h1', 'canceled', leaveForm), logs: [{ action: 'cancel', message: '已撤回已核准的特休，返還 1 天' }] }
      const calls = installFetch([
        [post('/h1/cancel'), json(doc)],
        historyRoute(),
      ])
      const wrapper = await mountPage({ role: 'admin' })
      wrapper.vm.activeTab = 'history'
      await flushPromises()
      const historyCallsBefore = callsTo(calls, c => c.url.includes('/api/approvals/history')).length
      const listCallsBefore = callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length

      await wrapper.vm.cancelApprovedFromHistory(wrapper.vm.historyList.find(item => item._id === 'h1'))
      await flushPromises()

      expect(callsTo(calls, c => c.url.endsWith('/h1/cancel'))).toHaveLength(1)
      expect(callsTo(calls, c => c.url.includes('/api/approvals/history')).length).toBeGreaterThan(historyCallsBefore)
      expect(callsTo(calls, c => /\/api\/approvals\?/.test(c.url)).length).toBeGreaterThan(listCallsBefore)
      expect(alertSpy).toHaveBeenCalledWith('已撤回已核准的特休，返還 1 天')
    })

    it('不是特休等伺服器拒絕的情況，顯示伺服器的中文原因', async () => {
      installFetch([
        [post('/h1/cancel'), json({ error: '已核准的申請單無法撤回，請聯絡管理員', code: 'CANNOT_CANCEL' }, 409)],
        historyRoute(),
      ])
      const wrapper = await mountPage({ role: 'admin' })
      wrapper.vm.activeTab = 'history'
      await flushPromises()
      await wrapper.vm.cancelApprovedFromHistory(wrapper.vm.historyList.find(item => item._id === 'h1'))
      await flushPromises()
      expect(alertSpy.mock.calls[0][0]).toBe('操作失敗：已核准的申請單無法撤回，請聯絡管理員')
    })
  })
})

describe('Approval.vue 申請單明細（C2、C5）', () => {
  const doc = {
    _id: 'a1',
    status: 'returned',
    form: {
      name: '請假',
      category: '人事',
      semanticType: 'leave',
      fields: [
        { _id: 'start', label: '開始時間', type_1: 'datetime' },
        { _id: 'type', label: '假別', type_1: 'select', options: [{ label: '病假', value: 'sick' }] },
        { _id: 'agent', label: '代理人', type_1: 'user' },
        { _id: 'dept', label: '部門', type_1: 'department' },
        { _id: 'note', label: '事由', type_1: 'text' },
      ],
    },
    form_data: { start: '2026-06-19T01:00:00.000Z', type: 'sick', agent: 'u1', dept: 'd1', note: '' },
    applicant_employee: { name: 'Bob' },
    current_step_index: 0,
    steps: [{ all_must_approve: true, is_required: true, approvers: [{ approver: { _id: 'u2', name: 'Alice' }, decision: 'returned', decided_at: '2026-06-19T02:00:00.000Z', comment: '請補充' }] }],
    logs: [{ action: 'return', by_employee: 'u2', message: '請補充說明', at: '2026-06-19T02:00:00.000Z' }],
  }

  it('用台灣時間、可讀文字顯示欄位，並顯示退簽原因與簽核紀錄', async () => {
    installFetch([
      ['/api/employees/options', json([{ _id: 'u1', name: '王小明' }, { _id: 'u2', name: 'Alice' }])],
      ['/api/departments', json([{ _id: 'd1', name: '護理部' }])],
      [(url) => url.endsWith('/api/approvals/a1'), json(doc)],
    ])
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('a1')
    await flushPromises()

    const dialogText = wrapper.findAll('.el-dialog').find(d => d.text().includes('申請單明細')).text()
    expect(dialogText).toContain('2026/06/19 09:00')
    expect(dialogText).not.toContain('2026-06-19T01:00:00.000Z')
    expect(dialogText).toContain('病假')
    expect(dialogText).toContain('王小明')
    expect(dialogText).toContain('護理部')
    expect(dialogText).not.toMatch(/\bu1\b|\bd1\b|\bsick\b/)
    expect(wrapper.find('.return-reason-alert').text()).toContain('請補充說明')
    expect(wrapper.find('.return-reason-alert').text()).toContain('Alice')
    expect(wrapper.find('.detail-logs').text()).toContain('退簽')
    const rows = wrapper.findAll('.el-descriptions__table tr').map(tr => tr.text())
    expect(rows.find(row => row.startsWith('事由'))).toMatch(/事由\s*-/)
  })

  it('載入明細失敗時顯示中文原因，不開啟空白對話框', async () => {
    installFetch([[(url) => url.endsWith('/api/approvals/a1'), json({ error: 'not found' }, 404)]])
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('a1')
    await flushPromises()
    expect(wrapper.vm.detail.visible).toBe(false)
    expect(alertSpy.mock.calls[0][0]).toContain('載入明細失敗')
    expect(alertSpy.mock.calls[0][0]).not.toMatch(/not found/)
  })

  it('下載附件失敗時顯示中文原因', async () => {
    installFetch([
      [(url) => url.endsWith('/api/approvals/a1'), json({
        ...doc,
        form_data: { ...doc.form_data, file: [{ name: 'p.pdf', url: '/upload/approvals/p.pdf' }] },
        form: { ...doc.form, fields: [...doc.form.fields, { _id: 'file', label: '證明', type_1: 'file' }] },
      })],
      [(url) => url.includes('/attachments/'), json({ error: 'Forbidden' }, 403)],
    ])
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('a1')
    await flushPromises()
    await wrapper.vm.downloadApprovalAttachment({ name: 'p.pdf', url: '/upload/approvals/p.pdf' })
    expect(alertSpy.mock.calls.at(-1)[0]).toContain('附件下載失敗')
    expect(alertSpy.mock.calls.at(-1)[0]).toContain('沒有權限')
  })
})
