import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import AttendanceManagementSetting from '../src/components/backComponents/AttendanceManagementSetting.vue'
import AttendanceImportDialog from '../src/components/backComponents/AttendanceImportDialog.vue'
import * as api from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(),
  importAttendanceRecords: vi.fn()
}))

const EMPLOYEES = [
  { _id: 'e1', name: '張雅惠', employeeId: 'EMP-0006' },
  { _id: 'e2', name: '李美玲', employeeId: 'EMP-0002' }
]

function respond(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body })
}

function record(id, timestamp, extra = {}) {
  return { _id: id, timestamp, action: 'clockIn', employee: { _id: 'e1', name: '張雅惠', employeeId: 'EMP-0006' }, ...extra }
}

describe('出勤管理：打卡記錄查詢', () => {
  let wrapper
  let recordsResponse

  function recordCalls() {
    return api.apiFetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/attendance?'))
  }

  async function mountPage() {
    wrapper = mount(AttendanceManagementSetting, { attachTo: document.body, global: { plugins: [ElementPlus] } })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    // 台灣時間 2027/01/01 00:30（UTC 還是 2026/12/31）：預設的日期範圍要用台灣日期
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-31T16:30:00.000Z'))
    recordsResponse = () => respond([])
    api.apiFetch.mockReset()
    api.apiFetch.mockImplementation((url) => {
      if (String(url).startsWith('/api/attendance?')) return recordsResponse(url)
      if (url === '/api/employees/attendance-import-options') return respond(EMPLOYEES)
      return respond([])
    })
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('頁首有標題與「匯入考勤資料」；預設查台灣時間的最近 7 天', async () => {
    await mountPage()

    expect(wrapper.find('[data-test="page-header"] h1').text()).toBe('出勤管理')
    expect(wrapper.find('[data-test="attendance-import-button"]').text()).toBe('匯入考勤資料')
    expect(wrapper.vm.filters.range).toEqual(['2026-12-26', '2027-01-01'])
    const params = new URLSearchParams(recordCalls()[0].split('?')[1])
    expect(Object.fromEntries(params)).toEqual({ start: '2026-12-26', end: '2027-01-01', limit: '2000' })
    expect(wrapper.find('[data-test="record-table"]').text()).toContain('這段期間沒有打卡記錄')
  })

  it('列出時間（台灣時間）、員工、動作與來源標籤；可依來源篩選', async () => {
    recordsResponse = () => respond([
      record('r1', '2026-12-31T16:05:00.000Z', { action: 'clockIn', source: 'online' }),
      record('r2', '2026-12-31T09:03:20.000Z', { action: 'clockOut', source: 'import', remark: '指紋機 104' }),
      record('r3', '2026-12-30T23:55:10.000Z', { action: 'clockIn' })
    ])
    await mountPage()

    const rows = wrapper.findAll('[data-test="record-table"] .el-table__body .el-table__row').map((row) => row.text().replace(/\s+/g, ' '))
    expect(rows).toHaveLength(3)
    // 16:05 UTC 是台灣隔天 00:05（星期五）
    expect(rows[0]).toContain('2027/01/01 00:05:00（五）')
    expect(rows[0]).toContain('張雅惠')
    expect(rows[0]).toContain('EMP-0006')
    expect(rows[0]).toContain('上班簽到')
    expect(rows[0]).toContain('線上')
    expect(rows[1]).toContain('2026/12/31 17:03:20（四）')
    expect(rows[1]).toContain('下班簽退')
    expect(rows[1]).toContain('指紋匯入')
    expect(rows[1]).toContain('指紋機 104')
    expect(rows[2]).toContain('未標示')
    expect(wrapper.find('[data-test="record-count"]').text()).toBe('共 3 筆')

    wrapper.vm.filters.source = 'import'
    await flushPromises()
    expect(wrapper.findAll('[data-test="record-table"] .el-table__body .el-table__row')).toHaveLength(1)
    expect(wrapper.find('[data-test="record-count"]').text()).toBe('共 1 筆')
    // 舊資料沒有來源欄位，歸在「未標示」
    wrapper.vm.filters.source = 'legacy'
    await flushPromises()
    expect(wrapper.findAll('[data-test="record-table"] .el-table__body .el-table__row')).toHaveLength(1)
  })

  it('指定員工與日期範圍後查詢；伺服器沒有依日期篩選時，範圍以外的記錄也不會列出來', async () => {
    // 舊版伺服器不認得 start／end，會把這位員工所有的記錄都傳回來
    recordsResponse = () => respond([
      record('in-1', '2024-03-04T09:03:20.000Z'),
      record('in-2', '2024-03-03T23:55:10.000Z'), // 台灣時間 3/4 07:55
      record('out-1', '2024-03-03T15:59:00.000Z'), // 台灣時間 3/3 23:59
      record('out-2', '2026-11-10T01:00:00.000Z')
    ])
    await mountPage()

    wrapper.vm.filters.employee = 'e1'
    wrapper.vm.filters.range = ['2024-03-04', '2024-03-04']
    await wrapper.vm.fetchRecords()
    await flushPromises()

    const params = new URLSearchParams(recordCalls().at(-1).split('?')[1])
    expect(Object.fromEntries(params)).toEqual({ start: '2024-03-04', end: '2024-03-04', limit: '2000', employee: 'e1' })
    expect(wrapper.vm.records.map((item) => item._id)).toEqual(['in-1', 'in-2'])
    expect(wrapper.find('[data-test="record-truncated"]').exists()).toBe(false)
  })

  it('筆數到達上限時提醒縮短範圍；讀取失敗顯示伺服器的原因', async () => {
    recordsResponse = () => respond(Array.from({ length: 2000 }, (_, index) => record(`r${index}`, '2026-12-31T01:00:00.000Z')))
    await mountPage()
    expect(wrapper.find('[data-test="record-truncated"]').text()).toContain('只顯示最新的 2000 筆')
    expect(wrapper.find('[data-test="record-pagination"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="record-table"] .el-table__body .el-table__row')).toHaveLength(50)

    recordsResponse = () => respond({ error: '結束日期不可早於開始日期' }, false, 400)
    await wrapper.vm.fetchRecords()
    await flushPromises()
    expect(wrapper.find('[data-test="record-error"]').text()).toContain('讀取打卡記錄失敗：結束日期不可早於開始日期')
    expect(wrapper.vm.records).toEqual([])
  })

  it('連續查詢時只採用最後一次的回應', async () => {
    await mountPage()
    const pending = []
    recordsResponse = () => new Promise((resolve) => { pending.push(resolve) })

    const first = wrapper.vm.fetchRecords()
    wrapper.vm.filters.employee = 'e2'
    const second = wrapper.vm.fetchRecords()
    pending[1]({ ok: true, json: async () => [record('new', '2026-12-31T02:00:00.000Z')] })
    await second
    pending[0]({ ok: true, json: async () => [record('old', '2026-12-31T01:00:00.000Z')] })
    await first
    await flushPromises()

    expect(wrapper.vm.records.map((item) => item._id)).toEqual(['new'])
  })

  it('匯入完成後重新查詢，不再另外跳一次「匯入完成」', async () => {
    await mountPage()
    const before = recordCalls().length

    wrapper.findComponent(AttendanceImportDialog).vm.$emit('import-complete', { summary: { importedCount: 3 } })
    await flushPromises()

    expect(recordCalls().length).toBe(before + 1)
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})
