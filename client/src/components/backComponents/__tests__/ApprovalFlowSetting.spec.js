import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ApprovalFlowSetting from '../ApprovalFlowSetting.vue'
import * as apiModule from '../../../api'

vi.mock('element-plus', () => {
  const success = vi.fn()
  const error = vi.fn()
  return {
    ElMessage: {
      success,
      error
    },
    ElMessageBox: {
      confirm: vi.fn()
    }
  }
})

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-select': { template: '<select><slot /></select>' },
  'el-option': { template: '<option><slot /></option>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-table': { template: '<table><slot /></table>' },
  'el-table-column': { template: '<div><slot :row="{}" :$index="0" /></div>' },
  'el-dialog': { template: '<div><slot /><slot name="footer" /></div>', props: ['modelValue'] },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div><slot /></div>' },
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-tag': { template: '<span><slot /></span>' }
}

async function mountComponent() {
  const wrapper = shallowMount(ApprovalFlowSetting, {
    global: {
      stubs: elementStubs
    }
  })
  await flushPromises()
  return wrapper
}

describe('ApprovalFlowSetting - custom field options', () => {
  let apiFetchMock

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  function mockApis(customFields, categories = [
    { id: 'cat-leave', name: '請假類', code: '請假類', description: '', builtin: true },
    { id: 'cat-general', name: '總務類', code: '總務類', description: '', builtin: true }
  ]) {
    const forms = [
      { _id: 'form1', name: '請假單', category: '請假類', is_active: true }
    ]

    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (path === '/api/other-control-settings' && method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ customFields }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }

      if (path === '/api/other-control-settings/form-categories' && method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify(categories),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }

      if (path === '/api/approvals/forms' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(forms), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }

      if (path === `/api/approvals/forms/${forms[0]._id}/workflow` && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ policy: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }

      if (path === `/api/approvals/forms/${forms[0]._id}/fields` && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }

      if (path === '/api/employees/options' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }

      if (path === '/api/roles' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }

      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        return Promise.resolve(new Response('', { status: 200 }))
      }

      return Promise.resolve(new Response('', { status: 404 }))
    })
  }

  it('載入自訂欄位選項並在選擇時帶入選項清單', async () => {
    const customFields = [
      {
        label: '制服尺寸',
        fieldKey: 'uniformSize',
        type: 'select',
        required: true,
        options: ['S', 'M', 'L']
      }
    ]

    mockApis(customFields)

    const wrapper = await mountComponent()

    expect(wrapper.vm.customFieldOptions).toHaveLength(1)
    const option = wrapper.vm.customFieldOptions[0]
    expect(option.value).toBe('uniformSize')
    expect(option.field.options).toEqual(['S', 'M', 'L'])

    wrapper.vm.activeTab = 'fields'
    wrapper.vm.selectedFormId = 'form1'
    await flushPromises()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('uniformSize')

    expect(wrapper.vm.fieldDialog.field_key).toBe('uniformSize')
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('S\nM\nL')
  })

  it('可解析字串形式的選項並維持原有資料', async () => {
    const customFields = [
      {
        label: '出差地點',
        fieldKey: 'travelLocation',
        type: 'select',
        required: false,
        optionsInput: '台北, 台中\n高雄'
      }
    ]

    mockApis(customFields)

    const wrapper = await mountComponent()

    expect(wrapper.vm.customFieldOptions).toHaveLength(1)
    const option = wrapper.vm.customFieldOptions[0]
    expect(option.field.options).toEqual(['台北', '台中', '高雄'])

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('travelLocation')

    expect(wrapper.vm.fieldDialog.optionsStr).toBe('台北\n台中\n高雄')
  })

  it('載入表單分類後提供對應標籤與預設值', async () => {
    const categories = [
      { id: 'cat-1', name: '請假流程', code: '請假類', description: '所有請假相關表單', builtin: true },
      { id: 'cat-2', name: '資產總務', code: '總務類', description: '', builtin: false }
    ]

    mockApis([], categories)

    const wrapper = await mountComponent()

    expect(wrapper.vm.categoryOptions).toHaveLength(2)
    expect(wrapper.vm.categoryOptions[0]).toMatchObject({ value: '請假類', label: '請假流程' })
    expect(wrapper.vm.categoryNameMap['請假類']).toBe('請假流程')
    expect(wrapper.vm.formDialog.category).toBe('請假類')
  })
})

describe('ApprovalFlowSetting - restore defaults', () => {
  let apiFetchMock
  let ElMessageBoxMock
  let ElMessageMock

  beforeEach(async () => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    
    // Get mocked ElMessage and ElMessageBox
    const elementPlus = await import('element-plus')
    ElMessageBoxMock = elementPlus.ElMessageBox
    ElMessageMock = elementPlus.ElMessage
    
    // Reset mocks
    ElMessageBoxMock.confirm.mockClear()
    ElMessageMock.success.mockClear()
    ElMessageMock.error.mockClear()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  function mockApis(restoreResponse = null) {
    const forms = [
      { _id: 'form1', name: '請假單', category: '請假類', is_active: true }
    ]
    const categories = [
      { id: 'cat-leave', name: '請假類', code: '請假類', description: '', builtin: true }
    ]

    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      
      if (path === '/api/approvals/restore-defaults' && method === 'POST') {
        if (restoreResponse === null) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                message: '已恢復預設簽核表單',
                count: 8,
                forms: [
                  { _id: 'new1', name: '請假' },
                  { _id: 'new2', name: '支援申請' },
                  { _id: 'new3', name: '特休保留' },
                  { _id: 'new4', name: '在職證明' },
                  { _id: 'new5', name: '離職證明' },
                  { _id: 'new6', name: '加班申請' },
                  { _id: 'new7', name: '補簽申請' },
                  { _id: 'new8', name: '獎金申請' }
                ]
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          )
        }
        return Promise.resolve(restoreResponse)
      }

      if (path === '/api/other-control-settings' && method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ customFields: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }

      if (path === '/api/other-control-settings/form-categories' && method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify(categories),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }

      if (path === '/api/approvals/forms' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(forms), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }

      if (path === `/api/approvals/forms/${forms[0]._id}/workflow` && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ policy: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }

      if (path === `/api/approvals/forms/${forms[0]._id}/fields` && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }

      if (path === '/api/employees/options' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }

      if (path === '/api/roles' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }

      return Promise.resolve(new Response('', { status: 404 }))
    })
  }

  it('should show confirmation dialog when restore button is clicked', async () => {
    mockApis()
    ElMessageBoxMock.confirm.mockResolvedValue('confirm')
    
    const wrapper = await mountComponent()
    
    await wrapper.vm.restoreDefaults()
    await flushPromises()
    
    expect(ElMessageBoxMock.confirm).toHaveBeenCalledWith(
      '確定要恢復預設值嗎？這將清除所有現有的簽核表單並建立預設表單。此操作無法復原！',
      '確認恢復預設值',
      expect.objectContaining({
        confirmButtonText: '確定',
        cancelButtonText: '取消',
        type: 'warning'
      })
    )
  })

  it('should call restore API and show success message on confirmation', async () => {
    mockApis()
    ElMessageBoxMock.confirm.mockResolvedValue('confirm')
    
    const wrapper = await mountComponent()
    
    await wrapper.vm.restoreDefaults()
    await flushPromises()
    
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/approvals/restore-defaults',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
    
    expect(ElMessageMock.success).toHaveBeenCalledWith('已恢復預設值，建立了 8 個表單樣板')
  })

  it('should not call API when user cancels confirmation', async () => {
    mockApis()
    ElMessageBoxMock.confirm.mockRejectedValue('cancel')
    
    const wrapper = await mountComponent()
    const callCountBefore = apiFetchMock.mock.calls.filter(
      call => call[0] === '/api/approvals/restore-defaults'
    ).length
    
    await wrapper.vm.restoreDefaults()
    await flushPromises()
    
    const callCountAfter = apiFetchMock.mock.calls.filter(
      call => call[0] === '/api/approvals/restore-defaults'
    ).length
    
    expect(callCountAfter).toBe(callCountBefore)
    expect(ElMessageMock.error).not.toHaveBeenCalled()
  })

  it('should show error message when restore fails', async () => {
    const errorResponse = new Response(
      JSON.stringify({ error: 'Database error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
    mockApis(errorResponse)
    ElMessageBoxMock.confirm.mockResolvedValue('confirm')
    
    const wrapper = await mountComponent()
    
    await wrapper.vm.restoreDefaults()
    await flushPromises()
    
    expect(ElMessageMock.error).toHaveBeenCalledWith('恢復失敗: Database error')
  })
})
