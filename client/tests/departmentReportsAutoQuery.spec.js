// 部門報表：打開頁面與改條件後自動查詢、查詢與匯出的各種狀態（沒有資料、錯誤、連續操作）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DepartmentReports from '../src/views/front/DepartmentReports.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  const message = vi.fn()
  message.success = vi.fn()
  message.error = vi.fn()
  message.info = vi.fn()
  message.warning = vi.fn()
  return { ...actual, default: actual.default, ElMessage: message }
})

const TableStub = {
  props: ['data'],
  provide() {
    return { rowsOf: () => this.data || [] }
  },
  template: '<table><slot /></table>',
}
const TableColumnStub = {
  props: ['prop', 'label'],
  inject: ['rowsOf'],
  template: `<td :data-label="label">
    <div v-for="(row, index) in rowsOf()" :key="index" class="cell">
      <slot :row="row">{{ prop ? row[prop] : '' }}</slot>
    </div>
  </td>`,
}

const stubs = {
  'el-date-picker': true,
  'el-select': { template: '<div><slot /></div>' },
  'el-option': true,
  'el-button': {
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
  },
  'el-table': TableStub,
  'el-table-column': TableColumnStub,
  'el-tag': { template: '<span class="el-tag-stub"><slot /></span>' },
  EmployeeAvatar: true,
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
})
const fileResponse = (size = 1024) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  blob: async () => ({ size }),
})

const templates = [
  { id: 't-leave', name: '部門請假統計', type: 'leave', exportSettings: { formats: ['excel', 'pdf'] }, permissionSettings: { supervisorDept: true } },
  { id: 't-hours', name: '部門工時統計', type: 'workHours', exportSettings: { formats: ['excel'] }, permissionSettings: { supervisorDept: true } },
  { id: 't-att', name: '部門出勤統計', type: 'attendance', exportSettings: { formats: ['excel'] }, permissionSettings: { supervisorDept: true } },
]

let previewHandler
let exportResponse
let calls
const mounted = []

function installApi({ role = 'supervisor' } = {}) {
  apiFetch.mockImplementation(async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost')
    calls.push({ pathname: parsed.pathname, params: parsed.searchParams, accept: init.headers?.Accept })
    if (parsed.pathname.startsWith('/api/employees/')) return json({ department: { _id: 'dept1', name: '內科病房' } })
    if (parsed.pathname === '/api/departments') {
      return json([{ _id: 'dept1', name: '內科病房' }, { _id: 'dept2', name: '外科病房' }])
    }
    if (parsed.pathname === '/api/reports/department/templates') return json(templates)
    if (parsed.searchParams.get('format') === 'json') return previewHandler(parsed)
    return typeof exportResponse === 'function' ? exportResponse(parsed) : exportResponse
  })
  window.sessionStorage.setItem('employeeId', 'sup1')
  window.sessionStorage.setItem('role', role)
}

async function mountPage() {
  const wrapper = mount(DepartmentReports, { global: { stubs } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const previewCalls = () => calls.filter((call) => call.params.get('format') === 'json')
const exportCalls = () => calls.filter((call) => call.pathname.includes('/export') && call.params.get('format') !== 'json')

beforeEach(() => {
  vi.clearAllMocks()
  apiFetch.mockReset()
  calls = []
  previewHandler = () => json({ summary: { scheduled: 10, attended: 9, absent: 1 }, records: [{ employee: 'e1', name: '王小明', scheduled: 10, attended: 9, absent: 1 }] })
  exportResponse = fileResponse()
  window.URL.createObjectURL = vi.fn(() => 'blob:mock')
  window.URL.revokeObjectURL = vi.fn()
  // jsdom 不會真的下載檔案：點下載連結時什麼都不做
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  window.sessionStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DepartmentReports.vue 自動查詢', () => {
  it('打開頁面就查詢：預設是台灣時間的這個月、主管自己的部門、排第一個的報表', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-31T18:00:00.000Z')) // 台灣 11/1 02:00
    installApi()
    const wrapper = await mountPage()

    expect(wrapper.vm.selectedMonth).toBe('2026-11')
    // 報表依固定順序排列（出勤、工時…請假），不是後端回傳的順序
    expect(wrapper.vm.availableReportOptions.map((option) => option.value)).toEqual(['attendance', 'workHours', 'leave'])
    expect(previewCalls()).toHaveLength(1)
    expect(previewCalls()[0].pathname).toBe('/api/reports/department/attendance/export')
    expect(previewCalls()[0].params.get('month')).toBe('2026-11')
    expect(previewCalls()[0].params.get('department')).toBe('dept1')
    expect(wrapper.vm.preview.state).toBe('success')
    expect(wrapper.find('[data-test="report-summary"]').text()).toContain('排班總計')
    // 主管只有自己的部門
    expect(wrapper.vm.departments.map((dept) => dept._id)).toEqual(['dept1'])
  })

  it('管理員可以選所有部門', async () => {
    installApi({ role: 'admin' })
    const wrapper = await mountPage()
    expect(wrapper.vm.departments.map((dept) => dept._id)).toEqual(['dept1', 'dept2'])
    expect(previewCalls()[0].params.get('department')).toBe('dept1')
  })

  it('改條件後稍等一下自動重新查詢；連續改兩個條件只查一次', async () => {
    installApi()
    const wrapper = await mountPage()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    wrapper.vm.reportType = 'leave'
    await wrapper.vm.$nextTick()
    wrapper.vm.selectedMonth = '2026-09'
    await wrapper.vm.$nextTick()
    expect(previewCalls()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(300)
    expect(previewCalls()).toHaveLength(2)
    expect(previewCalls()[1].pathname).toBe('/api/reports/department/leave/export')
    expect(previewCalls()[1].params.get('month')).toBe('2026-09')
  })

  it('改了條件又馬上改回來：不重查，也不會一直停在載入中', async () => {
    installApi()
    const wrapper = await mountPage()
    const original = wrapper.vm.selectedMonth
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    wrapper.vm.selectedMonth = '2026-01'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.preview.loading).toBe(true)
    wrapper.vm.selectedMonth = original
    await wrapper.vm.$nextTick()
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.vm.preview.loading).toBe(false)
    expect(previewCalls()).toHaveLength(1)
    expect(wrapper.vm.preview.state).toBe('success')
  })

  it('同一組條件不重複查詢，「重新查詢」才會再查一次', async () => {
    installApi()
    const wrapper = await mountPage()

    await wrapper.vm.handlePreview()
    expect(previewCalls()).toHaveLength(1)
    await wrapper.vm.handlePreview({ force: true })
    expect(previewCalls()).toHaveLength(2)
  })

  it('條件改得很快：比較晚回來的舊查詢不會蓋掉新的結果', async () => {
    installApi()
    const wrapper = await mountPage()
    const pending = []
    previewHandler = () => new Promise((resolve) => pending.push(resolve))

    wrapper.vm.selectedMonth = '2026-08'
    const first = wrapper.vm.handlePreview()
    wrapper.vm.selectedMonth = '2026-07'
    const second = wrapper.vm.handlePreview()
    await flushPromises()
    expect(pending).toHaveLength(2)

    pending[1](json({ summary: { scheduled: 7, attended: 7, absent: 0 }, records: [{ employee: 'e1', name: '七月的資料', scheduled: 7, attended: 7, absent: 0 }] }))
    await second
    pending[0](json({ summary: { scheduled: 8, attended: 8, absent: 0 }, records: [{ employee: 'e1', name: '八月的資料', scheduled: 8, attended: 8, absent: 0 }] }))
    await first
    await flushPromises()

    expect(wrapper.vm.preview.records.map((record) => record.name)).toEqual(['七月的資料'])
    expect(wrapper.vm.preview.loading).toBe(false)
  })
})

describe('DepartmentReports.vue 查詢結果的狀態', () => {
  it('沒有資料時說明可以換月份或報表', async () => {
    installApi()
    previewHandler = () => json({ summary: null, records: [] })
    const wrapper = await mountPage()

    expect(wrapper.vm.preview.state).toBe('empty')
    expect(wrapper.find('[data-test="report-empty"]').text()).toContain('內科病房沒有「部門出勤統計」的資料')
  })

  // 部門沒有員工時伺服器回 404 No data：以前跳出英文的「No data」錯誤
  it('伺服器回 404（部門沒有員工）當成沒有資料，不跳錯誤', async () => {
    const { ElMessage } = await import('element-plus')
    installApi()
    previewHandler = () => json({ error: 'No data' }, 404)
    const wrapper = await mountPage()

    expect(wrapper.vm.preview.state).toBe('empty')
    expect(wrapper.vm.preview.error).toBe('')
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('查詢失敗時在結果區顯示原因與「重新查詢」', async () => {
    installApi()
    previewHandler = () => json({ error: '報表類型未開放' }, 403)
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="report-error"]').text()).toContain('報表類型未開放')
    previewHandler = () => json({ summary: { scheduled: 1, attended: 1, absent: 0 }, records: [] })
    await wrapper.find('[data-test="report-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="report-error"]').exists()).toBe(false)
    expect(wrapper.vm.preview.state).toBe('success')
  })

  it('網路中斷時顯示中文訊息', async () => {
    installApi()
    previewHandler = () => Promise.reject(new TypeError('Failed to fetch'))
    const wrapper = await mountPage()
    expect(wrapper.vm.preview.error).toBe('查詢失敗，請確認網路連線後再試')
  })

  it('日期顯示成 YYYY/MM/DD，數字不留浮點數雜訊', async () => {
    installApi()
    const wrapper = await mountPage()
    const { formatCell, formatSummaryValue } = wrapper.vm

    expect(formatCell('2026-10-06', { kind: 'date' })).toBe('2026/10/06')
    expect(formatCell(284.87000000000006, { kind: 'number' })).toBe(284.87)
    expect(formatCell(-0.05000000000000071, { kind: 'number' })).toBe(-0.05)
    expect(formatCell('08:10', {})).toBe('08:10')
    expect(formatCell(null, { kind: 'number' })).toBe('')
    expect(formatSummaryValue(-51.129999999999995)).toBe(-51.13)
    expect(formatSummaryValue('4 筆 / 64 小時（8 天）')).toBe('4 筆 / 64 小時（8 天）')
  })

  it('沒有可管理的部門時，結果區說明原因，也沒有可以按的匯出', async () => {
    installApi()
    apiFetch.mockImplementation(async (url) => {
      const { pathname } = new URL(String(url), 'http://localhost')
      if (pathname.startsWith('/api/employees/')) return json({ department: null })
      if (pathname === '/api/departments') return json([{ _id: 'dept1', name: '內科病房' }])
      return json(templates)
    })
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="report-setup-problem"]').text()).toContain('尚未為您設定可管理的部門')
    expect(wrapper.findAll('button').filter((button) => button.text().includes('匯出')).every((button) => button.element.disabled)).toBe(true)
  })
})

describe('DepartmentReports.vue 匯出', () => {
  it('每種可用格式一顆按鈕；按下去匯出畫面上那組條件', async () => {
    installApi()
    const wrapper = await mountPage()
    wrapper.vm.reportType = 'leave'
    await flushPromises()
    await wrapper.vm.handlePreview()

    expect(wrapper.find('[data-test="export-excel"]').text()).toBe('匯出 Excel')
    expect(wrapper.find('[data-test="export-pdf"]').text()).toBe('匯出 PDF')

    await wrapper.find('[data-test="export-pdf"]').trigger('click')
    await flushPromises()
    expect(exportCalls()).toHaveLength(1)
    expect(exportCalls()[0].pathname).toBe('/api/reports/department/leave/export')
    expect(exportCalls()[0].params.get('format')).toBe('pdf')
    expect(exportCalls()[0].params.get('department')).toBe('dept1')
    expect(exportCalls()[0].params.get('month')).toBe(wrapper.vm.selectedMonth)
  })

  it('畫面上已經知道沒有資料時不匯出，並說明原因', async () => {
    const { ElMessage } = await import('element-plus')
    installApi()
    previewHandler = () => json({ summary: null, records: [] })
    const wrapper = await mountPage()

    await wrapper.vm.exportReport('excel')
    expect(exportCalls()).toHaveLength(0)
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining('沒有內容可以匯出'))
  })

  // 伺服器回錯誤（JSON）或空白內容時，以前會存成一個打不開的檔案並顯示「匯出成功」
  it('回應不是檔案時顯示原因，不下載', async () => {
    const { ElMessage } = await import('element-plus')
    installApi()
    const wrapper = await mountPage()

    exportResponse = json({ error: 'Forbidden' }, 403)
    await wrapper.vm.exportReport('excel')
    expect(ElMessage.error).toHaveBeenLastCalledWith('您沒有權限查看這個部門的報表')

    exportResponse = json({ error: '報表產生失敗' }, 200)
    await wrapper.vm.exportReport('excel')
    expect(ElMessage.error).toHaveBeenLastCalledWith('報表產生失敗')

    exportResponse = fileResponse(0)
    await wrapper.vm.exportReport('excel')
    expect(ElMessage.error).toHaveBeenLastCalledWith('伺服器回傳空白檔案，請稍後再試')

    expect(window.URL.createObjectURL).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(wrapper.vm.exporting).toBe(false)
  })

  it('匯出中再按一次不會重複送出', async () => {
    installApi()
    const wrapper = await mountPage()
    let release
    exportResponse = () => new Promise((resolve) => { release = () => resolve(fileResponse()) })

    const first = wrapper.vm.exportReport('excel')
    const second = wrapper.vm.exportReport('excel')
    await flushPromises()
    expect(exportCalls()).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(wrapper.vm.exporting).toBe(false)
  })
})
