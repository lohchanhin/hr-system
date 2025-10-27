import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import * as apiModule from '../../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
  utils: {
    sheet_to_json: vi.fn(() => [])
  },
  writeFile: vi.fn()
}), { virtual: true })

vi.mock('element-plus', () => {
  const success = vi.fn()
  const error = vi.fn()
  const warning = vi.fn()
  const confirm = vi.fn(() => Promise.resolve())
  const alert = vi.fn(() => Promise.resolve())
  return {
    ElMessage: {
      success,
      error,
      warning
    },
    ElMessageBox: {
      confirm,
      alert
    }
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

import EmployeeManagement from '../EmployeeManagement.vue'

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
    ElMessageBox.confirm.mockClear()
    ElMessageBox.alert.mockClear()
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

    const alertText = wrapper.find('.el-alert-stub').text()
    expect(alertText).toContain('範本內建的 5 筆示範資料')

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
    const csvContent = blobCalls[0].parts[0]
    const rows = csvContent.trim().split('\n')
    expect(rows.length).toBe(7)
    const [headerRow, descriptionRow, ...sampleRows] = rows
    expect(sampleRows.length).toBe(5)
    expect(headerRow).toContain('employeeId')
    expect(headerRow).toContain('email')
    expect(descriptionRow).toContain('員工編號 (必填)')
    expect(descriptionRow).toContain('姓名 (必填)')
    expect(descriptionRow).toContain('電子郵件 (必填唯一)')
    expect(descriptionRow).toContain('性別 (M=男, F=女, O=其他)')
    expect(sampleRows[0]).toContain('EMP-0001')
    expect(sampleRows[0]).toContain('import.hr001@example.com')
    expect(sampleRows[4]).toContain('EMP-0005')
    expect(sampleRows[4]).toContain('import.hr005@example.com')

    createElementSpy.mockRestore()
    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
    clickSpy.mockRestore()
    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
    window.Blob = originalBlob
  })

  it('使用範本示範資料可完成預覽匯入流程', async () => {
    const wrapper = await mountComponent()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const csvContent = wrapper.vm.buildBulkImportTemplateCsvContent()
    const samplePreview = [
      {
        employeeNo: 'EMP-0001',
        name: '王曉明',
        department: 'HR001',
        role: 'employee',
        email: 'import.hr001@example.com'
      },
      {
        employeeNo: 'EMP-0002',
        name: '林語彤',
        department: 'NUR101',
        role: 'employee',
        email: 'import.hr002@example.com'
      }
    ]

    importEmployeesBulkMock.mockImplementation(async formData => {
      const uploadedFile = formData.get('file')
      expect(uploadedFile).toBeTruthy()
      const uploadedText = await uploadedFile.text()
      expect(uploadedText).toContain('EMP-0001')
      expect(uploadedText).toContain('import.hr005@example.com')
      expect(JSON.parse(formData.get('valueMappings'))).toEqual({
        organization: {},
        department: {},
        subDepartment: {}
      })
      expect(JSON.parse(formData.get('ignore'))).toEqual({
        organization: [],
        department: [],
        subDepartment: []
      })
      const response = createApiResponse({ preview: samplePreview, errors: [] })
      const originalJson = response.json.bind(response)
      response.json = async () => {
        const data = await originalJson()
        expect(data.preview).toEqual(samplePreview)
        return data
      }
      return response
    })
    const file = new File([csvContent], 'employee-import-template.csv', { type: 'text/csv' })
    wrapper.vm.handleBulkImportFileChange({ name: 'employee-import-template.csv', raw: file })

    wrapper.vm.bulkImportPreview = samplePreview
    ElMessage.warning.mockClear()

    await wrapper.vm.submitBulkImport()
    await flushPromises()

    expect(importEmployeesBulkMock).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.bulkImportErrors).toEqual([])
    expect(wrapper.vm.bulkImportPreview).toEqual(samplePreview)
    expect(wrapper.vm.bulkImportDialogVisible).toBe(true)
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

    ElMessage.warning.mockClear()

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
    const valueMappingEntry = entries.find(([key]) => key === 'valueMappings')
    expect(valueMappingEntry).toBeTruthy()
    expect(JSON.parse(valueMappingEntry[1])).toEqual({
      organization: {},
      department: {},
      subDepartment: {}
    })
    const ignoreEntry = entries.find(([key]) => key === 'ignore')
    expect(ignoreEntry).toBeTruthy()
    expect(JSON.parse(ignoreEntry[1])).toEqual({
      organization: [],
      department: [],
      subDepartment: []
    })

    expect(ElMessage.success).toHaveBeenCalledWith('匯入成功')
    expect(ElMessage.warning).not.toHaveBeenCalled()

    const afterEmployeeCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === '/api/employees'
    ).length
    expect(afterEmployeeCalls).toBeGreaterThan(beforeEmployeeCalls)
    expect(wrapper.vm.bulkImportDialogVisible).toBe(true)
    expect(wrapper.vm.bulkImportPreview).toEqual(previewRows)
    expect(wrapper.vm.bulkImportErrors).toEqual([])
  })

  it('匯入成功後保留預覽，使用者確認關閉才會重置狀態', async () => {
    const previewRows = [
      { employeeNo: 'E0003', name: '李小青', department: '資訊部', role: 'employee', email: 'it@example.com' }
    ]
    importEmployeesBulkMock.mockResolvedValue(
      createApiResponse({ preview: previewRows, errors: [] })
    )

    const wrapper = await mountComponent()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const file = new File(['測試匯入'], 'employees.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    wrapper.vm.handleBulkImportFileChange({ name: 'employees.xlsx', raw: file })

    ElMessage.warning.mockClear()

    await wrapper.vm.submitBulkImport()
    await flushPromises()

    expect(wrapper.vm.bulkImportDialogVisible).toBe(true)
    expect(wrapper.vm.bulkImportPreview).toEqual(previewRows)

    ElMessageBox.confirm.mockResolvedValueOnce()
    await wrapper.vm.handleBulkImportDialogCancel()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '關閉後將清除目前的匯入檔案、預覽與對應設定，確定要離開？',
      '確認關閉匯入',
      expect.objectContaining({
        type: 'warning',
        confirmButtonText: '確認關閉',
        cancelButtonText: '繼續編輯'
      })
    )
    expect(wrapper.vm.bulkImportDialogVisible).toBe(false)
    expect(wrapper.vm.bulkImportPreview).toEqual([])
    expect(wrapper.vm.bulkImportErrors).toEqual([])
    expect(wrapper.vm.bulkImportUploadFileList).toEqual([])
    expect(wrapper.vm.bulkImportFile).toBeNull()
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

  it('匯入時若缺少參照會開啟對應視窗並可重新提交', async () => {
    const missingResponse = {
      message: '缺少對應資料',
      missingReferences: {
        department: {
          values: [{ value: '人資部', normalizedValue: '人資部', rows: [3] }],
          options: [{ id: 'dep1', name: '人資部 HR', code: 'HR001' }]
        }
      },
      errors: []
    }

    importEmployeesBulkMock
      .mockResolvedValueOnce(createApiResponse(missingResponse, 409))
      .mockResolvedValueOnce(createApiResponse({ preview: [], errors: [] }))

    const wrapper = await mountComponent()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const file = new File(['mapping'], 'employees.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    wrapper.vm.handleBulkImportFileChange({ name: 'employees.xlsx', raw: file })

    await wrapper.vm.submitBulkImport()
    await flushPromises()

    expect(wrapper.vm.referenceMappingDialogVisible).toBe(true)
    const pending = wrapper.vm.referenceMappingPending.department
    expect(pending).toHaveLength(1)
    const entry = pending[0]
    const key = wrapper.vm.getReferenceEntryKey(entry)
    expect(wrapper.vm.referenceMappingSelections.department[key].mode).toBe('map')
    wrapper.vm.referenceMappingSelections.department[key].targetId = 'dep1'

    await wrapper.vm.confirmReferenceMappings()
    await flushPromises()

    expect(importEmployeesBulkMock).toHaveBeenCalledTimes(2)
    const secondFormData = importEmployeesBulkMock.mock.calls[1][0]
    const mappedPayload = JSON.parse(secondFormData.get('valueMappings'))
    const ignorePayload = JSON.parse(secondFormData.get('ignore'))
    expect(mappedPayload.department[key]).toBe('dep1')
    expect(ignorePayload.department).toEqual([])
    expect(wrapper.vm.referenceMappingDialogVisible).toBe(false)
  })

  it('匯入時缺少多種參照類型可顯示並送出新類型的對應', async () => {
    const missingResponse = {
      message: '缺少對應資料',
      missingReferences: {
        department: {
          values: [{ value: '人資部', normalizedValue: '人資部', rows: [2] }],
          options: [{ id: 'dep1', name: '人資部 HR', code: 'HR001' }]
        },
        team: {
          values: [{ value: 'A班', rows: [2, 4] }],
          options: [
            { id: 'team1', name: 'Alpha班', code: 'T001' },
            { id: 'team2', name: 'B班' }
          ]
        }
      },
      errors: []
    }

    importEmployeesBulkMock
      .mockResolvedValueOnce(createApiResponse(missingResponse, 409))
      .mockResolvedValueOnce(createApiResponse({ preview: [], errors: [] }))

    const wrapper = await mountComponent()
    await wrapper.find('[data-test="bulk-import-button"]').trigger('click')

    const file = new File(['mapping'], 'employees.csv', { type: 'text/csv' })
    wrapper.vm.handleBulkImportFileChange({ name: 'employees.csv', raw: file })

    await wrapper.vm.submitBulkImport()
    await flushPromises()

    expect(wrapper.vm.referenceMappingDialogVisible).toBe(true)
    const keyList = Array.isArray(wrapper.vm.referenceMappingKeys)
      ? wrapper.vm.referenceMappingKeys
      : wrapper.vm.referenceMappingKeys?.value
    expect(Array.isArray(keyList)).toBe(true)
    expect(keyList).toContain('team')

    const departmentEntry = wrapper.vm.referenceMappingPending.department[0]
    const departmentKey = wrapper.vm.getReferenceEntryKey(departmentEntry)
    const teamEntry = wrapper.vm.referenceMappingPending.team[0]
    const teamKey = wrapper.vm.getReferenceEntryKey(teamEntry)

    expect(wrapper.vm.referenceMappingSelections.team[teamKey].mode).toBe('map')
    expect(wrapper.vm.referenceMappingOptions.team.map(opt => opt.id)).toContain('team1')

    wrapper.vm.referenceMappingSelections.department[departmentKey].targetId = 'dep1'
    wrapper.vm.referenceMappingSelections.team[teamKey].targetId = 'team1'

    await wrapper.vm.confirmReferenceMappings()
    await flushPromises()

    expect(importEmployeesBulkMock).toHaveBeenCalledTimes(2)
    const secondFormData = importEmployeesBulkMock.mock.calls[1][0]
    const valuePayload = JSON.parse(secondFormData.get('valueMappings'))
    const ignorePayload = JSON.parse(secondFormData.get('ignore'))

    expect(valuePayload.department[departmentKey]).toBe('dep1')
    expect(valuePayload.team[teamKey]).toBe('team1')
    expect(ignorePayload.team).toEqual([])
    expect(wrapper.vm.referenceMappingDialogVisible).toBe(false)
  })
})
