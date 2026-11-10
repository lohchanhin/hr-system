// 部門報表的遲到、早退預覽：「實際打卡」旁標示打卡來源（線上／指紋匯入），與匯出的「打卡來源」欄一致
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DepartmentReports from '../src/views/front/DepartmentReports.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))

// 表格的簡單替身：逐列呈現每一欄，欄位有自訂內容（slot）時用自訂內容
const TableStub = {
  props: ['data'],
  provide() {
    return { rowsOf: () => this.data || [] }
  },
  template: '<table><slot /></table>',
}
const TableColumnStub = {
  props: ['prop', 'label'],
  inject: ['rowsOf'],
  template: `<td :data-label="label">
    <div v-for="(row, index) in rowsOf()" :key="index" class="cell">
      <slot :row="row">{{ prop ? row[prop] : '' }}</slot>
    </div>
  </td>`,
}

// 畫面現在會自動查詢：測試結束要卸載，計時器才不會跑進下一個測試
const mountedWrappers = []

function createWrapper() {
  const wrapper = mountDepartmentReports()
  mountedWrappers.push(wrapper)
  return wrapper
}

function mountDepartmentReports() {
  return mount(DepartmentReports, {
    global: {
      stubs: {
        'el-card': { template: '<div><slot name="header" /><slot /></div>' },
        'el-date-picker': true,
        'el-select': { template: '<div><slot /></div>' },
        'el-option': true,
        'el-button': { template: '<button><slot /></button>' },
        'el-alert': true,
        'el-table': TableStub,
        'el-table-column': TableColumnStub,
        'el-tag': { props: ['type'], template: '<span class="el-tag-stub" :data-type="type"><slot /></span>' },
        EmployeeAvatar: true,
      },
    },
  })
}

function mockStartup() {
  apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ department: { _id: 'dept1', name: '內科病房' } }) })
  apiFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'dept1', name: '內科病房' }] })
  apiFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => [
      { id: 'tpl-late', name: '遲到統計', type: 'tardiness', exportSettings: { formats: ['excel'] }, permissionSettings: { supervisorDept: true } },
      { id: 'tpl-early', name: '早退統計', type: 'earlyLeave', exportSettings: { formats: ['excel'] }, permissionSettings: { supervisorDept: true } },
    ],
  })
  // 打開頁面時的自動查詢：沒有資料的報表
  apiFetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ summary: null, records: [] }) })
}

async function previewWith(type, records) {
  const wrapper = createWrapper()
  await flushPromises()
  apiFetch.mockResolvedValueOnce({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ summary: {}, records }),
  })
  wrapper.vm.selectedMonth = '2026-10'
  wrapper.vm.selectedDepartment = 'dept1'
  wrapper.vm.reportType = type
  await flushPromises()
  await wrapper.vm.handlePreview()
  await flushPromises()
  return wrapper
}

const cellsOf = (wrapper, label) => wrapper.findAll(`td[data-label="${label}"] .cell`).map((cell) => cell.text().trim())
// 實際打卡的每一格：[時間, 來源標籤（沒有標籤時為空字串）]
const punchCellsOf = (wrapper) => wrapper.findAll('td[data-label="實際打卡"] .cell').map((cell) => {
  const tag = cell.find('.el-tag-stub')
  return [cell.find('span:not(.el-tag-stub)').text(), tag.exists() ? tag.text() : '']
})

describe('DepartmentReports.vue 實際打卡的來源', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiFetch.mockReset()
    window.sessionStorage.setItem('employeeId', 'sup1')
    window.sessionStorage.setItem('role', 'supervisor')
    mockStartup()
  })

  afterEach(() => {
    while (mountedWrappers.length) mountedWrappers.pop().unmount()
    window.sessionStorage.clear()
  })

  it('遲到統計：實際打卡旁顯示線上、指紋匯入、未標示；沒有來源資訊時只顯示時間', async () => {
    const wrapper = await previewWith('tardiness', [
      { employee: 'e1', name: '羅護理師', date: '2026-10-12', scheduledStart: '08:00', actualClockIn: '08:10', clockInSource: 'import', minutesLate: 10 },
      { employee: 'e1', name: '羅護理師', date: '2026-10-13', scheduledStart: '08:00', actualClockIn: '08:05', clockInSource: 'online', minutesLate: 5 },
      { employee: 'e1', name: '羅護理師', date: '2026-10-14', scheduledStart: '08:00', actualClockIn: '08:20', clockInSource: 'legacy', minutesLate: 20 },
      { employee: 'e1', name: '羅護理師', date: '2026-10-15', scheduledStart: '08:00', actualClockIn: '08:30', minutesLate: 30 },
    ])

    expect(wrapper.vm.preview.state).toBe('success')
    expect(punchCellsOf(wrapper)).toEqual([['08:10', '指紋匯入'], ['08:05', '線上'], ['08:20', '未標示'], ['08:30', '']])
    expect(wrapper.findAll('td[data-label="實際打卡"] .el-tag-stub').map((tag) => tag.attributes('data-type'))).toEqual(['warning', 'success', 'info'])
    // 其他欄位照舊顯示原本的值
    expect(cellsOf(wrapper, '遲到分鐘')).toEqual(['10', '5', '20', '30'])
  })

  it('早退統計：實際打卡旁顯示簽退的來源', async () => {
    const wrapper = await previewWith('earlyLeave', [
      { employee: 'e1', name: '羅護理師', date: '2026-10-12', scheduledEnd: '17:00', actualClockOut: '16:30', clockOutSource: 'import', minutesEarly: 30 },
    ])

    expect(punchCellsOf(wrapper)).toEqual([['16:30', '指紋匯入']])
    expect(cellsOf(wrapper, '排定下班')).toEqual(['17:00'])
  })
})
