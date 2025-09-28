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
})
