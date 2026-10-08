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
  'el-button': {
    template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div><slot :$index="0" :row="{}" /></div>' },
  'el-dialog': { template: '<div><slot /><slot name="footer" /></div>', props: ['modelValue'] },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div><slot /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-switch': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  },
  'el-row': { template: '<div v-bind="$attrs"><slot /></div>' },
  'el-col': { template: '<div v-bind="$attrs"><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' }
}

const defaultCategories = [
  { id: 'cat-leave', name: '請假類', code: '請假類', description: '', builtin: true },
  { id: 'cat-general', name: '總務類', code: '總務類', description: '', builtin: true }
]

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
      const method = options?.method || 'GET'
      if (path === '/api/other-control-settings/item-settings' && method === 'PUT') {
        return new Response(JSON.stringify(serverResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (path === '/api/other-control-settings' && method === 'GET') {
        return new Response(JSON.stringify({ itemSettings: {}, customFields: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (path === '/api/other-control-settings/form-categories' && method === 'GET') {
        return new Response(JSON.stringify(defaultCategories), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response('', { status: 404 })
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
      const method = options?.method || 'GET'
      if (path === '/api/other-control-settings/item-settings' && method === 'PUT') {
        return new Response('', { status: 500 })
      }
      if (path === '/api/other-control-settings' && method === 'GET') {
        return new Response(JSON.stringify({ itemSettings: {}, customFields: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (path === '/api/other-control-settings/form-categories' && method === 'GET') {
        return new Response(JSON.stringify(defaultCategories), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response('', { status: 404 })
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
      if (path === '/api/other-control-settings/form-categories' && options.method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(defaultCategories), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
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
    expect(payload.customFields[payload.customFields.length - 1]).toEqual(newField)

    expect(wrapper.vm.customFields).toHaveLength(existingFields.length + 1)
    expect(ElMessage.success).toHaveBeenCalledWith('已更新自訂欄位')
    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(wrapper.vm.fieldDialogVisible).toBe(false)
  })

  it('新增含選項的自訂欄位可透過動態列新增、排序與刪除選項', async () => {
    const existingFields = []
    const newField = {
      label: '制服尺寸',
      fieldKey: 'uniformSize',
      type: 'select',
      category: 'profile',
      group: '報到資訊',
      required: true,
      description: '提供員工選擇制服尺寸'
    }

    apiFetchMock.mockImplementation((path, options = {}) => {
      if (path === '/api/other-control-settings' && options.method === 'GET') {
        return Promise.resolve(mockInitialResponse(existingFields))
      }
      if (path === '/api/other-control-settings/custom-fields' && options.method === 'PUT') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      if (path === '/api/other-control-settings/form-categories' && options.method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(defaultCategories), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    const wrapper = await mountComponent()

    wrapper.vm.openFieldDialog()
    await flushPromises()

    Object.assign(wrapper.vm.fieldForm, newField)
    await flushPromises()

    let optionRows = wrapper.findAll('[data-test="option-row"]')
    expect(optionRows).toHaveLength(1)

    await optionRows[0].find('[data-test="option-name"]').setValue('XS')

    const addButton = wrapper.find('[data-test="add-option"]')
    await addButton.trigger('click')
    await flushPromises()
    optionRows = wrapper.findAll('[data-test="option-row"]')
    await optionRows[1].find('[data-test="option-name"]').setValue('M')

    await addButton.trigger('click')
    await flushPromises()
    optionRows = wrapper.findAll('[data-test="option-row"]')
    await optionRows[2].find('[data-test="option-name"]').setValue('L')

    const listBeforeMove = wrapper.vm.fieldForm.optionsList
    const indexOfL = listBeforeMove.findIndex(opt => opt.name === 'L')
    const indexOfM = listBeforeMove.findIndex(opt => opt.name === 'M')
    if (indexOfL > -1 && indexOfM > -1) {
      wrapper.vm.moveOptionRow(indexOfL, indexOfM - indexOfL)
      await flushPromises()
    }

    const filteredNamesAfterMove = wrapper.vm.fieldForm.optionsList
      .map(opt => opt.name)
      .filter(Boolean)
    expect(filteredNamesAfterMove[0]).toBe('XS')
    expect(filteredNamesAfterMove.indexOf('L')).toBeLessThan(
      filteredNamesAfterMove.indexOf('M')
    )

    optionRows = wrapper.findAll('[data-test="option-row"]')
    const rowToRemove = optionRows.find(row =>
      row.find('[data-test="option-name"]').element.value === 'M'
    )
    await rowToRemove.find('[data-test="remove-option"]').trigger('click')
    await flushPromises()

    await wrapper.vm.saveField()

    const putCall = apiFetchMock.mock.calls.find(
      ([requestPath]) => requestPath === '/api/other-control-settings/custom-fields'
    )

    expect(putCall).toBeTruthy()
    const payload = JSON.parse(putCall[1].body)
    const latestPayloadField = payload.customFields[payload.customFields.length - 1]
    expect(latestPayloadField.fieldKey).toBe(newField.fieldKey)
    expect(latestPayloadField.options).toEqual(['XS', 'L'])

    const latestLocalField = wrapper.vm.customFields[wrapper.vm.customFields.length - 1]
    expect(latestLocalField.fieldKey).toBe(newField.fieldKey)
    expect(latestLocalField.options).toEqual(['XS', 'L'])
    expect(ElMessage.success).toHaveBeenCalledWith('已更新自訂欄位')
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

  it('編輯含選項的自訂欄位時會保留既有選項並提交更新', async () => {
    const existingFields = [
      {
        label: '制服尺寸',
        fieldKey: 'uniformSize',
        type: 'select',
        category: 'profile',
        group: '報到資訊',
        required: true,
        description: '提供員工選擇制服尺寸',
        options: ['XS', 'S']
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

    const wrapper = await mountComponent()

    wrapper.vm.openFieldDialog(0)
    await flushPromises()

    let optionRows = wrapper.findAll('[data-test="option-row"]')
    expect(optionRows).toHaveLength(2)
    expect(wrapper.vm.fieldForm.optionsList.map(opt => opt.name)).toEqual(['XS', 'S'])

    await optionRows[0].find('[data-test="option-code"]').setValue('XS')
    await optionRows[1].find('[data-test="option-name"]').setValue('S-plus')
    await optionRows[1].find('[data-test="option-code"]').setValue('S')

    const addButton = wrapper.find('[data-test="add-option"]')
    await addButton.trigger('click')
    await flushPromises()

    optionRows = wrapper.findAll('[data-test="option-row"]')
    const lastRow = optionRows[optionRows.length - 1]
    await lastRow.find('[data-test="option-name"]').setValue('M')
    await lastRow.find('[data-test="option-code"]').setValue('M')

    await wrapper.vm.saveField()

    const putCall = apiFetchMock.mock.calls.find(
      ([requestPath]) => requestPath === '/api/other-control-settings/custom-fields'
    )

    expect(putCall).toBeTruthy()
    const payload = JSON.parse(putCall[1].body)
    expect(payload.customFields[0].options).toEqual([
      { name: 'XS', code: 'XS' },
      { name: 'S-plus', code: 'S' },
      { name: 'M', code: 'M' }
    ])
    expect(wrapper.vm.customFields[0].options).toEqual([
      { name: 'XS', code: 'XS' },
      { name: 'S-plus', code: 'S' },
      { name: 'M', code: 'M' }
    ])
    expect(ElMessage.success).toHaveBeenCalledWith('已更新自訂欄位')
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

describe('OtherControlSetting - form categories', () => {
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

  it('新增分類後會顯示成功訊息並更新列表', async () => {
    const categories = [...defaultCategories]

    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (path === '/api/other-control-settings' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ itemSettings: {}, customFields: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
      if (path === '/api/other-control-settings/form-categories' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(categories), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
      if (path === '/api/other-control-settings/form-categories' && method === 'POST') {
        const body = JSON.parse(options.body)
        const created = { id: 'cat-new', builtin: false, description: '', ...body }
        categories.push(created)
        return Promise.resolve(new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    const wrapper = await mountComponent()

    wrapper.vm.openCategoryDialog()
    wrapper.vm.categoryForm.name = '出差審核'
    wrapper.vm.categoryForm.code = 'travel'
    await wrapper.vm.saveCategory()
    await flushPromises()

    expect(ElMessage.success).toHaveBeenCalledWith('已新增分類')
    const saved = wrapper.vm.formCategories.find(cat => cat.code === 'travel')
    expect(saved).toBeTruthy()
    expect(saved.name).toBe('出差審核')
  })

  it('編輯分類時會更新現有資料', async () => {
    const categories = [...defaultCategories]

    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (path === '/api/other-control-settings' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ itemSettings: {}, customFields: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
      if (path === '/api/other-control-settings/form-categories' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(categories), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
      }
      if (path.startsWith('/api/other-control-settings/form-categories/') && method === 'PUT') {
        const id = path.split('/').pop()
        const body = JSON.parse(options.body)
        const index = categories.findIndex(cat => cat.id === id)
        if (index > -1) {
          categories[index] = { ...categories[index], ...body }
          return Promise.resolve(new Response(JSON.stringify(categories[index]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }))
        }
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })

    const wrapper = await mountComponent()

    const original = wrapper.vm.formCategories[0]
    wrapper.vm.openCategoryDialog('edit', original)
    wrapper.vm.categoryForm.name = '請假申請'
    await wrapper.vm.saveCategory()
    await flushPromises()

    expect(ElMessage.success).toHaveBeenCalledWith('已更新分類')
    expect(wrapper.vm.formCategories[0].name).toBe('請假申請')
  })
})

describe('OtherControlSetting - 設定尚未成功載入時不可覆寫已儲存的資料', () => {
  let apiFetchMock
  let warnSpy
  let settingsGet

  const NOT_LOADED_MESSAGE = '其他控制設定尚未成功載入，為避免覆蓋已儲存的資料，目前無法儲存或刪除，請先按「重新載入」'
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const SAVED_SETTINGS = {
    itemSettings: { C12: [{ name: '公假', code: 'PUBLIC' }] },
    customFields: [{ label: '制服尺寸', fieldKey: 'uniformSize', type: 'select', category: 'employee', options: ['S', 'M'] }]
  }

  const writeCalls = () =>
    apiFetchMock.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')
  const settingsGetCalls = () =>
    apiFetchMock.mock.calls.filter(([path, options]) => path === '/api/other-control-settings' && (options?.method || 'GET') === 'GET')
  const buttonsByText = (wrapper, text) => wrapper.findAll('button').filter(button => button.text() === text)

  beforeEach(() => {
    settingsGet = () => Promise.resolve(new Response('', { status: 500 }))
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (method === 'GET') {
        if (path === '/api/other-control-settings') return settingsGet()
        if (path === '/api/other-control-settings/form-categories') return Promise.resolve(json(defaultCategories))
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessage.warning.mockClear()
    ElMessageBox.confirm.mockReset()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
    warnSpy.mockRestore()
  })

  it('載入成功時 settingsLoaded 為 true、沒有警告，儲存功能照常開放', async () => {
    settingsGet = () => Promise.resolve(json({ itemSettings: {}, customFields: [] }))
    const wrapper = await mountComponent()

    expect(wrapper.vm.settingsLoaded).toBe(true)
    expect(wrapper.find('[data-test="settings-load-alert"]').exists()).toBe(false)
    expect(buttonsByText(wrapper, '儲存').every(button => button.attributes('disabled') === undefined)).toBe(true)

    expect(await wrapper.vm.saveItemSettings('已儲存')).toBeTruthy()
    expect(writeCalls()).toHaveLength(1)
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('讀取設定時回應非 2xx：settingsLoaded 維持 false，顯示警告與重新載入按鈕，但仍可閱讀預設內容', async () => {
    const wrapper = await mountComponent()

    expect(wrapper.vm.settingsLoaded).toBe(false)
    const alert = wrapper.find('[data-test="settings-load-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('載入失敗')
    expect(alert.text()).toContain('預設內容')
    expect(wrapper.find('[data-test="reload-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="reload-settings"]').text()).toBe('重新載入')
    // 頁面仍可閱讀：預設的自訂欄位與字典項目還在
    expect(wrapper.vm.customFields.length).toBeGreaterThan(0)
    expect(wrapper.vm.itemSettings.C12.length).toBeGreaterThan(0)
    // 表單分類是另一支 API，不受影響
    expect(wrapper.vm.formCategories.map(category => category.id)).toEqual(['cat-leave', 'cat-general'])
  })

  it('網路錯誤或回應不是合法 JSON 也視為載入失敗', async () => {
    settingsGet = () => Promise.reject(new Error('Failed to fetch'))
    const networkFailure = await mountComponent()
    expect(networkFailure.vm.settingsLoaded).toBe(false)
    expect(networkFailure.find('[data-test="settings-load-alert"]').exists()).toBe(true)

    settingsGet = () => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))
    const invalidBody = await mountComponent()
    expect(invalidBody.vm.settingsLoaded).toBe(false)
    expect(invalidBody.find('[data-test="settings-load-alert"]').exists()).toBe(true)
  })

  it('載入失敗時所有儲存 / 刪除路徑都被擋下並提示，不會送出任何寫入請求，本機資料也不變', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const wrapper = await mountComponent()
    const itemSettingsBefore = JSON.parse(JSON.stringify(wrapper.vm.itemSettings))
    const customFieldsBefore = JSON.parse(JSON.stringify(wrapper.vm.customFields))
    const categoriesBefore = JSON.parse(JSON.stringify(wrapper.vm.formCategories))

    wrapper.vm.optionForm = { dictionaryKey: 'C12', name: '公假', code: 'PUBLIC' }
    Object.assign(wrapper.vm.fieldForm, { label: '測試欄位', fieldKey: 'testKey', type: 'text' })
    wrapper.vm.categoryForm = { id: '', name: '出差', code: 'travel', description: '', builtin: false }

    expect(await wrapper.vm.saveItemSettings('已儲存')).toBe(false)
    await wrapper.vm.saveOption()
    await wrapper.vm.removeOption('C12', 0)
    await wrapper.vm.saveField()
    await wrapper.vm.removeField(0)
    await wrapper.vm.saveCategory()
    await wrapper.vm.removeCategory({ id: 'cat-extra', name: '其他', code: 'other', builtin: false })

    expect(writeCalls()).toHaveLength(0)
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledTimes(7)
    ElMessage.error.mock.calls.forEach(([message]) => expect(message).toBe(NOT_LOADED_MESSAGE))
    expect(JSON.parse(JSON.stringify(wrapper.vm.itemSettings))).toEqual(itemSettingsBefore)
    expect(JSON.parse(JSON.stringify(wrapper.vm.customFields))).toEqual(customFieldsBefore)
    expect(JSON.parse(JSON.stringify(wrapper.vm.formCategories))).toEqual(categoriesBefore)
  })

  it('載入失敗時停用新增 / 編輯 / 刪除 / 儲存按鈕，成功重新載入後恢復', async () => {
    const wrapper = await mountComponent()

    for (const label of ['新增選項', '新增分類', '新增欄位', '編輯', '刪除', '儲存']) {
      const buttons = buttonsByText(wrapper, label)
      expect(buttons.length, label).toBeGreaterThan(0)
      buttons.forEach(button => expect(button.attributes('disabled'), label).toBeDefined())
    }
    // 重新載入按鈕本身不能被停用
    expect(wrapper.find('[data-test="reload-settings"]').attributes('disabled')).toBeUndefined()

    settingsGet = () => Promise.resolve(json(SAVED_SETTINGS))
    await wrapper.vm.reloadSettings()
    await flushPromises()

    for (const label of ['新增選項', '新增分類', '新增欄位', '編輯', '儲存']) {
      buttonsByText(wrapper, label).forEach(button => expect(button.attributes('disabled'), label).toBeUndefined())
    }
  })

  it('按下重新載入並成功：載入已儲存的資料、清除警告、恢復儲存', async () => {
    settingsGet = () => Promise.reject(new Error('Failed to fetch'))
    const wrapper = await mountComponent()
    expect(wrapper.vm.settingsLoaded).toBe(false)
    expect(settingsGetCalls()).toHaveLength(1)

    settingsGet = () => Promise.resolve(json(SAVED_SETTINGS))
    await wrapper.find('[data-test="reload-settings"]').trigger('click')
    await flushPromises()

    expect(settingsGetCalls()).toHaveLength(2)
    expect(wrapper.vm.settingsLoaded).toBe(true)
    expect(wrapper.vm.settingsLoadFailed).toBe(false)
    expect(wrapper.find('[data-test="settings-load-alert"]').exists()).toBe(false)
    expect(wrapper.vm.itemSettings.C12).toEqual([{ name: '公假', code: 'PUBLIC' }])
    expect(wrapper.vm.customFields.map(field => field.fieldKey)).toEqual(['uniformSize'])

    const saved = await wrapper.vm.saveItemSettings('已儲存字典項目設定')
    expect(saved).toBeTruthy()
    const putCall = writeCalls()[0]
    expect(putCall[0]).toBe('/api/other-control-settings/item-settings')
    expect(JSON.parse(putCall[1].body).C12).toEqual([{ name: '公假', code: 'PUBLIC' }])
    expect(ElMessage.success).toHaveBeenCalledWith('已儲存字典項目設定')
  })

  it('重新載入仍失敗時維持封鎖與警告，之後再重試成功即可恢復', async () => {
    const wrapper = await mountComponent()

    await wrapper.vm.reloadSettings()
    expect(settingsGetCalls()).toHaveLength(2)
    expect(wrapper.vm.settingsLoaded).toBe(false)
    expect(wrapper.find('[data-test="settings-load-alert"]').exists()).toBe(true)
    expect(await wrapper.vm.saveItemSettings('已儲存')).toBe(false)
    expect(writeCalls()).toHaveLength(0)

    settingsGet = () => Promise.resolve(json(SAVED_SETTINGS))
    await wrapper.vm.reloadSettings()
    await flushPromises()
    expect(wrapper.vm.settingsLoaded).toBe(true)
    expect(wrapper.find('[data-test="settings-load-alert"]').exists()).toBe(false)
  })

  it('載入進行中（尚未成功）也不能儲存，載入成功後才開放', async () => {
    let release
    settingsGet = () => new Promise(resolve => {
      release = () => resolve(json({ itemSettings: {}, customFields: [] }))
    })
    const wrapper = shallowMount(OtherControlSetting, { global: { stubs: elementStubs } })

    expect(wrapper.vm.settingsLoaded).toBe(false)
    expect(wrapper.find('[data-test="settings-load-alert"]').exists()).toBe(false)
    expect(await wrapper.vm.saveItemSettings('已儲存')).toBe(false)
    expect(writeCalls()).toHaveLength(0)

    release()
    await flushPromises()
    expect(wrapper.vm.settingsLoaded).toBe(true)
    expect(await wrapper.vm.saveItemSettings('已儲存')).toBeTruthy()
  })
})
