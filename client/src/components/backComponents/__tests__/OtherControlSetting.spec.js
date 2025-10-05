import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import OtherControlSetting from '../OtherControlSetting.vue'
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
