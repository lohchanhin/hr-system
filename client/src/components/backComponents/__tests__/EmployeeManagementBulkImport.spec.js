import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import EmployeeManagement from '../EmployeeManagement.vue'
import * as apiModule from '../../../api'
import { ElMessage } from 'element-plus'

vi.mock('element-plus', () => {
  const success = vi.fn()
  const error = vi.fn()
  const warning = vi.fn()
  return {
    ElMessage: {
      success,
      error,
      warning
    },
    ElMessageBox: {
      confirm: vi.fn(),
      alert: vi.fn()
    }
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-button': {
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-dialog': {
    template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>',
    props: ['modelValue']
  },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div class="el-form-item-stub"><slot /></div>' },
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-select': { template: '<select><slot /></select>', props: ['modelValue'] },
  'el-option': { template: '<option><slot /></option>' },
  'el-upload': { template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>' },
  'el-alert': { template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>' },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-avatar': { template: '<div class="el-avatar-stub"><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-radio-group': { template: '<div class="el-radio-group-stub"><slot /></div>' },
  'el-radio': { template: '<label class="el-radio-stub"><slot /></label>' },
  'el-date-picker': { template: '<input type="date" />', props: ['modelValue'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-table': {
    template: '<div class="el-table-stub"><slot :row="{}" :$index="0" /></div>'
  },
  'el-table-column': {
    template: '<div class="el-table-column-stub"><slot :row="{}" :$index="0" /></div>'
  }
}

function createApiResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const DEFAULT_API_PAYLOADS = {
  '/api/other-control-settings/item-settings': { itemSettings: {} },
  '/api/departments': [],
  '/api/employees': [],
  '/api/organizations': [],
  '/api/sub-departments': []
}

describe('EmployeeManagement - 批量匯入流程', () => {
  let apiFetchMock
  let importEmployeesBulkMock

  const mountComponent = async () => {
    const wrapper = shallowMount(EmployeeManagement, {
      global: {
        stubs: {
          transition: false,
          teleport: false,
          ...elementStubs
        }
      }
    })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation((path, options) => {
      const cleanPath = typeof path === 'string' ? path.split('?')[0] : path
      const payload = DEFAULT_API_PAYLOADS[cleanPath] ?? {}
      if (options?.method === 'DELETE') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      if (options?.method === 'POST' || options?.method === 'PUT') {
        return Promise.resolve(createApiResponse({}))
      }
      return Promise.resolve(createApiResponse(payload))
    })

    importEmployeesBulkMock = vi
      .spyOn(apiModule, 'importEmployeesBulk')
      .mockResolvedValue(createApiResponse({ preview: [], errors: [] }))

    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessage.warning.mockClear()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
    importEmployeesBulkMock.mockRestore()
  })

  it('點擊批量匯入按鈕會開啟匯入對話框', async () => {
    const wrapper = await mountComponent()
    ElMessage.warning.mockClear()
    expect(wrapper.vm.bulkImportDialogVisible).toBe(false)

    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    expect(wrapper.vm.bulkImportDialogVisible).toBe(true)
  })

  it('可以下載匯入範本 CSV', async () => {
    const wrapper = await mountComponent()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const originalCreateObjectURL = window.URL.createObjectURL
    const originalRevokeObjectURL = window.URL.revokeObjectURL
    const originalBlob = window.Blob

    const createObjectURLSpy = vi.fn(() => 'blob:template')
    const revokeObjectURLSpy = vi.fn()
    window.URL.createObjectURL = createObjectURLSpy
    window.URL.revokeObjectURL = revokeObjectURLSpy

    const blobCalls = []
    window.Blob = vi.fn((parts, options) => {
      blobCalls.push({ parts, options })
      return { size: parts.reduce((sum, part) => sum + String(part).length, 0), type: options?.type }
    })

    const anchor = document.createElement('a')
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor)
    const appendChildSpy = vi.spyOn(document.body, 'appendChild')
    const removeChildSpy = vi.spyOn(document.body, 'removeChild')

    await wrapper.vm.downloadBulkImportTemplate()

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(appendChildSpy).toHaveBeenCalledWith(anchor)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(removeChildSpy).toHaveBeenCalledWith(anchor)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:template')
    expect(blobCalls.length).toBe(1)
    const [headerRow, descriptionRow] = blobCalls[0].parts[0].split('\n')
    expect(headerRow).toContain('employeeId')
    expect(headerRow).toContain('email')
    expect(descriptionRow).toContain('員工編號 (必填)')
    expect(descriptionRow).toContain('姓名 (必填)')
    expect(descriptionRow).toContain('電子郵件 (必填唯一)')
    expect(descriptionRow).toContain('性別 (M=男, F=女, O=其他)')

    createElementSpy.mockRestore()
    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
    clickSpy.mockRestore()
    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
    window.Blob = originalBlob
  })

  it('匯入成功後顯示成功訊息並重新載入員工列表', async () => {
    const previewRows = [
      { employeeNo: 'E0002', name: '張小華', department: '社工部', role: 'employee', email: 'social@example.com' }
    ]
    importEmployeesBulkMock.mockResolvedValue(
      createApiResponse({ preview: previewRows, errors: [] })
    )

    const wrapper = await mountComponent()
    ElMessage.warning.mockClear()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const file = new File(['測試匯入'], 'employees.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    wrapper.vm.handleBulkImportFileChange({ name: 'employees.xlsx', raw: file })

    expect(wrapper.vm.bulkImportRequiredFieldNames).toEqual(['員工編號', '姓名', '電子郵件'])
    expect(wrapper.vm.bulkImportForm.columnMappings.employeeNo).toBe('employeeId')
    expect(wrapper.vm.bulkImportForm.columnMappings.name).toBe('name')
    expect(wrapper.vm.bulkImportForm.columnMappings.email).toBe('email')

    const beforeEmployeeCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === '/api/employees'
    ).length

    await wrapper.vm.submitBulkImport()
    await flushPromises()

    expect(importEmployeesBulkMock).toHaveBeenCalledTimes(1)
    const formData = importEmployeesBulkMock.mock.calls[0][0]
    const entries = Array.from(formData.entries())
    expect(entries.find(([key]) => key === 'file')).toBeTruthy()
    const mappingEntry = entries.find(([key]) => key === 'mappings')
    expect(mappingEntry).toBeTruthy()
    const parsedMappings = JSON.parse(mappingEntry[1])
    expect(parsedMappings.employeeNo).toBe('employeeId')
    expect(parsedMappings.name).toBe('name')
    expect(parsedMappings.email).toBe('email')

    expect(ElMessage.success).toHaveBeenCalledWith('匯入成功')
    expect(ElMessage.warning).not.toHaveBeenCalled()

    const afterEmployeeCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === '/api/employees'
    ).length
    expect(afterEmployeeCalls).toBeGreaterThan(beforeEmployeeCalls)
    expect(wrapper.vm.bulkImportDialogVisible).toBe(false)
    expect(wrapper.vm.bulkImportErrors).toEqual([])
  })

  it('匯入失敗時顯示錯誤訊息並保留錯誤清單', async () => {
    const errorPayload = { message: '格式錯誤', errors: ['第 2 列缺少姓名'] }
    importEmployeesBulkMock.mockResolvedValue(createApiResponse(errorPayload, 400))

    const wrapper = await mountComponent()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const file = new File(['錯誤'], 'employees.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    wrapper.vm.handleBulkImportFileChange({ name: 'employees.xlsx', raw: file })

    await wrapper.vm.submitBulkImport()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('格式錯誤')
    expect(wrapper.vm.bulkImportErrors).toEqual(errorPayload.errors)
    expect(wrapper.vm.bulkImportDialogVisible).toBe(true)
  })
})
