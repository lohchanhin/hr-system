import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'

import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import { apiFetch } from '../src/api'
import { getToken } from '../src/utils/tokenService'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: vi.fn() }))

const stubs = {
  'el-form': true,
  'el-form-item': true,
  'el-input': true,
  'el-select': true,
  'el-option': true,
  'el-date-picker': true,
  'el-button': true,
  'el-dialog': true,
  'el-table': true,
  'el-table-column': true,
  'el-tabs': true,
  'el-tab-pane': true,
  'el-checkbox': true,
  'el-switch': true,
  'el-tag': true,
  'el-time-picker': true,
  'el-input-number': true
}

describe('ShiftScheduleSetting.vue 日期格式', () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
  })

  it('使用 YYYY/MM/DD 作為日期格式', async () => {
    const wrapper = shallowMount(ShiftScheduleSetting, { global: { stubs } })
    await Promise.resolve()
    expect(wrapper.vm.dateFormat).toBe('YYYY/MM/DD')
  })
})
