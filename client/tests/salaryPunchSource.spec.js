import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// 薪資明細的「每日出勤明細」：線上打卡與指紋匯入一起比對（上班取最早、下班取最晚），
// 時間下方標示那一筆打卡的來源。掛真正的 Element Plus，只把網路請求換成假伺服器。

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('../src/api', () => ({ API_BASE_URL: '', apiFetch: apiFetchMock }))

import SalaryManagementSetting from '../src/components/backComponents/SalaryManagementSetting.vue'

vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 })

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await tick()
  await flushPromises()
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

const overviewRow = {
  _id: 'e1',
  employeeId: 'E001',
  name: '王小明',
  photo: '',
  department: '內科',
  subDepartment: '',
  organization: '',
  salaryType: '月薪',
  workDays: 1,
  actualWorkHours: 8.17,
  hourlyRate: 200,
  totalPayment: 40000,
}

const completeData = {
  workDays: 1,
  scheduledHours: 8,
  actualWorkHours: 8.17,
  dailyDetails: [
    {
      date: '2026-10-21',
      shiftName: '日班',
      scheduledHours: 8,
      workedHours: 8.17,
      hasAttendance: true,
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:20:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'online',
    },
    {
      date: '2026-10-22',
      shiftName: '日班',
      scheduledHours: 8,
      workedHours: 8,
      hasAttendance: true,
      clockInTime: '2026-10-21T23:58:00.000Z',
      clockOutTime: '2026-10-22T09:00:00.000Z',
      clockInSource: 'legacy',
      clockOutSource: null,
    },
  ],
  leaveRecords: [],
  overtimeRecords: [],
}

const mounted = []

beforeEach(() => {
  localStorage.clear()
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation(async (url) => {
    const { pathname } = new URL(String(url), 'http://localhost')
    if (pathname === '/api/payroll/overview/monthly') {
      return json({ items: [overviewRow], pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 } })
    }
    if (pathname.startsWith('/api/payroll/complete-data/e1/')) return json(completeData)
    return json([])
  })
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('薪資明細的每日出勤明細顯示打卡來源', () => {
  it('上班、下班時間下方標示線上 / 指紋匯入；舊資料顯示未標示，沒有來源資訊時不顯示', async () => {
    const wrapper = mount(SalaryManagementSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
    mounted.push(wrapper)
    await flush()

    await wrapper.vm.showDetailDialog(wrapper.vm.filteredOverviewData[0])
    await flush()

    const rows = [...document.body.querySelectorAll('.el-dialog .el-table__body tr')]
      .filter(row => row.textContent.includes('2026-10-2'))
    expect(rows).toHaveLength(2)
    const sourcesOf = row => [...row.querySelectorAll('.punch-source')].map(element => element.textContent.trim())
    expect(sourcesOf(rows[0])).toEqual(['指紋匯入', '線上'])
    expect(sourcesOf(rows[1])).toEqual(['未標示'])
  })
})
