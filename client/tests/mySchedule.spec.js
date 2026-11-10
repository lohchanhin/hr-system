import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { apiFetch } from '../src/api'

const { messageMock, messageBoxMock } = vi.hoisted(() => {
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
  const box = {
    confirm: vi.fn()
  }
  return { messageMock: message, messageBoxMock: box }
})

vi.mock('element-plus', () => ({
  ElMessage: messageMock,
  ElMessageBox: messageBoxMock
}))

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({ getToken: () => localStorage.getItem('token') }))

import MySchedule from '../src/views/front/MySchedule.vue'

describe('MySchedule.vue', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    localStorage.clear()
    Object.values(messageMock).forEach(fn => fn.mockReset())
    messageBoxMock.confirm.mockReset()
    messageBoxMock.confirm.mockResolvedValue()
  })

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  it('uses selected month when loading schedules', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp1', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'init', state: 'pending_confirmation', employeeResponse: 'pending' }]
      })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
        }
      }
    })
    await flush()
    apiFetch.mockReset()
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: '1', name: '早班', code: 'A1' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ date: '2023-02-01', shiftId: '1' }]
      })
    wrapper.vm.selectedMonth = '2023-02'
    await flush()
    await flush()
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/shifts')
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/schedules/monthly?month=2023-02&employee=emp1')
    expect(wrapper.vm.schedules[0].shiftName).toBe('早班 (A1)')
    expect(wrapper.vm.schedules[0].date).toBe('2023/02/01')
    expect(wrapper.vm.schedules[0].state).toBe('draft')
  })

  // 改版後沒有逐筆勾選：「全部確認」一次確認這個月所有待確認的班表（只包含可確認的那幾筆）
  it('confirm-all targets exactly the confirmable schedules', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp2', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
        }
      }
    })

    await flush()

    const rows = [
      { _id: 'a', state: 'pending_confirmation', employeeResponse: 'pending' },
      { _id: 'b', state: 'pending_confirmation', employeeResponse: 'pending' },
      { _id: 'c', state: 'finalized', employeeResponse: 'confirmed' }
    ]
    wrapper.vm.schedules = rows
    await flush()

    expect(wrapper.vm.confirmableRows.map(row => row._id)).toEqual(['a', 'b'])

    apiFetch.mockReset()
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, count: 2, schedules: [] }) })
      .mockResolvedValue({ ok: true, json: async () => [] })

    await wrapper.vm.handleBulkConfirm()
    await flush()

    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      '/api/schedules/respond/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ scheduleIds: ['a', 'b'], response: 'confirm', note: '' })
      })
    )
  })

  it('confirms all pending schedules in bulk', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp3', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
        }
      }
    })

    await flush()

    const confirmable = [
      { _id: 'x1', state: 'pending_confirmation', employeeResponse: 'pending', responseNote: '' },
      { _id: 'x2', state: 'pending_confirmation', employeeResponse: 'pending', responseNote: '' }
    ]
    wrapper.vm.schedules = [...confirmable]
    await flush()

    apiFetch.mockReset()
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, count: 2, schedules: [] })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    await wrapper.vm.handleBulkConfirm()
    await flush()
    await flush()

    expect(messageBoxMock.confirm).toHaveBeenCalled()
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      '/api/schedules/respond/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ scheduleIds: ['x1', 'x2'], response: 'confirm', note: '' })
      })
    )
    expect(messageMock.success).toHaveBeenCalledWith('已批次確認 2 筆班表')
    // 確認後重新讀取班表（班別、本月班表各一次）
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/shifts')
    expect(apiFetch.mock.calls[2][0]).toMatch(/^\/api\/schedules\/monthly\?month=\d{4}-\d{2}&employee=emp3$/)
    expect(wrapper.vm.bulkLoading).toBe(false)
  })

  it('auto switches to next month when current month has no pending but next month has pending', async () => {
    const token = `h.${btoa(JSON.stringify({ id: 'emp4', role: 'employee' }))}.s`
    localStorage.setItem('token', token)
    const currentMonth = dayjs().format('YYYY-MM')
    const nextMonth = dayjs().add(1, 'month').format('YYYY-MM')

    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'd1', date: `${currentMonth}-02`, state: 'draft', employeeResponse: 'pending' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'n1', date: `${nextMonth}-03`, state: 'pending_confirmation', employeeResponse: 'pending' }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'n1', date: `${nextMonth}-03`, state: 'pending_confirmation', employeeResponse: 'pending' }]
      })

    const wrapper = shallowMount(MySchedule, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-date-picker': true,
          'el-tag': true,
          'el-button': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-input': { template: '<textarea />' }
        }
      }
    })

    await flush()
    await flush()
    await flush()

    expect(wrapper.vm.selectedMonth).toBe(nextMonth)
    // 畫面上的年月改用 YYYY/MM（介面規範的日期格式）
    expect(wrapper.vm.monthHint).toContain(nextMonth.replace('-', '/'))
    expect(wrapper.vm.schedules).toHaveLength(1)
    expect(wrapper.vm.schedules[0].state).toBe('pending_confirmation')
  })

  // ── 改版後的行為：月份狀態、列的內容、連點、切月份的競態、錯誤訊息 ──
  describe('status, rows and safeguards', () => {
    function mountSchedule() {
      return shallowMount(MySchedule, {
        global: {
          stubs: {
            'el-date-picker': true,
            'el-tag': true,
            'el-button': true,
            'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
            'el-input': { template: '<textarea />' }
          }
        }
      })
    }

    function login(id, role = 'employee') {
      localStorage.setItem('token', `h.${btoa(JSON.stringify({ id, role }))}.s`)
    }

    const pendingRow = id => ({ _id: id, state: 'pending_confirmation', employeeResponse: 'pending', responseNote: '' })

    it('tells the employee what the month needs from them', async () => {
      login('emp10')
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      const bannerFor = rows => {
        wrapper.vm.schedules = rows
        return wrapper.vm.scheduleBanner
      }

      expect(bannerFor([])).toBeNull()
      expect(bannerFor([{ _id: 'a', state: 'draft', employeeResponse: 'pending' }]))
        .toMatchObject({ type: 'info', title: '班表尚未發布' })
      expect(bannerFor([pendingRow('a'), pendingRow('b'), { _id: 'c', state: 'finalized', employeeResponse: 'confirmed' }]))
        .toMatchObject({ type: 'warning', title: '有 2 天待您確認' })
      expect(bannerFor([
        { _id: 'a', state: 'changes_requested', employeeResponse: 'disputed' },
        { _id: 'b', state: 'pending_confirmation', employeeResponse: 'confirmed' }
      ])).toMatchObject({ type: 'danger', title: '已對 1 天提出異議' })
      expect(bannerFor([{ _id: 'a', state: 'pending_confirmation', employeeResponse: 'confirmed' }]))
        .toMatchObject({ type: 'success', title: '已全部確認' })
      expect(bannerFor([{ _id: 'a', state: 'finalized', employeeResponse: 'confirmed' }]))
        .toMatchObject({ type: 'success', title: '本月班表已定案' })
      // 發布後被改過的那幾天會退回未發布，其他天維持已確認
      expect(bannerFor([
        { _id: 'a', state: 'draft', employeeResponse: 'pending' },
        { _id: 'b', state: 'pending_confirmation', employeeResponse: 'confirmed' }
      ])).toMatchObject({ type: 'info', title: '有 1 天調整中' })
    })

    it('builds rows sorted by date with weekday, shift time, off-day mark and Taiwan response time', async () => {
      login('emp11')
      apiFetch.mockImplementation(async (url) => {
        if (url === '/api/shifts') {
          return {
            ok: true,
            json: async () => [
              { _id: 'n', name: '夜班', code: 'N', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true },
              { _id: 'r', name: '休', code: 'R', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
              { _id: 'd', name: '早班', code: 'D', semanticType: 'work', startTime: '8:30', endTime: '17:30' }
            ]
          }
        }
        if (url.includes('month=2026-12')) {
          return {
            ok: true,
            json: async () => ({
              schedules: [
                { _id: '3', date: '2026/12/03', shiftId: 'd', state: 'pending_confirmation', publishedAt: '2026-11-10T08:13:00.000Z' },
                { _id: '2', date: '2026/12/02', shiftId: 'r' },
                {
                  _id: '1',
                  // 以 UTC 午夜儲存的班表日期：不論裝置時區都是 12/01
                  date: '2026-12-01T00:00:00.000Z',
                  shiftId: 'n',
                  state: 'changes_requested',
                  employeeResponse: 'disputed',
                  responseNote: '想換班',
                  responseAt: '2026-11-30T16:30:00.000Z'
                }
              ]
            })
          }
        }
        return { ok: true, json: async () => [] }
      })
      const wrapper = mountSchedule()
      await flush()
      wrapper.vm.selectedMonth = '2026-12'
      await flush()
      await flush()

      const rows = wrapper.vm.schedules
      expect(rows.map(row => row._id)).toEqual(['1', '2', '3'])
      expect(rows[0]).toMatchObject({
        date: '2026/12/01',
        dayText: '12/01',
        weekday: '二',
        shiftName: '夜班 (N)',
        shiftTime: '22:00–翌日 06:00',
        isOff: false,
        // 台灣時間 2026/12/01 00:30
        responseAt: '2026/12/01 00:30'
      })
      expect(rows[1]).toMatchObject({ date: '2026/12/02', weekday: '三', isOff: true, shiftTime: '', offLabel: '休息日' })
      expect(rows[2]).toMatchObject({ date: '2026/12/03', weekday: '四', shiftTime: '08:30–17:30' })
      expect(wrapper.vm.publishedAtText).toBe('2026/11/10 16:13')
      expect(wrapper.vm.resolveStatus(rows[0]).text).toBe('已提出異議')
      expect(wrapper.vm.resolveStatus(rows[1]).text).toBe('未發布')
      expect(wrapper.vm.resolveStatus(rows[2]).text).toBe('待確認')
    })

    it('keeps the newest month when responses come back out of order', async () => {
      login('emp12')
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()

      const resolvers = {}
      apiFetch.mockReset()
      apiFetch.mockImplementation((url) => {
        if (url === '/api/shifts') return Promise.resolve({ ok: true, json: async () => [] })
        const month = new URLSearchParams(url.split('?')[1]).get('month')
        return new Promise(resolve => {
          resolvers[month] = rows => resolve({ ok: true, json: async () => rows })
        })
      })
      wrapper.vm.selectedMonth = '2023-02'
      await flush()
      wrapper.vm.selectedMonth = '2023-03'
      await flush()

      resolvers['2023-03']([{ _id: 'march', date: '2023-03-01' }])
      await flush()
      resolvers['2023-02']([{ _id: 'february', date: '2023-02-01' }])
      await flush()

      expect(wrapper.vm.selectedMonth).toBe('2023-03')
      expect(wrapper.vm.schedules.map(row => row._id)).toEqual(['march'])
    })

    it('opens one confirmation and sends one request when confirm-all is tapped twice', async () => {
      login('emp13')
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      wrapper.vm.schedules = [pendingRow('p1'), pendingRow('p2')]

      let closePrompt
      messageBoxMock.confirm.mockImplementation(() => new Promise(resolve => { closePrompt = resolve }))
      apiFetch.mockReset()
      apiFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, count: 2 }) })
        .mockResolvedValue({ ok: true, json: async () => [] })

      const first = wrapper.vm.handleBulkConfirm()
      const second = wrapper.vm.handleBulkConfirm()
      await flush()
      expect(messageBoxMock.confirm).toHaveBeenCalledTimes(1)
      closePrompt()
      await Promise.all([first, second])
      await flush()

      const posts = apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST')
      expect(posts).toHaveLength(1)
    })

    it('asks for a reason next to the field before sending an objection', async () => {
      login('emp14')
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      const row = pendingRow('x1')
      wrapper.vm.schedules = [row]
      apiFetch.mockClear()

      wrapper.vm.openDispute(wrapper.vm.schedules[0])
      wrapper.vm.disputeDialog.note = '   '
      await wrapper.vm.submitDispute()
      expect(wrapper.vm.disputeDialog.error).toBe('請輸入異議原因')
      expect(apiFetch).not.toHaveBeenCalled()

      wrapper.vm.disputeDialog.note = ' 當天要回診 '
      await wrapper.vm.submitDispute()
      await flush()
      expect(apiFetch).toHaveBeenNthCalledWith(
        1,
        '/api/schedules/x1/respond',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ response: 'dispute', note: '當天要回診' })
        })
      )
      expect(messageMock.success).toHaveBeenCalledWith('異議已送出')
      expect(wrapper.vm.disputeDialog.visible).toBe(false)
    })

    it('shows the API\'s English errors in Chinese and reloads the month', async () => {
      login('emp15')
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      wrapper.vm.schedules = [pendingRow('x2')]
      apiFetch.mockReset()
      apiFetch
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'schedule not awaiting confirmation' }) })
        .mockResolvedValue({ ok: true, json: async () => [] })

      await wrapper.vm.handleConfirm(wrapper.vm.schedules[0])
      await flush()

      expect(messageMock.error).toHaveBeenCalledWith('這一天的班表目前不在待確認狀態，請重新整理後再試')
      expect(apiFetch.mock.calls.map(([url]) => url)).toContain('/api/shifts')
      expect(wrapper.vm.respondingId).toBe('')
    })

    // 回覆班表的 API 只開放員工與主管
    it('offers no confirm or objection actions to an admin account', async () => {
      login('admin1', 'admin')
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      wrapper.vm.schedules = [pendingRow('a1')]
      await flush()

      expect(wrapper.vm.canRespond).toBe(false)
      expect(wrapper.vm.scheduleBanner.message).toContain('管理員')
      expect(wrapper.find('[data-test="confirm-all"]').exists()).toBe(false)
      expect(wrapper.find('.schedule-row__actions').exists()).toBe(false)
    })

    it('reports a failed load instead of showing an empty month', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      login('emp16')
      apiFetch.mockImplementation(async (url) => (
        url === '/api/shifts'
          ? { ok: true, json: async () => [] }
          : { ok: false, json: async () => ({ error: 'boom' }) }
      ))
      const wrapper = mountSchedule()
      await flush()
      await flush()

      expect(wrapper.vm.loadError).toBe(true)
      expect(wrapper.find('[data-test="load-error"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="empty"]').exists()).toBe(false)
      consoleSpy.mockRestore()
    })
  })
})
