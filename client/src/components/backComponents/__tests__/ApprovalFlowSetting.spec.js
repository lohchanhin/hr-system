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

  function mockApis(customFields) {
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
})
