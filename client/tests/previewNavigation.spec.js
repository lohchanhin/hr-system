import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const backMock = vi.fn()
const pushMock = vi.fn()
const leaveGuards = []

vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return {
    ...actual,
    useRouter: () => ({
      back: backMock,
      push: pushMock
    }),
    onBeforeRouteLeave: cb => {
      leaveGuards.push(cb)
    }
  }
})

import PreviewWeek from '../src/views/front/PreviewWeek.vue'
import PreviewMonth from '../src/views/front/PreviewMonth.vue'

const previewPayload = JSON.stringify({
  scheduleMap: {
    emp1: {
      '2024-01-01': { shiftId: 'shift1' }
    }
  },
  employees: [{ _id: 'emp1', name: '測試員工' }],
  days: [{ date: '2024-01-01', label: '1 日' }],
  shifts: [{ _id: 'shift1', code: '早班' }]
})

const resetHistoryState = () => {
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    window.history.replaceState(null, '', window.location.href)
  }
}

describe('排班預覽返回按鈕', () => {
  beforeEach(() => {
    backMock.mockReset()
    pushMock.mockReset()
    leaveGuards.length = 0
    sessionStorage.clear()
    resetHistoryState()
  })

  afterEach(() => {
    resetHistoryState()
  })

  it('在週表預覽中可透過歷史紀錄返回上一頁', async () => {
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState({ back: '/front/schedule' }, '', window.location.href)
    }

    sessionStorage.setItem('schedulePreview', previewPayload)
    const wrapper = mount(PreviewWeek)

    await wrapper.get('button.back-button').trigger('click')

    expect(backMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('schedulePreview')).toBeNull()

    wrapper.unmount()
  })

  it('在週表預覽中若無上一頁則導回排班頁', async () => {
    sessionStorage.setItem('schedulePreview', previewPayload)
    const wrapper = mount(PreviewWeek)

    await wrapper.get('button.back-button').trigger('click')

    expect(backMock).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith({ name: 'Schedule' })
    expect(sessionStorage.getItem('schedulePreview')).toBeNull()

    wrapper.unmount()
  })

  it('離開週表預覽頁面時會清除暫存資料', () => {
    sessionStorage.setItem('schedulePreview', previewPayload)
    const wrapper = mount(PreviewWeek)

    sessionStorage.setItem('schedulePreview', 'temp')
    leaveGuards.forEach(guard => guard())

    expect(sessionStorage.getItem('schedulePreview')).toBeNull()

    wrapper.unmount()
  })

  it('在月表預覽中按鈕同樣存在並可返回', async () => {
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState({ back: '/front/schedule' }, '', window.location.href)
    }

    sessionStorage.setItem('schedulePreview', previewPayload)
    const wrapper = mount(PreviewMonth)

    const button = wrapper.get('button.back-button')
    expect(button.text()).toContain('返回排班')

    await button.trigger('click')

    expect(backMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('schedulePreview')).toBeNull()

    wrapper.unmount()
  })

  it('離開月表預覽頁面時會清除暫存資料', () => {
    sessionStorage.setItem('schedulePreview', previewPayload)
    const wrapper = mount(PreviewMonth)

    sessionStorage.setItem('schedulePreview', 'temp')
    leaveGuards.forEach(guard => guard())

    expect(sessionStorage.getItem('schedulePreview')).toBeNull()

    wrapper.unmount()
  })
})
