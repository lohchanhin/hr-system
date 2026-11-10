import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import Attendance from '../src/views/front/Attendance.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/utils/tokenService', () => ({
  getToken: () => localStorage.getItem('token')
}))

describe('Attendance.vue availability', () => {
  const flush = () => new Promise(resolve => setTimeout(resolve))

  beforeEach(() => {
    apiFetch.mockReset()
    localStorage.clear()
    const token = `x.${btoa(JSON.stringify({ id: 'emp1', role: 'employee' }))}.y`
    localStorage.setItem('token', token)
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ actionBuffers: { clockIn: { earlyMinutes: 60, lateMinutes: 240 }, clockOut: { earlyMinutes: 240, lateMinutes: 120 } } }) })
  })

  function mountComponent() {
    return mount(Attendance, {
      global: {
        stubs: {
          'el-table': { template: '<div><slot></slot></div>' },
          'el-table-column': true,
          'el-dialog': { template: '<div><slot></slot><slot name="footer"></slot></div>' },
          'el-tooltip': { template: '<div><slot></slot></div>' },
          'el-button': { template: '<button><slot></slot></button>' },
          'el-input': { template: '<input />' }
        }
      }
    })
  }

  it('disables clock-in before allowed window and enables later', async () => {
    const wrapper = mountComponent()
    await flush()
    wrapper.vm.shiftDefinitions = [{ _id: 'shift1', startTime: '09:00', endTime: '18:00' }]
    wrapper.vm.monthlySchedules = [{ date: '2024/01/01', shiftId: 'shift1' }]
    wrapper.vm.updateAvailability(new Date('2023-12-31T23:30:00.000Z'))
    await wrapper.vm.$nextTick()
    let cards = wrapper.findAll('.punch-card')
    expect(cards[0].classes()).toContain('disabled')
    expect(cards[1].classes()).toContain('disabled')

    wrapper.vm.updateAvailability(new Date('2024-01-01T02:30:00.000Z'))
    await wrapper.vm.$nextTick()
    cards = wrapper.findAll('.punch-card')
    expect(cards[0].classes()).not.toContain('disabled')
    expect(cards[1].classes()).toContain('disabled')
  })

  it('shows a day-off notice and disables both punch cards on a day off', async () => {
    const wrapper = mountComponent()
    await flush()
    wrapper.vm.shiftDefinitions = [
      { _id: 'rest', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
    ]
    wrapper.vm.monthlySchedules = [{ date: '2024/01/01', shiftId: 'rest' }]
    // 台北時間 2024-01-01 23:30：舊的 24 小時視窗內
    wrapper.vm.updateAvailability(new Date('2024-01-01T15:30:00.000Z'))
    await wrapper.vm.$nextTick()

    const cards = wrapper.findAll('.punch-card')
    expect(cards[0].classes()).toContain('disabled')
    expect(cards[1].classes()).toContain('disabled')
    expect(wrapper.find('.day-off-notice').attributes('title')).toBe('今日為休息日，不需打卡')
    expect(wrapper.vm.clockInState.reason).toBe('今日為休息日，不需打卡')
  })

  it('does not show the day-off notice on a working day', async () => {
    const wrapper = mountComponent()
    await flush()
    wrapper.vm.shiftDefinitions = [{ _id: 'shift1', semanticType: 'work', startTime: '09:00', endTime: '18:00' }]
    wrapper.vm.monthlySchedules = [{ date: '2024/01/01', shiftId: 'shift1' }]
    wrapper.vm.updateAvailability(new Date('2024-01-01T02:30:00.000Z'))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.day-off-notice').exists()).toBe(false)
    expect(wrapper.findAll('.punch-card')[0].classes()).not.toContain('disabled')
  })

  it('loads schedules from the monthly response envelope', async () => {
    const schedules = [{ _id: 'schedule-1', date: '2026-08-02', shiftId: 'shift1' }]
    apiFetch.mockReset()
    apiFetch.mockImplementation(async (url) => {
      if (url.startsWith('/api/schedules/monthly')) {
        return { ok: true, json: async () => ({ schedules, publishSummary: null }) }
      }
      if (url === '/api/attendance/punch-window') {
        return { ok: true, json: async () => ({ actionBuffers: {} }) }
      }
      return { ok: true, json: async () => [] }
    })

    const wrapper = mountComponent()
    await flush()
    await flush()

    expect(wrapper.vm.monthlySchedules).toEqual(schedules)
  })

  // 線上打卡與指紋匯入並存，打卡記錄表格標示每一筆的來源
  it('shows the source of each punch (online / fingerprint import / unlabelled legacy rows)', async () => {
    // 這一頁只查自己的打卡（?employee=自己），打卡成功後會重新讀取清單，所以模擬的清單要包含剛打的那一筆
    const stored = [
      { action: 'clockOut', timestamp: '2026-10-21T09:05:00.000Z', source: 'import' },
      { action: 'clockIn', timestamp: '2026-10-21T00:10:00.000Z', source: 'online' },
      { action: 'clockIn', timestamp: '2026-10-20T23:55:00.000Z', source: 'import' },
      { action: 'clockIn', timestamp: '2026-10-01T00:00:00.000Z' }
    ]
    apiFetch.mockReset()
    apiFetch.mockImplementation(async (url, options) => {
      if (url === '/api/attendance' && options?.method === 'POST') {
        const saved = { action: 'clockOut', employee: 'emp1', timestamp: '2026-10-21T09:20:00.000Z', source: 'online' }
        stored.unshift(saved)
        return {
          ok: true,
          json: async () => saved
        }
      }
      if (url.startsWith('/api/attendance?employee=emp1&')) {
        return {
          ok: true,
          json: async () => [...stored]
        }
      }
      if (url === '/api/attendance/punch-window') {
        return { ok: true, json: async () => ({ actionBuffers: {} }) }
      }
      return { ok: true, json: async () => [] }
    })
    const wrapper = mountComponent()
    await flush()

    expect(wrapper.vm.records.map(row => [row.action, row.sourceLabel])).toEqual([
      ['下班簽退', '指紋匯入'],
      ['上班簽到', '線上'],
      ['上班簽到', '指紋匯入'],
      ['上班簽到', '未標示']
    ])

    await wrapper.vm.addRecord('下班簽退')
    expect(wrapper.vm.records[0]).toMatchObject({ action: '下班簽退', source: 'online', sourceLabel: '線上' })
  })

  it('does not send a client-controlled timestamp when recording attendance', async () => {
    apiFetch.mockReset()
    apiFetch.mockImplementation(async (url, options) => {
      if (url === '/api/attendance' && options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            action: 'clockIn',
            employee: 'emp1',
            timestamp: '2026-08-02T12:00:00.000Z',
          }),
        }
      }
      if (url === '/api/attendance/punch-window') {
        return { ok: true, json: async () => ({ actionBuffers: {} }) }
      }
      return { ok: true, json: async () => [] }
    })
    const wrapper = mountComponent()
    await flush()

    await wrapper.vm.addRecord('clockIn', 'CODEX_TEST_20260802_CLIENT_PUNCH')

    const call = apiFetch.mock.calls.find(([, options]) => options?.method === 'POST')
    const body = JSON.parse(call[1].body)
    expect(body).toEqual({
      action: 'clockIn',
      remark: 'CODEX_TEST_20260802_CLIENT_PUNCH',
      employee: 'emp1',
    })
    expect(body.timestamp).toBeUndefined()
  })

  // ── 只查自己的打卡、今日記錄、打卡進度、連點與錯誤訊息 ──
  describe('own records, today list and punch progress', () => {
    const shifts = [
      { _id: 'day', name: '早班', semanticType: 'work', startTime: '08:30', endTime: '17:30' },
      { _id: 'night', name: '夜班', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true }
    ]

    function mockApi({ records = [], schedules = [], post } = {}) {
      apiFetch.mockReset()
      apiFetch.mockImplementation(async (url, options) => {
        if (url === '/api/attendance' && options?.method === 'POST') return post(JSON.parse(options.body))
        if (url.startsWith('/api/attendance?employee=')) return { ok: true, json: async () => [...records] }
        if (url === '/api/shifts') return { ok: true, json: async () => shifts }
        if (url.startsWith('/api/schedules/monthly')) return { ok: true, json: async () => ({ schedules }) }
        if (url === '/api/attendance/punch-window') return { ok: true, json: async () => ({ actionBuffers: {} }) }
        return { ok: true, json: async () => [] }
      })
    }

    async function mountAt(now) {
      const wrapper = mountComponent()
      await flush()
      await flush()
      wrapper.vm.updateAvailability(new Date(now))
      await wrapper.vm.$nextTick()
      return wrapper
    }

    const daySchedules = [
      { _id: 's0', date: '2026/11/09', shiftId: 'day' },
      { _id: 's1', date: '2026/11/10', shiftId: 'day' }
    ]

    // 不帶 employee 時，管理員會拿到全公司的打卡、主管會拿到部屬的打卡（沒有自己的）
    it('only asks for the signed-in user\'s own records', async () => {
      mockApi()
      const wrapper = await mountAt('2026-11-10T08:00:00.000Z')

      const urls = apiFetch.mock.calls.map(([url]) => url)
      const listUrls = urls.filter(url => url.startsWith('/api/attendance?'))
      expect(listUrls).toHaveLength(1)
      const params = new URLSearchParams(listUrls[0].split('?')[1])
      // scope=self 給新版伺服器；employee=自己給不認得 scope 的舊版伺服器
      expect(params.get('scope')).toBe('self')
      expect(params.get('employee')).toBe('emp1')
      expect(urls).not.toContain('/api/attendance')
      wrapper.unmount()
    })

    // 以前開頁就讀回整段打卡歷史（數百 KB）；現在只要昨天到明天，前 7 天等展開「最近記錄」才讀
    it('loads only yesterday to tomorrow on open and the previous 7 days when the recent list is expanded', async () => {
      const calls = []
      const all = [
        { _id: 'today', action: 'clockIn', timestamp: '2026-11-10T00:25:00.000Z' },
        { _id: 'yesterday', action: 'clockOut', timestamp: '2026-11-09T09:35:00.000Z' },
        { _id: 'week', action: 'clockIn', timestamp: '2026-11-05T00:20:00.000Z' }
      ]
      apiFetch.mockReset()
      apiFetch.mockImplementation(async (url) => {
        if (url.startsWith('/api/attendance?')) {
          const params = new URLSearchParams(url.split('?')[1])
          calls.push(params)
          // 新版伺服器：只回傳日期範圍內（台灣日期，含頭尾）的記錄
          const inRange = all.filter(row => {
            const key = new Date(new Date(row.timestamp).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
            return key >= params.get('start') && key <= params.get('end')
          })
          return { ok: true, json: async () => inRange }
        }
        if (url === '/api/shifts') return { ok: true, json: async () => shifts }
        if (url.startsWith('/api/schedules/monthly')) return { ok: true, json: async () => ({ schedules: daySchedules }) }
        if (url === '/api/attendance/punch-window') return { ok: true, json: async () => ({ actionBuffers: {} }) }
        return { ok: true, json: async () => [] }
      })
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-10T08:00:00.000Z')) // 台灣時間 2026/11/10 16:00
      try {
        const wrapper = await mountAt('2026-11-10T08:00:00.000Z')

        expect(calls).toHaveLength(1)
        expect(calls[0].get('start')).toBe('2026-11-09')
        expect(calls[0].get('end')).toBe('2026-11-11')
        expect(wrapper.vm.todayRecords.map(row => row.key)).toEqual(['today'])

        // 還沒展開：不讀前 7 天，也不顯示（只有昨天的）筆數
        const toggle = wrapper.find('[data-test="recent-toggle"]')
        expect(toggle.text()).not.toContain('筆')
        expect(wrapper.find('[data-test="recent-records"]').exists()).toBe(false)

        await toggle.trigger('click')
        await flush()
        expect(calls).toHaveLength(2)
        expect(calls[1].get('scope')).toBe('self')
        expect(calls[1].get('start')).toBe('2026-11-03')
        expect(calls[1].get('end')).toBe('2026-11-09')
        expect(toggle.text()).toContain('2 筆')
        const recentText = wrapper.find('[data-test="recent-records"]').text()
        expect(recentText).toContain('2026/11/09（一）')
        expect(recentText).toContain('2026/11/05（四）')

        // 收合再展開不重複讀取
        await toggle.trigger('click')
        await toggle.trigger('click')
        await flush()
        expect(calls).toHaveLength(2)
        wrapper.unmount()
      } finally {
        vi.useRealTimers()
      }
    })

    it('says so when the previous 7 days have no punches, and offers a retry when loading them fails', async () => {
      let failNext = false
      apiFetch.mockReset()
      apiFetch.mockImplementation(async (url) => {
        if (url.startsWith('/api/attendance?')) {
          if (failNext) return { ok: false, status: 500, json: async () => ({}) }
          return { ok: true, json: async () => [] }
        }
        if (url === '/api/attendance/punch-window') return { ok: true, json: async () => ({ actionBuffers: {} }) }
        return { ok: true, json: async () => [] }
      })
      const wrapper = await mountAt('2026-11-10T08:00:00.000Z')
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      failNext = true
      await wrapper.find('[data-test="recent-toggle"]').trigger('click')
      await flush()
      expect(wrapper.find('[data-test="recent-error"]').text()).toContain('最近記錄載入失敗')

      failNext = false
      await wrapper.vm.fetchRecentRecords()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test="recent-error"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="recent-empty"]').text()).toContain('近 7 天沒有其他打卡記錄')
      errorSpy.mockRestore()
      wrapper.unmount()
    })

    it('lists only today\'s punches (Taiwan date) and keeps earlier days in a collapsed recent list', async () => {
      mockApi({
        schedules: daySchedules,
        records: [
          { _id: 'a', action: 'clockOut', timestamp: '2026-11-11T05:56:00.000Z' }, // 明天 13:56（日期錯誤的資料）
          { _id: 'b', action: 'clockIn', timestamp: '2026-11-10T00:25:00.000Z' }, // 今天 08:25
          { _id: 'c', action: 'outing', timestamp: '2026-11-09T16:30:00.000Z' }, // 台灣時間今天 00:30
          { _id: 'd', action: 'clockOut', timestamp: '2026-11-09T09:35:00.000Z' }, // 昨天 17:35
          { _id: 'e', action: 'clockIn', timestamp: '2026-11-09T00:20:00.000Z' }, // 昨天 08:20
          { _id: 'f', action: 'clockIn', timestamp: '2026-10-20T00:20:00.000Z' } // 三週前
        ]
      })
      // 台灣時間 2026/11/10 16:00
      const wrapper = await mountAt('2026-11-10T08:00:00.000Z')

      expect(wrapper.vm.todayRecords.map(row => row.key)).toEqual(['b', 'c'])
      const todayText = wrapper.find('[data-test="today-records"]').text()
      expect(todayText).toContain('08:25')
      expect(todayText).toContain('00:30')
      expect(todayText).not.toContain('13:56')
      expect(todayText).not.toContain('17:35')
      // 舊資料沒有來源：不顯示「未標示」這種對員工沒有意義的標籤
      expect(wrapper.text()).not.toContain('未標示')

      expect(wrapper.find('[data-test="recent-records"]').exists()).toBe(false)
      const toggle = wrapper.find('[data-test="recent-toggle"]')
      await toggle.trigger('click')
      await flush()
      // 筆數在展開（讀完前 7 天）之後才顯示
      expect(toggle.text()).toContain('2 筆')
      const recentText = wrapper.find('[data-test="recent-records"]').text()
      expect(recentText).toContain('2026/11/09（一）')
      expect(recentText).toContain('17:35')
      expect(recentText).toContain('08:20')
      expect(recentText).not.toContain('13:56')
      expect(wrapper.text()).not.toContain('2026/10/20')
      wrapper.unmount()
    })

    it('keeps the previous evening\'s clock-in of a cross-midnight shift with today\'s records', async () => {
      mockApi({
        schedules: [{ _id: 'n1', date: '2026/11/09', shiftId: 'night' }],
        records: [{ _id: 'in', action: 'clockIn', timestamp: '2026-11-09T13:47:00.000Z', source: 'online' }] // 昨天 21:47
      })
      // 台灣時間 2026/11/10 03:00，夜班進行中
      const wrapper = await mountAt('2026-11-09T19:00:00.000Z')

      expect(wrapper.vm.todayRecords.map(row => row.key)).toEqual(['in'])
      expect(wrapper.find('[data-test="today-records"]').text()).toContain('11/09 21:47')
      const summary = wrapper.find('[data-test="shift-summary"]').text()
      expect(summary).toContain('昨日班別')
      expect(summary).toContain('夜班')
      expect(summary).toContain('22:00–翌日 06:00')
      expect(wrapper.find('[data-test="punch-status"]').text()).toBe('已簽到 21:47，現在可以簽退')
      wrapper.unmount()
    })

    it('marks a finished clock-in as done with the reason and points to clock-out as the next step', async () => {
      mockApi({
        schedules: daySchedules,
        records: [{ _id: 'in', action: 'clockIn', timestamp: '2026-11-10T00:25:00.000Z', source: 'online' }]
      })
      // 台灣時間 14:00：簽退時段 13:30–19:30 已開放
      const wrapper = await mountAt('2026-11-10T06:00:00.000Z')

      const clockIn = wrapper.find('[data-test="punch-clockIn"]')
      expect(clockIn.classes()).toEqual(expect.arrayContaining(['disabled', 'is-done']))
      expect(clockIn.text()).toContain('已簽到 08:25')
      expect(wrapper.vm.clockInState.reason).toBe('已於 08:25 簽到，不需重複打卡')
      const clockOut = wrapper.find('[data-test="punch-clockOut"]')
      expect(clockOut.classes()).toContain('is-next')
      expect(clockOut.classes()).not.toContain('disabled')
      expect(wrapper.find('[data-test="shift-summary"]').text()).toContain('今日班別')
      expect(wrapper.find('[data-test="shift-summary"]').text()).toContain('08:30–17:30')
      wrapper.unmount()
    })

    it('disables clock-out and says why when the shift has no clock-in', async () => {
      mockApi({ schedules: daySchedules, records: [] })
      const wrapper = await mountAt('2026-11-10T06:00:00.000Z')

      const clockOut = wrapper.find('[data-test="punch-clockOut"]')
      expect(clockOut.classes()).toContain('disabled')
      expect(clockOut.text()).toContain('尚未簽到')
      expect(wrapper.vm.clockOutState.reason).toBe('尚未簽到，無法簽退')
      expect(wrapper.find('[data-test="punch-clockIn"]').text()).toContain('12:30 已截止')
      expect(wrapper.find('[data-test="punch-status"]').text()).toBe('尚未簽到，簽到時段已於 12:30 結束')
      wrapper.unmount()
    })

    // 伺服器只擋重複的線上打卡；指紋匯入的簽到算「已簽到」，但不擋線上再簽到
    it('counts a fingerprint clock-in as clocked in without blocking an online clock-in', async () => {
      mockApi({
        schedules: daySchedules,
        records: [{ _id: 'fp', action: 'clockIn', timestamp: '2026-11-10T00:25:00.000Z', source: 'import' }]
      })
      // 台灣時間 09:00
      const wrapper = await mountAt('2026-11-10T01:00:00.000Z')

      expect(wrapper.vm.clockInState.disabled).toBe(false)
      expect(wrapper.find('[data-test="punch-status"]').text()).toContain('已簽到 08:25')
      expect(wrapper.find('[data-test="today-records"]').text()).toContain('指紋匯入')
      wrapper.unmount()
    })

    it('does not treat a punch dated in the future as already clocked in', async () => {
      mockApi({
        schedules: daySchedules,
        records: [{ _id: 'future', action: 'clockIn', timestamp: '2026-11-10T04:00:00.000Z', source: 'online' }] // 12:00
      })
      // 台灣時間 08:00，簽到時段 07:30–12:30
      const wrapper = await mountAt('2026-11-10T00:00:00.000Z')

      expect(wrapper.vm.clockInState.disabled).toBe(false)
      expect(wrapper.find('[data-test="punch-clockIn"]').classes()).toContain('is-next')
      expect(wrapper.find('[data-test="punch-status"]').text()).toBe('尚未簽到，請於 12:30 前簽到')
      wrapper.unmount()
    })

    it('sends one request when the confirm button is tapped twice', async () => {
      const posts = []
      let finishPost
      mockApi({
        post: body => {
          posts.push(body)
          return new Promise(resolve => {
            finishPost = () => resolve({
              ok: true,
              json: async () => ({ _id: 'new', action: 'outing', timestamp: '2026-11-10T08:00:00.000Z', source: 'online' })
            })
          })
        }
      })
      const wrapper = await mountAt('2026-11-10T08:00:00.000Z')

      const first = wrapper.vm.addRecord('外出登記')
      const second = wrapper.vm.addRecord('外出登記')
      expect(await second).toBe(false)
      finishPost()
      expect(await first).toBe(true)
      expect(posts).toHaveLength(1)
      expect(wrapper.vm.punchSubmitting).toBe(false)
      wrapper.unmount()
    })

    it('shows the server\'s English errors in Chinese, keeps Chinese ones, and reloads the list', async () => {
      const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
      let serverError = 'Attendance action already recorded for this shift'
      mockApi({ post: async () => ({ ok: false, json: async () => ({ error: serverError }) }) })
      const wrapper = await mountAt('2026-11-10T08:00:00.000Z')
      const listCalls = () => apiFetch.mock.calls.filter(([url]) => url.startsWith('/api/attendance?employee=emp1&')).length
      const before = listCalls()

      expect(await wrapper.vm.addRecord('上班簽到')).toBe(false)
      expect(errorSpy).toHaveBeenLastCalledWith('這一班已經有上班簽到記錄，不需重複打卡')
      expect(listCalls()).toBe(before + 1)

      serverError = 'Clock-in is required before clock-out'
      await wrapper.vm.addRecord('下班簽退')
      expect(errorSpy).toHaveBeenLastCalledWith('尚未簽到，無法簽退')

      serverError = '今日未設定班表，請洽管理員'
      await wrapper.vm.addRecord('上班簽到')
      expect(errorSpy).toHaveBeenLastCalledWith('今日未設定班表，請洽管理員')

      serverError = 'something unexpected'
      await wrapper.vm.addRecord('上班簽到')
      expect(errorSpy).toHaveBeenLastCalledWith('上班簽到失敗，請稍後再試')
      errorSpy.mockRestore()
      wrapper.unmount()
    })

    it('reports a failed request instead of leaving an unhandled rejection', async () => {
      const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockApi({ post: async () => { throw new TypeError('Failed to fetch') } })
      const wrapper = await mountAt('2026-11-10T08:00:00.000Z')

      expect(await wrapper.vm.addRecord('外出登記')).toBe(false)
      expect(errorSpy).toHaveBeenLastCalledWith('連線失敗，請確認網路後再試一次')
      expect(wrapper.vm.punchSubmitting).toBe(false)
      errorSpy.mockRestore()
      consoleSpy.mockRestore()
      wrapper.unmount()
    })

    it('says the schedule failed to load instead of "no shift today" when the request fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      apiFetch.mockReset()
      apiFetch.mockImplementation(async (url) => {
        if (url.startsWith('/api/schedules/monthly')) return { ok: false, json: async () => ({ error: 'boom' }) }
        return { ok: true, json: async () => [] }
      })
      const wrapper = mountComponent()
      await flush()
      await flush()

      expect(wrapper.find('[data-test="context-error"]').exists()).toBe(true)
      consoleSpy.mockRestore()
      wrapper.unmount()
    })
  })
})
