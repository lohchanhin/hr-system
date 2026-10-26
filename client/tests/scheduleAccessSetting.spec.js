import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// 其他控制設定 > 排班權限：讀取與儲存 scheduleAccessMode，切成「只有排班人員」前要先確認
const messageBox = vi.hoisted(() => ({ confirm: vi.fn() }))
const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return { ...actual, ElMessage: message, ElMessageBox: messageBox }
})
vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '../src/api'
import ScheduleAccessSetting from '../src/components/backComponents/ScheduleAccessSetting.vue'

const ok = body => Promise.resolve({ ok: true, json: async () => body })

beforeEach(() => {
  apiFetch.mockReset()
  messageBox.confirm.mockReset()
  message.success.mockReset()
  message.error.mockReset()
})

describe('ScheduleAccessSetting.vue', () => {
  it('loads the stored mode', async () => {
    apiFetch.mockImplementation(() => ok({ mode: 'scheduler_only' }))
    const wrapper = mount(ScheduleAccessSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/other-control-settings/schedule-access', { method: 'GET' }, { autoRedirect: false })
    expect(wrapper.vm.mode).toBe('scheduler_only')
    expect(wrapper.vm.loaded).toBe(true)
  })

  it('asks before cutting supervisors off, and saves only after confirming', async () => {
    apiFetch.mockImplementation((url, options) => (
      options?.method === 'PUT' ? ok({ mode: JSON.parse(options.body).mode }) : ok({ mode: 'supervisor_and_scheduler' })
    ))
    const wrapper = mount(ScheduleAccessSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    wrapper.vm.mode = 'scheduler_only'
    messageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    await wrapper.vm.save()
    expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)

    messageBox.confirm.mockResolvedValueOnce()
    await wrapper.vm.save()
    const put = apiFetch.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ mode: 'scheduler_only' })
    expect(wrapper.vm.savedMode).toBe('scheduler_only')
    expect(message.success).toHaveBeenCalled()
  })

  it('switches back to the default without a confirmation', async () => {
    apiFetch.mockImplementation((url, options) => (
      options?.method === 'PUT' ? ok({ mode: 'supervisor_and_scheduler' }) : ok({ mode: 'scheduler_only' })
    ))
    const wrapper = mount(ScheduleAccessSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.mode = 'supervisor_and_scheduler'
    await wrapper.vm.save()
    expect(messageBox.confirm).not.toHaveBeenCalled()
    expect(wrapper.vm.savedMode).toBe('supervisor_and_scheduler')
  })

  it('does not allow saving when the setting could not be read', async () => {
    apiFetch.mockImplementation(() => Promise.resolve({ ok: false, json: async () => ({}) }))
    const wrapper = mount(ScheduleAccessSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.find('[data-test="schedule-access-load-alert"]').exists()).toBe(true)
    await wrapper.vm.save()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})
