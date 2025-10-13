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
