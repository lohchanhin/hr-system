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

const CardStub = { name: 'ElCard', template: '<section class="card-stub"><slot /><slot name="header" /></section>' }
const AlertStub = { name: 'ElAlert', template: '<div class="alert-stub"><slot /></div>' }
const EmptyStub = { name: 'ElEmpty', template: '<div class="empty-stub"><slot /></div>' }
const SkeletonStub = { name: 'ElSkeleton', template: '<div class="skeleton-stub"></div>' }

const flush = () => new Promise(resolve => setTimeout(resolve))

describe('ScheduleOverview.vue', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    messageMock.ElMessage.error.mockReset()
  })

  function setupApiMocks({ overview, organizations = [], departments = [], subDepartments = [] }) {
    const responses = {
      '/api/organizations': { ok: true, json: async () => organizations },
      '/api/departments': { ok: true, json: async () => departments },
      '/api/sub-departments': { ok: true, json: async () => subDepartments },
      '/api/schedules/overview': { ok: true, json: async () => overview }
    }

    apiFetch.mockImplementation(async url => {
      const parsed = new URL(url, 'http://localhost')
      const { pathname } = parsed
      if (responses[pathname]) {
        return responses[pathname]
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
