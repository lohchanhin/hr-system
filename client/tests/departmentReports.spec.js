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
  return {
    ...actual,
    default: actual.default,
    ElMessage: message,
  }
})


// 畫面現在會自動查詢（打開頁面、條件改變後稍等一下）：測試結束要卸載，計時器才不會跑進下一個測試
const mountedWrappers = []
// 自動查詢拿到的回應：沒有資料的報表
const emptyPreviewResponse = () => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ summary: null, records: [] }),
})

function createWrapper() {
  const wrapper = mountDepartmentReports()
  mountedWrappers.push(wrapper)
  return wrapper
}

function mountDepartmentReports() {
  return mount(DepartmentReports, {
    global: {
      stubs: {
        'el-card': { template: '<div><slot name="header" /><slot /></div>' },
        'el-date-picker': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input type="month" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'el-select': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
        },
        'el-option': {
          props: ['label', 'value'],
          template: '<option :value="value">{{ label }}</option>',
        },
        'el-button': {
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
        'el-alert': { template: '<div><slot /></div>' },
        'el-table': { props: ['data'], template: '<table><slot /></table>' },
        'el-table-column': { template: '<td></td>' },
      },
    },
  })
}

describe('DepartmentReports.vue', () => {
  let originalCreateObjectURL
  let originalRevokeObjectURL
  let createObjectURLSpy
  let revokeObjectURLSpy
  let createElementSpy
  let realCreateElement

  beforeEach(async () => {
    vi.clearAllMocks()
    apiFetch.mockReset()
    window.sessionStorage.setItem('employeeId', 'sup1')
    window.sessionStorage.setItem('role', 'supervisor')
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        department: { _id: 'dept1', name: '研發部' },
      }),
    })
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { _id: 'dept1', name: '研發部' },
        { _id: 'dept2', name: '客服部' },
      ],
    })
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'tpl-attendance',
          name: '出勤統計',
          type: 'attendance',
          exportSettings: { formats: ['excel', 'pdf'] },
          permissionSettings: { supervisorDept: true },
        },
        {
          id: 'tpl-leave',
          name: '請假統計',
          type: 'leave',
          exportSettings: { formats: ['pdf'] },
          permissionSettings: { supervisorDept: true },
        },
      ],
    })
    apiFetch.mockResolvedValue(emptyPreviewResponse())

    originalCreateObjectURL = window.URL.createObjectURL
    if (!originalCreateObjectURL) {
      window.URL.createObjectURL = () => ''
    }
    createObjectURLSpy = vi
      .spyOn(window.URL, 'createObjectURL')
      .mockReturnValue('blob:mock')

    originalRevokeObjectURL = window.URL.revokeObjectURL
    if (!originalRevokeObjectURL) {
      window.URL.revokeObjectURL = () => {}
    }
    revokeObjectURLSpy = vi
      .spyOn(window.URL, 'revokeObjectURL')
      .mockImplementation(() => {})

    realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const element = realCreateElement(tag)
      if (tag === 'a') {
        element.click = vi.fn()
      }
      return element
    })
  })

  afterEach(() => {
    while (mountedWrappers.length) mountedWrappers.pop().unmount()
    window.sessionStorage.clear()
    createObjectURLSpy?.mockRestore()
    revokeObjectURLSpy?.mockRestore()
    createElementSpy?.mockRestore()
    if (!originalCreateObjectURL) {
      delete window.URL.createObjectURL
    } else {
      window.URL.createObjectURL = originalCreateObjectURL
    }
    if (!originalRevokeObjectURL) {
      delete window.URL.revokeObjectURL
    } else {
      window.URL.revokeObjectURL = originalRevokeObjectURL
    }
  })

  it('匯出成功時下載檔案', async () => {
    const { ElMessage } = await import('element-plus')
    const wrapper = createWrapper()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/octet-stream' },
      blob: async () => new Blob(['excel']),
    })

    wrapper.vm.selectedMonth = '2024-05'
    wrapper.vm.selectedDepartment = 'dept1'
    wrapper.vm.reportType = 'attendance'
    wrapper.vm.exportFormat = 'excel'

    await wrapper.vm.exportReport()

    expect(apiFetch).toHaveBeenLastCalledWith(
      '/api/reports/department/attendance/export?month=2024-05&department=dept1&format=excel',
      expect.objectContaining({ headers: { Accept: 'application/octet-stream' } })
    )
    expect(window.URL.createObjectURL).toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('匯出成功')
  })

  it('顯示 JSON 預覽摘要', async () => {
    const wrapper = createWrapper()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        summary: { scheduled: 10, attended: 9, absent: 1 },
        records: [
          { name: '王小明', scheduled: 5, attended: 4, absent: 1 },
          { name: '李小華', scheduled: 5, attended: 5, absent: 0 },
        ],
      }),
    })

    wrapper.vm.selectedMonth = '2024-05'
    wrapper.vm.selectedDepartment = 'dept1'

    await wrapper.vm.handlePreview()

    expect(apiFetch).toHaveBeenLastCalledWith(
      '/api/reports/department/attendance/export?month=2024-05&department=dept1&format=json',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    )
    expect(wrapper.vm.preview.state).toBe('success')
    expect(wrapper.vm.preview.records.length).toBe(2)
    expect(wrapper.vm.summaryItems.length).toBeGreaterThan(0)
    // 舊版伺服器沒有請假天數：不顯示那一欄（不會顯示成 0）
    expect(wrapper.vm.dynamicColumns.map((column) => column.label)).toEqual(['排班天數', '出勤天數', '缺勤天數'])
    expect(wrapper.vm.summaryItems.map((item) => item.label)).toEqual(['排班總計', '出勤總計', '缺勤總計'])
    expect(wrapper.vm.summaryNote).toBe('')
  })

  // 出勤統計帶 onLeave（請假）：排班 − 出勤 − 請假 = 缺勤 在畫面上對得起來，欄位順序與匯出檔一致
  it('出勤統計顯示請假天數與請假總計，還沒開始的班另外說明', async () => {
    const wrapper = createWrapper()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        summary: { scheduled: 12, attended: 7, onLeave: 2, absent: 1 },
        records: [
          { name: '王小明', scheduled: 6, attended: 3, onLeave: 2, absent: 1 },
          { name: '李小華', scheduled: 6, attended: 4, onLeave: 0, absent: 0 },
        ],
      }),
    })
    wrapper.vm.selectedMonth = '2024-05'
    wrapper.vm.selectedDepartment = 'dept1'
    await wrapper.vm.handlePreview()
    await flushPromises()

    expect(wrapper.vm.dynamicColumns.map((column) => column.label)).toEqual(['排班天數', '出勤天數', '請假天數', '缺勤天數'])
    expect(wrapper.vm.summaryItems).toEqual([
      { label: '排班總計', value: 12 },
      { label: '出勤總計', value: 7 },
      { label: '請假總計', value: 2 },
      { label: '缺勤總計', value: 1 },
    ])
    // 12 − 7 − 2 − 1 = 2 天的班還沒開始
    expect(wrapper.vm.summaryNote).toBe('另有 2 天的班還沒開始，不計入缺勤')
    expect(wrapper.find('[data-test="report-summary-note"]').text()).toContain('另有 2 天的班還沒開始')
  })

  it('補休報表的欄位與匯出檔一致（結束日期、假別、存入調休的筆數與時數）', async () => {
    const wrapper = createWrapper()
    await flushPromises()
    wrapper.vm.reportTemplates = [
      { id: 'tpl-comp', name: '補休申請統計', type: 'compTime', exportSettings: { formats: ['excel'] }, permissionSettings: { supervisorDept: true } },
    ]
    await flushPromises()

    apiFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        summary: { totalRequests: 1, totalHours: 8, earnedCredits: 2, earnedHours: 16 },
        records: [
          { name: '王小明', date: '2024-05-06', endDate: '2024-05-06', leaveType: '調休', hours: 8, overtimeReference: '2024/02/10 春節' },
        ],
      }),
    })
    wrapper.vm.selectedMonth = '2024-05'
    wrapper.vm.selectedDepartment = 'dept1'
    wrapper.vm.reportType = 'compTime'
    await wrapper.vm.handlePreview({ force: true })
    await flushPromises()

    expect(wrapper.vm.dynamicColumns.map((column) => column.label)).toEqual(['日期', '結束日期', '假別', '補休時數', '來源（調休額度／加班單）'])
    expect(wrapper.vm.summaryItems.map((item) => item.label)).toEqual(['補休申請數', '補休總時數', '本月存入調休筆數', '本月存入調休時數'])
  })

  it('預覽失敗時顯示錯誤訊息', async () => {
    const { ElMessage } = await import('element-plus')
    const wrapper = createWrapper()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({
      ok: false,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'Forbidden' }),
    })

    wrapper.vm.selectedMonth = '2024-05'
    wrapper.vm.selectedDepartment = 'dept1'

    await wrapper.vm.handlePreview()

    // 伺服器回的是英文的 Forbidden：畫面顯示中文原因
    expect(ElMessage.error).toHaveBeenCalledWith('您沒有權限查看這個部門的報表')
    expect(wrapper.vm.preview.state).toBe('idle')
  })
  it('依後端模板限制報表與匯出格式', async () => {
    const wrapper = createWrapper()
    await flushPromises()

    expect(wrapper.vm.availableReportOptions.map((opt) => opt.value)).toEqual([
      'attendance',
      'leave',
    ])
    expect(wrapper.vm.reportType).toBe('attendance')
    expect(wrapper.vm.availableExportFormats.map((opt) => opt.value)).toEqual(['excel', 'pdf'])
    expect(wrapper.vm.exportFormat).toBe('excel')

    wrapper.vm.reportType = 'leave'
    await flushPromises()

    expect(wrapper.vm.availableExportFormats.map((opt) => opt.value)).toEqual(['pdf'])
    expect(wrapper.vm.exportFormat).toBe('pdf')
  })
})
