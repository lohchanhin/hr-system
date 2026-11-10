import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'

// 後台「班表總覽」的版面與狀態：共用頁首、一列工具列、空狀態與錯誤狀態，
// 以及換月份後停在不存在的頁次（表格是空的）的修正。

const messageMock = vi.hoisted(() => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))
vi.mock('element-plus', () => messageMock)
vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))

import ScheduleOverview from '../src/views/ScheduleOverview.vue'
import { apiFetch } from '../src/api'

const TableStub = {
  name: 'ElTable',
  props: ['data'],
  template: '<div class="table-stub" :data-rows="(data || []).length"><slot></slot></div>'
}
const ColumnStub = {
  name: 'ElTableColumn',
  props: ['label'],
  template: '<div class="column-stub" :data-label="label">{{ label }}</div>'
}
const stubs = {
  PageHeader: false,
  'el-select': { name: 'ElSelect', props: ['modelValue'], template: '<select v-bind="$attrs"><slot /></select>' },
  'el-option': { name: 'ElOption', props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-date-picker': { name: 'ElDatePicker', props: ['modelValue', 'clearable'], template: '<input class="month-stub" :data-clearable="String(clearable)" />' },
  'el-button': { name: 'ElButton', props: ['loading', 'disabled'], emits: ['click'], template: '<button v-bind="$attrs" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>' },
  'el-table': TableStub,
  'el-table-column': ColumnStub,
  'el-alert': { name: 'ElAlert', template: '<div class="alert-stub"><slot /></div>' },
  'el-skeleton': { name: 'ElSkeleton', template: '<div class="skeleton-stub"></div>' },
  'el-collapse': { name: 'ElCollapse', template: '<div><slot /></div>' },
  'el-collapse-item': { name: 'ElCollapseItem', template: '<section><slot name="title" /><slot /></section>' },
  'el-pagination': { name: 'ElPagination', props: ['currentPage', 'total', 'pageSize'], template: '<div class="pagination-stub" :data-page="currentPage"></div>' }
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise(resolve => setTimeout(resolve))
}

const month = dayjs().format('YYYY-MM')
const people = count => Array.from({ length: count }, (_, index) => ({
  id: `emp-${index + 1}`,
  name: `員工${String(index + 1).padStart(3, '0')}`,
  title: '護理師',
  schedules: []
}))
const overviewOf = employees => ({
  month,
  days: [`${month}-01`, `${month}-02`],
  organizations: employees.length
    ? [{ id: 'org-1', name: '迦南醫院', departments: [{ id: 'dept-1', name: '護理部', subDepartments: [{ id: 'unit-1', name: 'A 病房', employees }] }] }]
    : []
})

let overviewHandler
let referenceHandler
beforeEach(() => {
  apiFetch.mockReset()
  messageMock.ElMessage.error.mockReset()
  overviewHandler = () => ({ ok: true, json: async () => overviewOf([]) })
  referenceHandler = () => ({ ok: true, json: async () => [] })
  apiFetch.mockImplementation(async url => {
    const { pathname } = new URL(url, 'http://localhost')
    if (pathname === '/api/schedules/overview') return overviewHandler()
    return referenceHandler(pathname)
  })
})

const mountPage = async () => {
  const wrapper = shallowMount(ScheduleOverview, { global: { stubs } })
  await flush()
  return wrapper
}

describe('班表總覽：版面與狀態', () => {
  it('用共用頁首，篩選與匯出排成一列；月份不能清空', async () => {
    const wrapper = await mountPage()

    const header = wrapper.find('[data-test="page-header"]')
    expect(header.text()).toContain('班表總覽')
    const toolbar = wrapper.find('.hr-toolbar')
    expect(toolbar.find('.month-stub').attributes('data-clearable')).toBe('false')
    expect(toolbar.findAll('select')).toHaveLength(3)
    expect(toolbar.find('[data-test="export-excel"]').exists()).toBe(true)
    expect(toolbar.find('[data-test="export-pdf"]').exists()).toBe(true)
  })

  it('沒有資料時說明下一步', async () => {
    const wrapper = await mountPage()
    const empty = wrapper.find('[data-test="overview-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('請調整上方的月份或篩選條件')
    expect(wrapper.find('[data-test="overview-count"]').exists()).toBe(false)
  })

  it('有資料時顯示人數，日期欄標題帶星期', async () => {
    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(3)) })
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="overview-count"]').text()).toBe('3 位人員')
    expect(wrapper.find('[data-test="overview-empty"]').exists()).toBe(false)
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][dayjs(`${month}-01`).day()]
    expect(wrapper.vm.formatDayLabel(`${month}-01`)).toBe(`${month.slice(5)}/01(${weekday})`)
  })

  it('載入失敗時只顯示錯誤（伺服器的原因），不同時顯示「沒有資料」；可以重新載入', async () => {
    overviewHandler = () => ({ ok: false, json: async () => ({ error: '班表總覽暫時無法讀取' }) })
    const wrapper = await mountPage()

    expect(wrapper.find('.alert-stub').text()).toContain('班表總覽暫時無法讀取')
    expect(wrapper.find('[data-test="overview-empty"]').exists()).toBe(false)

    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(2)) })
    await wrapper.find('[data-test="overview-retry"]').trigger('click')
    await flush()
    expect(wrapper.find('.alert-stub').exists()).toBe(false)
    expect(wrapper.find('[data-test="overview-count"]').text()).toBe('2 位人員')
  })

  it('機構、部門資料載入失敗後按重新載入會先補載入這些資料', async () => {
    let fail = true
    referenceHandler = () => (fail
      ? { ok: false, json: async () => ({ error: '無法載入機構資料' }) }
      : { ok: true, json: async () => [] })
    const wrapper = await mountPage()
    expect(wrapper.find('.alert-stub').text()).toContain('無法載入機構資料')
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes('/api/schedules/overview'))).toBe(false)

    fail = false
    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(1)) })
    await wrapper.find('[data-test="overview-retry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="overview-count"]').text()).toBe('1 位人員')
  })
})

describe('班表總覽：換月份後的頁次', () => {
  it('人數變少時回到最後一頁，不會停在空白的頁次', async () => {
    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(120)) })
    const wrapper = await mountPage()
    const unit = { id: 'unit-1' }

    wrapper.vm.setUnitCurrentPage(unit, 3)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.getUnitPageRows(unit)).toHaveLength(20)

    // 換到只有 30 人的月份：以前頁次停在第 3 頁，表格是空的，分頁列也因為只有一頁而不顯示
    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(30)) })
    wrapper.vm.selectedMonth = dayjs().add(1, 'month').format('YYYY-MM')
    wrapper.vm.triggerOverviewReload()
    await flush()

    expect(wrapper.vm.unitCurrentPage(unit)).toBe(1)
    expect(wrapper.vm.getUnitPageRows(unit)).toHaveLength(30)
    expect(wrapper.find('.table-stub').attributes('data-rows')).toBe('30')
  })

  it('人數仍然夠多時保留原本的頁次', async () => {
    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(120)) })
    const wrapper = await mountPage()
    const unit = { id: 'unit-1' }
    wrapper.vm.setUnitCurrentPage(unit, 2)

    overviewHandler = () => ({ ok: true, json: async () => overviewOf(people(110)) })
    wrapper.vm.triggerOverviewReload()
    await flush()
    expect(wrapper.vm.unitCurrentPage(unit)).toBe(2)
  })
})
