import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '../src/api'
import LeaveRequestHint from '../src/components/LeaveRequestHint.vue'

const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
const statusOf = (years) => ({
  years: years.map(([year, state]) => ({ year, state, migrated: false, approvedAt: null, followGovernmentAdjustments: false, synthetic: false })),
  provisional: years.some(([, state]) => state !== 'approved'),
  provisionalYears: years.filter(([, state]) => state !== 'approved').map(([year]) => year),
  lastApprovedDate: null,
})

const mountHint = (props = {}) => mount(LeaveRequestHint, { props, global: { plugins: [ElementPlus] } })
async function settle() {
  await vi.advanceTimersByTimeAsync(400)
  await flushPromises()
}

describe('LeaveRequestHint: company calendar not yet approved', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 台灣 2026-10-21 中午
    vi.setSystemTime(new Date('2026-10-21T04:00:00.000Z'))
    apiFetch.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('warns when the leave reaches a year whose company calendar is not approved', async () => {
    apiFetch.mockResolvedValue(jsonResponse(statusOf([[2026, 'approved'], [2027, 'draft']])))
    const wrapper = mountHint({ endDate: '2027-01-05' })
    await settle()

    expect(apiFetch).toHaveBeenCalledWith('/api/holiday-calendar/status?from=2026-10-21&to=2027-01-05')
    const alert = wrapper.find('[data-test="leave-calendar-provisional"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('請假期間涵蓋 2027 年，公司行事曆尚未核定，國定假日可能調整')
    expect(wrapper.html()).toContain('el-alert--info')
  })

  it('shows nothing when every year is approved, and caches the answer per year', async () => {
    apiFetch.mockResolvedValue(jsonResponse(statusOf([[2026, 'approved']])))
    const wrapper = mountHint({ endDate: '2026-11-03' })
    await settle()
    expect(wrapper.find('[data-test="leave-calendar-provisional"]').exists()).toBe(false)

    await wrapper.setProps({ endDate: '2026-12-01' })
    await settle()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('reads the Taipei day of a date-time value and waits until the user stops changing it', async () => {
    apiFetch.mockResolvedValue(jsonResponse(statusOf([[2026, 'draft']])))
    const wrapper = mountHint({ endDate: null })
    await wrapper.setProps({ endDate: new Date('2026-12-30T16:00:00.000Z') }) // 台灣 12/31
    await wrapper.setProps({ endDate: new Date('2026-12-31T15:59:00.000Z') })
    await settle()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/holiday-calendar/status?from=2026-10-21&to=2026-12-31')
    expect(wrapper.find('[data-test="leave-calendar-provisional"]').text()).toContain('2026 年')
  })

  it('does not ask for a leave in the past, and stays quiet when the server cannot answer', async () => {
    const past = mountHint({ endDate: '2026-08-14' })
    await settle()
    expect(apiFetch).not.toHaveBeenCalled()
    expect(past.find('[data-test="leave-calendar-provisional"]').exists()).toBe(false)

    apiFetch.mockResolvedValue(jsonResponse({ error: 'bad range' }, 400))
    const failed = mountHint({ endDate: '2027-02-01' })
    await settle()
    expect(failed.find('[data-test="leave-calendar-provisional"]').exists()).toBe(false)

    apiFetch.mockRejectedValue(new Error('offline'))
    const offline = mountHint({ endDate: '2027-03-01' })
    await settle()
    expect(offline.find('[data-test="leave-calendar-provisional"]').exists()).toBe(false)
  })

  it('keeps the balance hint and adds the calendar note below it', async () => {
    apiFetch.mockResolvedValue(jsonResponse(statusOf([[2026, 'approved'], [2027, 'none']])))
    const items = [{ key: 'personal', name: '事假', aliases: [], period: 'year', enforcement: 'warn', quotaHours: 112, usedHours: 0, pendingHours: 0, remainingHours: 112, availableHours: 112, source: 'policy', status: 'ok' }]
    const wrapper = mountHint({ items, typeText: '事假', hours: 8, endDate: '2027-01-04' })
    await settle()
    expect(wrapper.find('[data-test="leave-request-hint"]').text()).toContain('事假')
    expect(wrapper.find('[data-test="leave-calendar-provisional"]').text()).toContain('2027 年')
  })
})
