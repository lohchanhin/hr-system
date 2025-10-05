import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import OtherControlSetting from '../OtherControlSetting.vue'
import * as apiModule from '../../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

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
      confirm: vi.fn()
    }
  }
})

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-alert': { template: '<div><slot /></div>' },
  'el-select': { template: '<div><slot /></div>' },
  'el-option': { template: '<div><slot /></div>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div><slot :$index="0" :row="{}" /></div>' },
  'el-dialog': { template: '<div><slot /><slot name="footer" /></div>', props: ['modelValue'] },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div><slot /></div>' },
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] }
}

async function mountComponent() {
  const wrapper = shallowMount(OtherControlSetting, {
    global: {
      stubs: elementStubs
    }
  })
  await flushPromises()
  return wrapper
}

describe('OtherControlSetting - saveItemSettings', () => {
  let apiFetchMock

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessage.warning.mockClear()
    ElMessageBox.confirm.mockReset()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  it('送出扁平結構的字典項目並顯示成功訊息', async () => {
    const serverResponse = { saved: true, itemSettings: { TEST: [] } }
    apiFetchMock.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PUT') {
        return new Response(JSON.stringify(serverResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({ itemSettings: {}, customFields: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    const wrapper = await mountComponent()

    const nextItemSettings = {
      TEST: [
        { name: '測試職稱', code: 'TEST_ROLE' }
      ]
    }
    wrapper.vm.itemSettings = nextItemSettings

    const result = await wrapper.vm.saveItemSettings('字典項目設定已更新')

    const putCall = apiFetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(putCall).toBeTruthy()
    expect(putCall[1]).toMatchObject({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextItemSettings)
    })
    expect(putCall[2]).toEqual({ autoRedirect: false })

    expect(result).toEqual(serverResponse)
    expect(ElMessage.success).toHaveBeenCalledWith('字典項目設定已更新')
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('處理儲存失敗並提示錯誤訊息', async () => {
    apiFetchMock.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PUT') {
        return new Response('', { status: 500 })
      }
      return new Response(JSON.stringify({ itemSettings: {}, customFields: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    const wrapper = await mountComponent()

    const result = await wrapper.vm.saveItemSettings('字典項目設定已更新')

    expect(result).toBe(false)
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('儲存字典項目時發生問題，請稍後再試')
  })
})

describe('OtherControlSetting - custom fields', () => {
  let apiFetchMock

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessage.warning.mockClear()
    ElMessageBox.confirm.mockReset()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  const mockInitialResponse = customFields =>
    new Response(
      JSON.stringify({ itemSettings: {}, customFields }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  it('新增自訂欄位時會送出完整清單並顯示成功訊息', async () => {
    const existingFields = [
      {
        label: '現有欄位',
        fieldKey: 'existingField',
        type: 'text',
        category: 'profile',
        group: '基本資料',
        required: false,
        description: '已存在的欄位'
      }
    ]
    const newField = {
      label: '緊急聯絡人',
      fieldKey: 'emergencyContact',
      type: 'text',
      category: 'profile',
      group: '聯絡資訊',
      required: true,
      description: '員工緊急聯絡資訊'
    }

    apiFetchMock.mockImplementation((path, options = {}) => {
      if (path === '/api/other-control-settings' && options.method === 'GET') {
        return Promise.resolve(mockInitialResponse(existingFields))
      }
      if (path === '/api/other-control-settings/custom-fields' && options.method === 'PUT') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    const wrapper = await mountComponent()

    Object.assign(wrapper.vm.fieldForm, newField)
    wrapper.vm.fieldDialogVisible = true

    await wrapper.vm.saveField()

    const putCall = apiFetchMock.mock.calls.find(
      ([requestPath]) => requestPath === '/api/other-control-settings/custom-fields'
    )

    expect(putCall).toBeTruthy()
    expect(putCall[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    })
    expect(putCall[2]).toEqual({ autoRedirect: false })

    const payload = JSON.parse(putCall[1].body)
    expect(payload.customFields).toHaveLength(existingFields.length + 1)
    expect(payload.customFields.at(-1)).toEqual(newField)

    expect(wrapper.vm.customFields).toHaveLength(existingFields.length + 1)
    expect(ElMessage.success).toHaveBeenCalledWith('已更新自訂欄位')
    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(wrapper.vm.fieldDialogVisible).toBe(false)
  })

  it('新增自訂欄位失敗時會還原資料並提示錯誤訊息', async () => {
    const existingFields = [
      {
        label: '現有欄位',
        fieldKey: 'existingField',
        type: 'text',
        category: 'profile',
        group: '基本資料',
        required: false,
        description: '已存在的欄位'
      }
    ]

    apiFetchMock.mockImplementation((path, options = {}) => {
      if (path === '/api/other-control-settings' && options.method === 'GET') {
        return Promise.resolve(mockInitialResponse(existingFields))
      }
      if (path === '/api/other-control-settings/custom-fields' && options.method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify({ message: '後端錯誤' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    const wrapper = await mountComponent()

    Object.assign(wrapper.vm.fieldForm, {
      label: '生日',
      fieldKey: 'birthday',
      type: 'date',
      category: 'profile',
      group: '個人資訊',
      required: false,
      description: ''
    })
    wrapper.vm.fieldDialogVisible = true

    const beforeSave = JSON.parse(JSON.stringify(wrapper.vm.customFields))
    await wrapper.vm.saveField()

    expect(JSON.parse(JSON.stringify(wrapper.vm.customFields))).toEqual(beforeSave)
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('後端錯誤')
    expect(wrapper.vm.fieldDialogVisible).toBe(true)
  })

  it('刪除自訂欄位時會送出完整清單並顯示成功訊息', async () => {
    const existingFields = [
      {
        label: '欄位一',
        fieldKey: 'fieldOne',
        type: 'text',
        category: 'profile',
        group: '基本資料',
        required: false,
        description: '第一個欄位'
      },
      {
        label: '欄位二',
        fieldKey: 'fieldTwo',
        type: 'select',
        category: 'profile',
        group: '基本資料',
        required: true,
        description: '第二個欄位'
      }
    ]

    apiFetchMock.mockImplementation((path, options = {}) => {
      if (path === '/api/other-control-settings' && options.method === 'GET') {
        return Promise.resolve(mockInitialResponse(existingFields))
      }
      if (path === '/api/other-control-settings/custom-fields' && options.method === 'PUT') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    ElMessageBox.confirm.mockResolvedValueOnce()

    const wrapper = await mountComponent()

    await wrapper.vm.removeField(0)

    const putCall = apiFetchMock.mock.calls.find(
      ([requestPath]) => requestPath === '/api/other-control-settings/custom-fields'
    )

    expect(putCall).toBeTruthy()
    expect(putCall[1]).toMatchObject({ method: 'PUT' })
    const payload = JSON.parse(putCall[1].body)
    expect(payload.customFields).toHaveLength(existingFields.length - 1)
    expect(payload.customFields[0]).toEqual(existingFields[1])
    expect(ElMessage.success).toHaveBeenCalledWith('已刪除自訂欄位')
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('刪除自訂欄位失敗時會還原資料並提示錯誤訊息', async () => {
    const existingFields = [
      {
        label: '欄位一',
        fieldKey: 'fieldOne',
        type: 'text',
        category: 'profile',
        group: '基本資料',
        required: false,
        description: '第一個欄位'
      },
      {
        label: '欄位二',
        fieldKey: 'fieldTwo',
        type: 'select',
        category: 'profile',
        group: '基本資料',
        required: true,
        description: '第二個欄位'
      }
    ]

    apiFetchMock.mockImplementation((path, options = {}) => {
      if (path === '/api/other-control-settings' && options.method === 'GET') {
        return Promise.resolve(mockInitialResponse(existingFields))
      }
      if (path === '/api/other-control-settings/custom-fields' && options.method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify({ message: '刪除失敗' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    ElMessageBox.confirm.mockResolvedValueOnce()

    const wrapper = await mountComponent()

    const beforeRemove = JSON.parse(JSON.stringify(wrapper.vm.customFields))
    await wrapper.vm.removeField(0)

    expect(JSON.parse(JSON.stringify(wrapper.vm.customFields))).toEqual(beforeRemove)
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('刪除失敗')
  })
})
