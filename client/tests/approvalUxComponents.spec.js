import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import ElementPlus from 'element-plus'
import ApprovalFormFields from '../src/components/ApprovalFormFields.vue'
import ApprovalListFilters from '../src/components/ApprovalListFilters.vue'
import LeaveBalancePanel from '../src/components/LeaveBalancePanel.vue'
import CompensatoryLeavePanel from '../src/components/CompensatoryLeavePanel.vue'
import ApprovalDetailContent from '../src/views/front/ApprovalDetailContent.vue'
import { buildInitialFormData } from '../src/utils/approvalForm'

// 2026/11 簽核頁介面整理：欄位元件（欄位旁的錯誤、補充內容、附件檢查、台灣時間）、
// 餘額與調休存摺（可收合、說明收進按鈕、手機清單）、申請單明細（頁面直接給單據、目前關卡、手機清單）、清單工具列

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const mounted = []
const track = (wrapper) => { mounted.push(wrapper); return wrapper }
afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// 手機寬度（小於 768px）
function asMobile() {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

/* -------------------- ApprovalFormFields -------------------- */

function mountFields(fields, extraProps = {}, slots = {}, initial = null) {
  const Host = defineComponent({
    setup() {
      const formData = ref(initial || buildInitialFormData(fields))
      const files = ref({})
      return { formData, files }
    },
    render() {
      return h(ApprovalFormFields, {
        fields,
        modelValue: this.formData,
        'onUpdate:modelValue': (v) => { this.formData = v },
        files: this.files,
        'onUpdate:files': (v) => { this.files = v },
        ...extraProps,
      }, slots)
    },
  })
  return track(mount(Host, { global: { plugins: [ElementPlus] } }))
}

describe('ApprovalFormFields：欄位旁的錯誤與補充內容', () => {
  const fields = [
    { _id: 'type', label: '假別', type_1: 'text', required: true },
    { _id: 'reason', label: '事由', type_1: 'textarea' },
  ]

  it('errors 的訊息顯示在對應的欄位下方，其他欄位不受影響', async () => {
    const wrapper = mountFields(fields, { errors: { type: '請填寫假別' } })
    // Element Plus 的欄位錯誤訊息延遲 100 毫秒才顯示
    await new Promise(resolve => setTimeout(resolve, 150))
    await flushPromises()
    const items = wrapper.findAll('.el-form-item')
    expect(items[0].classes()).toContain('is-error')
    expect(items[0].find('.el-form-item__error').text()).toBe('請填寫假別')
    expect(items[0].attributes('data-field-id')).toBe('type')
    expect(items[1].classes()).not.toContain('is-error')
    expect(items[1].find('.el-form-item__error').exists()).toBe(false)
  })

  it('field-extra 讓頁面在指定欄位下方放補充內容（請假單的餘額、超額提示）', () => {
    const wrapper = mountFields(fields, {}, {
      'field-extra': ({ field }) => (field._id === 'type' ? h('span', { class: 'brief' }, '事假 可請 60 小時') : null),
    })
    const items = wrapper.findAll('.el-form-item')
    expect(items[0].find('.field-extra .brief').text()).toBe('事假 可請 60 小時')
    expect(items[1].find('.brief').exists()).toBe(false)
  })

  it('沒有提供 field-extra 時不多出空的容器', () => {
    expect(mountFields(fields).find('.field-extra').exists()).toBe(false)
  })
})

describe('ApprovalFormFields：附件在選檔當下檢查', () => {
  const pick = async (wrapper, files) => {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  it('格式不對或太大的檔案不加入，並在欄位下方說明是哪個檔案、為什麼；合格的檔案照常加入', async () => {
    const wrapper = mountFields([{ _id: 'f', label: '證明', type_1: 'file' }])
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    await pick(wrapper, [
      new File(['%PDF-1.7'], 'ok.pdf', { type: 'application/pdf' }),
      new File(['MZ'], 'virus.exe', { type: 'application/octet-stream' }),
      big,
    ])
    expect(wrapper.vm.files.f.map(item => item.name)).toEqual(['ok.pdf'])
    const problems = wrapper.findAll('[data-test="file-problems"] li').map(node => node.text())
    expect(problems).toEqual([
      '「virus.exe」的格式不支援，請上傳 PDF、Word、Excel 或圖片',
      '「big.pdf」有 11.0 MB，超過每個檔案 10 MB 的上限',
    ])

    // 之後選了合格的檔案，說明就消失
    await pick(wrapper, [new File(['PNG'], 'photo.png', { type: 'image/png' })])
    expect(wrapper.vm.files.f.map(item => item.name)).toEqual(['ok.pdf', 'photo.png'])
    expect(wrapper.find('[data-test="file-problems"]').exists()).toBe(false)
  })
})

describe('ApprovalFormFields：日期時間一律是台灣時間', () => {
  const fields = [{ _id: 'start', label: '開始時間', type_1: 'datetime' }]

  it('已存的時間點在選擇器上顯示成台灣時間（YYYY/MM/DD HH:mm），不管電腦在哪個時區', async () => {
    const wrapper = mountFields(fields, {}, {}, { start: '2026-11-12T01:00:00.000Z' })
    await flushPromises()
    expect(wrapper.find('.el-date-editor input').element.value).toBe('2026/11/12 09:00')
  })

  it('在選擇器上選的時間當成台灣時間存進表單', async () => {
    const wrapper = mountFields(fields)
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    picker.vm.$emit('update:modelValue', new Date(2026, 10, 13, 9, 30, 0))
    await flushPromises()
    expect(wrapper.vm.formData.start).toBeInstanceOf(Date)
    expect(wrapper.vm.formData.start.toISOString()).toBe('2026-11-13T01:30:00.000Z')
    // 清除選擇
    picker.vm.$emit('update:modelValue', null)
    await flushPromises()
    expect(wrapper.vm.formData.start).toBe(null)
  })

  it('手機上日期時間不跳出鍵盤（不可直接輸入），桌機可以輸入', async () => {
    const desktop = mountFields(fields)
    expect(desktop.findComponent({ name: 'ElDatePicker' }).props('editable')).toBe(true)
    asMobile()
    const mobile = mountFields(fields)
    expect(mobile.findComponent({ name: 'ElDatePicker' }).props('editable')).toBe(false)
  })
})

/* -------------------- ApprovalListFilters -------------------- */

describe('ApprovalListFilters', () => {
  const empty = { formId: '', status: '', keyword: '', from: '', to: '' }
  const mountFilters = (props = {}) => track(mount(ApprovalListFilters, {
    props: { modelValue: empty, formOptions: [{ value: 'f1', label: '請假' }], ...props },
    global: { plugins: [ElementPlus] },
  }))
  const lastValue = (wrapper) => wrapper.emitted('update:modelValue').at(-1)[0]

  it('桌機：條件排成一列，沒有狀態可篩選的清單不顯示狀態；重新整理在右邊', async () => {
    const wrapper = mountFilters()
    expect(wrapper.find('[data-test="filters-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="filter-form"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="filter-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="filter-keyword"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="filters-clear"]').exists()).toBe(false)
    await wrapper.find('[data-test="list-refresh"]').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('改一個條件只更新那個條件；日期範圍拆成起訖；清除篩選全部清空', async () => {
    const wrapper = mountFilters({
      modelValue: { ...empty, status: 'pending' },
      statusOptions: [{ value: 'pending', label: '待簽核' }],
      showKeyword: true,
    })
    wrapper.findAllComponents({ name: 'ElSelect' })[0].vm.$emit('update:modelValue', 'f1')
    expect(lastValue(wrapper)).toEqual({ ...empty, status: 'pending', formId: 'f1' })
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-11-01', '2026-11-10'])
    expect(lastValue(wrapper)).toEqual({ ...empty, status: 'pending', from: '2026-11-01', to: '2026-11-10' })
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', null)
    expect(lastValue(wrapper)).toEqual({ ...empty, status: 'pending' })
    await wrapper.find('[data-test="filters-clear"]').trigger('click')
    expect(lastValue(wrapper)).toEqual(empty)
  })

  it('手機：條件收在「篩選」按鈕裡（標出套用了幾個），按了才展開，用兩個單日選擇器', async () => {
    asMobile()
    const wrapper = mountFilters({ modelValue: { ...empty, formId: 'f1', from: '2026-11-01' } })
    const toggle = wrapper.find('[data-test="filters-toggle"]')
    expect(toggle.text()).toBe('篩選（2）')
    expect(wrapper.find('[data-test="filter-form"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="list-refresh"]').exists()).toBe(true)

    await toggle.trigger('click')
    expect(wrapper.find('[data-test="filter-form"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="filter-range"]').exists()).toBe(false)
    expect(wrapper.findAllComponents({ name: 'ElDatePicker' })).toHaveLength(2)
  })
})

/* -------------------- LeaveBalancePanel -------------------- */

const balances = (patch = {}) => ({
  employee: { _id: 'e1', name: '小美' },
  year: 2026,
  range: { start: '2026-01-01', end: '2026-12-31' },
  dayHours: 8,
  items: [
    { key: 'annual', name: '特休', source: 'employee', period: 'year', status: 'ok', quotaHours: 80, usedHours: 16, pendingHours: 8, remainingHours: 64, availableHours: 56, includes: [], note: '', expiryDate: '2026-12-30T16:00:00.000Z' },
    { key: 'personal', name: '事假', source: 'policy', period: 'year', status: 'ok', quotaHours: 112, usedHours: 44, pendingHours: 0, remainingHours: 68, availableHours: 68, includes: [], note: '每年 14 日，不給薪（勞工請假規則第 7 條）' },
    { key: 'marriage', name: '婚假', source: 'policy', period: 'event', status: 'ok', quotaHours: 64, usedHours: 0, pendingHours: 0, remainingHours: null, availableHours: null, includes: [] },
  ],
  unmatched: [],
  ...patch,
})

describe('LeaveBalancePanel：可收合、說明收進按鈕、手機清單', () => {
  const mountPanel = (props) => track(mount(LeaveBalancePanel, { props, global: { plugins: [ElementPlus] } }))

  it('collapsible：預設只留標題與「這張單的影響」，按展開才看到表格；收合時不顯示重新整理', async () => {
    const wrapper = mountPanel({
      balances: balances({ focus: { typeKey: 'personal', typeName: '事假', requestedHours: 8, remainingBefore: 68, remainingAfter: 60 } }),
      title: '申請人假別餘額',
      collapsible: true,
    })
    await flushPromises()
    const body = wrapper.find('[data-test="leave-balance-body"]')
    expect(body.element.style.display).toBe('none')
    expect(wrapper.classes()).toContain('is-collapsed')
    // 這張單核准前後剩多少一直看得到
    const focus = wrapper.find('[data-test="leave-balance-focus"]')
    expect(body.element.contains(focus.element)).toBe(false)
    expect(focus.text()).toContain('核准前剩 68 小時（8 天 4 小時），核准後剩 60 小時（7 天 4 小時）')

    const toggle = wrapper.find('[data-test="leave-balance-toggle"]')
    expect(toggle.text()).toBe('展開')
    await toggle.trigger('click')
    expect(body.element.style.display).toBe('')
    expect(toggle.text()).toBe('收合')
    expect(wrapper.classes()).not.toContain('is-collapsed')
  })

  it('collapsible 的面板自己向伺服器取資料時：收合不影響載入，expand() 可由頁面展開', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json(balances()))
    const wrapper = mountPanel({ collapsible: true, title: '我的假別餘額' })
    await flushPromises()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('loaded')).toHaveLength(1)
    expect(wrapper.find('[data-test="leave-balance-refresh"]').exists()).toBe(false)
    wrapper.vm.expand()
    await flushPromises()
    expect(wrapper.find('[data-test="leave-balance-body"]').element.style.display).toBe('')
    expect(wrapper.find('[data-test="leave-balance-refresh"]').exists()).toBe(true)
  })

  it('沒有設 collapsible 時和以前一樣直接顯示表格，沒有展開按鈕', () => {
    const wrapper = mountPanel({ balances: balances() })
    expect(wrapper.find('[data-test="leave-balance-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="leave-balance-body"]').element.style.display).toBe('')
  })

  it('各假別的規定（法條）與計算方式收進「說明」，表格的備註欄只留狀態與期限', async () => {
    const wrapper = mountPanel({ balances: balances() })
    await flushPromises()
    const help = wrapper.find('[data-test="leave-balance-help"]')
    expect(help.element.style.display).toBe('none')
    expect(help.text()).toContain('事假：每年 14 日，不給薪（勞工請假規則第 7 條）')
    expect(help.text()).toContain('特休依員工資料')
    // 表格裡不再有法條
    expect(wrapper.find('.balance-table').text()).not.toContain('勞工請假規則')

    await wrapper.find('[data-test="leave-balance-help-toggle"]').trigger('click')
    expect(help.element.style.display).toBe('')
    expect(wrapper.find('[data-test="leave-balance-help-toggle"]').text()).toBe('收合說明')
    // 精簡模式沒有說明
    expect(mountPanel({ balances: balances(), compact: true }).find('[data-test="leave-balance-help-toggle"]').exists()).toBe(false)
  })

  it('請休期限以台灣日期顯示：台灣時間 12/31 的午夜（UTC 是 12/30 16:00）要顯示 12/31', async () => {
    const wrapper = mountPanel({ balances: balances() })
    await flushPromises()
    expect(wrapper.text()).toContain('請休期限 2026/12/31')
    expect(wrapper.text()).not.toContain('2026/12/30')
  })

  it('手機：每個假別一列（剩餘在右、額度與已使用在下一行），沒有表格', async () => {
    asMobile()
    const wrapper = mountPanel({ balances: balances({ focus: { typeKey: 'personal', typeName: '事假', requestedHours: 8, remainingBefore: 68, remainingAfter: 60 } }) })
    await flushPromises()
    expect(wrapper.find('.balance-table').exists()).toBe(false)
    const rows = wrapper.findAll('[data-test="leave-balance-list"] .balance-item').map(node => node.text().replace(/\s+/g, ' '))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('特休')
    expect(rows[0]).toContain('剩 64 小時（8 天）')
    expect(rows[0]).toContain('額度 80 小時（10 天）・已使用 16 小時（2 天）・簽核中 8 小時（1 天）')
    expect(rows[0]).toContain('請休期限 2026/12/31')
    expect(rows[1]).toContain('本次申請')
    expect(rows[2]).toContain('每次上限 64 小時')
    expect(wrapper.findAll('.balance-item.focus-row')).toHaveLength(1)
  })
})

/* -------------------- CompensatoryLeavePanel -------------------- */

const bank = (patch = {}) => ({
  employeeId: 'e1',
  availableHours: 8,
  balanceHours: 12,
  pendingHours: 4,
  earnedHours: 24,
  usedHours: 12,
  expiredHours: 0,
  credits: [
    { id: 'c1', sourceText: '2026-10-25 臺灣光復節 適逢週日', hours: 8, usedHours: 4, remainingHours: 4, status: 'partial', statusLabel: '部分使用', suggestedDate: '2026-10-26', usages: [{ id: 'u1', kind: 'leave_request', hours: 4, days: [{ date: '2026-11-03', hours: 4 }], fullDayDates: [], approvalStatus: 'approved' }] },
    { id: 'c2', sourceText: '人資手動給予：值班補償', hours: 8, usedHours: 0, remainingHours: 8, status: 'available', statusLabel: '未使用', usages: [] },
  ],
  ...patch,
})

describe('CompensatoryLeavePanel：可收合、說明收進按鈕、手機清單', () => {
  const mountComp = (props) => track(mount(CompensatoryLeavePanel, { props, global: { plugins: [ElementPlus] } }))

  it('collapsible：預設只留標題與可用時數，按展開才看到明細；expand() 可由頁面展開', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(json(bank()))
    const wrapper = mountComp({ title: '我的調休（移休）', collapsible: true })
    await flushPromises()
    expect(wrapper.find('[data-test="comp-leave-available"]').text()).toBe('可用 8 小時（1 天）')
    const body = wrapper.find('[data-test="comp-leave-body"]')
    expect(body.element.style.display).toBe('none')
    expect(wrapper.find('[data-test="comp-leave-refresh"]').exists()).toBe(false)

    await wrapper.find('[data-test="comp-leave-toggle"]').trigger('click')
    expect(body.element.style.display).toBe('')
    expect(wrapper.find('[data-test="comp-leave-refresh"]').exists()).toBe(true)

    const second = mountComp({ title: '我的調休（移休）', collapsible: true })
    await flushPromises()
    second.vm.expand()
    await flushPromises()
    expect(second.find('[data-test="comp-leave-body"]').element.style.display).toBe('')
  })

  it('調休怎麼來、怎麼用的長說明預設收合，按「說明」才展開', async () => {
    const wrapper = mountComp({ bank: null, title: '我的調休' })
    vi.spyOn(window, 'fetch').mockResolvedValue(json(bank()))
    await wrapper.vm.load()
    await flushPromises()
    const help = wrapper.find('[data-test="comp-leave-help"]')
    expect(help.element.style.display).toBe('none')
    await wrapper.find('[data-test="comp-leave-help-toggle"]').trigger('click')
    expect(help.element.style.display).toBe('')
    expect(help.text()).toContain('選假別「調休」')
  })

  it('手機：每筆調休一張小卡（來源、時數、狀態、建議調休日、使用紀錄），沒有表格', async () => {
    asMobile()
    const wrapper = mountComp({ bank: bank(), title: '調休存摺' })
    await flushPromises()
    expect(wrapper.find('.comp-table').exists()).toBe(false)
    const cards = wrapper.findAll('[data-test="comp-leave-list"] .comp-item').map(node => node.text().replace(/\s+/g, ' '))
    expect(cards).toHaveLength(2)
    expect(cards[0]).toContain('2026-10-25 臺灣光復節 適逢週日')
    expect(cards[0]).toContain('部分使用')
    expect(cards[0]).toContain('8 小時（1 天），已用 4 小時（0.5 天），剩 4 小時（0.5 天）')
    expect(cards[0]).toContain('建議調休日 2026/10/26')
    expect(cards[0]).toContain('調休簽核 4 小時（0.5 天；2026/11/03 4 小時，已核可）')
    expect(cards[1]).toContain('未使用')
    // 員工自己看：沒有作廢按鈕
    expect(wrapper.find('[data-test="comp-leave-void"]').exists()).toBe(false)
  })
})

/* -------------------- ApprovalDetailContent -------------------- */

const requestDoc = (patch = {}) => ({
  _id: 'r1',
  status: 'pending',
  createdAt: '2026-11-10T08:26:00.000Z',
  form: {
    _id: 'f1',
    name: '請假',
    category: '人事',
    semanticType: 'leave',
    fields: [
      { _id: 'type', label: '假別', type_1: 'text', order: 1 },
      { _id: 'hours', label: '時數', type_1: 'number', order: 2 },
      { _id: 'agent', label: '代理人', type_1: 'user', order: 3 },
    ],
  },
  form_data: { type: '事假', hours: 8, agent: 'u9' },
  applicant_employee: { _id: 'a1', name: '張雅惠' },
  current_step_index: 0,
  steps: [
    { step_order: 1, all_must_approve: true, is_required: true, approvers: [{ approver: { _id: 'p1', name: '營運部主管' }, decision: 'pending' }] },
    { step_order: 2, all_must_approve: false, is_required: false, approvers: [{ approver: 'p2', decision: 'pending' }, { approver: { _id: 'p3', name: '人資專員' }, decision: 'pending' }] },
  ],
  logs: [{ action: 'create', by_employee: 'a1', at: '2026-11-10T08:26:00.000Z', message: '建立【請假】申請' }],
  ...patch,
})

describe('ApprovalDetailContent：頁面直接給單據（簽核頁）', () => {
  const mountDetail = (props) => track(mount(ApprovalDetailContent, { props, global: { plugins: [ElementPlus] } }))

  it('傳了 doc 就直接顯示，不向伺服器取明細；頁面提供的名稱與頭像對照也用得上', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json([]))
    const personResolver = vi.fn((value, fallbackName) => (value && typeof value === 'object' ? value : { _id: String(value || ''), name: fallbackName || '' }))
    const wrapper = mountDetail({
      doc: requestDoc(),
      personResolver,
      nameResolver: (id) => ({ p2: '人資主管', a1: '張雅惠' }[id] || ''),
      valueLookups: { user: (id) => ({ u9: '王小明' }[id]) },
    })
    await flushPromises()
    expect(fetchSpy).not.toHaveBeenCalled()

    const text = wrapper.text()
    expect(text).toContain('請假')
    expect(text).toContain('張雅惠')
    expect(text).toContain('2026/11/10 16:26 送出')
    expect(wrapper.find('[data-test="detail-status"]').text()).toBe('待簽核')
    // 代理人的編號換成姓名、只有編號的審核人用頁面的對照找姓名
    const rows = wrapper.findAll('.el-descriptions__table tr').map(tr => tr.text())
    expect(rows.find(row => row.startsWith('代理人'))).toContain('王小明')
    expect(text).toContain('人資主管')
    expect(text).not.toContain('p2')
    // 簽核紀錄的處理人只有編號時也找得到姓名
    expect(wrapper.find('.detail-logs').text()).toContain('張雅惠')
    expect(personResolver).toHaveBeenCalled()
  })

  it('請假單的時數旁補上天數（1 天 = 8 小時）；其他表單的「時數」照原樣', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(json([]))
    const leave = mountDetail({ doc: requestDoc(), valueLookups: {} })
    await flushPromises()
    const hoursRow = (wrapper) => wrapper.findAll('.el-descriptions__table tr').map(tr => tr.text()).find(row => row.startsWith('時數'))
    expect(hoursRow(leave)).toMatch(/時數\s*8 小時（1 天）/)

    const overtime = mountDetail({ doc: requestDoc({ form: { ...requestDoc().form, name: '加班申請', semanticType: 'overtime' } }), valueLookups: {} })
    await flushPromises()
    expect(hoursRow(overtime)).toMatch(/時數\s*8$/)
  })

  it('已經不在簽核中的單（撤回、被退簽…）：還沒簽的人顯示「未簽核」，不是還在等他簽的「待簽核」', async () => {
    const steps = [
      { approvers: [{ approver: { _id: 'p1', name: '營運部主管' }, decision: 'returned', decided_at: '2026-11-10T08:40:00.000Z' }] },
      { approvers: [{ approver: { _id: 'p2', name: '人資主管' }, decision: 'pending' }] },
    ]
    const decisions = (wrapper) => wrapper.findAll('.el-timeline .el-table__body .el-tag').map(tag => tag.text())
    const canceled = mountDetail({ doc: requestDoc({ status: 'canceled', steps }), valueLookups: {} })
    await flushPromises()
    expect(decisions(canceled)).toEqual(['已退簽', '未簽核'])

    const pending = mountDetail({ doc: requestDoc(), valueLookups: {} })
    await flushPromises()
    expect(decisions(pending)).toEqual(['待簽核', '待簽核', '待簽核'])
  })

  it('進行中的單標出「目前關卡」；一位簽核人的關卡不寫需全員同意，多位才說明，選填關卡有標示', async () => {
    const wrapper = mountDetail({ doc: requestDoc(), valueLookups: {} })
    await flushPromises()
    const items = wrapper.findAll('.el-timeline-item')
    expect(items[0].find('[data-test="step-current"]').text()).toBe('目前關卡')
    expect(items[0].text()).not.toContain('需全員同意')
    expect(items[1].find('[data-test="step-current"]').exists()).toBe(false)
    expect(items[1].find('.step-meta').text()).toContain('任一位核可即可')
    expect(items[1].find('.step-meta').text()).toContain('選填關卡')
  })

  it('已結束的單（核可、撤回）沒有目前關卡', async () => {
    const wrapper = mountDetail({ doc: requestDoc({ status: 'approved', current_step_index: 1 }), valueLookups: {} })
    await flushPromises()
    expect(wrapper.find('[data-test="step-current"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="detail-status"]').text()).toBe('已核可')
  })

  it('表單已刪除、沒有分類時不顯示空的括號', async () => {
    const wrapper = mountDetail({ doc: requestDoc({ form: null, form_data: {} }), valueLookups: {} })
    await flushPromises()
    expect(wrapper.find('.detail-head__form').text()).toBe('（表單已刪除）')
    expect(wrapper.text()).not.toContain('（）')
    expect(wrapper.text()).toContain('這張申請單沒有填寫內容')
  })

  it('頁面提供 downloadHandler 時，附件交給頁面下載（錯誤訊息由頁面統一處理）', async () => {
    const downloadHandler = vi.fn()
    const file = { name: 'proof.pdf', url: '/upload/approvals/x.pdf' }
    const doc = requestDoc({
      form: { ...requestDoc().form, fields: [{ _id: 'proof', label: '證明', type_1: 'file' }] },
      form_data: { proof: [file] },
    })
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json([]))
    const wrapper = mountDetail({ doc, valueLookups: {}, downloadHandler })
    await flushPromises()
    await wrapper.find('.attachment-list a').trigger('click')
    expect(downloadHandler).toHaveBeenCalledWith(file)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('頁面換了一張單（doc 改變）就顯示新的內容；改回用 approvalId 時才向伺服器取', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(json(requestDoc({ _id: 'r9', applicant_employee: { _id: 'a9', name: '伺服器取回的申請人' } })))
    const wrapper = mountDetail({ doc: requestDoc(), valueLookups: {} })
    await flushPromises()
    await wrapper.setProps({ doc: requestDoc({ _id: 'r2', applicant_employee: { _id: 'a2', name: '李小華' } }) })
    await flushPromises()
    expect(wrapper.text()).toContain('李小華')
    expect(wrapper.text()).not.toContain('張雅惠')
    expect(fetchSpy).not.toHaveBeenCalled()

    await wrapper.setProps({ doc: null, approvalId: 'r9' })
    await flushPromises()
    // 取明細一次（代理人欄位的姓名對照另外在背景查）
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/approvals/r9'))).toHaveLength(1)
    expect(wrapper.text()).toContain('伺服器取回的申請人')
  })

  it('手機：審核人與簽核紀錄是一行一筆的清單，不用橫向捲動的表格', async () => {
    asMobile()
    const doc = requestDoc({
      steps: [{ approvers: [{ approver: { _id: 'p1', name: '營運部主管' }, decision: 'returned', decided_at: '2026-11-10T08:40:00.000Z', comment: '請改成半天' }] }],
    })
    const wrapper = mountDetail({ doc, valueLookups: {}, nameResolver: () => '張雅惠' })
    await flushPromises()
    expect(wrapper.find('.el-timeline .el-table').exists()).toBe(false)
    const approver = wrapper.find('[data-test="approver-list"] .approver-item').text().replace(/\s+/g, ' ')
    expect(approver).toContain('營運部主管')
    expect(approver).toContain('已退簽')
    expect(approver).toContain('2026/11/10 16:40')
    expect(approver).toContain('請改成半天')
    const logs = wrapper.find('ul.detail-logs')
    expect(logs.exists()).toBe(true)
    expect(logs.text()).toContain('送出申請')
    expect(logs.text()).toContain('張雅惠')
  })
})
