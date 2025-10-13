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


function createWrapper() {
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
  let supervisorTemplates

  beforeEach(async () => {
    vi.clearAllMocks()
    apiFetch.mockReset()
    window.sessionStorage.setItem('employeeId', 'sup1')
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
    supervisorTemplates = [
      {
        id: 'tpl-attendance',
        name: '出勤統計',
        type: 'attendance',
        exportSettings: { formats: ['excel'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-leave',
        name: '請假統計',
        type: 'leave',
        exportSettings: { formats: ['excel', 'pdf'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-tardiness',
        name: '遲到統計',
        type: 'tardiness',
        exportSettings: { formats: ['excel'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-early',
        name: '早退統計',
        type: 'earlyLeave',
        exportSettings: { formats: ['excel'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-work-hours',
        name: '工時統計',
        type: 'workHours',
        exportSettings: { formats: ['excel'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-overtime',
        name: '加班申請統計',
        type: 'overtime',
        exportSettings: { formats: ['pdf'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-comp-time',
        name: '補休申請統計',
        type: 'compTime',
        exportSettings: { formats: ['pdf'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-make-up',
        name: '補打卡統計',
        type: 'makeUp',
        exportSettings: { formats: ['excel'] },
        permissionSettings: { supervisorDept: true },
      },
      {
        id: 'tpl-special-leave',
        name: '特休統計',
        type: 'specialLeave',
        exportSettings: { formats: ['excel'] },
        permissionSettings: { supervisorDept: true },
      },
    ]

    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => supervisorTemplates,
    })

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

  it('針對九種主管報表匯出呼叫正確端點', async () => {
    const wrapper = createWrapper()
    await flushPromises()

    wrapper.vm.selectedMonth = '2024-05'
    wrapper.vm.selectedDepartment = 'dept1'

    const expectations = [
      { type: 'attendance', format: 'excel', endpoint: '/api/reports/department/attendance/export' },
      { type: 'leave', format: 'pdf', endpoint: '/api/reports/department/leave/export' },
      { type: 'tardiness', format: 'excel', endpoint: '/api/reports/department/tardiness/export' },
      { type: 'earlyLeave', format: 'excel', endpoint: '/api/reports/department/early-leave/export' },
      { type: 'workHours', format: 'excel', endpoint: '/api/reports/department/work-hours/export' },
      { type: 'overtime', format: 'pdf', endpoint: '/api/reports/department/overtime/export' },
      { type: 'compTime', format: 'pdf', endpoint: '/api/reports/department/comp-time/export' },
      { type: 'makeUp', format: 'excel', endpoint: '/api/reports/department/make-up/export' },
      { type: 'specialLeave', format: 'excel', endpoint: '/api/reports/department/special-leave/export' },
    ]

    for (const item of expectations) {
      apiFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/octet-stream' },
        blob: async () => new Blob(['data']),
      })

      wrapper.vm.reportType = item.type
      await flushPromises()
      wrapper.vm.exportFormat = item.format

      await wrapper.vm.exportReport()

      expect(apiFetch).toHaveBeenLastCalledWith(
        `${item.endpoint}?month=2024-05&department=dept1&format=${item.format}`,
        expect.objectContaining({ headers: { Accept: 'application/octet-stream' } })
      )
    }
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

    expect(ElMessage.error).toHaveBeenCalledWith('Forbidden')
    expect(wrapper.vm.preview.state).toBe('idle')
  })
  it('依後端模板限制報表與匯出格式', async () => {
    const wrapper = createWrapper()
    await flushPromises()

    const optionValues = wrapper.vm.availableReportOptions.map((opt) => opt.value)
    expect(optionValues).toEqual([
      'attendance',
      'leave',
      'tardiness',
      'earlyLeave',
      'workHours',
      'overtime',
      'compTime',
      'makeUp',
      'specialLeave',
    ])
    expect(wrapper.vm.reportType).toBe('attendance')
    expect(wrapper.vm.availableExportFormats.map((opt) => opt.value)).toEqual(['excel'])
    expect(wrapper.vm.exportFormat).toBe('excel')

    wrapper.vm.reportType = 'leave'
    await flushPromises()

    expect(wrapper.vm.availableExportFormats.map((opt) => opt.value)).toEqual(['excel', 'pdf'])
    expect(wrapper.vm.exportFormat).toBe('excel')

    wrapper.vm.reportType = 'overtime'
    await flushPromises()

    expect(wrapper.vm.availableExportFormats.map((opt) => opt.value)).toEqual(['pdf'])
    expect(wrapper.vm.exportFormat).toBe('pdf')
  })
})
