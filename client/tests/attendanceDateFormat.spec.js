import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'

import Attendance from '../src/views/front/Attendance.vue'
import { apiFetch } from '../src/api'
import { getToken } from '../src/utils/tokenService'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: vi.fn() }))

const stubs = {
  'el-table': { template: '<div><slot></slot></div>' },
  'el-table-column': true,
  'el-tag': { template: '<div><slot></slot></div>' },
  'el-dialog': { template: '<div><slot></slot></div>' },
  'el-input': true,
  'el-button': true
}

describe('Attendance.vue 日期格式', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    getToken.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  it('以 YYYY/MM/DD HH:mm:ss 儲存打卡時間，並顯示 YYYY/MM/DD 日期', async () => {
    const ts = '2024-05-01T08:00:00'
    apiFetch.mockResolvedValue({ ok: true, json: async () => [{ action: 'clockIn', timestamp: ts, remark: '' }] })

    const wrapper = shallowMount(Attendance, { global: { stubs, mocks: { ElMessage: { warning: vi.fn() } } } })
    await flush()
    expect(wrapper.vm.records[0].time).toBe(dayjs(ts).format('YYYY/MM/DD HH:mm:ss'))

    vi.useFakeTimers()
    vi.setSystemTime(new Date(ts))
    wrapper.vm.updateTime()
    expect(wrapper.vm.currentDate).toBe(dayjs(ts).format('YYYY/MM/DD dddd'))
  })
})
