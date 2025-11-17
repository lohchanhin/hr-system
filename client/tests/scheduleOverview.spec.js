import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'

const messageMock = vi.hoisted(() => ({
  ElMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('element-plus', () => messageMock)

vi.mock('../src/api', () => ({
  apiFetch: vi.fn()
}))

import ScheduleOverview from '../src/views/ScheduleOverview.vue'
import { apiFetch } from '../src/api'

const createTableStub = () => {
  const TableStub = {
    name: 'ElTable',
    props: ['data'],
    provide() {
      return { tableData: this.data }
    },
    template: '<div class="table-stub"><slot></slot></div>'
  }

  const ColumnStub = {
    name: 'ElTableColumn',
    inject: ['tableData'],
    props: ['label', 'prop'],
    template: `
      <div class="column-stub" :data-label="label">
        <div class="header">{{ label }}</div>
        <div v-for="row in (tableData || [])" :key="row.id || row.name" class="cell">
          <slot :row="row">
            <span>{{ prop ? row[prop] : '' }}</span>
          </slot>
        </div>
      </div>
    `
  }

  return { TableStub, ColumnStub }
}

const { TableStub, ColumnStub } = createTableStub()

const SelectStub = {
  name: 'ElSelect',
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: `
    <select class="select-stub" @change="onChange">
      <option value="">全部</option>
      <slot />
    </select>
  `,
  methods: {
    onChange(event) {
      this.$emit('update:modelValue', event.target.value)
      this.$emit('change', event.target.value)
    }
  }
}

const OptionStub = {
  name: 'ElOption',
  props: ['label', 'value'],
  template: '<option :value="value">{{ label }}</option>'
}

const DatePickerStub = {
  name: 'ElDatePicker',
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: `
    <input
      class="date-picker-stub"
      type="month"
      :value="modelValue"
      @input="onInput"
    />
  `,
  methods: {
    onInput(event) {
      this.$emit('update:modelValue', event.target.value)
      this.$emit('change', event.target.value)
    }
  }
}

const ButtonStub = {
  name: 'ElButton',
  props: ['loading', 'disabled'],
  emits: ['click'],
  template: `
    <button class="button-stub" :disabled="disabled || loading" @click="$emit('click')">
      <slot />
    </button>
  `
}

const ButtonGroupStub = { name: 'ElButtonGroup', template: '<div class="button-group-stub"><slot /></div>' }

const CardStub = { name: 'ElCard', template: '<section class="card-stub"><slot /><slot name="header" /></section>' }
const AlertStub = { name: 'ElAlert', template: '<div class="alert-stub"><slot /></div>' }
const EmptyStub = { name: 'ElEmpty', template: '<div class="empty-stub"><slot /></div>' }
const SkeletonStub = { name: 'ElSkeleton', template: '<div class="skeleton-stub"></div>' }

const flush = () => new Promise(resolve => setTimeout(resolve))

describe('ScheduleOverview.vue', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    messageMock.ElMessage.error.mockReset()
    if (typeof HTMLAnchorElement !== 'undefined') {
      HTMLAnchorElement.prototype.click = vi.fn()
    }
  })

  function setupApiMocks({
    overview,
    organizations = [],
    departments = [],
    subDepartments = [],
    exportResponse
  }) {
    const responses = {
      '/api/organizations': { ok: true, json: async () => organizations },
      '/api/departments': { ok: true, json: async () => departments },
      '/api/sub-departments': { ok: true, json: async () => subDepartments },
      '/api/schedules/overview': { ok: true, json: async () => overview },
      '/api/schedules/overview/export':
        exportResponse || { ok: true, blob: async () => new Blob(['test'], { type: 'application/octet-stream' }) }
    }

    apiFetch.mockImplementation(async url => {
      const parsed = new URL(url, 'http://localhost')
      const { pathname } = parsed
      if (responses[pathname]) {
        return typeof responses[pathname] === 'function' ? responses[pathname](parsed) : responses[pathname]
      }
      throw new Error(`Unexpected fetch path: ${pathname}`)
    })
  }

  it('renders hierarchical overview table', async () => {
    const month = dayjs().format('YYYY-MM')
    const dayList = [`${month}-01`, `${month}-02`]

    setupApiMocks({
      organizations: [{ _id: 'org-1', name: '台北總院' }],
      departments: [{ _id: 'dept-1', name: '內科部', organization: 'org-1' }],
      subDepartments: [{ _id: 'sub-1', name: '急診一科', department: 'dept-1' }],
      overview: {
        month,
        days: dayList,
        organizations: [
          {
            id: 'org-1',
            name: '台北總院',
            departments: [
              {
                id: 'dept-1',
                name: '內科部',
                subDepartments: [
                  {
                    id: 'sub-1',
                    name: '急診一科',
                    employees: [
                      {
                        id: 'emp-1',
                        name: 'Alice',
                        title: '護理師',
                        schedules: [
                          { date: dayList[0], shiftId: 's1', shiftName: '早班' },
                          { date: dayList[1], shiftId: 's2', shiftName: '小夜班' }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    })

    const wrapper = shallowMount(ScheduleOverview, {
      global: {
        stubs: {
          'el-card': CardStub,
          'el-select': SelectStub,
          'el-option': OptionStub,
          'el-date-picker': DatePickerStub,
          'el-button': ButtonStub,
          'el-button-group': ButtonGroupStub,
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-alert': AlertStub,
          'el-empty': EmptyStub,
          'el-skeleton': SkeletonStub
        }
      }
    })

    await flush()
    await flush()

    const organizations = wrapper.findAll('[data-test="organization-block"]')
    expect(organizations).toHaveLength(1)
    expect(organizations[0].text()).toContain('台北總院')

    const unitBlocks = wrapper.findAll('[data-test="subdepartment-block"]')
    expect(unitBlocks).toHaveLength(1)
    expect(unitBlocks[0].text()).toContain('急診一科')
    expect(unitBlocks[0].text()).toContain('Alice')
    expect(unitBlocks[0].text()).toContain('早班')
    expect(unitBlocks[0].text()).toContain('小夜班')

    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/schedules/overview?month=${month}`))
    expect(messageMock.ElMessage.error).not.toHaveBeenCalled()
  })

  it('triggers export with current filters', async () => {
    const month = dayjs().format('YYYY-MM')
    const createObjectURL = vi.fn(() => 'blob:url')
    const revokeSpy = vi.fn()
    global.URL.createObjectURL = createObjectURL
    global.URL.revokeObjectURL = revokeSpy

    setupApiMocks({
      organizations: [{ _id: 'org-1', name: '台北總院' }],
      departments: [{ _id: 'dept-1', name: '內科部', organization: 'org-1' }],
      subDepartments: [{ _id: 'sub-1', name: '急診一科', department: 'dept-1' }],
      overview: { month, days: [], organizations: [] }
    })

    const wrapper = shallowMount(ScheduleOverview, {
      global: {
        stubs: {
          'el-card': CardStub,
          'el-select': SelectStub,
          'el-option': OptionStub,
          'el-date-picker': DatePickerStub,
          'el-button': ButtonStub,
          'el-button-group': ButtonGroupStub,
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-alert': AlertStub,
          'el-empty': EmptyStub,
          'el-skeleton': SkeletonStub
        }
      }
    })

    await flush()
    await flush()

    wrapper.vm.selectedOrganization = 'org-1'
    wrapper.vm.selectedDepartment = 'dept-1'
    wrapper.vm.selectedSubDepartment = 'sub-1'
    await wrapper.vm.$nextTick()

    const exportButton = wrapper.find('[data-test="export-excel"]')
    await exportButton.trigger('click')
    await flush()

    const exportCall = apiFetch.mock.calls.find(call => call[0].includes('/api/schedules/overview/export'))
    expect(exportCall[0]).toContain(`month=${month}`)
    expect(exportCall[0]).toContain('organization=org-1')
    expect(exportCall[0]).toContain('department=dept-1')
    expect(exportCall[0]).toContain('subDepartment=sub-1')
    expect(exportCall[0]).toContain('format=excel')
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalled()
  })

  it('shows error message when export fails', async () => {
    const month = dayjs().format('YYYY-MM')
    setupApiMocks({
      organizations: [{ _id: 'org-1', name: '台北總院' }],
      departments: [{ _id: 'dept-1', name: '內科部', organization: 'org-1' }],
      subDepartments: [{ _id: 'sub-1', name: '急診一科', department: 'dept-1' }],
      overview: { month, days: [], organizations: [] },
      exportResponse: { ok: false, json: async () => ({ error: '無法匯出' }) }
    })

    const wrapper = shallowMount(ScheduleOverview, {
      global: {
        stubs: {
          'el-card': CardStub,
          'el-select': SelectStub,
          'el-option': OptionStub,
          'el-date-picker': DatePickerStub,
          'el-button': ButtonStub,
          'el-button-group': ButtonGroupStub,
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-alert': AlertStub,
          'el-empty': EmptyStub,
          'el-skeleton': SkeletonStub
        }
      }
    })

    await flush()
    await flush()

    const exportButton = wrapper.find('[data-test="export-pdf"]')
    await exportButton.trigger('click')
    await flush()

    expect(messageMock.ElMessage.error).toHaveBeenCalledWith('無法匯出')
    const exportCall = apiFetch.mock.calls.find(call => call[0].includes('/api/schedules/overview/export'))
    expect(exportCall[0]).toContain('format=pdf')
  })

  it('allows exporting without department selection and sets correct filename', async () => {
    const month = dayjs().format('YYYY-MM')
    const createObjectURL = vi.fn(() => 'blob:url')
    const revokeSpy = vi.fn()
    const originalCreateElement = document.createElement
    const linkMock = originalCreateElement.call(document, 'a')
    const clickSpy = vi.spyOn(linkMock, 'click')
    const originalCreateObjectURL = global.URL.createObjectURL
    const originalRevokeObjectURL = global.URL.revokeObjectURL
    global.URL.createObjectURL = createObjectURL
    global.URL.revokeObjectURL = revokeSpy
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      if (tag === 'a') return linkMock
      return originalCreateElement.call(document, tag, options)
    })

    setupApiMocks({
      organizations: [{ _id: 'org-1', name: '台北總院' }],
      departments: [{ _id: 'dept-1', name: '內科部', organization: 'org-1' }],
      subDepartments: [{ _id: 'sub-1', name: '急診一科', department: 'dept-1' }],
      overview: { month, days: [], organizations: [] }
    })

    const wrapper = shallowMount(ScheduleOverview, {
      global: {
        stubs: {
          'el-card': CardStub,
          'el-select': SelectStub,
          'el-option': OptionStub,
          'el-date-picker': DatePickerStub,
          'el-button': ButtonStub,
          'el-button-group': ButtonGroupStub,
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-alert': AlertStub,
          'el-empty': EmptyStub,
          'el-skeleton': SkeletonStub
        }
      }
    })

    await flush()
    await flush()

    wrapper.vm.selectedOrganization = 'org-1'
    wrapper.vm.selectedDepartment = ''
    await wrapper.vm.$nextTick()

    const exportButton = wrapper.find('[data-test="export-pdf"]')
    await exportButton.trigger('click')
    await flush()

    const exportCall = apiFetch.mock.calls.find(call => call[0].includes('/api/schedules/overview/export'))
    expect(exportCall[0]).toContain(`month=${month}`)
    expect(exportCall[0]).toContain('organization=org-1')
    expect(exportCall[0]).not.toContain('department=')
    expect(exportCall[0]).toContain('format=pdf')
    expect(linkMock.download).toBe(`班表總覽_${month}_台北總院_全部部門_全部小單位.pdf`)
    expect(clickSpy).toHaveBeenCalled()

    createElementSpy.mockRestore()
    global.URL.createObjectURL = originalCreateObjectURL
    global.URL.revokeObjectURL = originalRevokeObjectURL
  })

  it('shows error message when overview request fails', async () => {
    const month = dayjs().format('YYYY-MM')
    apiFetch.mockImplementation(async url => {
      const parsed = new URL(url, 'http://localhost')
      const { pathname } = parsed
      if (pathname === '/api/organizations' || pathname === '/api/departments' || pathname === '/api/sub-departments') {
        return { ok: true, json: async () => [] }
      }
      if (pathname === '/api/schedules/overview') {
        return { ok: false, json: async () => ({ error: '後端錯誤' }) }
      }
      throw new Error('Unexpected path')
    })

    const wrapper = shallowMount(ScheduleOverview, {
      global: {
        stubs: {
          'el-card': CardStub,
          'el-select': SelectStub,
          'el-option': OptionStub,
          'el-date-picker': DatePickerStub,
          'el-button': ButtonStub,
          'el-button-group': ButtonGroupStub,
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-alert': AlertStub,
          'el-empty': EmptyStub,
          'el-skeleton': SkeletonStub
        }
      }
    })

    await flush()
    await flush()

    expect(messageMock.ElMessage.error).toHaveBeenCalledWith('後端錯誤')
    expect(wrapper.find('.alert-stub').text()).toContain('後端錯誤')
    expect(wrapper.findAll('[data-test="organization-block"]').length).toBe(0)
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/schedules/overview?month=${month}`))
  })
})
