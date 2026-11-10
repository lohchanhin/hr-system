import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// 薪資管理（月薪資總覽）：畫面上的金額一律是伺服器回傳的數字，匯出要說清楚範圍，
// 讀取失敗、下載失敗都要說出來，連續操作時比較晚回來的舊回應不能蓋掉新的。
// 掛真正的 Element Plus，只把網路請求換成假伺服器。

const { apiFetchMock, messageSuccess, messageError, messageWarning } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
}))
vi.mock('../src/api', () => ({ API_BASE_URL: '', apiFetch: apiFetchMock }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), { success: messageSuccess, error: messageError, warning: messageWarning, info: vi.fn() }),
  }
})

import SalaryManagementSetting from '../src/components/backComponents/SalaryManagementSetting.vue'

vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 })

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await tick()
  await flushPromises()
}

const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
})
const file = (size = 2048, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') => ({
  ok: true,
  status: 200,
  headers: { get: () => type },
  blob: async () => ({ size, type }),
})

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const organizations = [{ _id: ORG_A, name: '仁愛院區' }, { _id: ORG_B, name: '和平院區' }]
const departments = [
  { _id: 'dept-1', name: '護理部', organization: ORG_A },
  { _id: 'dept-2', name: '行政部', organization: ORG_A },
  { _id: 'dept-3', name: '照服部', organization: ORG_B },
]
const subDepartments = [
  { _id: 'sub-1', name: '三樓病房', department: 'dept-1' },
  { _id: 'sub-2', name: '總務', department: 'dept-2' },
  { _id: 'sub-3', name: '日照', department: 'dept-3' },
]

// 伺服器 /api/payroll/overview/monthly 的一列（即時試算、沒有薪資記錄）
const row = (overrides = {}) => ({
  _id: 'e1',
  employeeId: 'E001',
  name: '王小明',
  photo: '',
  department: '護理部',
  subDepartment: '三樓病房',
  organization: ORG_A,
  salaryType: '月薪',
  workDays: 21,
  scheduledHours: 176,
  actualWorkHours: 170.9,
  hourlyRate: 151.27083333333334,
  leaveHours: 8,
  paidLeaveHours: 0,
  unpaidLeaveHours: 8,
  leaveDeduction: 1210,
  overtimeHours: 2,
  overtimePay: 403,
  overtimeIssues: [],
  nightShiftDays: 2,
  nightShiftHours: 16,
  nightShiftCalculationMethod: 'calculated',
  nightShiftBreakdown: [
    { shiftName: '大夜班', shiftCode: 'N', allowanceType: '固定津貼', workHours: 8, allowanceAmount: 500, calculationDetail: '固定津貼: NT$ 500 / 班', hasIssue: false },
    { shiftName: '大夜班', shiftCode: 'N', allowanceType: '固定津貼', workHours: 8, allowanceAmount: 500, calculationDetail: '固定津貼: NT$ 500 / 班', hasIssue: false },
  ],
  nightShiftConfigurationIssues: [],
  baseSalary: 35095,
  laborInsuranceFee: 955,
  healthInsuranceFee: 545,
  laborPensionSelf: 726,
  employeeAdvance: 5445,
  debtGarnishment: 1000,
  otherDeductions: 300,
  lateEarlyDeduction: 100,
  deductionShortfall: 0,
  netPay: 26124,
  // 夜班津貼 = 班表算出的 1000 + 核准的夜班獎金申請 800
  nightShiftAllowance: 1800,
  performanceBonus: 2000,
  otherBonuses: 0,
  recurringAllowance: 1500,
  recurringAllowanceBreakdown: [{ item: '組長加給', amount: 1500 }],
  totalBonus: 5703,
  totalPayment: 31827,
  insuranceRate: { level: 24, insuredSalary: 38200, workerFee: 955, employerFee: 3343, ordinaryRate: 11.5, employmentInsuranceRate: 1 },
  annualLeave: { totalHours: 80, usedHours: 16, remainingHours: 64, expiryDate: '2026-12-31T00:00:00.000Z' },
  hasPayrollRecord: false,
  ...overrides,
})

let overviewHandler
let completeDataHandler
let exportHandler
let calls
const mounted = []

const overviewCalls = () => calls.filter(call => call.pathname === '/api/payroll/overview/monthly')
const page = (items, total = items.length, pageSize = 20) => ({
  items,
  pagination: { total, page: 1, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
})

beforeEach(() => {
  calls = []
  overviewHandler = () => json(page([row()]))
  completeDataHandler = () => json({ dailyDetails: [], leaveRecords: [], overtimeRecords: [] })
  exportHandler = () => file()
  localStorage.clear()
  messageSuccess.mockReset()
  messageError.mockReset()
  messageWarning.mockReset()
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation(async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost')
    const call = { url: String(url), pathname: parsed.pathname, params: parsed.searchParams, method: init.method || 'GET' }
    calls.push(call)
    if (parsed.pathname === '/api/organizations') return json(organizations)
    if (parsed.pathname === '/api/departments') return json(departments)
    if (parsed.pathname === '/api/sub-departments') return json(subDepartments)
    if (parsed.pathname === '/api/payroll/overview/monthly') return overviewHandler(parsed, call)
    if (parsed.pathname.startsWith('/api/payroll/complete-data/')) return completeDataHandler(parsed, call)
    if (parsed.pathname.startsWith('/api/payroll/export')) return exportHandler(parsed, call)
    return json([])
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:payroll') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  // jsdom 不會真的下載檔案：點下載連結時什麼都不做
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mountPage() {
  const wrapper = mount(SalaryManagementSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
  mounted.push(wrapper)
  await flush()
  return wrapper
}

const statText = (wrapper, name) => wrapper.find(`[data-test="${name}"] .hr-stat__value`).text()
const breakdownLine = key => {
  const cells = [...document.body.querySelectorAll(`[data-test="breakdown-${key}"] td`)].map(cell => cell.textContent.trim())
  return { item: cells[0], description: cells[1], amount: cells[2] }
}

describe('薪資管理：版面', () => {
  it('頁首是「薪資管理」，沒有單一頁籤的頁籤列、重複標題與預設顯示的示意表格，真正的薪資表直接在第一屏', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="page-header"] h1').text()).toBe('薪資管理')
    expect(wrapper.find('.el-tabs').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('薪資管理設定')
    expect(wrapper.text()).not.toContain('月薪資總覽')
    // 示意表格的假資料（王曉明、李小華）預設不在畫面上
    expect(document.body.textContent).not.toContain('王曉明')
    expect(document.body.textContent).not.toContain('李小華')
    expect(wrapper.find('[data-test="payroll-table"]').text()).toContain('王小明')
  })

  it('不再讀取沒有任何功能使用的 /api/salary-settings', async () => {
    await mountPage()
    expect(calls.some(call => call.pathname.startsWith('/api/salary-settings'))).toBe(false)
  })
})

describe('薪資管理：月份', () => {
  // 以前用 UTC 取月份：台灣每月 1 日 08:00 以前打開會停在上個月
  it('預設月份是台灣時間的這個月（月初凌晨不會停在上個月）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z')) // 台灣 11/1 01:30
    const wrapper = await mountPage()

    expect(wrapper.vm.overviewMonth).toBe('2026-11-01')
    expect(overviewCalls()[0].params.get('month')).toBe('2026-11-01')
  })

  it('上個月、下個月按鈕切換月份並重新查詢（跨年也正確）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-15T04:00:00.000Z'))
    const wrapper = await mountPage()

    await wrapper.find('[data-test="prev-month"]').trigger('click')
    await flush()
    expect(wrapper.vm.overviewMonth).toBe('2025-12-01')
    expect(overviewCalls().at(-1).params.get('month')).toBe('2025-12-01')

    await wrapper.find('[data-test="next-month"]').trigger('click')
    await wrapper.find('[data-test="next-month"]').trigger('click')
    await flush()
    expect(overviewCalls().at(-1).params.get('month')).toBe('2026-02-01')
  })
})

describe('薪資管理：金額只顯示伺服器的數字', () => {
  it('統計數字與合計列是這一頁各列的加總，兩者一致', async () => {
    overviewHandler = () => json(page([
      row(),
      row({ _id: 'e2', employeeId: 'E002', name: '李美玲', baseSalary: 46706, netPay: 44627, totalBonus: 3600, totalPayment: 48227 }),
    ]))
    const wrapper = await mountPage()

    expect(statText(wrapper, 'stat-count')).toBe('2')
    expect(statText(wrapper, 'stat-net-pay')).toBe('NT$ 70,751')
    expect(statText(wrapper, 'stat-total-bonus')).toBe('NT$ 9,303')
    expect(statText(wrapper, 'stat-total-payment')).toBe('NT$ 80,054')

    const summary = wrapper.vm.summarizeOverview({
      columns: [{ property: 'name' }, { property: 'baseSalary' }, { property: 'netPay' }, { property: 'totalBonus' }, { property: 'totalPayment' }, { property: 'workDays' }],
    })
    expect(summary).toEqual(['合計', '81,801', '70,751', '9,303', '80,054', ''])
  })

  it('有很多頁時，統計與合計註明是本頁的加總', async () => {
    overviewHandler = () => json(page([row()], 45))
    const wrapper = await mountPage()

    expect(statText(wrapper, 'stat-count')).toBe('45')
    expect(wrapper.find('.table-footer').text()).toContain('本頁 1 人的加總')
    expect(wrapper.vm.summarizeOverview({ columns: [{ property: 'name' }] })).toEqual(['本頁合計'])
  })

  // 2026/11：summary=true 時伺服器回整個篩選結果（不只這一頁）的人數與合計；只換頁時不帶，沿用上一次的
  it('上方統計用伺服器的整體合計；換月份、篩選、搜尋時才要求重算，只換頁不要求', async () => {
    const summary = { headCount: 45, withPayrollRecord: 0, totals: { netPay: 1234567, totalBonus: 89012, totalPayment: 1323579 } }
    overviewHandler = parsed => json({ ...page([row()], 45), summary: parsed.searchParams.get('summary') === 'true' ? summary : null })
    const wrapper = await mountPage()
    expect(overviewCalls()[0].params.get('summary')).toBe('true')
    expect(statText(wrapper, 'stat-count')).toBe('45')
    expect(statText(wrapper, 'stat-net-pay')).toBe('NT$ 1,234,567')
    expect(statText(wrapper, 'stat-total-payment')).toBe('NT$ 1,323,579')
    expect(wrapper.find('[data-test="totals-note"]').text()).toContain('上方統計是全部 45 人的合計')

    wrapper.vm.handleOverviewPageChange(2)
    await flush()
    expect(overviewCalls().at(-1).params.get('summary')).toBeNull()
    expect(statText(wrapper, 'stat-net-pay')).toBe('NT$ 1,234,567')

    wrapper.vm.filterEmployeeName = '王'
    wrapper.vm.applyOverviewFilters()
    await flush()
    expect(overviewCalls().at(-1).params.get('summary')).toBe('true')
    wrapper.vm.shiftMonth(-1)
    await flush()
    expect(overviewCalls().at(-1).params.get('summary')).toBe('true')
  })

  it('明細寫出這次套用的計薪方式（employment.method）', async () => {
    const employment = { employed: true, ratio: 0.5, employedDays: 16, daysInMonth: 31, startKey: '2026-10-16', endKey: '2026-10-31', reason: 'partial_month' }
    overviewHandler = () => json(page([
      row({ employment: { ...employment, method: 'calendarDays', basisDays: 31 } }),
      row({ _id: 'e2', employment: { ...employment, method: 'none', basisDays: null } }),
      row({ _id: 'e3', employment: { ...employment, method: 'days30', basisDays: 30 }, hasPayrollRecord: true, hoursSource: 'attendance' }),
    ]))
    const wrapper = await mountPage()
    const [calendar, none, days30] = wrapper.vm.filteredOverviewData
    expect(wrapper.vm.salaryNotice(calendar).tip).toContain('月薪按在職天數 ÷ 當月 31 天計算')
    expect(wrapper.vm.salaryNotice(none).tip).toContain('不按比例，給整個月的月薪')
    expect(wrapper.vm.salaryNotice(days30).tip).toContain('月薪按在職天數 ÷ 30 計算')
    await wrapper.vm.showDetailDialog(calendar)
    await flush()
    expect(breakdownLine('baseSalary').description).toContain('在職 16 天 ÷ 當月 31 天')
    expect(document.body.querySelector('[data-test="hours-source-note"]')).toBeNull()
    await wrapper.vm.showDetailDialog(days30)
    await flush()
    expect(document.body.querySelector('[data-test="hours-source-note"]').textContent).toContain('依目前的出勤資料')
  })

  // 以前明細把「請假扣款」列成本薪之後的另一筆扣款（本薪其實已經扣過），扣款合計還漏掉員工預支與債權扣押
  it('明細：本薪已含請假扣款（不再另列一筆），每一項扣款與獎金都是伺服器的數字，三個合計也是', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    expect(document.body.querySelector('[data-test="breakdown-leaveDeduction"]')).toBeNull()
    expect(breakdownLine('baseSalary')).toMatchObject({ item: '本薪', amount: 'NT$ 35,095' })
    expect(breakdownLine('baseSalary').description).toContain('已扣請假 NT$ 1,210（不給薪 8 小時）')
    expect(breakdownLine('laborInsuranceFee')).toMatchObject({ amount: '-NT$ 955', description: '投保級距第 24 級，投保薪資 NT$ 38,200' })
    expect(breakdownLine('healthInsuranceFee').amount).toBe('-NT$ 545')
    expect(breakdownLine('laborPensionSelf').amount).toBe('-NT$ 726')
    expect(breakdownLine('employeeAdvance').amount).toBe('-NT$ 5,445')
    expect(breakdownLine('debtGarnishment').amount).toBe('-NT$ 1,000')
    expect(breakdownLine('otherDeductions')).toMatchObject({ amount: '-NT$ 300', description: '含遲到早退扣款 NT$ 100' })
    expect(breakdownLine('netPay').amount).toBe('NT$ 26,124')
    expect(breakdownLine('overtimePay').amount).toBe('NT$ 403')
    expect(breakdownLine('recurringAllowance')).toMatchObject({ amount: 'NT$ 1,500', description: '組長加給 NT$ 1,500' })
    expect(breakdownLine('performanceBonus').amount).toBe('NT$ 2,000')
    expect(breakdownLine('otherBonuses').amount).toBe('NT$ 0')
    expect(breakdownLine('totalBonus').amount).toBe('NT$ 5,703')
    expect(breakdownLine('totalPayment').amount).toBe('NT$ 31,827')
    expect(document.body.querySelector('[data-test="detail-month"]').textContent).toMatch(/^\d{4}\/\d{2}$/)
  })

  // 以前打開明細後，會用出勤明細 API 的夜班津貼（不含核准的夜班獎金）蓋掉總覽的數字，結果夜班津貼那一列和獎金合計對不起來
  it('明細：夜班津貼維持總覽的數字，不會被出勤明細 API 的數字蓋掉', async () => {
    completeDataHandler = () => json({
      nightShiftDays: 2,
      nightShiftHours: 16,
      nightShiftAllowance: 1000,
      nightShiftCalculationMethod: 'calculated',
      dailyDetails: [],
      leaveRecords: [],
      overtimeRecords: [],
    })
    const wrapper = await mountPage()
    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    expect(breakdownLine('nightShiftAllowance').amount).toBe('NT$ 1,800')
    expect(breakdownLine('totalBonus').amount).toBe('NT$ 5,703')
    // 同一個班別的夜班合併成一列：2 班、每班 500
    expect(wrapper.vm.nightShiftGroups).toHaveLength(1)
    expect(wrapper.vm.nightShiftGroups[0]).toMatchObject({ shiftName: '大夜班', count: 2, allowanceAmount: 500 })
  })

  it('已存檔的薪資記錄：金額照記錄顯示，計算依據寫「已儲存的薪資記錄」，出勤時數用明細 API 的數字', async () => {
    overviewHandler = () => json(page([row({ hasPayrollRecord: true, workDays: 0, actualWorkHours: 0, hourlyRate: 0, baseSalary: 65489, netPay: 71868 })]))
    completeDataHandler = () => json({ workDays: 20, scheduledHours: 160, actualWorkHours: 158.5, hourlyRate: 272.87083333333334, leaveHours: 0, overtimeHours: 0, dailyDetails: [], leaveRecords: [], overtimeRecords: [] })
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="payroll-table"]').text()).toContain('已存檔')
    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    expect(breakdownLine('baseSalary')).toMatchObject({ amount: 'NT$ 65,489', description: '已儲存的薪資記錄' })
    expect(breakdownLine('netPay')).toMatchObject({ amount: 'NT$ 71,868', description: '已儲存的薪資記錄' })
    expect(wrapper.vm.detailStats).toMatchObject({ workDays: 20, actualWorkHours: 158.5 })
    expect(document.body.querySelector('#pane-attendance .detail-stats').textContent).toContain('NT$ 272.87')
  })

  // 扣款超過本薪時實領是 0：沒扣到的金額（deductionShortfall）要寫出來；以前存檔後只剩「已儲存的薪資記錄」
  it('扣款超過本薪：實領那一列標示還有多少沒扣到，已存檔的記錄也一樣；沒有不足額時不顯示', async () => {
    overviewHandler = () => json(page([
      row({ _id: 'e1', netPay: 0, deductionShortfall: 2350 }),
      row({ _id: 'e2', name: '李大華', netPay: 0, deductionShortfall: 800, hasPayrollRecord: true }),
      row({ _id: 'e3', name: '陳小美' }),
    ]))
    const wrapper = await mountPage()

    // 總覽的「實領」欄也標出沒扣到的金額（只有不足額大於 0 的列）
    const marks = wrapper.findAll('[data-test="deduction-shortfall"]').map(node => node.text())
    expect(marks).toEqual(['未扣 2,350', '未扣 800'])

    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()
    expect(breakdownLine('netPay')).toMatchObject({ amount: 'NT$ 0', description: '扣款超過本薪，還有 NT$ 2,350 沒有扣到' })
    expect(document.body.querySelector('[data-test="breakdown-netPay"]').classList.contains('has-issue')).toBe(true)

    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[1])
    await flush()
    expect(breakdownLine('netPay').description).toBe('扣款超過本薪，還有 NT$ 800 沒有扣到（已儲存的薪資記錄）')
    expect(document.body.querySelector('[data-test="breakdown-netPay"]').classList.contains('has-issue')).toBe(true)

    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[2])
    await flush()
    expect(breakdownLine('netPay').description).toBe('本薪 − 以上扣款')
    expect(document.body.querySelector('[data-test="breakdown-netPay"]').classList.contains('has-issue')).toBe(false)
  })

  it('金額、時數的格式：千分位、負數、0，以及不留浮點數雜訊', async () => {
    const wrapper = await mountPage()
    const { formatAmount, formatCurrency, formatHours } = wrapper.vm

    expect(formatAmount(1234567.4)).toBe('1,234,567')
    expect(formatAmount(-1200)).toBe('-1,200')
    expect(formatAmount(-0.4)).toBe('0')
    expect(formatAmount(undefined)).toBe('0')
    expect(formatCurrency(45800)).toBe('NT$ 45,800')
    expect(formatCurrency(-955)).toBe('-NT$ 955')
    expect(formatCurrency(null)).toBe('NT$ 0')
    expect(formatHours(7.999999999)).toBe('8')
    expect(formatHours(0.1 + 0.2)).toBe('0.3')
    expect(formatHours(170.9)).toBe('170.9')
  })

  it('員工資料沒有薪資金額時，在列上標示「未設定薪資」並說明到哪裡設定', async () => {
    overviewHandler = () => json(page([row({ hourlyRate: 0, baseSalary: 0, netPay: 0, totalBonus: 0, totalPayment: 0 })]))
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="payroll-table"]').text()).toContain('未設定薪資')
    expect(wrapper.vm.salaryNotice(wrapper.vm.filteredOverviewData[0]).tip).toContain('員工管理')
  })

  it('月中到職的員工標示「未滿月」', async () => {
    overviewHandler = () => json(page([row({ employment: { employed: true, ratio: 0.5, employedDays: 15, daysInMonth: 30, startKey: '2026-11-16', endKey: '2026-11-30', reason: 'partial_month' } })]))
    const wrapper = await mountPage()

    const notice = wrapper.vm.salaryNotice(wrapper.vm.filteredOverviewData[0])
    expect(notice.label).toBe('未滿月')
    expect(notice.tip).toContain('在職 15 天（2026/11/16～2026/11/30）')
  })
})

describe('薪資管理：讀取狀態與連續操作', () => {
  it('總覽讀取失敗時顯示原因與「重新載入」，不是只留一張空表', async () => {
    overviewHandler = () => json({ error: 'Failed to build monthly payroll overview' }, 500)
    const wrapper = await mountPage()

    const error = wrapper.find('[data-test="overview-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('薪資資料載入失敗，請稍後再試')

    overviewHandler = () => json(page([row()]))
    await error.find('button').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="overview-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="payroll-table"]').text()).toContain('王小明')
  })

  it('沒有符合條件的員工時，說明可以調整篩選條件', async () => {
    overviewHandler = () => json(page([]))
    const wrapper = await mountPage()
    expect(wrapper.find('[data-test="overview-empty"]').text()).toContain('沒有符合條件的員工，請調整上方的篩選條件')
  })

  it('很快連續換篩選條件：比較晚回來的舊回應不會蓋掉新的結果', async () => {
    const wrapper = await mountPage()
    const pending = []
    overviewHandler = () => new Promise(resolve => pending.push(resolve))

    wrapper.vm.filterDepartment = 'dept-1'
    wrapper.vm.applyOverviewFilters()
    wrapper.vm.filterDepartment = 'dept-2'
    wrapper.vm.applyOverviewFilters()
    await flush()
    expect(pending).toHaveLength(2)

    // 後送的（行政部）先回來，先送的（護理部）後回來
    pending[1](json(page([row({ _id: 'e9', name: '行政部的人' })])))
    await flush()
    pending[0](json(page([row({ _id: 'e8', name: '護理部的人' })])))
    await flush()

    expect(wrapper.vm.filteredOverviewData.map(item => item.name)).toEqual(['行政部的人'])
    expect(wrapper.vm.overviewLoading).toBe(false)
  })

  it('很快連續點兩位員工的明細：顯示的是後點那位的出勤記錄', async () => {
    overviewHandler = () => json(page([row(), row({ _id: 'e2', employeeId: 'E002', name: '李美玲' })]))
    const wrapper = await mountPage()
    const pending = {}
    completeDataHandler = parsed => new Promise(resolve => { pending[parsed.pathname.split('/')[4]] = resolve })
    const [first, second] = wrapper.vm.filteredOverviewData

    wrapper.vm.showDetailDialog(first)
    wrapper.vm.showDetailDialog(second)
    await flush()
    const day = name => ({ date: '2026-11-03', shiftName: name, scheduledHours: 8, workedHours: 8, hasAttendance: true, clockInTime: null, clockOutTime: null })
    pending.e2(json({ dailyDetails: [day('李美玲的班')], leaveRecords: [], overtimeRecords: [] }))
    await flush()
    pending.e1(json({ dailyDetails: [day('王小明的班')], leaveRecords: [], overtimeRecords: [] }))
    await flush()

    expect(wrapper.vm.selectedEmployee.name).toBe('李美玲')
    expect(wrapper.vm.employeeDetailData.dailyDetails.map(item => item.shiftName)).toEqual(['李美玲的班'])
    expect(wrapper.vm.detailLoading).toBe(false)
  })

  it('換看另一位員工時先清掉上一位的出勤記錄，讀取失敗時顯示原因', async () => {
    overviewHandler = () => json(page([row(), row({ _id: 'e2', employeeId: 'E002', name: '李美玲' })]))
    const wrapper = await mountPage()
    const [first, second] = wrapper.vm.filteredOverviewData
    completeDataHandler = () => json({ dailyDetails: [{ date: '2026-11-03', shiftName: '日班', scheduledHours: 8, workedHours: 8, hasAttendance: true }], leaveRecords: [], overtimeRecords: [] })
    await wrapper.vm.showDetailDialog(first)
    await flush()
    expect(wrapper.vm.employeeDetailData.dailyDetails).toHaveLength(1)

    completeDataHandler = () => json({ error: 'Employee not found' }, 400)
    const opening = wrapper.vm.showDetailDialog(second)
    expect(wrapper.vm.employeeDetailData).toBeNull()
    await opening
    await flush()
    expect(wrapper.vm.detailError).toBe('找不到這位員工，可能已被刪除，請重新整理後再試')
    expect(document.body.querySelector('[data-test="detail-error"]')).toBeTruthy()
  })

  it('每日出勤的狀態：不用上班的日子、還沒到的日子不是缺勤', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T04:00:00.000Z'))
    const wrapper = await mountPage()
    const { dayStatus } = wrapper.vm
    const day = overrides => ({ date: '2026-11-05', scheduledHours: 8, workedHours: 0, hasAttendance: false, clockInTime: null, clockOutTime: null, ...overrides })

    expect(dayStatus(day({ hasAttendance: true })).label).toBe('已出勤')
    expect(dayStatus(day({ scheduledHours: 0, semanticType: 'rest_day' })).label).toBe('休息日')
    expect(dayStatus(day({ scheduledHours: 0, semanticType: 'holiday' })).label).toBe('國定假日')
    expect(dayStatus(day({ scheduledHours: 0 })).label).toBe('不用上班')
    expect(dayStatus(day({ date: '2026-11-20' })).label).toBe('尚未到')
    expect(dayStatus(day({ clockInTime: '2026-11-05T00:00:00.000Z' })).label).toBe('缺下班卡')
    expect(dayStatus(day({ date: '2026-11-10', clockInTime: '2026-11-10T00:00:00.000Z' })).label).toBe('上班中')
    expect(dayStatus(day()).label).toBe('缺勤')
  })

  it('請假記錄的給薪方式看伺服器的 payRate：半薪假不再顯示成「有薪」', async () => {
    const wrapper = await mountPage()
    const { leavePay } = wrapper.vm
    expect(leavePay({ payRate: 1, isPaid: true }).label).toBe('全薪')
    expect(leavePay({ payRate: 0.5, isPaid: true }).label).toBe('半薪')
    expect(leavePay({ payRate: 0, isPaid: false }).label).toBe('不給薪')
    expect(leavePay({ isPaid: true }).label).toBe('給薪')
  })
})

describe('薪資管理：篩選', () => {
  it('部門依機構、單位依部門縮小範圍；換機構時清掉不屬於它的部門與單位', async () => {
    const wrapper = await mountPage()
    wrapper.vm.filterOrganization = ORG_A
    wrapper.vm.filterDepartment = 'dept-1'
    wrapper.vm.filterSubDepartment = 'sub-1'
    await flush()
    expect(wrapper.vm.departmentOptions.map(item => item.name)).toEqual(['護理部', '行政部'])
    expect(wrapper.vm.subDepartmentOptions.map(item => item.name)).toEqual(['三樓病房'])

    wrapper.vm.filterOrganization = ORG_B
    wrapper.vm.handleOrganizationChange()
    await flush()
    expect(wrapper.vm.filterDepartment).toBe('')
    expect(wrapper.vm.filterSubDepartment).toBe('')
    expect(wrapper.vm.subDepartmentOptions.map(item => item.name)).toEqual(['日照'])
    const last = overviewCalls().at(-1).params
    expect(last.get('organization')).toBe(ORG_B)
    expect(last.has('department')).toBe(false)
    expect(last.has('subDepartment')).toBe(false)
  })
})

describe('薪資管理：匯出', () => {
  const summaryText = () => document.body.querySelector('[data-test="export-summary"]').textContent.replace(/\s+/g, ' ')
  const confirmButton = () => document.body.querySelector('[data-test="export-confirm"]')

  it('匯出前說明月份、格式、範圍與人數；格式範例要按「查看格式範例」才顯示', async () => {
    overviewHandler = () => json(page([row()], 9))
    const wrapper = await mountPage()
    wrapper.vm.overviewMonth = '2026-09-01'
    wrapper.vm.applyOverviewFilters()
    await flush()

    wrapper.vm.openExportDialog('taichung')
    await flush()
    expect(summaryText()).toContain('月份2026/09')
    expect(summaryText()).toContain('格式台中銀行匯款檔（Excel）')
    expect(summaryText()).toContain('範圍全公司')
    expect(summaryText()).toContain('人數9 人')
    expect(document.body.querySelector('[data-test="export-sample"]')).toBeNull()

    document.body.querySelector('[data-test="toggle-sample"]').click()
    await flush()
    expect(document.body.querySelector('[data-test="export-sample"]').textContent).toContain('假資料')
  })

  // 伺服器的獎金紙條有夜班津貼與定期津貼兩欄（獎金合計是第 12 欄、備註第 13 欄），格式範例要一致
  it('獎金紙條的格式範例與伺服器匯出的欄位一致（含夜班津貼、定期津貼）', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openExportDialog('bonusSlip')
    await flush()
    document.body.querySelector('[data-test="toggle-sample"]').click()
    await flush()

    const labels = wrapper.vm.exportSample.columns.map(column => column.label)
    expect(labels).toEqual([
      '員工編號', '姓名', '部門', '銀行代碼', '帳號末四碼',
      '加班費', '夜班津貼', '績效獎金', '其他獎金', '定期津貼', '簽核調整', '獎金合計', '備註',
    ])
    expect(labels.indexOf('獎金合計')).toBe(11)
    const sampleText = document.body.querySelector('[data-test="export-sample"]').textContent
    expect(sampleText).toContain('夜班津貼')
    expect(sampleText).toContain('定期津貼')
    // 範例的合計就是各欄相加
    const toNumber = text => Number(String(text).replace(/,/g, ''))
    wrapper.vm.exportSample.rows.forEach((sample) => {
      const sum = ['overtime', 'nightShift', 'performance', 'otherBonus', 'recurring', 'adjustment'].reduce((total, key) => total + toNumber(sample[key]), 0)
      expect(sum).toBe(toNumber(sample.total))
    })
  })

  // 2026/11：銀行匯款檔與獎金紙條也套用機構、部門、單位（POST /api/payroll/export 接受同樣的範圍參數）；以前一律匯出全公司
  it('銀行匯款檔套用畫面上的機構、部門、單位：範圍與人數和畫面相同，參數一起送出', async () => {
    overviewHandler = parsed => json(page([row()], parsed.searchParams.get('department') ? 3 : 12))
    const wrapper = await mountPage()
    wrapper.vm.filterOrganization = ORG_A
    wrapper.vm.filterDepartment = 'dept-1'
    wrapper.vm.applyOverviewFilters()
    await flush()
    expect(statText(wrapper, 'stat-count')).toBe('3')

    wrapper.vm.openExportDialog('taiwan')
    await flush()
    expect(summaryText()).toContain('範圍仁愛院區／護理部')
    expect(summaryText()).toContain('人數3 人')
    expect(document.body.querySelector('[data-test="export-scope-note"]')).toBeNull()
    expect(document.body.querySelector('[data-test="export-dialog"]').textContent).not.toContain('全公司')

    confirmButton().click()
    await flush()
    const exportCall = calls.find(call => call.pathname === '/api/payroll/export')
    expect(exportCall.method).toBe('POST')
    expect([...exportCall.params.keys()].sort()).toEqual(['department', 'format', 'month', 'organization'])
    expect(exportCall.params.get('format')).toBe('taiwan')
    expect(exportCall.params.get('department')).toBe('dept-1')
    expect(messageSuccess).toHaveBeenCalledWith(expect.stringContaining('臺灣企銀匯款檔'))
  })

  it('範圍內沒有員工時伺服器回的中文原因照樣顯示', async () => {
    const wrapper = await mountPage()
    exportHandler = () => json({ error: '這個範圍沒有員工，沒有資料可以匯出' }, 400)
    wrapper.vm.openExportDialog('bonusSlip')
    await flush()
    confirmButton().click()
    await flush()
    expect(messageError).toHaveBeenCalledWith('這個範圍沒有員工，沒有資料可以匯出')
  })

  it('總覽 PDF 套用機構、部門、單位；姓名搜尋不會套用，要提醒並顯示範圍內的人數', async () => {
    overviewHandler = parsed => json(page([row()], parsed.searchParams.get('q') ? 1 : 3))
    const wrapper = await mountPage()
    wrapper.vm.filterOrganization = ORG_A
    wrapper.vm.filterDepartment = 'dept-1'
    wrapper.vm.filterEmployeeName = '王'
    wrapper.vm.applyOverviewFilters()
    await flush()
    expect(statText(wrapper, 'stat-count')).toBe('1')

    wrapper.vm.openExportDialog('pdf')
    await flush()
    expect(summaryText()).toContain('範圍仁愛院區／護理部')
    expect(summaryText()).toContain('人數3 人')
    expect(document.body.querySelector('[data-test="export-scope-note"]').textContent).toContain('搜尋不會套用到匯出')

    exportHandler = () => file(4096, 'application/pdf')
    confirmButton().click()
    await flush()
    const exportCall = calls.find(call => call.pathname === '/api/payroll/export/pdf')
    expect(exportCall.params.get('organization')).toBe(ORG_A)
    expect(exportCall.params.get('department')).toBe('dept-1')
    expect(exportCall.params.has('q')).toBe(false)
  })

  it('範圍內沒有員工時不能匯出，並說明原因', async () => {
    overviewHandler = () => json(page([]))
    const wrapper = await mountPage()

    wrapper.vm.openExportDialog('pdf')
    await flush()
    expect(document.body.querySelector('[data-test="export-nothing"]').textContent).toContain('沒有資料可以匯出')
    expect(confirmButton().disabled).toBe(true)

    await wrapper.vm.confirmExport()
    expect(calls.some(call => call.pathname.startsWith('/api/payroll/export'))).toBe(false)
    expect(messageWarning).toHaveBeenCalledWith(expect.stringContaining('沒有資料可以匯出'))
  })

  it('匯出失敗時顯示原因（伺服器的英文訊息換成中文），視窗留著可以重試', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openExportDialog('pdf')
    await flush()

    exportHandler = () => json({ error: 'No employees found matching the criteria' }, 400)
    await wrapper.vm.confirmExport()
    expect(messageError).toHaveBeenCalledWith('沒有符合條件的員工，沒有資料可以匯出')
    expect(wrapper.vm.exportDialog.visible).toBe(true)
    expect(wrapper.vm.exportDialog.submitting).toBe(false)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  // 伺服器用 200 回了 JSON（錯誤內容）或空白檔案時，以前會存成一個打不開的檔案
  it('回應不是檔案（JSON 或空白）時顯示錯誤，不下載', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openExportDialog('taiwan')
    await flush()

    exportHandler = () => json({ error: '薪資資料尚未準備好' }, 200)
    await wrapper.vm.confirmExport()
    expect(messageError).toHaveBeenLastCalledWith('薪資資料尚未準備好')

    exportHandler = () => file(0)
    await wrapper.vm.confirmExport()
    expect(messageError).toHaveBeenLastCalledWith('伺服器回傳空白檔案，請稍後再試')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('網路中斷時顯示中文訊息，不是瀏覽器的英文錯誤', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openExportDialog('taiwan')
    await flush()

    exportHandler = () => Promise.reject(new TypeError('Failed to fetch'))
    await wrapper.vm.confirmExport()
    expect(messageError).toHaveBeenCalledWith('匯出失敗，請確認網路連線後再試')
  })

  it('匯出中再按一次不會重複送出', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openExportDialog('taiwan')
    await flush()
    let release
    exportHandler = () => new Promise(resolve => { release = () => resolve(file()) })

    const first = wrapper.vm.confirmExport()
    const second = wrapper.vm.confirmExport()
    await flush()
    expect(calls.filter(call => call.pathname === '/api/payroll/export')).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(wrapper.vm.exportDialog.submitting).toBe(false)
  })

  it('個人薪資表：同一位員工下載中再按一次不重複送出，失敗時顯示原因', async () => {
    const wrapper = await mountPage()
    const employee = wrapper.vm.filteredOverviewData[0]
    let release
    exportHandler = () => new Promise(resolve => { release = () => resolve(json({ error: 'Employee not found' }, 404)) })

    const first = wrapper.vm.exportIndividualPayroll(employee)
    const second = wrapper.vm.exportIndividualPayroll(employee)
    await flush()
    const individualCalls = calls.filter(call => call.pathname === '/api/payroll/export/individual')
    expect(individualCalls).toHaveLength(1)
    expect(individualCalls[0].params.get('employeeId')).toBe('e1')
    expect(individualCalls[0].params.get('organizationName')).toBe('仁愛院區')
    expect(wrapper.vm.isExportingIndividual(employee)).toBe(true)

    release()
    await Promise.all([first, second])
    expect(messageError).toHaveBeenCalledWith('找不到這位員工，可能已被刪除，請重新整理後再試')
    expect(wrapper.vm.isExportingIndividual(employee)).toBe(false)
  })
})
