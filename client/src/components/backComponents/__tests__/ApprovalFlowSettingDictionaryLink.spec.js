import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { computed, defineComponent, h, inject, nextTick, provide } from 'vue'
import { ElMessage } from 'element-plus'
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

// 讓 el-table-column 的 slot 依 el-table 的 data 逐列渲染，才能驗證表格內的標籤
const ElTableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    provide('stubTableRows', computed(() => props.data || []))
    return () => h('table', slots.default?.())
  }
})
const ElTableColumnStub = defineComponent({
  setup(_, { slots }) {
    const rows = inject('stubTableRows', computed(() => []))
    return () => h('div', (rows.value || []).map((row, index) => slots.default?.({ row, $index: index })))
  }
})

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-select': { template: '<select><slot /></select>' },
  'el-option': { template: '<option><slot /></option>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-table': ElTableStub,
  'el-table-column': ElTableColumnStub,
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

// 與伺服器預設值相同的字典類自訂欄位與字典項目
const C12_CUSTOM_FIELD = {
  label: '假別類別 (C12)',
  fieldKey: 'C12',
  type: 'select',
  category: 'dictionary',
  group: '假別設定',
  required: true,
  description: '維護假別類別與對應設定'
}
const UNIFORM_CUSTOM_FIELD = {
  label: '制服尺寸',
  fieldKey: 'uniformSize',
  type: 'select',
  category: 'employee',
  required: false,
  options: ['S', 'M', 'L']
}
const LEAVE_TYPES = ['特休假', '病假', '事假']

describe('ApprovalFlowSetting - 套用字典類自訂欄位（連結字典）', () => {
  let apiFetchMock
  let fieldRows
  let itemSettingsResponse
  // 寫入類請求（POST / PUT / DELETE）的回應，預設成功；失敗情境的測試會覆寫
  let writeResponse

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  function mockApis({ customFields = [C12_CUSTOM_FIELD, UNIFORM_CUSTOM_FIELD] } = {}) {
    const forms = [{ _id: 'form1', name: '休假/事假/公假申請單（人事類-出勤標準）', category: '人事類', is_active: true, semanticType: 'general' }]
    const categories = [{ id: 'cat-personnel', name: '人事類', code: '人事類', description: '', builtin: true }]

    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (method === 'GET') {
        if (path === '/api/other-control-settings') return Promise.resolve(json({ customFields }))
        if (path === '/api/other-control-settings/item-settings') return Promise.resolve(itemSettingsResponse())
        if (path === '/api/other-control-settings/form-categories') return Promise.resolve(json(categories))
        if (path === '/api/approvals/forms') return Promise.resolve(json(forms))
        if (path === '/api/approvals/forms/form1/workflow') return Promise.resolve(json({ policy: {} }))
        if (path === '/api/approvals/forms/form1/fields') return Promise.resolve(json(fieldRows))
        if (path === '/api/employees/options') return Promise.resolve(json([]))
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(writeResponse(method, path))
    })
  }

  function lastBody(method, path) {
    const calls = apiFetchMock.mock.calls.filter(([p, opts]) => p === path && opts?.method === method)
    expect(calls.length).toBeGreaterThan(0)
    return JSON.parse(calls[calls.length - 1][1].body)
  }

  async function mountFieldsTab() {
    const wrapper = await mountComponent()
    wrapper.vm.activeTab = 'fields'
    wrapper.vm.selectedFormId = 'form1'
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    fieldRows = []
    itemSettingsResponse = () => json({ C12: [...LEAVE_TYPES], C14: ['交通補助'] })
    writeResponse = () => new Response('', { status: 200 })
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  it('載入欄位與字典項目：字典類自訂欄位沒有 options，字典項目另外讀取', async () => {
    mockApis()
    const wrapper = await mountComponent()

    const c12 = wrapper.vm.customFieldOptions.find(opt => opt.value === 'C12')
    expect(c12.field.category).toBe('dictionary')
    expect(c12.field.options).toBeUndefined()
    expect(apiFetchMock.mock.calls.some(([path]) => path === '/api/other-control-settings/item-settings')).toBe(true)
    expect(wrapper.vm.dictionaryItems.C12).toEqual([
      { name: '特休假', code: '特休假' },
      { name: '病假', code: '病假' },
      { name: '事假', code: '事假' }
    ])
  })

  it('選擇「假別類別 (C12)」會連結字典：帶入欄位設定、唯讀預覽字典項目、儲存 field_key 與快照', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    await nextTick()

    expect(wrapper.vm.fieldDialog).toMatchObject({
      field_key: 'C12',
      label: '假別類別 (C12)',
      type_1: 'select',
      required: true,
      dictionaryLinked: true,
      dictionaryLabel: '假別類別 (C12)'
    })
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假\n事假')

    const textarea = wrapper.find('[data-test="field-options"]')
    expect(textarea.exists()).toBe(true)
    expect(textarea.attributes('disabled')).toBeDefined()
    const hint = wrapper.find('[data-test="dictionary-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('選項即時使用字典「假別類別 (C12)」，修改字典後立即生效')
    expect(hint.text()).toContain('解除連結，改手動輸入')

    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    expect(body).toMatchObject({
      field_key: 'C12',
      label: '假別類別 (C12)',
      type_1: 'select',
      required: true,
      options: ['特休假', '病假', '事假']
    })
  })

  it('字典沒有項目時仍可連結，預覽為空且不送出快照', async () => {
    itemSettingsResponse = () => json({ C12: [] })
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')

    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(true)
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('')

    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    expect(body.field_key).toBe('C12')
    expect(body).not.toHaveProperty('options')
  })

  it('字典項目 API 失敗時不影響載入，連結後預覽為空', async () => {
    itemSettingsResponse = () => new Response('', { status: 500 })
    mockApis()
    const wrapper = await mountComponent()

    expect(wrapper.vm.dictionaryItems).toEqual({})
    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(true)
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('')
  })

  it('字典項目回傳 { itemSettings } 包裝或物件項目時也能正規化', async () => {
    itemSettingsResponse = () => json({
      itemSettings: {
        C12: [{ name: '特休假', code: 'A' }, { label: '病假', value: 'B' }, '病假', '  ', { name: '' }]
      }
    })
    mockApis()
    const wrapper = await mountComponent()

    expect(wrapper.vm.dictionaryItems.C12).toEqual([
      { name: '特休假', code: 'A' },
      { name: '病假', code: 'B' }
    ])
    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假')
  })

  it('開啟欄位視窗時重新讀取字典，唯讀預覽會更新', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假\n事假')

    // 字典在別處新增了「公假」：重新開窗並套用後立即反映
    itemSettingsResponse = () => json({ C12: [...LEAVE_TYPES, '公假'] })
    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    await flushPromises()

    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假\n事假\n公假')
    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(true)
  })

  it('解除連結：清除 field_key、選項可編輯並保留目前字典項目，儲存為手動選項', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    await nextTick()
    expect(wrapper.find('[data-test="unlink-dictionary"]').exists()).toBe(true)

    await wrapper.find('[data-test="unlink-dictionary"]').trigger('click')
    await nextTick()

    expect(wrapper.vm.fieldDialog.field_key).toBe('')
    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(false)
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假\n事假')
    expect(wrapper.vm.selectedCustomFieldKey).toBe('')
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="dictionary-hint"]').exists()).toBe(false)

    wrapper.vm.fieldDialog.optionsStr = '休假\n事假\n公假'
    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    // 新增欄位明確解除連結時也要送出空的 field_key，否則伺服器會依標籤尾端的 (C12) 再次自動連結
    expect(body.field_key).toBe('')
    expect(body.options).toEqual(['休假', '事假', '公假'])
  })

  it('清除「套用自訂欄位」選擇等同解除連結並保留目前項目', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    wrapper.vm.handleCustomFieldSelect('')
    await nextTick()

    expect(wrapper.vm.fieldDialog.field_key).toBe('')
    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(false)
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假\n事假')
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeUndefined()
  })

  it('非字典類自訂欄位維持原本的一次性複製選項，且選項可編輯', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('uniformSize')
    await nextTick()

    expect(wrapper.vm.fieldDialog).toMatchObject({
      field_key: 'uniformSize',
      label: '制服尺寸',
      type_1: 'select',
      dictionaryLinked: false
    })
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('S\nM\nL')
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="dictionary-hint"]').exists()).toBe(false)

    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    expect(body).toMatchObject({ field_key: 'uniformSize', options: ['S', 'M', 'L'] })
  })

  it('先連結字典再改選非字典類自訂欄位，會回到手動選項', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    wrapper.vm.handleCustomFieldSelect('uniformSize')
    await nextTick()

    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(false)
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('S\nM\nL')
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeUndefined()
  })

  it('連結字典後把型別改成非下拉欄位時，選項恢復可編輯', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    expect(wrapper.vm.fieldDialogLinked).toBe(true)

    wrapper.vm.fieldDialog.type_1 = 'text'
    await nextTick()
    expect(wrapper.vm.fieldDialogLinked).toBe(false)
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeUndefined()
  })

  it('編輯伺服器已連結的欄位（dictionaryKey）時以連結狀態開啟，並改用即時字典項目', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()
    // 字典新增了「公假」，欄位資料裡的選項還是舊的
    itemSettingsResponse = () => json({ C12: [...LEAVE_TYPES, '公假'] })
    await wrapper.vm.loadDictionaryItems()

    const row = {
      _id: 'f1',
      label: '假別類別 (C12)',
      type_1: 'select',
      type_2: '',
      required: true,
      field_key: '',
      dictionaryKey: 'C12',
      optionsSource: 'dictionary',
      options: LEAVE_TYPES.map(name => ({ label: name, value: name })),
      order: 0
    }
    wrapper.vm.openFieldDialog('edit', row)
    await flushPromises()

    expect(wrapper.vm.fieldDialog).toMatchObject({
      field_key: 'C12',
      dictionaryLinked: true,
      dictionaryLabel: '假別類別 (C12)'
    })
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('特休假\n病假\n事假\n公假')
    expect(wrapper.vm.selectedCustomFieldKey).toBe('C12')
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="dictionary-hint"]').text()).toContain('「假別類別 (C12)」')

    await wrapper.vm.saveField()
    const body = lastBody('PUT', '/api/approvals/forms/form1/fields/f1')
    expect(body).toMatchObject({
      field_key: 'C12',
      options: ['特休假', '病假', '事假', '公假']
    })
  })

  it('編輯已連結欄位後解除連結再儲存，會送出空的 field_key 清除連結', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog('edit', {
      _id: 'f1',
      label: '假別類別 (C12)',
      type_1: 'select',
      field_key: 'C12',
      dictionaryKey: 'C12',
      optionsSource: 'dictionary',
      options: LEAVE_TYPES.map(name => ({ label: name, value: name })),
      order: 0
    })
    expect(wrapper.vm.fieldDialogLinked).toBe(true)

    wrapper.vm.unlinkDictionaryField()
    await wrapper.vm.saveField()

    const body = lastBody('PUT', '/api/approvals/forms/form1/fields/f1')
    expect(body.field_key).toBe('')
    expect(body.options).toEqual(['特休假', '病假', '事假'])
  })

  it('編輯字典沒有項目而退回自身選項的欄位時，預覽使用欄位自己的選項', async () => {
    itemSettingsResponse = () => json({ C12: [] })
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog('edit', {
      _id: 'f1',
      label: '假別類別 (C12)',
      type_1: 'select',
      field_key: 'C12',
      dictionaryKey: 'C12',
      optionsSource: 'own',
      options: ['休假', '事假', '公假'],
      order: 0
    })
    await flushPromises()

    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(true)
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('休假\n事假\n公假')
  })

  it('編輯手動輸入的欄位維持原行為：選項可編輯、不是連結狀態', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog('edit', {
      _id: 'f2',
      label: '假別類別',
      type_1: 'select',
      dictionaryKey: null,
      optionsSource: 'own',
      options: ['休假', '事假', '公假'],
      order: 1
    })
    await nextTick()

    expect(wrapper.vm.fieldDialog.dictionaryLinked).toBe(false)
    expect(wrapper.vm.fieldDialog.field_key).toBe('')
    expect(wrapper.vm.fieldDialog.optionsStr).toBe('休假\n事假\n公假')
    expect(wrapper.find('[data-test="field-options"]').attributes('disabled')).toBeUndefined()

    await wrapper.vm.saveField()
    const body = lastBody('PUT', '/api/approvals/forms/form1/fields/f2')
    expect(body.options).toEqual(['休假', '事假', '公假'])
    expect(body.field_key).toBe('')
  })

  it('欄位表格對下拉 / 複選欄位顯示「字典：代碼」或「手動」，其他型別不顯示', async () => {
    fieldRows = [
      { _id: 'f1', label: '假別類別 (C12)', type_1: 'select', required: true, order: 0, field_key: '', dictionaryKey: 'C12', optionsSource: 'dictionary', options: [] },
      { _id: 'f2', label: '手動下拉', type_1: 'select', required: false, order: 1, dictionaryKey: null, optionsSource: 'own', options: ['A', 'B'] },
      { _id: 'f3', label: '津貼', type_1: 'checkbox', required: false, order: 2, field_key: 'C14', optionsSource: 'dictionary', options: [] },
      { _id: 'f4', label: '備註', type_1: 'text', required: false, order: 3, dictionaryKey: null, optionsSource: 'own' },
      { _id: 'f5', label: '舊資料下拉', type_1: 'select', required: false, order: 4, options: ['X'] }
    ]
    mockApis()
    const wrapper = await mountFieldsTab()

    const tags = wrapper.findAll('.field-source-tag').map(tag => tag.text())
    expect(tags).toEqual(['字典：C12', '手動', '字典：C14', '手動'])
  })

  it('勾選必填時不回寫連結欄位被解析過的 options，手動欄位則維持原行為', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    await wrapper.vm.updateField({
      _id: 'f1',
      label: '假別類別 (C12)',
      type_1: 'select',
      required: false,
      order: 0,
      field_key: '',
      dictionaryKey: 'C12',
      optionsSource: 'dictionary',
      options: LEAVE_TYPES.map(name => ({ label: name, value: name }))
    })
    const linkedBody = lastBody('PUT', '/api/approvals/forms/form1/fields/f1')
    expect(linkedBody).not.toHaveProperty('options')
    expect(linkedBody.required).toBe(false)

    await wrapper.vm.updateField({
      _id: 'f2',
      label: '手動下拉',
      type_1: 'select',
      required: true,
      order: 1,
      options: ['A', 'B']
    })
    const manualBody = lastBody('PUT', '/api/approvals/forms/form1/fields/f2')
    expect(manualBody.options).toEqual(['A', 'B'])
  })

  /* ---- C-1：新增視窗的「解除連結」要確實送出空的 field_key ---- */

  it('客戶情境：新增欄位套用「假別類別 (C12)」後解除連結，手動輸入的選項不會被伺服器再次自動連結', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    await nextTick()
    await wrapper.find('[data-test="unlink-dictionary"]').trigger('click')
    await nextTick()
    wrapper.vm.fieldDialog.optionsStr = '休假\n事假\n公假'

    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    expect(body).toMatchObject({
      label: '假別類別 (C12)',
      type_1: 'select',
      field_key: '',
      options: ['休假', '事假', '公假']
    })
  })

  it('新增欄位時清除「套用自訂欄位」選擇，也會送出空的 field_key', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    wrapper.vm.handleCustomFieldSelect('')
    wrapper.vm.fieldDialog.optionsStr = '休假\n事假\n公假'

    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    expect(body.field_key).toBe('')
    expect(body.options).toEqual(['休假', '事假', '公假'])
  })

  it('解除連結後又重新套用字典類自訂欄位，會恢復送出 field_key', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    wrapper.vm.unlinkDictionaryField()
    expect(wrapper.vm.fieldDialog.explicitUnlink).toBe(true)
    wrapper.vm.handleCustomFieldSelect('C12')
    expect(wrapper.vm.fieldDialog.explicitUnlink).toBe(false)

    await wrapper.vm.saveField()
    expect(lastBody('POST', '/api/approvals/forms/form1/fields')).toMatchObject({
      field_key: 'C12',
      options: ['特休假', '病假', '事假']
    })
  })

  it('重新開啟新增視窗會重設明確解除的旗標，沒有套用也沒有解除時維持舊行為（不送 field_key）', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    wrapper.vm.unlinkDictionaryField()
    expect(wrapper.vm.fieldDialog.explicitUnlink).toBe(true)

    wrapper.vm.openFieldDialog()
    expect(wrapper.vm.fieldDialog.explicitUnlink).toBe(false)
    wrapper.vm.fieldDialog.label = '假別類別 (C12)'
    wrapper.vm.fieldDialog.type_1 = 'select'
    wrapper.vm.fieldDialog.optionsStr = '休假\n事假\n公假'
    await wrapper.vm.saveField()
    const body = lastBody('POST', '/api/approvals/forms/form1/fields')
    expect(body).not.toHaveProperty('field_key')
    expect(body.options).toEqual(['休假', '事假', '公假'])
  })

  it('編輯視窗開啟時也會重設明確解除的旗標', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.handleCustomFieldSelect('C12')
    wrapper.vm.unlinkDictionaryField()

    wrapper.vm.openFieldDialog('edit', {
      _id: 'f9',
      label: '假別類別 (C12)',
      type_1: 'select',
      field_key: 'C12',
      dictionaryKey: 'C12',
      optionsSource: 'dictionary',
      options: LEAVE_TYPES.map(name => ({ label: name, value: name })),
      order: 0
    })
    expect(wrapper.vm.fieldDialog.explicitUnlink).toBe(false)
    expect(wrapper.vm.fieldDialogLinked).toBe(true)

    await wrapper.vm.saveField()
    expect(lastBody('PUT', '/api/approvals/forms/form1/fields/f9').field_key).toBe('C12')
  })

  /* ---- C-2：field_key 格式與儲存失敗提示 ---- */

  it('非字典類自訂欄位的代碼不符合伺服器格式時不送 field_key（新增）', async () => {
    const badKeys = ['contact.phone', 'phone number', '緊急電話', 'a'.repeat(41)]
    mockApis({
      customFields: badKeys.map((fieldKey, index) => ({
        label: `自訂欄位${index}`,
        fieldKey,
        type: 'select',
        category: 'employee',
        options: ['A', 'B']
      }))
    })
    const wrapper = await mountFieldsTab()

    for (const badKey of badKeys) {
      wrapper.vm.openFieldDialog()
      wrapper.vm.handleCustomFieldSelect(badKey)
      // 對話框欄位仍帶入代碼與選項，只是不送給伺服器
      expect(wrapper.vm.fieldDialog.field_key).toBe(badKey)
      expect(wrapper.vm.fieldDialog.optionsStr).toBe('A\nB')
      await wrapper.vm.saveField()
      const body = lastBody('POST', '/api/approvals/forms/form1/fields')
      expect(body, badKey).not.toHaveProperty('field_key')
      expect(body.options).toEqual(['A', 'B'])
    }
  })

  it('非字典類自訂欄位的代碼符合伺服器格式（含 40 字上限）時照送', async () => {
    const longKey = 'k'.repeat(40)
    mockApis({
      customFields: [
        { label: '長代碼', fieldKey: longKey, type: 'select', category: 'employee', options: ['A'] },
        { label: '底線連字號', fieldKey: 'emp_size-2', type: 'select', category: 'employee', options: ['A'] }
      ]
    })
    const wrapper = await mountFieldsTab()

    for (const key of [longKey, 'emp_size-2']) {
      wrapper.vm.openFieldDialog()
      wrapper.vm.handleCustomFieldSelect(key)
      await wrapper.vm.saveField()
      expect(lastBody('POST', '/api/approvals/forms/form1/fields').field_key).toBe(key)
    }
  })

  it('編輯時改套用代碼不合格式的自訂欄位，改送空的 field_key 清掉原本儲存的連結', async () => {
    mockApis({
      customFields: [
        C12_CUSTOM_FIELD,
        { label: '聯絡電話', fieldKey: 'contact.phone', type: 'select', category: 'employee', options: ['公司', '手機'] }
      ]
    })
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog('edit', {
      _id: 'f1',
      label: '假別類別 (C12)',
      type_1: 'select',
      field_key: 'C12',
      dictionaryKey: 'C12',
      optionsSource: 'dictionary',
      options: LEAVE_TYPES.map(name => ({ label: name, value: name })),
      order: 0
    })
    wrapper.vm.handleCustomFieldSelect('contact.phone')
    await wrapper.vm.saveField()

    const body = lastBody('PUT', '/api/approvals/forms/form1/fields/f1')
    expect(body.field_key).toBe('')
    expect(body.options).toEqual(['公司', '手機'])
  })

  it('儲存欄位被伺服器拒絕時顯示伺服器的錯誤並保持視窗開啟', async () => {
    mockApis({
      customFields: [{ label: '聯絡電話', fieldKey: 'contact.phone', type: 'text', category: 'employee' }]
    })
    writeResponse = () => json({ error: 'invalid field_key' }, 400)
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.fieldDialog.label = '聯絡電話'
    wrapper.vm.fieldDialog.field_key = 'bad key!'
    wrapper.vm.fieldDialog.dictionaryLinked = true
    wrapper.vm.fieldDialog.type_1 = 'select'
    const fieldLoadsBefore = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length

    await wrapper.vm.saveField()

    expect(ElMessage.error).toHaveBeenCalledTimes(1)
    expect(ElMessage.error.mock.calls[0][0]).toContain('儲存欄位失敗')
    expect(ElMessage.error.mock.calls[0][0]).toContain('invalid field_key')
    expect(wrapper.vm.fieldDialogVisible).toBe(true)
    const fieldLoadsAfter = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length
    expect(fieldLoadsAfter).toBe(fieldLoadsBefore)
  })

  it('儲存欄位失敗且伺服器沒有錯誤文字時顯示預設的中文訊息（新增與編輯都一樣）', async () => {
    mockApis()
    writeResponse = () => new Response('', { status: 500 })
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.fieldDialog.label = '備註'
    await wrapper.vm.saveField()
    expect(ElMessage.error).toHaveBeenLastCalledWith('儲存欄位失敗，請稍後再試')
    expect(wrapper.vm.fieldDialogVisible).toBe(true)

    wrapper.vm.openFieldDialog('edit', { _id: 'f2', label: '備註', type_1: 'text', order: 0 })
    await wrapper.vm.saveField()
    expect(ElMessage.error).toHaveBeenCalledTimes(2)
    expect(ElMessage.error).toHaveBeenLastCalledWith('儲存欄位失敗，請稍後再試')
    expect(wrapper.vm.fieldDialogVisible).toBe(true)
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('儲存欄位成功時關閉視窗、不顯示錯誤', async () => {
    mockApis()
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFieldDialog()
    wrapper.vm.fieldDialog.label = '備註'
    await wrapper.vm.saveField()

    expect(wrapper.vm.fieldDialogVisible).toBe(false)
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('儲存樣板失敗時顯示錯誤並保持視窗開啟，成功時照舊關閉', async () => {
    mockApis()
    writeResponse = () => json({ error: 'name is required' }, 400)
    const wrapper = await mountFieldsTab()

    wrapper.vm.openFormDialog()
    wrapper.vm.formDialog.name = '補休申請'
    await wrapper.vm.saveFormTemplate()

    expect(ElMessage.error).toHaveBeenCalledTimes(1)
    expect(ElMessage.error.mock.calls[0][0]).toContain('儲存樣板失敗')
    expect(ElMessage.error.mock.calls[0][0]).toContain('name is required')
    expect(wrapper.vm.formDialogVisible).toBe(true)

    writeResponse = () => new Response('', { status: 201 })
    ElMessage.error.mockClear()
    await wrapper.vm.saveFormTemplate()
    expect(wrapper.vm.formDialogVisible).toBe(false)
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('刪除欄位被伺服器拒絕時顯示錯誤，仍會重新讀取欄位列表', async () => {
    mockApis()
    writeResponse = () => json({ error: 'field not found' }, 404)
    const wrapper = await mountFieldsTab()
    const fieldLoadsBefore = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length

    await wrapper.vm.removeField({ _id: 'gone' })

    expect(ElMessage.error).toHaveBeenCalledTimes(1)
    expect(ElMessage.error.mock.calls[0][0]).toContain('刪除欄位失敗')
    expect(ElMessage.error.mock.calls[0][0]).toContain('field not found')
    const fieldLoadsAfter = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length
    expect(fieldLoadsAfter).toBe(fieldLoadsBefore + 1)
  })

  it('調整欄位排序失敗時顯示錯誤、停止後續請求並以伺服器順序重新讀取', async () => {
    fieldRows = [
      { _id: 'a', label: 'A', type_1: 'text', order: 0, required: false },
      { _id: 'b', label: 'B', type_1: 'text', order: 1, required: false },
      { _id: 'c', label: 'C', type_1: 'text', order: 2, required: false }
    ]
    mockApis()
    writeResponse = () => json({ error: 'boom' }, 500)
    const wrapper = await mountFieldsTab()
    const fieldLoadsBefore = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length

    await wrapper.vm.moveField(2, -1)

    const putCalls = apiFetchMock.mock.calls.filter(([, o]) => o?.method === 'PUT')
    expect(putCalls).toHaveLength(1)
    expect(ElMessage.error).toHaveBeenCalledTimes(1)
    expect(ElMessage.error.mock.calls[0][0]).toContain('調整欄位排序失敗')
    expect(ElMessage.error.mock.calls[0][0]).toContain('boom')
    const fieldLoadsAfter = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length
    expect(fieldLoadsAfter).toBe(fieldLoadsBefore + 1)
  })

  it('勾選必填被伺服器拒絕時顯示錯誤並重新讀取欄位還原開關', async () => {
    mockApis()
    writeResponse = () => new Response('', { status: 500 })
    const wrapper = await mountFieldsTab()
    const fieldLoadsBefore = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length

    await wrapper.vm.updateField({ _id: 'f1', label: '備註', type_1: 'text', required: true, order: 0 })

    expect(ElMessage.error).toHaveBeenCalledWith('更新欄位失敗，請稍後再試')
    const fieldLoadsAfter = apiFetchMock.mock.calls.filter(([p, o]) => p === '/api/approvals/forms/form1/fields' && !o?.method).length
    expect(fieldLoadsAfter).toBe(fieldLoadsBefore + 1)
  })
})

describe('ApprovalFlowSetting - 樣板的表單性質', () => {
  let apiFetchMock

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  function mockApis() {
    const forms = [{ _id: 'form1', name: '請假單', category: '請假類', is_active: true, semanticType: 'leave' }]
    const categories = [{ id: 'cat-leave', name: '請假類', code: '請假類', description: '', builtin: true }]
    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (method === 'GET') {
        if (path === '/api/other-control-settings') return Promise.resolve(json({ customFields: [] }))
        if (path === '/api/other-control-settings/form-categories') return Promise.resolve(json(categories))
        if (path === '/api/approvals/forms') return Promise.resolve(json(forms))
        if (path === '/api/approvals/forms/form1/workflow') return Promise.resolve(json({ policy: {} }))
        if (path === '/api/employees/options') return Promise.resolve(json([]))
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    })
  }

  function lastBody(method, path) {
    const calls = apiFetchMock.mock.calls.filter(([p, opts]) => p === path && opts?.method === method)
    expect(calls.length).toBeGreaterThan(0)
    return JSON.parse(calls[calls.length - 1][1].body)
  }

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    mockApis()
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  it('提供 一般 / 請假 / 加班 三個選項，新增時預設為一般', async () => {
    const wrapper = await mountComponent()

    wrapper.vm.openFormDialog()
    await nextTick()

    expect(wrapper.vm.semanticTypeOptions).toEqual([
      { value: 'general', label: '一般' },
      { value: 'leave', label: '請假' },
      { value: 'overtime', label: '加班' }
    ])
    expect(wrapper.vm.formDialog.semanticType).toBe('general')
    expect(wrapper.find('[data-test="form-semantic-type"]').exists()).toBe(true)
  })

  it('新增樣板時依名稱預設表單性質（與伺服器推斷規則一致）', async () => {
    const wrapper = await mountComponent()
    wrapper.vm.openFormDialog()

    const cases = [
      ['休假/事假/公假申請單（人事類-出勤標準）', 'leave'],
      ['請假', 'leave'],
      ['休假申請單', 'leave'],
      ['病假單', 'leave'],
      ['Leave Request', 'leave'],
      ['加班申請', 'overtime'],
      ['Overtime Request', 'overtime'],
      ['加班與休假對照', 'overtime'],
      // 名稱含假別字眼、但不是請假申請本身（保留 / 證明 / 結算）：與伺服器一樣視為一般
      ['特休保留', 'general'],
      ['特休保留申請', 'general'],
      ['年假結算', 'general'],
      ['特休結算單', 'general'],
      ['請假證明', 'general'],
      ['在職證明', 'general'],
      ['', 'general']
    ]
    for (const [name, expected] of cases) {
      wrapper.vm.formDialog.name = name
      await nextTick()
      expect(wrapper.vm.formDialog.semanticType, name).toBe(expected)
    }
  })

  it('名稱推斷與伺服器 inferSemanticType 完全一致（排除保留 / 證明 / 結算，加班優先）', async () => {
    const wrapper = await mountComponent()
    wrapper.vm.openFormDialog()

    const cases = [
      ['特休保留', 'general'],
      ['特休保留申請', 'general'],
      ['年假結算', 'general'],
      ['事假結算', 'general'],
      ['公假證明', 'general'],
      ['加班證明', 'overtime'],
      ['加班結算', 'overtime'],
      ['特休申請', 'leave'],
      ['公假申請', 'leave']
    ]
    for (const [name, expected] of cases) {
      wrapper.vm.formDialog.name = name
      await nextTick()
      expect(wrapper.vm.formDialog.semanticType, name).toBe(expected)
    }
  })

  it('新增「特休保留」樣板時 payload 的 semanticType 是 general', async () => {
    const wrapper = await mountComponent()
    wrapper.vm.openFormDialog()
    wrapper.vm.formDialog.name = '特休保留'
    await nextTick()

    await wrapper.vm.saveFormTemplate()

    expect(lastBody('POST', '/api/approvals/forms')).toMatchObject({ name: '特休保留', semanticType: 'general' })
  })

  it('管理者手動選過表單性質後，不再被名稱覆蓋', async () => {
    const wrapper = await mountComponent()
    wrapper.vm.openFormDialog()

    wrapper.vm.formDialog.name = '休假申請單'
    await nextTick()
    expect(wrapper.vm.formDialog.semanticType).toBe('leave')

    wrapper.vm.formDialog.semanticType = 'general'
    wrapper.vm.handleSemanticTypeChange()
    wrapper.vm.formDialog.name = '加班申請單'
    await nextTick()
    expect(wrapper.vm.formDialog.semanticType).toBe('general')

    // 重新開啟新增視窗後，又回到依名稱推斷
    wrapper.vm.openFormDialog()
    await nextTick()
    wrapper.vm.formDialog.name = '加班申請單'
    await nextTick()
    expect(wrapper.vm.formDialog.semanticType).toBe('overtime')
  })

  it('新增樣板時 payload 帶 semanticType', async () => {
    const wrapper = await mountComponent()
    wrapper.vm.openFormDialog()
    wrapper.vm.formDialog.name = '休假/事假/公假申請單（人事類-出勤標準）'
    await nextTick()

    await wrapper.vm.saveFormTemplate()

    const body = lastBody('POST', '/api/approvals/forms')
    expect(body).toMatchObject({
      name: '休假/事假/公假申請單（人事類-出勤標準）',
      semanticType: 'leave'
    })
  })

  it('覆寫表單性質後送出覆寫值', async () => {
    const wrapper = await mountComponent()
    wrapper.vm.openFormDialog()
    wrapper.vm.formDialog.name = '補休加班單'
    await nextTick()
    expect(wrapper.vm.formDialog.semanticType).toBe('overtime')

    wrapper.vm.formDialog.semanticType = 'leave'
    wrapper.vm.handleSemanticTypeChange()
    await wrapper.vm.saveFormTemplate()

    expect(lastBody('POST', '/api/approvals/forms').semanticType).toBe('leave')
  })

  it('編輯既有樣板顯示已儲存的表單性質，不被名稱推斷覆蓋，並隨 PUT 送出', async () => {
    const wrapper = await mountComponent()

    wrapper.vm.openFormDialog('edit', {
      _id: 'form1',
      name: '請假單',
      category: '請假類',
      is_active: true,
      semanticType: 'general',
      description: ''
    })
    await nextTick()
    expect(wrapper.vm.formDialog.semanticType).toBe('general')

    wrapper.vm.formDialog.name = '請假單（新版）'
    await nextTick()
    expect(wrapper.vm.formDialog.semanticType).toBe('general')

    await wrapper.vm.saveFormTemplate()
    const body = lastBody('PUT', '/api/approvals/forms/form1')
    expect(body.semanticType).toBe('general')
  })

  it('編輯時管理者可改成請假並送出', async () => {
    const wrapper = await mountComponent()

    wrapper.vm.openFormDialog('edit', {
      _id: 'form1',
      name: '休假/事假/公假申請單',
      category: '人事類',
      is_active: true,
      semanticType: 'general'
    })
    wrapper.vm.formDialog.semanticType = 'leave'
    wrapper.vm.handleSemanticTypeChange()
    await wrapper.vm.saveFormTemplate()

    expect(lastBody('PUT', '/api/approvals/forms/form1').semanticType).toBe('leave')
  })

  it('既有樣板是其他性質（例如調班）時保留原值，不被改成一般', async () => {
    const wrapper = await mountComponent()

    wrapper.vm.openFormDialog('edit', {
      _id: 'form2',
      name: '調班申請',
      category: '人事類',
      is_active: true,
      semanticType: 'shift_change'
    })
    await nextTick()

    expect(wrapper.vm.formDialog.semanticType).toBe('shift_change')
    expect(wrapper.vm.semanticTypeOptions.map(opt => opt.value)).toEqual(['general', 'leave', 'overtime', 'shift_change'])
    expect(wrapper.vm.semanticTypeOptions[3].label).toBe('調班')

    await wrapper.vm.saveFormTemplate()
    expect(lastBody('PUT', '/api/approvals/forms/form2').semanticType).toBe('shift_change')
  })

  it('伺服器沒有回傳 semanticType 的舊資料編輯時視為一般', async () => {
    const wrapper = await mountComponent()

    wrapper.vm.openFormDialog('edit', { _id: 'form3', name: '總務申請', category: '總務類', is_active: true })
    await nextTick()

    expect(wrapper.vm.formDialog.semanticType).toBe('general')
  })
})
