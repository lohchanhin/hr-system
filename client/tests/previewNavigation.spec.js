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

  it.each([
    ['週表', PreviewWeek],
    ['月表', PreviewMonth]
  ])('%s預覽顯示員工每天的班別代碼，表格在自己的區塊內捲動', (_label, component) => {
    sessionStorage.setItem('schedulePreview', previewPayload)
    const wrapper = mount(component)

    expect(wrapper.find('[data-test="preview-empty"]').exists()).toBe(false)
    expect(wrapper.find('.preview-scroll table').exists()).toBe(true)
    const cells = wrapper.findAll('tbody td').map(cell => cell.text())
    expect(cells).toEqual(['測試員工', '早班'])

    wrapper.unmount()
  })

  // 直接開啟網址、或暫存內容損壞時（以前 JSON.parse 會丟錯，整頁空白）
  it.each([
    ['週表', PreviewWeek, null],
    ['月表', PreviewMonth, null],
    ['週表', PreviewWeek, '{broken'],
    ['月表', PreviewMonth, '{broken']
  ])('%s預覽沒有資料或資料損壞時顯示說明，仍可返回排班', async (_label, component, stored) => {
    if (stored !== null) sessionStorage.setItem('schedulePreview', stored)
    const wrapper = mount(component)

    expect(wrapper.find('[data-test="preview-empty"]').text()).toContain('沒有可預覽的排班資料')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.get('button.back-button').trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'Schedule' })

    wrapper.unmount()
  })
})
