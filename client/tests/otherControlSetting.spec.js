import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import OtherControlSetting from '../src/components/backComponents/OtherControlSetting.vue'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

describe('OtherControlSetting custom field defaults', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    global.ElMessage = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })

  it('initializes dictionary fields for C03~C14 with expected types', async () => {
    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const keyTypeMap = Object.fromEntries(wrapper.vm.customFields.map(field => [field.fieldKey, field.type]))
    const requiredCodes = [
      'C03',
      'C04',
      'C05',
      'C06',
      'C07',
      'C08',
      'C09',
      'C10',
      'C11_name',
      'C11_content',
      'C11_timeRange',
      'C11_paidBreak',
      'C11_allowFlexTime',
      'C11_flexWindow',
      'C12',
      'C13',
      'C14'
    ]

    expect(Object.keys(keyTypeMap)).toEqual(expect.arrayContaining(requiredCodes))
    expect(keyTypeMap.C03).toBe('select')
    expect(keyTypeMap.C05).toBe('composite')
    expect(keyTypeMap.C11_timeRange).toBe('timeRange')
    expect(keyTypeMap.C11_paidBreak).toBe('boolean')
    expect(keyTypeMap.C11_flexWindow).toBe('number')
    expect(keyTypeMap.C12).toBe('select')
    expect(keyTypeMap.C14).toBe('select')
  })

  it('dictionaryDefinitions covers C03~C14 with correct labels', async () => {
    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const expectedPairs = [
      { key: 'C03', label: '職稱' },
      { key: 'C04', label: '執業職稱' },
      { key: 'C05', label: '語言能力' },
      { key: 'C06', label: '身障等級' },
      { key: 'C07', label: '身分類別' },
      { key: 'C08', label: '教育程度' },
      { key: 'C09', label: '緊急聯絡人稱謂' },
      { key: 'C10', label: '教育訓練積分類別' },
      { key: 'C11', label: '班別設定' },
      { key: 'C12', label: '假別類別' },
      { key: 'C13', label: '加班原因' },
      { key: 'C14', label: '津貼項目' }
    ]

    expect(wrapper.vm.dictionaryDefinitions).toEqual(expect.arrayContaining(expectedPairs))
  })

  it('renders dictionary select options with proper labels for C08 以後', async () => {
    const wrapper = mount(OtherControlSetting, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()

    const trigger = wrapper.find('.dictionary-select .el-select__wrapper')
    await trigger.trigger('click')
    await flushPromises()

    const dropdownItems = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
    const optionTexts = dropdownItems.map(item => item.textContent?.trim())
    const expectedLabels = [
      'C08 教育程度',
      'C09 緊急聯絡人稱謂',
      'C10 教育訓練積分類別',
      'C11 班別設定',
      'C12 假別類別',
      'C13 加班原因',
      'C14 津貼項目'
    ]

    expect(optionTexts).toEqual(expect.arrayContaining(expectedLabels))

    wrapper.unmount()
  })

  it('supports extended field type options when adding a new field', async () => {
    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const typeValues = wrapper.vm.fieldTypeOptions.map(option => option.value)
    expect(typeValues).toEqual(expect.arrayContaining(['number', 'timeRange', 'boolean', 'composite']))

    wrapper.vm.openFieldDialog()
    wrapper.vm.fieldForm.label = '測試數字欄位'
    wrapper.vm.fieldForm.fieldKey = 'testNumberField'
    wrapper.vm.fieldForm.type = 'number'
    await wrapper.vm.saveField()

    const created = wrapper.vm.customFields.find(field => field.fieldKey === 'testNumberField')
    expect(created).toBeTruthy()
    expect(created.type).toBe('number')
  })

  it('createDefaultItemSettings 會涵蓋所有字典並保持 name/code 結構', async () => {
    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const defaults = wrapper.vm.createDefaultItemSettings()
    const dictionaryKeys = wrapper.vm.dictionaryDefinitions.map(dict => dict.key)

    expect(Object.keys(defaults)).toEqual(expect.arrayContaining(dictionaryKeys))
    dictionaryKeys.forEach(key => {
      expect(Array.isArray(defaults[key])).toBe(true)
      defaults[key].forEach(option => {
        expect(typeof option.name).toBe('string')
        expect(typeof option.code).toBe('string')
      })
    })
  })

  it('loadSettings 會將字串選項正規化為 name/code 物件', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        itemSettings: {
          C03: ['行政專員', '總務']
        }
      })
    })

    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.vm.itemSettings.C03).toEqual([
      { name: '行政專員', code: '行政專員' },
      { name: '總務', code: '總務' }
    ])
  })

  it('loadSettings 會保留物件屬性並填滿 name/code 欄位', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        itemSettings: {
          C04: [
            { label: '臨床藥師', value: 'CLINIC_PHARM' },
            { name: '物理治療師', code: 'PHYS_THER' }
          ]
        }
      })
    })

    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.vm.itemSettings.C04[0]).toMatchObject({
      label: '臨床藥師',
      value: 'CLINIC_PHARM',
      name: '臨床藥師',
      code: 'CLINIC_PHARM'
    })
    expect(wrapper.vm.itemSettings.C04[1]).toEqual({ name: '物理治療師', code: 'PHYS_THER' })
  })
})
