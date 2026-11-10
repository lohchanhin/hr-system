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
    const requiredCodes = ['C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C12', 'C14']

    expect(Object.keys(keyTypeMap)).toEqual(expect.arrayContaining(requiredCodes))
    expect(keyTypeMap.C03).toBe('select')
    expect(keyTypeMap.C05).toBe('composite')
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
      { key: 'C12', label: '假別類別' },
      { key: 'C14', label: '津貼項目' }
    ]

    expect(wrapper.vm.dictionaryDefinitions).toEqual(expect.arrayContaining(expectedPairs))
  })

  // 2026/11：選字典改成左邊的名稱清單（以前是右上角的下拉選單，選項是「C08 教育程度」）
  it('lists every dictionary by its name for C08 以後, and shows the chosen one with where it is used', async () => {
    const wrapper = mount(OtherControlSetting, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()

    const names = wrapper.findAll('[data-test="dictionary-list"] .dictionary-item__name').map(item => item.text())
    const expectedLabels = [
      '教育程度',
      '緊急聯絡人稱謂',
      '教育訓練積分類別',
      '假別類別',
      '津貼項目'
    ]
    expect(names).toEqual(expect.arrayContaining(expectedLabels))
    // 第一個字典預設選取
    expect(wrapper.find('[data-test="dictionary-title"]').text()).toBe('職稱')

    await wrapper.find('[data-test="dictionary-item-C12"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="dictionary-title"]').text()).toBe('假別類別')
    expect(wrapper.find('[data-test="dictionary-item-C12"]').classes()).toContain('is-active')
    expect(wrapper.find('[data-test="dictionary-usage"]').text()).toBe('用在：簽核表單裡連結這個字典的下拉欄位（例如請假單的假別）；代碼 C12')

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

  it('載入設定失敗時以真實 Element Plus 顯示警告與重新載入，並停用新增 / 儲存，重新載入成功後恢復', async () => {
    apiFetch.mockImplementation(url => {
      if (url === '/api/other-control-settings') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    const wrapper = mount(OtherControlSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.vm.settingsLoaded).toBe(false)
    const alert = wrapper.find('.load-alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('載入失敗')
    const retry = wrapper.find('[data-test="reload-settings"]')
    expect(retry.text()).toBe('重新載入')
    const addFieldButton = wrapper.findAll('button').find(button => button.text() === '新增欄位')
    expect(addFieldButton.attributes('disabled')).toBeDefined()

    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => ({}) }))
    await retry.trigger('click')
    await flushPromises()

    expect(wrapper.vm.settingsLoaded).toBe(true)
    expect(wrapper.find('.load-alert').exists()).toBe(false)
    expect(wrapper.findAll('button').find(button => button.text() === '新增欄位').attributes('disabled')).toBeUndefined()
  })
})
