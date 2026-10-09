import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import realShape from './fixtures/scheduleLeaveApprovals.realShape.json'

// 排班頁「相關簽核」：伺服器回傳範圍內員工的所有簽核單（請假、加班、補簽、支援、特休保留、獎金…，任何狀態）。
// realShape.json 是真的 listLeaveApprovals 控制器（supertest + 真的 JWT + 本機 mongod）的實際回應，
// 用它餵畫面，才不會再出現「伺服器與前端各自假設不同形狀」而清單永遠是空的情況。

const elementPlusMock = vi.hoisted(() => {
  const ElMessage = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
  const ElMessageBox = { alert: vi.fn(), confirm: vi.fn() }
  const loadingServiceMock = vi.fn(() => ({ close: vi.fn() }))
  return { module: { ElMessage, ElMessageBox, ElLoading: { service: loadingServiceMock } }, ElMessage }
})
vi.mock('element-plus', () => elementPlusMock.module)
global.ElMessage = elementPlusMock.ElMessage

vi.mock('../src/api', () => ({ apiFetch: vi.fn(), importScheduleRecords: vi.fn() }))
const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

import { apiFetch } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

const encodeBase64 = data => Buffer.from(data, 'utf8').toString('base64')
const setRoleToken = role => localStorage.setItem('token', `stub.${encodeBase64(JSON.stringify({ role }))}.sig`)

const [sha, wang] = realShape.employees
const approvalsOf = () => realShape.response.approvals
const byForm = name => approvalsOf().filter(item => item.form.name === name)

function mountSchedule() {
  const TableStub = {
    name: 'ElTable',
    props: ['data'],
    provide() {
      return { tableContext: this }
    },
    template: '<div class="table-stub"><slot></slot></div>'
  }
  const ColumnStub = {
    name: 'ElTableColumn',
    inject: ['tableContext'],
    props: ['label', 'fixed', 'width', 'className'],
    template: `
      <div class="col" :data-label="label" :data-width="width || ''">
        <div class="col-header"><slot name="header"></slot></div>
        <div v-for="row in (tableContext?.data || [])" :key="row && (row._id || row.id || row.name || JSON.stringify(row))" class="cell">
          <slot :row="row"></slot>
        </div>
      </div>
    `
  }
  const stubs = {
    'el-date-picker': true,
    'el-table': TableStub,
    'el-table-column': ColumnStub,
    'el-select': { name: 'ElSelect', props: ['modelValue', 'disabled'], template: '<select v-bind="$attrs"><slot></slot></select>' },
    'el-option': { name: 'ElOption', props: ['label', 'value'], template: '<option :value="value"><slot>{{ label }}</slot></option>' },
    'el-steps': { name: 'ElSteps', template: '<div class="steps-stub"><slot></slot></div>' },
    'el-step': { name: 'ElStep', template: '<div class="step-stub"><slot></slot></div>' },
    'el-checkbox': { name: 'ElCheckbox', props: ['modelValue'], template: '<label><input type="checkbox" /><slot></slot></label>' },
    'el-input': { name: 'ElInput', template: '<input v-bind="$attrs" />' },
    'el-popover': { name: 'ElPopover', template: '<div class="popover-stub"><slot></slot><slot name="reference"></slot></div>' },
    'el-tag': { name: 'ElTag', template: '<span class="tag-stub" v-bind="$attrs"><slot></slot></span>' },
    'el-tooltip': { name: 'ElTooltip', template: '<span class="tooltip-stub"><slot></slot></span>' },
    'el-button': { name: 'ElButton', template: '<button v-bind="$attrs"><slot></slot></button>' },
    'el-progress': true,
    'el-pagination': { name: 'ElPagination', emits: ['current-change', 'size-change'], template: '<div class="pagination-stub"></div>' },
    'el-switch': { name: 'ElSwitch', template: '<input type="checkbox" />' },
    'el-divider': { name: 'ElDivider', template: '<div class="divider-stub"></div>' },
    'el-descriptions': { name: 'ElDescriptions', template: '<div><slot></slot></div>' },
    'el-descriptions-item': { name: 'ElDescriptionsItem', template: '<div><slot></slot></div>' },
    'el-dialog': { name: 'ElDialog', props: ['modelValue'], template: '<div class="dialog-stub"><slot></slot></div>' },
    'el-drawer': { name: 'ElDrawer', props: ['modelValue'], template: '<aside class="drawer-stub"><slot></slot></aside>' },
    'el-badge': { name: 'ElBadge', template: '<span><slot></slot></span>' },
    'el-icon': { name: 'ElIcon', template: '<span><slot></slot></span>' },
    'el-empty': { name: 'ElEmpty', template: '<div class="empty-stub"></div>' },
    'el-alert': { name: 'ElAlert', props: ['title', 'type'], template: '<div class="alert-stub">{{ title }}</div>' },
    'el-timeline': { name: 'ElTimeline', template: '<div><slot></slot></div>' },
    'el-timeline-item': { name: 'ElTimelineItem', template: '<div><slot></slot></div>' },
    ScheduleDashboard: { name: 'ScheduleDashboard', template: '<div class="dashboard-stub"></div>', props: ['summary'] }
  }
  return shallowMount(Schedule, { global: { stubs } })
}

const flush = () => new Promise(resolve => setTimeout(resolve))

function setupApi({ response = realShape.response, headers = {}, employees = realShape.employees } = {}) {
  apiFetch.mockImplementation(async url => {
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    const ok = body => ({ ok: true, json: async () => body })
    if (pathname === '/api/employees/schedule' && searchParams.get('supervisor') && searchParams.get('pageSize') === '200' && !searchParams.has('department')) {
      return ok({ employees: employees.map(e => ({ _id: e._id, subDepartment: { _id: e.subDepartment } })) })
    }
    if (pathname === '/api/employees/schedule') {
      return ok({
        employees,
        pagination: { page: 1, pageSize: 50, total: employees.length, totalPages: 1 }
      })
    }
    if (pathname === `/api/employees/${realShape.supervisor}`) {
      return ok({
        _id: realShape.supervisor,
        name: '林主任',
        department: { _id: employees[0].department, name: 'Dept A' },
        subDepartment: { _id: employees[0].subDepartment, name: 'Sub A' }
      })
    }
    if (pathname === '/api/departments') return ok([{ _id: employees[0].department, name: 'Dept A' }])
    if (pathname === '/api/sub-departments') {
      return ok([{ _id: employees[0].subDepartment, name: 'Sub A', department: { _id: employees[0].department } }])
    }
    if (pathname === '/api/schedules/monthly') {
      return ok({
        schedules: [],
        publishSummary: { status: 'draft', pendingEmployees: [], disputedEmployees: [], publishedAt: null, hasSchedules: false, totalEmployees: 0, allEmployeesConfirmed: false },
        pagination: { page: 1, limit: 20, totalEmployees: 0 }
      })
    }
    if (pathname === '/api/schedules/leave-approvals') {
      return { ok: true, headers: { get: name => headers[String(name).toLowerCase()] ?? null }, json: async () => response }
    }
    return ok([])
  })
}

async function mountWithApprovals(options) {
  setRoleToken('supervisor')
  localStorage.setItem('employeeId', realShape.supervisor)
  setupApi(options)
  const wrapper = mountSchedule()
  await flush()
  await wrapper.vm.$nextTick()
  return wrapper
}

// 相關簽核表的某一欄，每一列的文字
const columnTexts = (wrapper, label) =>
  wrapper.findAll(`.modern-approval-table .col[data-label="${label}"] .cell`).map(cell => cell.text())
const rowOf = (wrapper, id) => wrapper.vm.relatedApprovalRows.find(row => row._id === id)

describe('排班頁相關簽核（餵真的伺服器回應）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetch.mockReset()
    localStorage.clear()
    sessionStorage.clear()
    pushMock.mockReset()
  })

  it('realShape 真的是新的統一形狀：每一列都有 applicant_employee._id，且不只請假', () => {
    const rows = approvalsOf()
    expect(rows).toHaveLength(8)
    rows.forEach(item => {
      expect(item.applicant_employee._id).toBeTruthy()
      expect(item.form.name).toBeTruthy()
    })
    expect(new Set(rows.map(item => item.status))).toEqual(new Set(['approved', 'pending', 'rejected', 'returned', 'canceled']))
    expect(new Set(rows.map(item => item.form.semanticType))).toEqual(new Set(['leave', 'overtime', 'general']))
    // 日曆用的 leaves[] 仍是舊形狀（只含核准的請假）
    expect(realShape.response.leaves).toHaveLength(2)
    expect(Object.keys(realShape.response.leaves[0]).sort()).toEqual(['employee', 'endDate', 'leaveType', 'startDate', 'status'])
  })

  it('列出所有簽核單，不再是空的', async () => {
    const wrapper = await mountWithApprovals()

    expect(wrapper.vm.approvalList).toHaveLength(8)
    expect(wrapper.vm.relatedApprovalRows).toHaveLength(8)
    expect(wrapper.find('[data-test="approval-empty-hint"]').exists()).toBe(false)
    expect(wrapper.find('.approval-count').text()).toBe('8 項')
    // 收合時先顯示前 10 筆（這裡只有 8 筆，全部都在）
    expect(columnTexts(wrapper, '申請人')).toHaveLength(8)
    expect(new Set(columnTexts(wrapper, '申請人'))).toEqual(new Set(['沙俊宇', '王小明']))
  })

  it('資料類型：請假、加班各自標示，其他顯示表單名稱；申請類型欄是表單名稱', async () => {
    const wrapper = await mountWithApprovals()

    const labelOf = id => rowOf(wrapper, id).sourceTypeLabel
    expect(byForm('(全)假別申請單').map(item => labelOf(item._id))).toEqual(['請假簽核', '請假簽核'])
    expect(byForm('加班申請').map(item => labelOf(item._id))).toEqual(['加班簽核'])
    expect(labelOf(byForm('支援申請')[0]._id)).toBe('支援申請')
    expect(labelOf(byForm('特休保留')[0]._id)).toBe('特休保留')
    expect(labelOf(byForm('補簽申請')[0]._id)).toBe('補簽申請')
    expect(labelOf(byForm('獎金申請')[0]._id)).toBe('獎金申請')
    expect(labelOf(byForm('（表單已刪除）')[0]._id)).toBe('（表單已刪除）')

    expect(columnTexts(wrapper, '申請類型').sort()).toEqual(approvalsOf().map(item => item.form.name).sort())
    expect(rowOf(wrapper, byForm('加班申請')[0]._id).sourceType).toBe('approval')
    expect(rowOf(wrapper, byForm('(全)假別申請單')[0]._id).sourceType).toBe('leave_approval')
  })

  it('期間：台灣時間的 起 ~ 迄（同一天只顯示一天），沒有日期的顯示申請日', async () => {
    const wrapper = await mountWithApprovals()
    const periodOf = id => rowOf(wrapper, id).periodText

    const [singleDayLeave, multiDayLeave] = byForm('(全)假別申請單') // 先建立的在後（新的在前）
    // 台灣 7/12～7/13（存的是 UTC 7/11 16:00～7/12 16:00，不能顯示成 7/11）
    expect(periodOf(multiDayLeave._id)).toBe('2026/07/12 ~ 2026/07/13')
    // 台灣 7/20 一整天
    expect(periodOf(singleDayLeave._id)).toBe('2026/07/20')
    // 加班 18:00～21:00 同一天
    expect(periodOf(byForm('加班申請')[0]._id)).toBe('2026/07/14')
    // 純日期欄位
    expect(periodOf(byForm('支援申請')[0]._id)).toBe('2026/07/20 ~ 2026/07/21')
    // 沒有日期：申請日
    expect(periodOf(byForm('特休保留')[0]._id)).toBe('申請日 2026/07/06')
    expect(periodOf(byForm('獎金申請')[0]._id)).toBe('申請日 2026/07/08')
    expect(periodOf(byForm('（表單已刪除）')[0]._id)).toBe('申請日 2026/07/15')
    expect(columnTexts(wrapper, '期間')).toContain('2026/07/12 ~ 2026/07/13')
  })

  it('狀態：待簽核、已核准、已駁回、已退回、已撤回各有標籤與顏色', async () => {
    const wrapper = await mountWithApprovals()
    const statusOf = form => {
      const row = rowOf(wrapper, byForm(form)[0]._id)
      return [row.status, row.statusLabel, row.statusTagType]
    }

    expect(statusOf('支援申請')).toEqual(['pending', '待簽核', 'warning'])
    expect(statusOf('加班申請')).toEqual(['approved', '已核准', 'success'])
    expect(statusOf('獎金申請')).toEqual(['rejected', '已駁回', 'danger'])
    expect(statusOf('特休保留')).toEqual(['returned', '已退回', 'warning'])
    expect(statusOf('補簽申請')).toEqual(['canceled', '已撤回', 'info'])
    expect(new Set(columnTexts(wrapper, '狀態'))).toEqual(new Set(['待簽核', '已核准', '已駁回', '已退回', '已撤回']))
  })

  it('兩種拼法的撤回（canceled / cancelled）都顯示已撤回', async () => {
    const wrapper = await mountWithApprovals()
    wrapper.vm.approvalList = [
      { ...approvalsOf()[0], _id: 'c1', status: 'cancelled' },
      { ...approvalsOf()[0], _id: 'c2', status: 'canceled' }
    ]
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.relatedApprovalRows.map(row => [row.statusLabel, row.statusTagType])).toEqual([
      ['已撤回', 'info'],
      ['已撤回', 'info']
    ])
  })

  it('備註摘要用伺服器給的 noteSummary，沒有時顯示 -', async () => {
    const wrapper = await mountWithApprovals()

    expect(rowOf(wrapper, byForm('支援申請')[0]._id).noteSummary).toBe('支援急診')
    expect(rowOf(wrapper, byForm('補簽申請')[0]._id).noteSummary).toBe('忘記打卡')
    expect(rowOf(wrapper, byForm('（表單已刪除）')[0]._id).noteSummary).toBe('')
    const notes = columnTexts(wrapper, '備註摘要')
    expect(notes).toContain('支援急診')
    expect(notes).toContain('-')
  })

  it('每一列都能查看（不只請假），查看會開啟申請單明細', async () => {
    const wrapper = await mountWithApprovals()

    const buttons = wrapper.findAll('.modern-approval-table .col[data-label="查看詳情"] button')
    expect(buttons).toHaveLength(8)
    buttons.forEach(button => expect(button.attributes('disabled')).toBeUndefined())

    const overtime = byForm('加班申請')[0]
    const index = wrapper.vm.displayedApprovalRows.findIndex(row => row._id === overtime._id)
    await buttons[index].trigger('click')
    expect(wrapper.vm.detail.visible).toBe(true)
    expect(wrapper.vm.detail.approvalId).toBe(overtime._id)
  })

  it('依選取的員工過濾，仍讀新的申請人欄位', async () => {
    const wrapper = await mountWithApprovals()

    wrapper.vm.selectedEmployees = new Set([sha._id])
    await wrapper.vm.$nextTick()
    const shaForms = approvalsOf().filter(item => item.applicant_employee._id === sha._id).map(item => item._id)
    expect(wrapper.vm.relatedApprovalRows.map(row => row._id).sort()).toEqual(shaForms.sort())
    expect(new Set(columnTexts(wrapper, '申請人'))).toEqual(new Set(['沙俊宇']))

    wrapper.vm.selectedEmployees = new Set([wang._id])
    await wrapper.vm.$nextTick()
    expect(new Set(columnTexts(wrapper, '申請人'))).toEqual(new Set(['王小明']))
    expect(wrapper.vm.relatedApprovalRows).toHaveLength(4)
  })

  it('只用舊欄位 employee 的資料也能顯示申請人', async () => {
    const wrapper = await mountWithApprovals()
    const { applicant_employee: ignored, ...legacy } = approvalsOf()[1]
    wrapper.vm.approvalList = [{ ...legacy, _id: 'legacy1' }]
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.relatedApprovalRows).toHaveLength(1)
    expect(wrapper.vm.relatedApprovalRows[0].applicantName).toBe('王小明')
  })

  it('待簽核數與跳轉按鈕沿用，分頁照常運作', async () => {
    const wrapper = await mountWithApprovals()
    expect(wrapper.find('[data-test="approval-summary-pending"]').text()).toBe('2')
    expect(wrapper.find('[data-test="approval-jump-button"]').attributes('disabled')).toBeUndefined()

    // 25 筆：收合時先顯示前 10 筆，展開後每頁 10 筆
    const many = Array.from({ length: 25 }, (_, index) => ({ ...approvalsOf()[index % 8], _id: `many${index}` }))
    wrapper.vm.approvalList = many
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.relatedApprovalRows).toHaveLength(25)
    expect(wrapper.vm.displayedApprovalRows).toHaveLength(10)
    expect(wrapper.find('.approval-collapse-hint').exists()).toBe(true)

    wrapper.vm.approvalCollapsed = false
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.displayedApprovalRows.map(row => row._id)).toEqual(many.slice(0, 10).map(item => item._id))
    wrapper.vm.onApprovalPageChange(3)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.displayedApprovalRows.map(row => row._id)).toEqual(many.slice(20).map(item => item._id))
  })

  it('伺服器標示截斷（X-Approvals-Truncated）時顯示提示，沒有標示時不顯示', async () => {
    const plain = await mountWithApprovals()
    expect(plain.find('[data-test="approval-truncated-hint"]').exists()).toBe(false)

    const truncated = await mountWithApprovals({ headers: { 'x-approvals-truncated': 'true' } })
    expect(truncated.vm.approvalTruncated).toBe(true)
    expect(truncated.find('[data-test="approval-truncated-hint"]').text()).toContain('500')
  })

  it('舊版前端形狀的資料（category 為 leave、沒有 semanticType）仍然顯示為請假簽核', async () => {
    const legacy = [{
      _id: 'old1',
      status: 'pending',
      form: { _id: 'f1', name: '請假申請', category: 'leave' },
      applicant_employee: { _id: sha._id, name: '沙俊宇' },
      form_data: { startDate: '2026-07-12', endDate: '2026-07-13', reason: '家中有事' }
    }]
    const wrapper = await mountWithApprovals({ response: { approvals: legacy, leaves: [] } })

    const [row] = wrapper.vm.relatedApprovalRows
    expect(row.sourceTypeLabel).toBe('請假簽核')
    expect(row.approvalType).toBe('請假申請')
    expect(row.periodText).toBe('2026/07/12 ~ 2026/07/13')
    expect(row.noteSummary).toBe('家中有事')
    expect(row.statusLabel).toBe('待簽核')
  })
})
