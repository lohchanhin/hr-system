import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { buildShiftStyle } from '../src/utils/shiftColors'
import { ROW_COLOR_PALETTE } from '../src/utils/rowColors'
import { useAuthStore } from '../src/stores/auth'
const notificationDrawerStyles = readFileSync(
  'src/views/front/ScheduleNotificationDrawer.scss',
  'utf8'
)

const elementPlusMock = vi.hoisted(() => {
  const ElMessage = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
  const ElMessageBox = { alert: vi.fn(), confirm: vi.fn() }
  const loadingInstances = []
  const loadingServiceMock = vi.fn(() => {
    const instance = { close: vi.fn() }
    loadingInstances.push(instance)
    return instance
  })
  return {
    module: {
      ElMessage,
      ElMessageBox,
      ElLoading: { service: loadingServiceMock }
    },
    ElMessage,
    ElMessageBox,
    loadingInstances,
    loadingServiceMock
  }
})

vi.mock('element-plus', () => elementPlusMock.module)

const { ElMessage, ElMessageBox, loadingInstances, loadingServiceMock } = elementPlusMock
global.ElMessage = ElMessage

vi.mock('../src/api', () => ({ apiFetch: vi.fn(), importScheduleRecords: vi.fn() }))
const encodeBase64 = data => Buffer.from(data, 'utf8').toString('base64')
const createToken = payload => `stub.${encodeBase64(JSON.stringify(payload ?? {}))}.sig`
const setRoleToken = role => {
  if (role) {
    localStorage.setItem('token', createToken({ role }))
  } else {
    localStorage.removeItem('token')
  }
}

const styleToObject = style =>
  String(style || '')
    .split(';')
    .map(segment => segment.trim())
    .filter(Boolean)
    .reduce((acc, segment) => {
      const [prop, value] = segment.split(':')
      if (prop && value) {
        acc[prop.trim()] = value.trim()
      }
      return acc
    }, {})
const pushMock = vi.fn()
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

import { apiFetch, importScheduleRecords } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

describe('Schedule.vue', () => {
  const originalDocumentCreateElement = document.createElement

  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    importScheduleRecords.mockReset()
    ElMessage.error.mockReset()
    ElMessage.success.mockReset()
    ElMessage.warning.mockReset()
    ElMessage.info.mockReset()
    ElMessageBox.alert.mockReset()
    ElMessageBox.confirm.mockReset()
    ElMessageBox.confirm.mockResolvedValue()
    loadingServiceMock.mockClear()
    loadingInstances.length = 0
    pushMock.mockReset()
    sessionStorage.clear()
    localStorage.clear()
    setRoleToken('employee')
    if (typeof window !== 'undefined') {
      window.ElMessage = global.ElMessage
    }
  })

  afterEach(() => {
    document.createElement = originalDocumentCreateElement
    vi.unstubAllGlobals()
  })

  function mountSchedule(options = {}) {
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
        <div class="col" :data-label="label" :data-fixed="fixed || ''" :data-width="width || ''" :data-class-name="className || ''">
          <div class="col-header"><slot name="header"></slot></div>
          <div
            v-for="row in (tableContext?.data || [])"
            :key="row && (row._id || row.id || row.name || JSON.stringify(row))"
            class="cell"
          >
            <slot :row="row"></slot>
          </div>
        </div>
      `
    }
    const SelectStub = {
      name: 'ElSelect',
      props: ['modelValue', 'disabled'],
      emits: ['update:modelValue', 'change'],
      template: '<select v-bind="$attrs" :disabled="disabled"><slot></slot></select>'
    }
    const OptionStub = {
      name: 'ElOption',
      props: ['label', 'value'],
      template: '<option :value="value"><slot>{{ label }}</slot></option>'
    }
    const StepsStub = {
      name: 'ElSteps',
      props: ['active'],
      template: '<div class="steps-stub" :data-active="active"><slot></slot></div>'
    }
    const StepStub = {
      name: 'ElStep',
      props: ['title', 'description', 'status'],
      template:
        '<div class="step-stub" :data-title="title" :data-status="status"><slot></slot><div class="step-description">{{ description }}</div></div>'
    }
    const CheckboxStub = {
      name: 'ElCheckbox',
      inheritAttrs: false,
      props: ['modelValue', 'disabled'],
      emits: ['change'],
      template:
        '<label class="checkbox-stub"><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" /><slot></slot></label>'
    }
    const InputStub = { name: 'ElInput', template: '<input v-bind="$attrs" />' }
    const PopoverStub = {
      name: 'ElPopover',
      template: '<div class="popover-stub"><slot></slot><slot name="reference"></slot></div>'
    }
    const TagStub = { name: 'ElTag', template: '<span v-bind="$attrs"><slot></slot></span>' }
    const TooltipStub = { name: 'ElTooltip', template: '<span class="tooltip-stub"><slot></slot></span>' }
    const ButtonStub = { name: 'ElButton', template: '<button v-bind="$attrs"><slot></slot></button>' }
    const ProgressStub = {
      name: 'ElProgress',
      props: ['percentage'],
      template: '<div class="progress-stub" :data-percentage="percentage"></div>'
    }
    const PaginationStub = {
      name: 'ElPagination',
      emits: ['current-change', 'size-change'],
      template: '<div class="pagination-stub"><slot></slot></div>'
    }
    const SwitchStub = {
      name: 'ElSwitch',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template: '<input type="checkbox" />'
    }
    const DividerStub = { name: 'ElDivider', template: '<div class="divider-stub"></div>' }
    const DescriptionsStub = {
      name: 'ElDescriptions',
      template: '<div class="descriptions-stub"><slot></slot></div>'
    }
    const DescriptionsItemStub = {
      name: 'ElDescriptionsItem',
      template: '<div class="descriptions-item-stub"><slot></slot></div>'
    }
    const DialogStub = {
      name: 'ElDialog',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template: '<div class="dialog-stub"><slot></slot></div>'
    }
    const DrawerStub = {
      name: 'ElDrawer',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template: '<aside class="drawer-stub"><slot></slot></aside>'
    }
    const AlertStub = {
      name: 'ElAlert',
      props: ['title', 'type'],
      template: '<div class="alert-stub" :data-type="type">{{ title }}</div>'
    }
    const TimelineStub = { name: 'ElTimeline', template: '<div class="timeline-stub"><slot></slot></div>' }
    const TimelineItemStub = {
      name: 'ElTimelineItem',
      template: '<div class="timeline-item-stub"><slot></slot></div>'
    }
    const baseStubs = {
      'el-date-picker': true,
      'el-table': TableStub,
      'el-table-column': ColumnStub,
      'el-select': SelectStub,
      'el-option': OptionStub,
      'el-steps': StepsStub,
      'el-step': StepStub,
      'el-checkbox': CheckboxStub,
      'el-input': InputStub,
      'el-popover': PopoverStub,
      'el-tag': TagStub,
      'el-tooltip': TooltipStub,
      'el-button': ButtonStub,
      'el-progress': ProgressStub,
      'el-pagination': PaginationStub,
      'el-switch': SwitchStub,
      'el-divider': DividerStub,
      'el-descriptions': DescriptionsStub,
      'el-descriptions-item': DescriptionsItemStub,
      'el-dialog': DialogStub,
      'el-drawer': DrawerStub,
      'el-badge': { name: 'ElBadge', template: '<span class="badge-stub"><slot></slot></span>' },
      'el-icon': { name: 'ElIcon', template: '<span class="icon-stub"><slot></slot></span>' },
      'el-empty': { name: 'ElEmpty', template: '<div class="empty-stub"></div>' },
      'el-alert': AlertStub,
      'el-timeline': TimelineStub,
      'el-timeline-item': TimelineItemStub,
      ScheduleDashboard: { name: 'ScheduleDashboard', template: '<div class="dashboard-stub"></div>', props: ['summary'] }
    }
    const optionGlobal = options.global || {}
    return shallowMount(Schedule, {
      ...options,
      global: {
        ...optionGlobal,
        stubs: {
          ...baseStubs,
          ...(optionGlobal.stubs || {})
        }
      }
    })
  }

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  function setupSupervisorApiMock({
    summary = [],
    shifts = [],
    departments = [{ _id: 'd1', name: 'Dept A' }],
    subDepartments = [
      { _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }
    ],
    employees = [],
    directReports = [],
    monthlyWithSelf = [],
    monthlyWithoutSelf = [],
    approvals = [],
    leaves = [],
    memos = [],
    memoHandler,
    batchDeleteHandler,
    leaveApprovalsHandler,
    publishHandler,
    finalizeHandler,
    publishResult = null,
    finalizeResult = null,
    exportResponse = null,
    publishSummary,
    supervisorProfile = {
      _id: 'sup1',
      name: '主管',
      department: { _id: 'd1', name: 'Dept A' },
      subDepartment: { _id: 'sd1', name: 'Sub A' }
    },
    includeSelfPreference = false
  } = {}) {
    const buildSummaryFromSchedules = list => {
      const employeeMap = new Map()
      let latestPublishedAt = null
      let hasPublished = false
      let hasDisputed = false
      let hasFinalized = false
      list.forEach(item => {
        if (!item) return
        const state = item.state || 'draft'
        const response = item.employeeResponse || 'pending'
        const employee = item.employee || {}
        const rawId = employee._id ?? employee.id ?? item.employee
        const id = rawId ? String(rawId) : ''
        const name = employee?.name || item.employeeName || id
        if (state !== 'draft') hasPublished = true
        if (state === 'changes_requested' || response === 'disputed') hasDisputed = true
        if (state === 'finalized') hasFinalized = true
        if (item?.publishedAt) {
          const published = new Date(item.publishedAt)
          if (!Number.isNaN(published)) {
            if (!latestPublishedAt || latestPublishedAt < published) {
              latestPublishedAt = published
            }
          }
        }
        if (!id) return
        if (!employeeMap.has(id)) {
          employeeMap.set(id, {
            id,
            name: name || id,
            pendingCount: 0,
            disputedCount: 0,
            latestNote: '',
            latestResponseAt: null,
            disputes: []
          })
        }
        const entry = employeeMap.get(id)
        if (state === 'pending_confirmation' && response === 'pending') entry.pendingCount += 1
        if (response === 'disputed' || state === 'changes_requested') {
          entry.disputedCount += 1
          if (item?.responseNote) entry.latestNote = item.responseNote
          entry.disputes.push({
            date: item.date,
            note: item.responseNote || '',
            responseAt: item.responseAt
          })
        }
        if (item?.responseAt) {
          const responded = new Date(item.responseAt)
          if (!Number.isNaN(responded)) {
            if (!entry.latestResponseAt || entry.latestResponseAt < responded) {
              entry.latestResponseAt = responded
            }
          }
        }
      })
      const pendingEmployees = []
      const disputedEmployees = []
      employeeMap.forEach(entry => {
        if (entry.pendingCount > 0) pendingEmployees.push({ id: entry.id, name: entry.name, pendingCount: entry.pendingCount })
        if (entry.disputedCount > 0) {
          disputedEmployees.push({
            id: entry.id,
            name: entry.name,
            disputedCount: entry.disputedCount,
            latestNote: entry.latestNote,
            latestResponseAt: entry.latestResponseAt ? entry.latestResponseAt.toISOString() : null,
            disputes: entry.disputes
          })
        }
      })
      let status = 'draft'
      if (hasFinalized) status = 'finalized'
      else if (hasDisputed) status = 'disputed'
      else if (hasPublished) status = pendingEmployees.length ? 'pending' : 'ready'

      return {
        status,
        pendingEmployees,
        disputedEmployees,
        publishedAt: latestPublishedAt ? latestPublishedAt.toISOString() : null,
        hasSchedules: list.length > 0,
        totalEmployees: employeeMap.size,
        allEmployeesConfirmed: status === 'ready' && pendingEmployees.length === 0 && disputedEmployees.length === 0
      }
    }

    apiFetch.mockImplementation(async (url, options = {}) => {
      const parsed = new URL(url, 'http://localhost')
      const { pathname, searchParams } = parsed

      if (pathname === '/api/schedules/summary') {
        return { ok: true, json: async () => summary }
      }
      if (pathname === '/api/schedules/preferences/include-self') {
        if ((options.method || 'GET').toUpperCase() === 'PUT') {
          return { ok: true, json: async () => ({ includeSelf: includeSelfPreference }) }
        }
        return { ok: true, json: async () => ({ includeSelf: includeSelfPreference }) }
      }

      if (pathname === '/api/shifts') {
        return { ok: true, json: async () => shifts }
      }

      if (pathname === `/api/employees/${supervisorProfile?._id ?? ''}`) {
        return { ok: true, json: async () => supervisorProfile }
      }

      if (
        pathname === '/api/employees/schedule'
        && searchParams.get('supervisor')
        && searchParams.get('pageSize') === '200'
        && !searchParams.has('department')
      ) {
        return { ok: true, json: async () => ({ employees: directReports }) }
      }

      if (pathname === '/api/employees/schedule') {
        const page = Number(searchParams.get('page') || 1)
        const pageSize = Number(searchParams.get('pageSize') || employees.length || 20)
        const search = String(searchParams.get('search') || '').trim().toLowerCase()
        let filteredEmployees = search
          ? employees.filter(employee => String(employee?.name || '').toLowerCase().includes(search))
          : employees
        const status = searchParams.get('status')
        const scheduleSource = [...monthlyWithoutSelf, ...monthlyWithSelf]
        const scheduledIds = new Set(
          scheduleSource
            .filter(item => item?.shiftId)
            .map(item => String(item?.employee?._id || item?.employee || ''))
            .filter(Boolean)
        )
        const leaveIds = new Set(
          leaves
            .map(item => String(item?.employee?._id || item?.employee || ''))
            .filter(Boolean)
        )
        if (status === 'unscheduled') {
          filteredEmployees = filteredEmployees.filter(employee =>
            !scheduledIds.has(String(employee?._id || '')) &&
            !leaveIds.has(String(employee?._id || ''))
          )
        } else if (status === 'onLeave') {
          filteredEmployees = filteredEmployees.filter(employee =>
            leaveIds.has(String(employee?._id || ''))
          )
        }
        const pageEmployees = filteredEmployees.slice((page - 1) * pageSize, page * pageSize)
        return {
          ok: true,
          json: async () => ({
            employees: pageEmployees,
            pagination: {
              page,
              pageSize,
              total: filteredEmployees.length,
              totalPages: Math.max(1, Math.ceil(filteredEmployees.length / pageSize))
            }
          })
        }
      }

      if (pathname === '/api/employees') {
        const supervisorId = searchParams.get('supervisor')
        const hasDepartment = searchParams.has('department')
        if (supervisorId && !hasDepartment && searchParams.size === 1) {
          return { ok: true, json: async () => directReports }
        }
        if (hasDepartment) {
          return { ok: true, json: async () => employees }
        }
        return { ok: true, json: async () => employees }
      }

      if (pathname === '/api/departments') {
        return { ok: true, json: async () => departments }
      }

      if (pathname === '/api/sub-departments') {
        return { ok: true, json: async () => subDepartments }
      }

      if (pathname === '/api/schedules/monthly') {
        const includeSelf = searchParams.get('includeSelf') === 'true'
        const employeeIdsParam = searchParams.get('employeeIds')
        const page = Number(searchParams.get('page') || 1)
        const limit = Number(searchParams.get('limit') || 20)
        const sourceList = includeSelf ? monthlyWithSelf : monthlyWithoutSelf
        let schedules = sourceList
        if (employeeIdsParam) {
          const allowed = new Set(employeeIdsParam.split(',').filter(Boolean))
          schedules = sourceList.filter(item => {
            const rawId = item?.employee?._id || item?.employee
            return rawId && allowed.has(String(rawId))
          })
        } else if (page > 0 && limit > 0) {
          const uniqueIds = []
          sourceList.forEach(item => {
            const rawId = item?.employee?._id || item?.employee
            const id = rawId ? String(rawId) : ''
            if (id && !uniqueIds.includes(id)) uniqueIds.push(id)
          })
          const allowed = new Set(uniqueIds.slice((page - 1) * limit, (page - 1) * limit + limit))
          schedules = sourceList.filter(item => {
            const rawId = item?.employee?._id || item?.employee
            return rawId && allowed.has(String(rawId))
          })
        }
        const summaryPayload = publishSummary || buildSummaryFromSchedules(sourceList)
        return {
          ok: true,
          json: async () => ({
            schedules,
            publishSummary: summaryPayload,
            pagination: { page, limit, totalEmployees: summaryPayload.totalEmployees }
          })
        }
      }

      if (pathname === '/api/schedules/leave-approvals') {
        if (typeof leaveApprovalsHandler === 'function') {
          const handled = await leaveApprovalsHandler({ searchParams })
          if (handled) return handled
        }
        return {
          ok: true,
          json: async () => ({ approvals, leaves })
        }
      }

      if (pathname === '/api/schedules/publish') {
        if (typeof publishHandler === 'function') {
          const handled = await publishHandler({ url, options })
          if (handled) return handled
        }
        const resolved =
          publishResult ?? { updated: 0, publishedAt: new Date().toISOString(), employees: [] }
        return { ok: true, json: async () => resolved }
      }

      if (pathname === '/api/schedules/publish/finalize') {
        if (typeof finalizeHandler === 'function') {
          const handled = await finalizeHandler({ url, options })
          if (handled) return handled
        }
        const resolved = finalizeResult ?? { finalized: 0 }
        return { ok: true, json: async () => resolved }
      }

      if (pathname === '/api/schedules/memos') {
        return { ok: true, json: async () => memos }
      }

      if (pathname.startsWith('/api/schedules/memos/')) {
        if (typeof memoHandler === 'function') {
          const handled = await memoHandler({ url, options })
          if (handled) return handled
        }
        const content = JSON.parse(options.body || '{}').content || ''
        return { ok: true, json: async () => ({ date: pathname.split('/').pop(), content }) }
      }

      if (pathname === '/api/schedules/batch-delete') {
        if (typeof batchDeleteHandler === 'function') {
          const handled = await batchDeleteHandler({ url, options })
          if (handled) return handled
        }
        const ids = JSON.parse(options.body || '{}').ids || []
        return { ok: true, json: async () => ({ deleted: ids.length, ids }) }
      }

      if (pathname === '/api/schedules/export') {
        return exportResponse || {
          ok: true,
          blob: async () => new Blob(['schedule-export'])
        }
      }

      return { ok: true, json: async () => [] }
    })
  }

  it('includes supervisor id in requests when present', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      directReports: [
        { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
      ],
      employees: [
        {
          _id: 'e1',
          name: 'Employee 1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        }
      ]
    })
    const wrapper = mountSchedule()
    await flush()
    const month = wrapper.vm.currentMonth
    expect(apiFetch).toHaveBeenCalledWith('/api/employees/schedule?supervisor=sup1&pageSize=200')
    const employeesCall = apiFetch.mock.calls
      .map(([url]) => url)
      .find(url => url.startsWith('/api/employees/schedule?') && url.includes('department='))
    expect(employeesCall).toContain('supervisor=sup1')
    expect(employeesCall).toContain('department=d1')
    expect(employeesCall).toContain('subDepartment=sd1')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toContain(`month=${month}`)
    expect(monthlyCall?.[0]).toContain('supervisor=sup1')
    expect(monthlyCall?.[0]).toContain('employeeIds=')
  })

  it('computes publish summary with pending and disputed responses', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    const scheduleData = [
      {
        _id: 'sch1',
        employee: { _id: 'emp1', name: 'Alice' },
        date: `${month}-01`,
        shiftId: 'shiftA',
        state: 'pending_confirmation',
        employeeResponse: 'pending',
        publishedAt: '2024-04-20T00:00:00.000Z'
      },
      {
        _id: 'sch2',
        employee: { _id: 'emp2', name: 'Bob' },
        date: `${month}-02`,
        shiftId: 'shiftA',
        state: 'changes_requested',
        employeeResponse: 'disputed',
        responseNote: '想調整班別',
        responseAt: '2024-04-21T01:00:00.000Z',
        publishedAt: '2024-04-20T00:00:00.000Z'
      }
    ]

    setupSupervisorApiMock({
      monthlyWithoutSelf: scheduleData,
      shifts: [{ _id: 'shiftA', name: '白班' }],
      departments: [{ _id: 'd1', name: 'Dept A' }],
      subDepartments: [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }],
      directReports: [],
      employees: []
    })

    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.vm.publishSummary.status).toBe('disputed')
    expect(wrapper.vm.publishSummary.pendingEmployees).toHaveLength(1)
    expect(wrapper.vm.publishSummary.pendingEmployees[0]).toMatchObject({ id: 'emp1' })
    expect(wrapper.vm.publishSummary.disputedEmployees).toHaveLength(1)
    expect(wrapper.vm.publishSummary.disputedEmployees[0]).toMatchObject({ id: 'emp2' })
    expect(wrapper.vm.publishSummary.publishedAt).toBe('2024-04-20T00:00:00.000Z')
  })

  it('顯示草稿狀態的發布步驟與徽章', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      monthlyWithSelf: [],
      monthlyWithoutSelf: [],
      employees: [],
      directReports: []
    })

    const wrapper = mountSchedule()
    await flush()

    const badge = wrapper.find('[data-test="publish-status-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('尚未發布')
    const steps = wrapper.find('.steps-stub')
    expect(steps.attributes('data-active')).toBe('0')
    expect(wrapper.find('[data-test="pending-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="disputed-card"]').exists()).toBe(false)
  })

  it('以卡片呈現待回覆與異議統計並更新步驟', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const scheduleData = [
      {
        _id: 'sch1',
        employee: { _id: 'emp1', name: 'Alice' },
        date: `${month}-01`,
        shiftId: 'shiftA',
        state: 'pending_confirmation',
        employeeResponse: 'pending',
        publishedAt: '2024-04-20T00:00:00.000Z'
      },
      {
        _id: 'sch2',
        employee: { _id: 'emp2', name: 'Bob' },
        date: `${month}-02`,
        shiftId: 'shiftA',
        state: 'changes_requested',
        employeeResponse: 'disputed',
        responseNote: '想調整班別',
        publishedAt: '2024-04-20T00:00:00.000Z'
      }
    ]

    setupSupervisorApiMock({
      monthlyWithoutSelf: scheduleData,
      monthlyWithSelf: scheduleData,
      shifts: [{ _id: 'shiftA', name: '白班' }],
      departments: [{ _id: 'd1', name: 'Dept A' }],
      subDepartments: [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }],
      directReports: [],
      employees: []
    })

    const wrapper = mountSchedule()
    await flush()

    const steps = wrapper.find('.steps-stub')
    expect(steps.attributes('data-active')).toBe('2')
    const pendingCard = wrapper.find('[data-test="pending-card"]')
    expect(pendingCard.exists()).toBe(true)
    expect(pendingCard.find('.card-badge').text()).toBe('1')
    expect(pendingCard.text()).toContain('Alice')
    const disputedCard = wrapper.find('[data-test="disputed-card"]')
    expect(disputedCard.exists()).toBe(true)
    expect(disputedCard.find('.card-badge').text()).toBe('1')
    expect(disputedCard.text()).toContain('Bob')
    const progress = wrapper.find('.progress-stub')
    expect(progress.exists()).toBe(true)
    expect(progress.attributes('data-percentage')).toBe('50')
  })

  it('appends department filters to leave approval requests', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const capturedParams = []
    setupSupervisorApiMock({
      monthlyWithSelf: [],
      monthlyWithoutSelf: [],
      employees: [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
      leaveApprovalsHandler: async ({ searchParams }) => {
        capturedParams.push(Object.fromEntries(searchParams.entries()))
        return { ok: true, json: async () => ({ approvals: [], leaves: [] }) }
      }
    })

    mountSchedule()
    await flush()

    expect(capturedParams.length).toBeGreaterThan(0)
    expect(capturedParams[0]).toMatchObject({
      month,
      department: 'd1',
      subDepartment: 'sd1'
    })
  })

  it('omits supervisor param when id missing', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('employee')
    setupSupervisorApiMock()
    mountSchedule()
    await flush()
    const employeesCall = apiFetch.mock.calls.find(([url]) => url.startsWith('/api/employees'))
    expect(employeesCall?.[0]).toContain('/api/employees/schedule?')
    expect(employeesCall?.[0]).not.toContain('supervisor=')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toContain(`month=${month}`)
    expect(monthlyCall?.[0]).not.toContain('supervisor=')
  })

  it('保留包含自己設定並在主管未排班時提示且保留指派能力', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    localStorage.setItem('schedule-include-self:sup1', 'true')
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: '員工A', department: 'd1', subDepartment: 'sd1' },
        { _id: 'sup1', name: '主管', department: 'd1', subDepartment: 'sd1' }
      ],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
      monthlyWithSelf: [],
      monthlyWithoutSelf: [],
      approvals: [],
      leaves: [],
      includeSelfPreference: true
    })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    expect(wrapper.vm.includeSelf).toBe(true)
    expect(wrapper.vm.employees.map(e => e._id)).toContain('sup1')
    expect(ElMessage.info).toHaveBeenCalledWith('尚未為主管建立班表，請先建立排班。')
  })

  it('refetches leave approvals when department changes', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const responses = {
      'd1|sd1': { approvals: [{ _id: 'a1', status: 'pending' }], leaves: [] },
      'd2|sd2': { approvals: [{ _id: 'a2', status: 'pending' }], leaves: [] }
    }
    const observed = []
    setupSupervisorApiMock({
      departments: [
        { _id: 'd1', name: 'Dept A' },
        { _id: 'd2', name: 'Dept B' }
      ],
      subDepartments: [
        { _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } },
        { _id: 'sd2', name: 'Sub B', department: { _id: 'd2' } }
      ],
      employees: [
        { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' },
        { _id: 'e2', name: 'E2', department: 'd2', subDepartment: 'sd2' }
      ],
      directReports: [
        { _id: 'e1', subDepartment: { _id: 'sd1' } },
        { _id: 'e2', subDepartment: { _id: 'sd2' } }
      ],
      leaveApprovalsHandler: async ({ searchParams }) => {
        const snapshot = Object.fromEntries(searchParams.entries())
        observed.push(snapshot)
        const key = `${snapshot.department || ''}|${snapshot.subDepartment || ''}`
        const payload = responses[key] || { approvals: [], leaves: [] }
        return { ok: true, json: async () => payload }
      },
      monthlyWithSelf: [],
      monthlyWithoutSelf: []
    })

    const wrapper = mountSchedule()
    await flush()

    expect(observed[0]).toMatchObject({ department: 'd1', subDepartment: 'sd1' })
    expect(wrapper.vm.approvalList).toEqual(responses['d1|sd1'].approvals)

    wrapper.vm.selectedDepartment = 'd2'
    await wrapper.vm.onDepartmentChange()
    await flush()

    expect(observed[observed.length - 1]).toMatchObject({ department: 'd2', subDepartment: 'sd2' })
    expect(wrapper.vm.approvalList).toEqual(responses['d2|sd2'].approvals)
  })

  it('僅顯示相關人員簽核資料，且隱藏班表確認簽核', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')

    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: '王小明', department: 'd1', subDepartment: 'sd1' },
        { _id: 'e2', name: '李小華', department: 'd1', subDepartment: 'sd1' }
      ],
      monthlyWithoutSelf: [
        {
          _id: 'm1',
          employee: { _id: 'e1', name: '王小明' },
          date: `${dayjs().add(1, 'month').format('YYYY-MM')}-01`,
          state: 'pending_confirmation',
          employeeResponse: 'pending'
        },
        {
          _id: 'm2',
          employee: { _id: 'e2', name: '李小華' },
          date: `${dayjs().add(1, 'month').format('YYYY-MM')}-01`,
          state: 'changes_requested',
          employeeResponse: 'disputed',
          responseNote: '想調整班別'
        }
      ],
      approvals: [
        {
          _id: 'ap1',
          status: 'pending',
          form: { _id: 'f1', name: '請假申請', category: 'leave' },
          applicant_employee: { _id: 'e1', name: '王小明' }
        },
        {
          _id: 'ap2',
          status: 'pending',
          form: { _id: 'f2', name: '加班單', category: '' },
          applicant_employee: { _id: 'e2', name: '李小華' },
          form_data: { reason: '支援專案' }
        },
        {
          _id: 'ap3',
          status: 'pending',
          form: { _id: 'f3', name: '請假申請', category: 'leave' },
          applicant_employee: { _id: 'e999', name: '外部員工' }
        }
      ],
      leaves: []
    })

    const wrapper = mountSchedule()
    await flush()
    await wrapper.vm.$nextTick()

    const rows = wrapper.vm.relatedApprovalRows
    expect(rows.some(row => row.applicantName === '外部員工')).toBe(false)
    expect(rows.some(row => row.sourceType === 'schedule_confirmation')).toBe(false)

    expect(wrapper.find('.approval-card').exists()).toBe(true)
    expect(wrapper.find('[data-test="approval-empty-hint"]').exists()).toBe(false)
  })

  it('切換頁碼與搜尋員工後，簽核清單會同步更新', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')

    const dynamicApprovals = [
      {
        _id: 'ap1',
        status: 'pending',
        form: { _id: 'f1', name: '請假申請', category: 'leave' },
        applicant_employee: { _id: 'e1', name: '王小明' }
      },
      {
        _id: 'ap2',
        status: 'pending',
        form: { _id: 'f2', name: '請假申請', category: 'leave' },
        applicant_employee: { _id: 'e2', name: '李小華' }
      }
    ]
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: '王小明', department: 'd1', subDepartment: 'sd1' },
        { _id: 'e2', name: '李小華', department: 'd1', subDepartment: 'sd1' }
      ],
      leaveApprovalsHandler: async () => ({
        ok: true,
        json: async () => ({ approvals: dynamicApprovals, leaves: [] })
      })
    })

    const wrapper = mountSchedule()
    await flush()
    await wrapper.vm.$nextTick()

    wrapper.vm.employees = [
      { _id: 'e1', name: '王小明', department: 'Dept A', subDepartment: 'Sub A' },
      { _id: 'e2', name: '李小華', department: 'Dept A', subDepartment: 'Sub A' }
    ]
    wrapper.vm.approvalList = dynamicApprovals

    wrapper.vm.onPageSizeChange(1)
    await flush()
    await flush()
    expect(wrapper.vm.visibleEmployees).toHaveLength(1)
    expect(wrapper.vm.leaveApprovalRows).toHaveLength(1)
    expect(wrapper.vm.leaveApprovalRows[0].applicant_employee._id).toBe(
      wrapper.vm.visibleEmployees[0]._id
    )

    wrapper.vm.onPageChange(2)
    await flush()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.visibleEmployees).toHaveLength(1)
    expect(wrapper.vm.leaveApprovalRows).toHaveLength(1)
    expect(wrapper.vm.leaveApprovalRows[0].applicant_employee._id).toBe(
      wrapper.vm.visibleEmployees[0]._id
    )

    wrapper.vm.employeeSearch = '王'
    await flush()
    await wrapper.vm.$nextTick()
    expect(
      wrapper.vm.leaveApprovalRows.map(row => row.applicant_employee._id)
    ).toEqual(['e1'])
  })

  it('點擊查看詳情仍可正常呼叫 openDetail', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      employees: [{ _id: 'e1', name: '王小明', department: 'd1', subDepartment: 'sd1' }],
      approvals: [
        {
          _id: 'ap1',
          status: 'pending',
          form: { _id: 'f1', name: '請假申請', category: 'leave' },
          applicant_employee: { _id: 'e1', name: '王小明' }
        }
      ],
      leaves: []
    })

    const wrapper = mountSchedule()
    await flush()
    await wrapper.vm.$nextTick()

    const detailRequestCount = apiFetch.mock.calls.filter(([url]) =>
      String(url).includes('/api/approvals/ap1')
    ).length
    await wrapper.vm.openDetail('ap1')
    await flush()

    expect(apiFetch.mock.calls.filter(([url]) =>
      String(url).includes('/api/approvals/ap1')
    )).toHaveLength(detailRequestCount)
    expect(wrapper.vm.detail.visible).toBe(true)
    expect(wrapper.vm.detail.approvalId).toBe('ap1')
  })

  it('簽核資料載入失敗時保留既有資料並顯示 fallback 提示', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      employees: [{ _id: 'e1', name: '王小明', department: 'd1', subDepartment: 'sd1' }],
      approvals: [
        {
          _id: 'ap1',
          status: 'pending',
          form: { _id: 'f1', name: '請假申請', category: 'leave' },
          applicant_employee: { _id: 'e1', name: '王小明' }
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedEmployees = new Set(['e1'])
    wrapper.vm.approvalList = [
      {
        _id: 'ap1',
        status: 'pending',
        form: { _id: 'f1', name: '請假申請', category: 'leave' },
        applicant_employee: { _id: 'e1', name: '王小明' }
      }
    ]
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.relatedApprovalRows).toHaveLength(1)
    expect(wrapper.vm.approvalFetchError).toBe('')

    apiFetch.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET'
      const path = String(url)
      if (path.startsWith('/api/schedules/leave-approvals') && method === 'GET') {
        return { ok: false, json: async () => ({ message: 'fail' }) }
      }
      if (path.startsWith('/api/schedules/monthly') && method === 'GET') {
        return { ok: true, json: async () => [] }
      }
      if (path.startsWith('/api/shifts') && method === 'GET') {
        return { ok: true, json: async () => [] }
      }
      if (path.startsWith('/api/schedules/summary') && method === 'GET') {
        return { ok: true, json: async () => [] }
      }
      if (path.startsWith('/api/departments') && method === 'GET') {
        return { ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] }
      }
      if (path.startsWith('/api/subdepartments') && method === 'GET') {
        return { ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }] }
      }
      if (path.startsWith('/api/employees/direct-report-subordinates') && method === 'GET') {
        return {
          ok: true,
          json: async () => [{ _id: 'e1', name: '王小明', department: 'd1', subDepartment: 'sd1' }]
        }
      }
      if (path.startsWith('/api/employees/me/profile') && method === 'GET') {
        return {
          ok: true,
          json: async () => ({ _id: 'sup1', department: { _id: 'd1' }, subDepartment: { _id: 'sd1' } })
        }
      }
      if (path.startsWith('/api/users/me/settings') && method === 'GET') {
        return { ok: true, json: async () => ({ scheduleIncludeSelf: false }) }
      }
      return { ok: true, json: async () => [] }
    })

    await wrapper.vm.fetchSchedules({ reset: true })
    await flush()

    expect(wrapper.vm.approvalList).toHaveLength(1)
    expect(wrapper.vm.approvalFetchError).toContain('簽核資料載入失敗')
    expect(wrapper.find('[data-test="approval-error-alert"]').exists()).toBe(true)
  })

  it('does not append supervisor param for employee role even when id exists', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('employee')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock()
    mountSchedule()
    await flush()
    const employeesCall = apiFetch.mock.calls.find(([url]) => url.startsWith('/api/employees'))
    expect(employeesCall?.[0]).toContain('/api/employees/schedule?')
    expect(employeesCall?.[0]).not.toContain('supervisor=')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toContain(`month=${month}`)
    expect(monthlyCall?.[0]).not.toContain('supervisor=')
  })

  it('fetches summary and passes to dashboard', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setupSupervisorApiMock({
      summary: [
        { shiftCount: 1, leaveCount: 0 },
        { shiftCount: 0, leaveCount: 1 }
      ],
      departments: [],
      subDepartments: []
    })
    const wrapper = mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith(`/api/schedules/summary?month=${month}`)
    const dash = wrapper.findComponent({ name: 'ScheduleDashboard' })
    expect(dash.props('summary')).toEqual({ direct: 2, unscheduled: 2, onLeave: 1 })
  })

  it('shows the 國定假日休假 button to people who can edit the schedule and loads the dialog only after it is pressed', async () => {
    setRoleToken('supervisor')
    setupSupervisorApiMock({})
    const wrapper = mountSchedule()
    await flush()
    const ledgerCalls = () => apiFetch.mock.calls.filter(([url]) => String(url).includes('/api/holiday-ledger'))

    const button = wrapper.find('[data-test="holiday-ledger-button"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('國定假日休假')
    // 沒按按鈕之前：不載入視窗元件，也不發任何假日紀錄請求
    expect(wrapper.vm.holidayLedgerRequested).toBe(false)
    expect(wrapper.vm.holidayLedgerVisible).toBe(false)
    expect(ledgerCalls()).toHaveLength(0)

    await button.trigger('click')
    await flush()

    expect(wrapper.vm.holidayLedgerRequested).toBe(true)
    expect(wrapper.vm.holidayLedgerVisible).toBe(true)
    // 視窗沿用目前排班頁的月份與範圍
    expect(wrapper.vm.holidayLedgerScope).toMatchObject({ month: wrapper.vm.currentMonth })
    wrapper.unmount()
  })

  it('does not show the 國定假日休假 button to an employee', async () => {
    setRoleToken('employee')
    setupSupervisorApiMock({})
    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.find('[data-test="holiday-ledger-button"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('loads shift options when API returns array directly', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 's1', code: 'S1', startTime: '08:00', endTime: '17:00', remark: 'R' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.shifts).toEqual([
      { _id: 's1', code: 'S1', name: '', startTime: '08:00', endTime: '17:00', remark: 'R' }
    ])
  })

  it('loads shift options when API returns object with shifts', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ shifts: [{ _id: 's1', code: 'S1', name: '早班', startTime: '08:00', endTime: '17:00', remark: 'R' }] })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.shifts).toEqual([
      { _id: 's1', code: 'S1', name: '早班', startTime: '08:00', endTime: '17:00', remark: 'R' }
    ])
  })

  it('keeps colour, semantic type, cross-day, night-shift and break fields so the configured colours show', async () => {
    const shifts = [
      {
        _id: 's1', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', semanticType: 'work',
        bgColor: '#336699', color: '#ffffff', crossDay: false, isNightShift: false,
        breakDuration: 60, breakMinutes: 60, breakTime: '12:00-13:00',
        breakWindows: [{ start: '12:00', end: '13:00', label: '午休' }], hasAllowance: true
      },
      { _id: 's2', code: '國', name: '國定假日', startTime: '00:00', endTime: '00:00', semanticType: 'holiday', bgColor: '#fee2e2' },
      { _id: 's3', code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', crossDay: true, isNightShift: true },
      { _id: 's4', code: 'G', name: '只設文字色', startTime: '08:00', endTime: '17:00', color: '#7c2d12' }
    ]
    setupSupervisorApiMock({ shifts })
    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.vm.shifts[0]).toEqual({
      _id: 's1', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', remark: undefined,
      semanticType: 'work', crossDay: false, isNightShift: false, bgColor: '#336699', color: '#ffffff',
      breakDuration: 60, breakMinutes: 60, breakTime: '12:00-13:00',
      breakWindows: [{ start: '12:00', end: '13:00', label: '午休' }]
    })
    expect(wrapper.vm.shifts[1]).toMatchObject({ semanticType: 'holiday', bgColor: '#fee2e2' })
    expect(wrapper.vm.shifts[2]).toMatchObject({ crossDay: true, isNightShift: true })

    const legendItems = wrapper.findAll('[data-test="shift-legend-item"]')
    expect(legendItems).toHaveLength(4)
    // 有設定底色 / 文字色：用設定的顏色
    const configured = styleToObject(legendItems[0].attributes('style'))
    expect(configured['--shift-base-color']).toBe('#336699')
    expect(configured['--shift-text-color']).toBe('#ffffff')
    expect(styleToObject(legendItems[1].attributes('style'))['--shift-base-color']).toBe('#fee2e2')
    // 沒有設定顏色：才退回依代碼產生的淡色
    const generated = styleToObject(legendItems[2].attributes('style'))
    const expectedGenerated = buildShiftStyle({ _id: 's3', code: 'N', name: '夜班' })
    expect(generated['--shift-base-color']).toBe(expectedGenerated['--shift-base-color'])
    expect(generated['--shift-text-color']).toBe(expectedGenerated['--shift-text-color'])
    // 只設文字色：底色仍用產生的淡色，文字色用設定值
    const textOnly = styleToObject(legendItems[3].attributes('style'))
    expect(textOnly['--shift-text-color']).toBe('#7c2d12')
  })

  // 刻意更新（行事曆分類）：標頭改讀 GET /api/holiday-calendar/headers（不再讀 /api/holidays-public/by-month），
  // 只有國定假日標 🎊；公務機關補假等以灰字資訊顯示在日期下方
  it('marks only counted holidays in the day header (not 補班日, 工作日 or 例假日 records)', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setupSupervisorApiMock()
    const baseImplementation = apiFetch.getMockImplementation()
    apiFetch.mockImplementation(async (url, options) => {
      if (String(url).startsWith('/api/holiday-calendar/headers')) {
        return {
          ok: true,
          json: async () => ({
            month,
            entries: [
              { date: `${month}-05`, kind: 'statutory', displayKind: 'holiday', label: '測試節日', name: '測試節日' },
              { date: `${month}-06`, kind: 'gov_makeup_workday', displayKind: 'gov_info', label: '公務機關補行上班', name: '測試補班' },
              { date: `${month}-07`, kind: 'company_workday', displayKind: 'company_workday', label: '測試工作日', name: '測試工作日' },
              { date: `${month}-08`, kind: 'company_off', displayKind: 'company_off', label: '測試週休', name: '測試週休' }
            ],
            status: { year: Number(month.slice(0, 4)), state: 'approved', migrated: false, provisional: false, synthetic: false, message: '' }
          })
        }
      }
      return baseImplementation(url, options)
    })
    const wrapper = mountSchedule()
    await flush()

    expect(apiFetch.mock.calls.some(([url]) => String(url) === `/api/holiday-calendar/headers?month=${wrapper.vm.currentMonth}`)).toBe(true)
    expect(apiFetch.mock.calls.some(([url]) => String(url).startsWith('/api/holidays-public/by-month'))).toBe(false)
    const labels = wrapper.vm.days.map(day => day.label)
    expect(labels[4]).toContain('🎊測試節日')
    expect(labels[5]).not.toContain('🎊')
    expect(labels[6]).not.toContain('🎊')
    expect(labels[7]).not.toContain('🎊')
    const headerText = wrapper.findAll('.day-header-label').map(node => node.text()).join('|')
    expect(headerText).toContain('🎊測試節日')
    expect(headerText).not.toContain('測試補班')
    expect(headerText).not.toContain('測試工作日')
    expect(headerText).not.toContain('測試週休')
    expect(wrapper.find('[data-test="calendar-provisional-alert"]').exists()).toBe(false)
  })

  it('shows government make-up days as grey info under the date and warns while the calendar is provisional', async () => {
    setupSupervisorApiMock()
    const baseImplementation = apiFetch.getMockImplementation()
    let requestedMonth = ''
    apiFetch.mockImplementation(async (url, options) => {
      if (String(url).startsWith('/api/holiday-calendar/headers')) {
        requestedMonth = new URL(String(url), 'http://local').searchParams.get('month')
        const date = (day) => `${requestedMonth}-${String(day).padStart(2, '0')}`
        return {
          ok: true,
          json: async () => ({
            month: requestedMonth,
            entries: [
              { date: date(20), kind: 'gov_makeup_off', displayKind: 'gov_info', label: '公務機關補假', name: '補假', compensatesDate: date(15) },
              { date: date(28), kind: 'statutory', displayKind: 'holiday', label: '和平紀念日', name: '和平紀念日' }
            ],
            status: {
              year: Number(requestedMonth.slice(0, 4)),
              state: 'draft',
              migrated: true,
              provisional: true,
              synthetic: false,
              message: '公司行事曆由舊版資料轉換、尚未核定，國定假日標示僅供參考'
            }
          })
        }
      }
      return baseImplementation(url, options)
    })
    const wrapper = mountSchedule()
    await flush()

    const day20 = wrapper.vm.days[19]
    expect(day20.label).not.toContain('🎊')
    expect(day20.infos).toEqual(['公務機關補假'])
    expect(wrapper.vm.days[27].label).toContain('🎊和平紀念日')
    const info = wrapper.findAll('[data-test="day-header-info-20"]')
    if (wrapper.vm.virtualVisibleDays.some(day => day.date === 20)) {
      expect(info.map(node => node.text())).toEqual(['公務機關補假'])
    }
    const alert = wrapper.find('[data-test="calendar-provisional-alert"]')
    expect(alert.exists()).toBe(true)
    expect(wrapper.vm.calendarStatus).toMatchObject({
      provisional: true,
      message: '公司行事曆由舊版資料轉換、尚未核定，國定假日標示僅供參考'
    })
  })

  it('shows loading state while applying batch schedules', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('admin')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: 'd1', subDepartmentId: 'sd1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: '', department: 'd1', subDepartment: 'sd1' }
      }
    }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleCell('e1', 1, true)
    wrapper.vm.batchShiftId = 's1'

    const inserted = [
      {
        _id: 'sch1',
        employee: 'e1',
        date: `${month}-01`,
        shiftId: 's1',
        department: 'd1',
        subDepartment: 'sd1'
      }
    ]

    let resolveFetch
    apiFetch.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFetch = () =>
            resolve({
              ok: true,
              json: async () => inserted
            })
        })
    )

    const applyPromise = wrapper.vm.applyBatch()
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    const button = wrapper.find('[data-test="batch-apply-button"]')
    expect(button.exists()).toBe(true)
    expect(wrapper.vm.isApplyingBatch).toBe(true)
    expect(button.attributes('loading')).toBe('true')
    expect(button.element.disabled).toBe(true)
    expect(loadingServiceMock).not.toHaveBeenCalled()

    resolveFetch()
    await applyPromise
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isApplyingBatch).toBe(false)
    expect(button.attributes('loading')).toBe('false')
    expect(button.element.disabled).toBe(true)
    expect(ElMessage.success).toHaveBeenCalledWith('批次套用完成')
  })

  it('shows persistent labor-rule details when batch apply is rejected', async () => {
    setRoleToken('supervisor')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', employeeId: 'CODEX_TEST_A0077', name: 'CODEX 測試主管', departmentId: 'd1', subDepartmentId: 'sd1' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: '', department: 'd1', subDepartment: 'sd1' } }
    }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleCell('e1', 1, true)
    wrapper.vm.batchShiftId = 's1'
    let applyingWhenDialogOpened = true
    ElMessageBox.alert.mockImplementation(() => {
      applyingWhenDialogOpened = wrapper.vm.isApplyingBatch
      return Promise.resolve()
    })
    apiFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: '排班規範檢核未通過',
        violations: [{ employee: 'e1', message: '不得連續7日未安排休/例' }]
      })
    })

    await wrapper.vm.applyBatch()

    expect(applyingWhenDialogOpened).toBe(false)
    expect(loadingServiceMock).not.toHaveBeenCalled()
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('CODEX_TEST_A0077 CODEX 測試主管：不得連續7日未安排休/例'),
      '排班規範檢核未通過',
      expect.objectContaining({ customClass: 'schedule-issue-dialog', closeOnClickModal: false })
    )
  })

  it('shows employee and rule details when publish or finalize is rejected', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const violationResponse = message => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: '排班規範檢核未通過',
        violations: [{ employee: 'e1', message }]
      })
    })
    setupSupervisorApiMock({
      employees: [
        {
          _id: 'e1',
          employeeId: 'CODEX_TEST_A0077',
          name: 'CODEX 測試主管',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ],
      publishHandler: () => violationResponse('2026-08-07 至 2026-08-13 不得連續7日出勤'),
      finalizeHandler: () => violationResponse('2026-08-20 換班間隔僅 8 小時，至少須 11 小時')
    })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      {
        _id: 'e1',
        employeeId: 'CODEX_TEST_A0077',
        name: 'CODEX 測試主管',
        departmentId: 'd1',
        subDepartmentId: 'sd1'
      }
    ]

    await wrapper.vm.publishSchedulesForMonth()
    await wrapper.vm.finalizeSchedulesForMonth()

    expect(ElMessageBox.alert).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('CODEX_TEST_A0077 CODEX 測試主管：2026-08-07 至 2026-08-13 不得連續7日出勤'),
      '排班規範檢核未通過',
      expect.objectContaining({ customClass: 'schedule-issue-dialog', closeOnClickModal: false })
    )
    expect(ElMessageBox.alert).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('CODEX_TEST_A0077 CODEX 測試主管：2026-08-20 換班間隔僅 8 小時，至少須 11 小時'),
      '排班規範檢核未通過',
      expect.objectContaining({ customClass: 'schedule-issue-dialog', closeOnClickModal: false })
    )
    expect(ElMessage.warning).not.toHaveBeenCalledWith('排班規範檢核未通過')
  })

  it('keeps schedule import errors open and includes row and employee code', async () => {
    setRoleToken('supervisor')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    importScheduleRecords.mockResolvedValue({
      ok: false,
      json: async () => ({
        errors: [{ row: 11, day: null, code: 'CODEX_TEST_A0077', message: '員工代號不在目前部門或操作權限範圍內' }]
      })
    })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    wrapper.vm.includeSelf = true
    await wrapper.vm.$nextTick()
    const file = new File(['schedule'], 'schedule.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })

    await wrapper.vm.onScheduleImportFile({ target: { files: [file], value: 'schedule.xlsx' } })

    const formData = importScheduleRecords.mock.calls[0][0]
    expect(formData.get('includeSelf')).toBe('true')
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('第 11 列／員工代號「CODEX_TEST_A0077」'),
      '班表匯入檢核未通過',
      expect.objectContaining({ customClass: 'schedule-issue-dialog', closeOnClickModal: false })
    )
  })

  it('shows every ambiguous system employee id before schedule import', async () => {
    setRoleToken('supervisor')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    importScheduleRecords.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: '員工代號在系統內重複，請先修正員工資料',
        code: 'EMPLOYEE_ID_AMBIGUOUS',
        conflicts: [
          { employeeId: 'A001', count: 2 },
          { employeeId: 'B002', count: 3 }
        ]
      })
    })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    await wrapper.vm.$nextTick()
    const file = new File(['schedule'], 'schedule.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })

    await wrapper.vm.onScheduleImportFile({ target: { files: [file], value: 'schedule.xlsx' } })

    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('員工代號「A001」在系統內有 2 筆資料'),
      '班表匯入檢核未通過',
      expect.objectContaining({ customClass: 'schedule-issue-dialog', closeOnClickModal: false })
    )
    expect(ElMessageBox.alert.mock.calls[0][0]).toContain('員工代號「B002」在系統內有 3 筆資料')
  })

  it('保留排班通知日誌並寫入目前帳號的 localStorage', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock()
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.callWarning('CODEX_TEST 通知內容')
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.scheduleNotifications[0]).toEqual(expect.objectContaining({
      type: 'warning',
      message: 'CODEX_TEST 通知內容'
    }))
    expect(wrapper.find('.schedule-notification-drawer').exists()).toBe(true)
    expect(wrapper.find('.notification-log-item').attributes('data-type')).toBe('warning')
    expect(wrapper.find('.notification-log-item__heading').text()).toContain('提醒')
    const stored = JSON.parse(localStorage.getItem('schedule-notifications:sup1'))
    expect(stored[0].message).toBe('CODEX_TEST 通知內容')
  })

  it('通知日誌超過容量上限時淘汰最舊記錄', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock()
    const wrapper = mountSchedule()
    await flush()
    const largeMessage = `CODEX_TEST ${'X'.repeat(70_000)}`
    wrapper.vm.scheduleNotifications = Array.from({ length: 8 }, (_, index) => ({
      id: `notification-${index}`,
      type: 'warning',
      title: '容量測試',
      message: largeMessage,
      details: [{ rule: 'capacity', message: largeMessage }],
      createdAt: new Date(2026, 7, 24, 12, 0, index % 60).toISOString()
    }))

    wrapper.vm.persistScheduleNotifications()

    const serialized = localStorage.getItem('schedule-notifications:sup1')
    const stored = JSON.parse(serialized)
    expect(new Blob([serialized]).size).toBeLessThanOrEqual(900_000)
    expect(stored.length).toBeLessThan(8)
    expect(stored[0].id).toBe('notification-0')
    expect(stored.at(-1).id).toBe(`notification-${stored.length - 1}`)
  })

  it('通知抽屜以全域高對比色顯示四種狀態', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock()
    const host = document.createElement('div')
    const style = document.createElement('style')
    style.textContent = notificationDrawerStyles
    document.head.appendChild(style)
    document.body.appendChild(host)
    const wrapper = mountSchedule({ attachTo: host })
    await flush()

    wrapper.vm.callSuccess('成功內容')
    wrapper.vm.callWarning('提醒內容')
    wrapper.vm.callError('錯誤內容')
    wrapper.vm.callInfo('通知內容')
    await wrapper.vm.$nextTick()

    const drawer = wrapper.find('.schedule-notification-drawer')
    const toolbar = getComputedStyle(drawer.find('.notification-log-toolbar span').element)
    const title = getComputedStyle(drawer.find('.notification-log-item__heading strong').element)
    const time = getComputedStyle(drawer.find('.notification-log-item__heading time').element)
    const body = getComputedStyle(drawer.find('.notification-log-item p').element)
    expect(toolbar.color).toBe('rgb(71, 84, 103)')
    expect(title.color).toBe('rgb(24, 32, 38)')
    expect(time.color).toBe('rgb(102, 112, 133)')
    expect(body.color).toBe('rgb(52, 64, 84)')

    const expectedBorders = {
      info: 'rgb(23, 92, 211)',
      error: 'rgb(180, 35, 24)',
      warning: 'rgb(181, 71, 8)',
      success: 'rgb(8, 127, 91)'
    }
    wrapper.findAll('.notification-log-item').forEach(item => {
      expect(getComputedStyle(item.element).borderLeftColor)
        .toBe(expectedBorders[item.attributes('data-type')])
    })
    const relativeLuminance = hex => {
      const channels = hex.match(/[a-f\d]{2}/gi)
        .map(channel => parseInt(channel, 16) / 255)
        .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const contrastOnWhite = hex => 1.05 / (relativeLuminance(hex) + 0.05)
    ;['#182026', '#344054', '#667085', '#475467', '#B42318', '#087F5B', '#B54708', '#175CD3']
      .forEach(color => expect(contrastOnWhite(color)).toBeGreaterThanOrEqual(4.5))

    wrapper.unmount()
    host.remove()
    style.remove()
  })

  it.each([200, 400])('shows all 138 precheck violations for HTTP %s and keeps them on the page', async status => {
    setRoleToken('supervisor')
    setupSupervisorApiMock()
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [{ _id: 'e1', employeeId: 'QA001', name: '測試員工' }]
    const violations = Array.from({ length: 138 }, (_, index) => ({
      employee: 'e1', date: '2026-09-01', rule: 'shift-gap', message: `間隔不足 ${index + 1}`
    }))
    apiFetch.mockResolvedValueOnce({ ok: status === 200, status, json: async () => ({ ok: false, violations }) })
    await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })
    await flush()
    const panel = wrapper.find('[data-test="schedule-rule-results"]')
    expect(panel.findAll('li')).toHaveLength(138)
    expect(panel.text()).toContain('QA001 測試員工 2026-09-01 [換班休息間隔]')
    expect(panel.findAll('li')[137].text()).toContain('間隔不足 138')
    expect(wrapper.vm.scheduleNotifications[0].details).toHaveLength(138)
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('間隔不足 138'), expect.any(String), expect.objectContaining({ zIndex: 4000 })
    )
    expect(ElMessage.success).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not report a failed or incomplete precheck as compliant', async () => {
    setupSupervisorApiMock()
    const wrapper = mountSchedule()
    await flush()
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false, error: '檢核未完成' }) })
    await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })
    expect(wrapper.vm.scheduleRuleValidation.ok).toBe(false)
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith('檢核未完成')
    wrapper.unmount()
  })

  it('完整保存并重新开启 138 项排班问题，不再截断前 20 项', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock()
    const wrapper = mountSchedule()
    await flush()
    const issues = Array.from({ length: 138 }, (_, index) => `CODEX_TEST 问题 ${index + 1}`)

    await wrapper.vm.openScheduleIssueDialog('排班規範檢核未通過', issues, '检核失败')
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('CODEX_TEST 问题 138'),
      '排班規範檢核未通過',
      expect.objectContaining({
        customClass: 'schedule-issue-dialog',
        modalClass: 'schedule-issue-overlay'
      })
    )
    expect(ElMessageBox.alert.mock.calls[0][0]).not.toContain('另有')
    expect(wrapper.vm.scheduleNotifications[0].details).toHaveLength(138)
    const renderedDetails = wrapper.findAll('.notification-log-item__details li')
    expect(renderedDetails).toHaveLength(138)
    expect(renderedDetails[137].text()).toContain('CODEX_TEST 问题 138')

    ElMessageBox.alert.mockClear()
    await wrapper.find('.notification-log-item__details-button').trigger('click')
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('CODEX_TEST 问题 138'),
      '排班規範檢核未通過',
      expect.objectContaining({ customClass: 'schedule-issue-dialog' })
    )
  })

  it('載入並儲存逐日期排班備忘錄', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      employees: [{ _id: 'e1', name: '員工A', department: 'd1', subDepartment: 'sd1' }],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
      memos: [{ date: `${dayjs().add(1, 'month').format('YYYY-MM')}-01`, content: '原備忘錄' }]
    })
    const wrapper = mountSchedule()
    await flush()
    await flush()

    expect(wrapper.vm.dayMemos[1]).toBe('原備忘錄')
    wrapper.vm.openDayMemo(1)
    wrapper.vm.memoDialog.content = 'CODEX_TEST 新備忘錄'
    await wrapper.vm.saveDayMemo()

    expect(wrapper.vm.dayMemos[1]).toBe('CODEX_TEST 新備忘錄')
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/schedules\/memos\/\d{4}-\d{2}-01$/),
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('批次清空只删除选取范围内已经存在的排班', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      employees: [{ _id: 'e1', name: '員工A', department: 'd1', subDepartment: 'sd1' }],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }]
    })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = {
      e1: { 1: { id: 'schedule-1', shiftId: 'shift-1', department: 'd1', subDepartment: 'sd1' } }
    }
    wrapper.vm.selectedCellsCache = new Map([['e1::1', { manual: true }]])
    await wrapper.vm.$nextTick()

    await wrapper.vm.clearSelectedSchedules()

    expect(apiFetch).toHaveBeenCalledWith('/api/schedules/batch-delete', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ids: ['schedule-1'] })
    }))
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('')
    expect(wrapper.vm.scheduleMap.e1[1].id).toBe('')
  })

  it('匯入遇到既有班表时先确认，再以 overwrite 预览与提交', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock()
    importScheduleRecords
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ employees: 1, scheduleDays: 0, errors: [], warnings: [], overwriteCount: 1 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ employees: 1, scheduleDays: 1, errors: [], warnings: [], overwriteCount: 0 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ imported: 1 })
      })
    const wrapper = mountSchedule()
    await flush()
    const file = new File(['schedule'], 'schedule.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })

    await wrapper.vm.onScheduleImportFile({ target: { files: [file], value: 'schedule.xlsx' } })

    expect(importScheduleRecords).toHaveBeenCalledTimes(3)
    expect(importScheduleRecords.mock.calls[0][0].get('overwrite')).toBe('false')
    expect(importScheduleRecords.mock.calls[1][0].get('overwrite')).toBe('true')
    expect(importScheduleRecords.mock.calls[2][0].get('overwrite')).toBe('true')
    expect(importScheduleRecords.mock.calls[2][0].get('mode')).toBe('commit')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      expect.stringContaining('發現 1 個日期已有班表'),
      '確認覆蓋既有排班',
      expect.objectContaining({ confirmButtonText: '覆蓋匯入' })
    )
  })

  describe('schedule import confirmation dialog', () => {
    const scheduleFile = () => new File(['schedule'], 'schedule.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const runImport = async (wrapper) => {
      wrapper.vm.employees = [{ _id: 'e1', employeeId: 'A0003', name: '王小明' }]
      await wrapper.vm.onScheduleImportFile({ target: { files: [scheduleFile()], value: 'schedule.xlsx' } })
    }

    it('lists the warning texts, rule-violation texts and informational-day count before committing', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      importScheduleRecords
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            employees: 8,
            scheduleDays: 232,
            informationalDays: 8,
            skippedDays: 2,
            errors: [],
            warnings: [
              { row: 3, day: 19, code: '國', message: '公版標記為國定假日，但系統假日日曆沒有該日期' },
              { row: 4, day: 20, code: '事', message: '請假代碼沒有對應的已核准假單' }
            ],
            violations: [
              { employee: 'e1', date: '2026-06-29', rule: 'weekly-one-regular-rest-one-rest-day', message: '該週沒有例假' }
            ],
            overwriteCount: 0
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 232, warnings: [], violations: [] }) })
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
      expect(title).toBe('確認匯入班表')
      expect(options).toMatchObject({
        confirmButtonText: '確認匯入',
        cancelButtonText: '取消',
        customClass: 'schedule-issue-dialog'
      })
      expect(message).toContain('將匯入 8 名員工、232 個班次。')
      expect(message).toContain('班表中共有 8 天為國定假日或請假標記，其中 2 天因班別設定中沒有對應的班別，不會建立班表')
      expect(message).toContain('資料提醒（2 項）：')
      expect(message).toContain('・第 3 列／19 日／班別代號或名稱「國」：公版標記為國定假日，但系統假日日曆沒有該日期')
      expect(message).toContain('・第 4 列／20 日／班別代號或名稱「事」：請假代碼沒有對應的已核准假單')
      expect(message).toContain('排班規範問題（1 項，可先存為草稿，發布前必須修正）：')
      expect(message).toContain('・A0003 王小明 2026-06-29 [每週一例一休]：該週沒有例假')
      expect(message).not.toMatch(/[项资规范问题汇确认]/)
      expect(importScheduleRecords).toHaveBeenCalledTimes(2)
      expect(importScheduleRecords.mock.calls[1][0].get('mode')).toBe('commit')
      expect(ElMessage.success).toHaveBeenCalledWith('已匯入 232 個班次')
    })

    it('caps long warning and violation lists with a "…另有 N 項" line', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      importScheduleRecords
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            employees: 8,
            scheduleDays: 240,
            errors: [],
            warnings: Array.from({ length: 45 }, (_, index) => ({ row: 2, day: index + 1, code: '事', message: `提醒${index + 1}` })),
            violations: Array.from({ length: 138 }, (_, index) => ({ employee: 'e1', message: `違規${index + 1}` })),
            overwriteCount: 0
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 240 }) })
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      const message = ElMessageBox.confirm.mock.calls[0][0]
      expect(message).toContain('資料提醒（45 項）：')
      expect(message).toContain('提醒20')
      expect(message).not.toContain('提醒21')
      expect(message).toContain('…另有 25 項')
      expect(message).toContain('排班規範問題（138 項')
      expect(message).toContain('違規20')
      expect(message).not.toContain('違規21')
      expect(message).toContain('…另有 118 項')
    })

    it('does not commit when the confirmation is cancelled', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      ElMessageBox.confirm.mockRejectedValueOnce('cancel')
      importScheduleRecords.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ employees: 1, scheduleDays: 1, errors: [], warnings: [], overwriteCount: 0 })
      })
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      expect(importScheduleRecords).toHaveBeenCalledTimes(1)
      expect(ElMessage.error).not.toHaveBeenCalled()
      expect(wrapper.vm.isImportingSchedule).toBe(false)
    })

    it('shows the overwrite explanation and the overwrite preview warnings in one confirmation', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      importScheduleRecords
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ employees: 1, scheduleDays: 0, errors: [], warnings: [], overwriteCount: 4 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            employees: 1,
            scheduleDays: 30,
            errors: [],
            warnings: [{ row: 2, day: 9, code: '國', message: '覆蓋後才出現的提醒' }],
            violations: [{ employee: 'e1', message: '覆蓋後才出現的違規' }],
            overwriteCount: 0
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 30 }) })
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
      expect(title).toBe('確認覆蓋既有排班')
      expect(options).toMatchObject({ confirmButtonText: '覆蓋匯入' })
      expect(message).toContain('發現 4 個日期已有班表')
      expect(message).toContain('覆蓋後才出現的提醒')
      expect(message).toContain('A0003 王小明：覆蓋後才出現的違規')
      expect(importScheduleRecords.mock.calls.map(call => call[0].get('mode'))).toEqual(['preview', 'preview', 'commit'])
      expect(importScheduleRecords.mock.calls[2][0].get('overwrite')).toBe('true')
      expect(ElMessage.success).toHaveBeenCalledWith('已匯入 30 個班次（含覆蓋）')
    })

    it('shows warnings that only appear after committing instead of ignoring them', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      const previewWarning = { row: 3, day: 19, code: '國', message: '預覽就看得到的提醒' }
      importScheduleRecords
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ employees: 1, scheduleDays: 3, errors: [], warnings: [previewWarning], overwriteCount: 0 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: 3,
            warnings: [
              previewWarning,
              { row: null, day: null, code: '', message: '匯入已完成，但排班規範檢核暫時無法完成，請按「排班檢核」重試' }
            ]
          })
        })
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      expect(ElMessageBox.alert).toHaveBeenCalledTimes(1)
      const [alertMessage, alertTitle] = ElMessageBox.alert.mock.calls[0]
      expect(alertTitle).toBe('班表匯入提醒')
      expect(alertMessage).toContain('匯入已完成，但排班規範檢核暫時無法完成')
      expect(alertMessage).not.toContain('預覽就看得到的提醒')
      expect(alertMessage).not.toContain('第 - 列')
      const notification = wrapper.vm.scheduleNotifications.find(item => item.title === '匯入提醒')
      expect(notification.message).toBe('匯入完成，另有 2 項資料提醒。')
      expect(notification.details.map(detail => detail.message)).toEqual([
        '第 3 列／19 日／班別代號或名稱「國」：預覽就看得到的提醒',
        '匯入已完成，但排班規範檢核暫時無法完成，請按「排班檢核」重試'
      ])
    })

    it('does not open an extra dialog when the commit adds no new warnings', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      const warning = { row: 3, day: 19, code: '國', message: '同一則提醒' }
      importScheduleRecords
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ employees: 1, scheduleDays: 3, errors: [], warnings: [warning], overwriteCount: 0 })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 3, warnings: [warning] }) })
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      expect(ElMessageBox.alert).not.toHaveBeenCalled()
      expect(wrapper.vm.scheduleNotifications.some(item => item.title === '匯入提醒')).toBe(true)
    })

    it('reports an unexpected import failure in Traditional Chinese', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock()
      importScheduleRecords.mockRejectedValueOnce(new Error(''))
      const wrapper = mountSchedule()
      await flush()

      await runImport(wrapper)

      expect(ElMessage.error).toHaveBeenCalledWith('班表匯入失敗')
    })
  })

  it('uses fullscreen popper strategy for batch shift and row-color selects and shows readonly department fields', async () => {
    setRoleToken('admin')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.batchDepartment = 'd1'
    wrapper.vm.batchSubDepartment = 'sd1'
    wrapper.vm.selectedDepartment = 'd1'
    wrapper.vm.selectedSubDepartment = 'sd1'
    wrapper.vm.departments = [{ _id: 'd1', name: '部門A' }]
    wrapper.vm.subDepartments = [{ _id: 'sd1', name: '單位A', department: 'd1' }]
    wrapper.vm.isTableFullscreen = true
    wrapper.vm.isFullscreenToolbarCollapsed = false
    await wrapper.vm.$nextTick()

    const shiftSelect = wrapper.find('[data-test="batch-shift-select"]')
    const rowColorSelect = wrapper.find('[data-test="batch-row-color-select"]')
    expect(shiftSelect.attributes('append-to')).toBeTruthy()
    expect(shiftSelect.attributes('popper-class')).toContain('schedule-toolbar-popper--fullscreen')
    expect(rowColorSelect.attributes('append-to')).toBeTruthy()
    expect(rowColorSelect.attributes('popper-class')).toContain('schedule-toolbar-popper--fullscreen')

    expect(wrapper.find('[data-test="batch-dept-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="batch-subdept-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="batch-dept-readonly"]').text()).toContain('部門A')
    expect(wrapper.find('[data-test="batch-subdept-readonly"]').text()).toContain('單位A')
  })

  it('keeps department and sub-department payload in fullscreen readonly mode when applying batch', async () => {
    setRoleToken('admin')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.departments = [{ _id: 'd1', name: '部門A' }]
    wrapper.vm.subDepartments = [{ _id: 'sd1', name: '單位A', department: 'd1' }]
    wrapper.vm.batchDepartment = 'd1'
    wrapper.vm.batchSubDepartment = 'sd1'
    wrapper.vm.selectedDepartment = 'd1'
    wrapper.vm.selectedSubDepartment = 'sd1'
    wrapper.vm.batchShiftId = 's1'
    wrapper.vm.isTableFullscreen = true
    wrapper.vm.isFullscreenToolbarCollapsed = false
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: 'd1', subDepartmentId: 'sd1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: '', department: 'd0', subDepartment: 'sd0' }
      }
    }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleCell('e1', 1, true)

    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            _id: 'sch1',
            employee: 'e1',
            date: `${wrapper.vm.currentMonth}-01`,
            shiftId: 's1',
            department: 'd1',
            subDepartment: 'sd1'
          }
        ]
      })
    )

    await wrapper.vm.applyBatch()
    const request = apiFetch.mock.calls.find(([url]) => url === '/api/schedules/batch')
    expect(request).toBeTruthy()
    const body = JSON.parse(request[1].body)
    expect(body.schedules).toEqual([
      {
        employee: 'e1',
        date: `${wrapper.vm.currentMonth}-01`,
        shiftId: 's1',
        department: 'd1',
        subDepartment: 'sd1'
      }
    ])
  })

  it('renders leave indicator and prevents editing when leave exists', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      shifts: [
        { _id: 'shift1', code: 'A', name: '早班', startTime: '08:00', endTime: '17:00' }
      ],
      employees: [{ _id: 'e1', name: 'Emp1', department: 'd1', subDepartment: 'sd1' }],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
      monthlyWithoutSelf: [
        {
          _id: 'sch1',
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 'shift1',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ],
      leaves: [
        {
          employee: 'e1',
          leaveType: 'annual',
          status: 'approved',
          startDate: `${month}-01`,
          endDate: `${month}-01`
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()

    const leaveCell = wrapper.findAllComponents({ name: 'ScheduleGridVirtualBody' })
      .find(component => component.props('row')?._id === 'e1' && component.props('day')?.date === 1)
    expect(leaveCell).toBeTruthy()
    expect(leaveCell.props('cellView').cellMeta.isLeave).toBe(true)
    expect(wrapper.vm.scheduleMap.e1[1].leave.excludesHours).toBe(true)

    const initialCalls = apiFetch.mock.calls.length
    await wrapper.vm.onSelect('e1', 1, 'shift1')
    await flush()
    expect(apiFetch.mock.calls.length).toBe(initialCalls)
    expect(ElMessage.info).toHaveBeenCalledWith('該日已有核准的全天請假，無法調整排班')
  })

  describe('leave counted in hours', () => {
    const nextMonth = () => dayjs().add(1, 'month').format('YYYY-MM')
    // 台灣時間的 UTC ISO 字串（前端日期選擇器送出的格式）
    const taipeiIso = (month, day, time) => new Date(`${month}-${String(day).padStart(2, '0')}T${time}:00+08:00`).toISOString()
    const cellOf = (wrapper, day) => wrapper.findAllComponents({ name: 'ScheduleGridVirtualBody' })
      .find(component => component.props('row')?._id === 'e1' && component.props('day')?.date === day)

    function mountWithLeaves(month, leaves) {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock({
        shifts: [
          { _id: 'shift1', code: 'A', name: '早班', startTime: '08:00', endTime: '17:00' },
          { _id: 'shift2', code: 'B', name: '晚班', startTime: '13:00', endTime: '21:00' }
        ],
        employees: [{ _id: 'e1', name: 'Emp1', department: 'd1', subDepartment: 'sd1' }],
        directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
        monthlyWithoutSelf: [1, 2, 3, 4, 5].map(day => ({
          _id: `sch${day}`,
          employee: 'e1',
          date: `${month}-0${day}`,
          shiftId: 'shift1',
          department: 'd1',
          subDepartment: 'sd1'
        })),
        leaves
      })
      return mountSchedule()
    }

    it('keeps a day with only a 2-hour leave editable and notes the leave hours', async () => {
      const month = nextMonth()
      const wrapper = mountWithLeaves(month, [{
        employee: 'e1',
        leaveType: '事假',
        status: 'approved',
        startDate: taipeiIso(month, 1, '09:00'),
        endDate: taipeiIso(month, 1, '11:00')
      }])
      await flush()

      const cell = cellOf(wrapper, 1)
      expect(cell).toBeTruthy()
      const cellView = cell.props('cellView')
      expect(cellView.cellMeta.isLeave).toBe(false)
      expect(cellView.cellMeta.partialLeaveHours).toBe(2)
      expect(cellView.cellMeta.hasShift).toBe(true)
      expect(cellView.leaveTitle).toBe('當天有 2 小時核准請假')
      expect(wrapper.vm.scheduleMap.e1[1].leave).toBeUndefined()

      apiFetch.mockClear()
      await wrapper.vm.onSelect('e1', 1, 'shift2')
      await flush()
      expect(ElMessage.info).not.toHaveBeenCalledWith(expect.stringContaining('全天請假'))
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/schedules/sch1',
        expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"shiftId":"shift2"') })
      )
    })

    it('turns only the days entirely on leave into leave days when a timed leave runs over several days', async () => {
      const month = nextMonth()
      const wrapper = mountWithLeaves(month, [{
        employee: 'e1',
        leaveType: '特休',
        status: 'approved',
        startDate: taipeiIso(month, 2, '13:00'),
        endDate: taipeiIso(month, 4, '10:00')
      }])
      await flush()

      const meta = day => cellOf(wrapper, day).props('cellView').cellMeta
      expect(meta(1)).toEqual(expect.objectContaining({ isLeave: false, partialLeaveHours: 0 }))
      expect(meta(2)).toEqual(expect.objectContaining({ isLeave: false, partialLeaveHours: 8 }))
      expect(meta(3)).toEqual(expect.objectContaining({ isLeave: true, partialLeaveHours: 0 }))
      expect(meta(4)).toEqual(expect.objectContaining({ isLeave: false, partialLeaveHours: 8 }))
      expect(wrapper.vm.scheduleMap.e1[3].leave.excludesHours).toBe(true)
      expect(wrapper.vm.scheduleMap.e1[2].leave).toBeUndefined()

      apiFetch.mockClear()
      await wrapper.vm.onSelect('e1', 3, 'shift2')
      expect(apiFetch).not.toHaveBeenCalled()
      // 3 日排了早班、請假從 00:00 到 24:00 涵蓋整個班次：和伺服器一樣用「涵蓋整個班別」判斷，所以是這句提示
      expect(ElMessage.info).toHaveBeenCalledWith('該日的核准請假涵蓋整個班別，無法調整排班')
    })

    it('adds up several leaves on the same day, never above one day of 8 hours', async () => {
      const month = nextMonth()
      // 2 日從 09:00 開始請：早班 08:00-17:00 沒有被整個涵蓋，仍是只請幾小時的日子（08:00 開始就涵蓋整個早班，那天會變成請假日）
      const wrapper = mountWithLeaves(month, [
        { employee: 'e1', leaveType: '事假', status: 'approved', startDate: taipeiIso(month, 1, '09:00'), endDate: taipeiIso(month, 1, '11:00') },
        { employee: 'e1', leaveType: '病假', status: 'approved', startDate: taipeiIso(month, 1, '14:00'), endDate: taipeiIso(month, 1, '15:30') },
        { employee: 'e1', leaveType: '事假', status: 'approved', startDate: taipeiIso(month, 2, '09:00'), endDate: taipeiIso(month, 2, '17:00') },
        { employee: 'e1', leaveType: '事假', status: 'approved', startDate: taipeiIso(month, 2, '17:00'), endDate: taipeiIso(month, 2, '20:00') }
      ])
      await flush()

      expect(cellOf(wrapper, 1).props('cellView').leaveTitle).toBe('當天有 3.5 小時核准請假')
      expect(cellOf(wrapper, 2).props('cellView').cellMeta.partialLeaveHours).toBe(8)
    })

    it('does not make the leave cell look like a partial leave when the leave is a whole day', async () => {
      const month = nextMonth()
      const wrapper = mountWithLeaves(month, [{
        employee: 'e1',
        leaveType: '特休',
        status: 'approved',
        startDate: `${month}-01`,
        endDate: `${month}-01`
      }])
      await flush()

      const cellView = cellOf(wrapper, 1).props('cellView')
      expect(cellView.cellMeta).toEqual(expect.objectContaining({ isLeave: true, partialLeaveHours: 0 }))
      expect(cellView.leaveTitle).toContain('已核准請假')
    })

    describe('a rostered working shift that the leave covers is a leave day, as on the server', () => {
      // 與伺服器（完整性檢查、匯出、國定假日休假紀錄、存檔）同一組班別：日班休息 60 分鐘、日班（無休息）、下午班、跨日夜班、休息日
      const ROSTER_SHIFTS = [
        { _id: 'D', code: 'D', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
        { _id: 'D0', code: 'D0', name: '日班無休', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
        { _id: 'P', code: 'P', name: '下午班', semanticType: 'work', startTime: '13:00', endTime: '17:00' },
        { _id: 'N', code: 'N', name: '夜班', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true },
        { _id: 'R', code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
      ]
      const WHOLE_DAY_TITLE = '已核准請假，該日不列入工作時數'

      // roster：{ 日: 班別 ID }；leaves：[[開始日, 開始時間, 結束日, 結束時間], ...]（台灣時間）
      function mountRoster(month, roster, leaves) {
        setRoleToken('supervisor')
        localStorage.setItem('employeeId', 'sup1')
        setupSupervisorApiMock({
          shifts: ROSTER_SHIFTS,
          employees: [{ _id: 'e1', name: 'Emp1', department: 'd1', subDepartment: 'sd1' }],
          directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
          monthlyWithoutSelf: Object.entries(roster).map(([day, shiftId]) => ({
            _id: `sch${day}`,
            employee: 'e1',
            date: `${month}-${String(day).padStart(2, '0')}`,
            shiftId,
            department: 'd1',
            subDepartment: 'sd1'
          })),
          // 時間給 null 代表整天的假（日期選擇器只有日期）
          leaves: leaves.map(([fromDay, fromTime, toDay, toTime]) => ({
            employee: 'e1',
            leaveType: '事假',
            status: 'approved',
            startDate: fromTime ? taipeiIso(month, fromDay, fromTime) : `${month}-${String(fromDay).padStart(2, '0')}`,
            endDate: toTime ? taipeiIso(month, toDay, toTime) : `${month}-${String(toDay).padStart(2, '0')}`
          }))
        })
        return mountSchedule()
      }
      const viewOf = (wrapper, day) => cellOf(wrapper, day).props('cellView')
      const expectLeaveDay = (wrapper, day) => {
        const view = viewOf(wrapper, day)
        expect({ day, ...view.cellMeta, leaveTitle: view.leaveTitle }).toEqual(expect.objectContaining({
          day, isLeave: true, partialLeaveHours: 0, hasShift: false, missingShift: false, leaveTitle: WHOLE_DAY_TITLE
        }))
        expect(wrapper.vm.scheduleMap.e1[day].leave).toEqual(expect.objectContaining({ type: '事假', excludesHours: true }))
      }
      const expectPartialDay = (wrapper, day, hours) => {
        const view = viewOf(wrapper, day)
        expect({ day, ...view.cellMeta, leaveTitle: view.leaveTitle }).toEqual(expect.objectContaining({
          day, isLeave: false, partialLeaveHours: hours, leaveTitle: `當天有 ${hours} 小時核准請假`
        }))
        expect(wrapper.vm.scheduleMap.e1[day].leave).toBeUndefined()
      }

      it('shows a 日班 08-17 on a leave of 08:00-17:00 as leave, also when only the unpaid break is left out', async () => {
        const month = nextMonth()
        const wrapper = mountRoster(month, { 1: 'D', 2: 'D', 3: 'D', 4: 'D0' }, [
          [1, '08:00', 1, '17:00'],
          [2, '09:00', 2, '17:00'],
          [3, '09:30', 3, '17:00'],
          [4, '09:00', 4, '17:00']
        ])
        await flush()

        expectLeaveDay(wrapper, 1)
        // 日班休息 60 分鐘：09:00-17:00 只剩休息時間沒請，仍是請假日
        expectLeaveDay(wrapper, 2)
        // 差 90 分鐘、或沒有休息時間的日班差 1 小時：只是請幾小時，仍可排班
        expectPartialDay(wrapper, 3, 7.5)
        expectPartialDay(wrapper, 4, 8)
        expect(wrapper.vm.isSelectableCell('e1', 1)).toBe(false)
        expect(wrapper.vm.isSelectableCell('e1', 3)).toBe(true)

        apiFetch.mockClear()
        await wrapper.vm.onSelect('e1', 1, 'P')
        expect(apiFetch).not.toHaveBeenCalled()
        expect(ElMessage.info).toHaveBeenCalledWith('該日的核准請假涵蓋整個班別，無法調整排班')

        await wrapper.vm.onSelect('e1', 3, 'N')
        await flush()
        expect(apiFetch).toHaveBeenCalledWith(
          '/api/schedules/sch3',
          expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"shiftId":"N"') })
        )
      })

      it('shows an afternoon shift on an afternoon leave as leave, but keeps a 日班 that the leave only overlaps', async () => {
        const month = nextMonth()
        const wrapper = mountRoster(month, { 1: 'P', 2: 'D' }, [
          [1, '13:00', 1, '17:00'],
          [2, '13:00', 2, '17:00']
        ])
        await flush()

        expectLeaveDay(wrapper, 1)
        expectPartialDay(wrapper, 2, 4)
      })

      it('adds up two leaves (08-12 and 13-17) that together leave only the break of the 日班 uncovered', async () => {
        const month = nextMonth()
        const wrapper = mountRoster(month, { 1: 'D', 2: 'D0' }, [
          [1, '08:00', 1, '12:00'],
          [1, '13:00', 1, '17:00'],
          [2, '08:00', 2, '12:00'],
          [2, '13:00', 2, '17:00']
        ])
        await flush()

        expectLeaveDay(wrapper, 1)
        // 沒有休息時間的日班：12:00-13:00 沒請，只是請 8 小時
        expectPartialDay(wrapper, 2, 8)
      })

      it('counts an all-day leave on the next day when judging the tail of a night shift, as the server does', async () => {
        const month = nextMonth()
        // 10 日夜班 22:00-翌日 06:00：10 日 22:00-24:00 有時分的假 + 11 日整天的假，整個班次都在請假中
        const wrapper = mountRoster(month, { 10: 'N' }, [
          [10, '22:00', 11, '00:00'],
          [11, null, 11, null]
        ])
        await flush()

        expectLeaveDay(wrapper, 10)
      })

      it('keeps a night shift editable on a day a timed leave covers from 00:00 to 24:00 when its tail runs past the leave', async () => {
        const month = nextMonth()
        // 請假 2 日 13:00 到 4 日 00:00：3 日整個日曆日都在請假中，但 3 日夜班的 4 日 00:00-06:00 沒請，伺服器不當請假日
        const wrapper = mountRoster(month, { 3: 'N', 5: 'D' }, [
          [2, '13:00', 4, '00:00'],
          [5, '00:00', 6, '00:00']
        ])
        await flush()

        expectPartialDay(wrapper, 3, 8)
        expect(wrapper.vm.isSelectableCell('e1', 3)).toBe(true)
        // 同樣整天的有時分請假、排的是日班：整個班次都在請假中，是請假日
        expectLeaveDay(wrapper, 5)
      })

      it('covers a night shift that crosses midnight only when the leave runs to the end of the shift', async () => {
        const month = nextMonth()
        const wrapper = mountRoster(month, { 1: 'N', 2: 'D', 3: 'N' }, [
          [1, '22:00', 2, '06:00'],
          [3, '22:00', 4, '00:00']
        ])
        await flush()

        expectLeaveDay(wrapper, 1)
        // 隔天凌晨的 6 小時不影響隔天的日班
        expectPartialDay(wrapper, 2, 6)
        // 只請到午夜：夜班後半段沒請
        expectPartialDay(wrapper, 3, 2)
      })

      it('never guesses: a shift missing from the shift table, a rest day or an empty day keeps the leave-hours note and stays editable', async () => {
        const month = nextMonth()
        const wrapper = mountRoster(month, { 1: 'ghost-shift', 2: 'R' }, [
          [1, '08:00', 1, '17:00'],
          [2, '08:00', 2, '17:00'],
          [3, '08:00', 3, '17:00']
        ])
        await flush()

        expectPartialDay(wrapper, 1, 8)
        expect(viewOf(wrapper, 1).cellMeta.hasShift).toBe(true)
        expectPartialDay(wrapper, 2, 8)
        expectPartialDay(wrapper, 3, 8)
        expect(viewOf(wrapper, 3).cellMeta.missingShift).toBe(true)
        expect(wrapper.vm.isSelectableCell('e1', 1)).toBe(true)
      })
    })

    it('says a leave conflict from the server is a whole-day leave or a leave covering the shift', async () => {
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      wrapper.vm.currentMonth = '2026-08'
      wrapper.vm.employees = [
        { _id: 'e1', employeeId: 'A0077', name: '石靜嫻', departmentId: 'd1', subDepartmentId: 'sd1' }
      ]
      wrapper.vm.shifts = [{ _id: 'day', code: 'D', name: '日班' }]
      wrapper.vm.scheduleMap = { e1: { 21: { shiftId: '', department: 'd1', subDepartment: 'sd1' } } }
      apiFetch.mockReset()
      apiFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'leave conflict' }) })

      await wrapper.vm.onSelect('e1', 21, 'day')

      expect(ElMessageBox.alert).toHaveBeenCalledWith(
        expect.stringContaining('A0077 石靜嫻：2026-08-21 已有核准的全天請假，或請假時間涵蓋整個班別，無法安排班別「D(日班)」'),
        '核准請假衝突',
        expect.objectContaining({ customClass: 'schedule-issue-dialog' })
      )
    })

    it('says the same for a batch apply that the server rejects over leave', async () => {
      apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
      const wrapper = mountSchedule()
      await flush()
      ElMessageBox.alert.mockClear()

      await wrapper.vm.handleBatchApiError({ json: async () => ({ error: 'leave conflict' }) })

      expect(ElMessageBox.alert).toHaveBeenCalledWith(
        expect.stringContaining('已核准的全天請假，或請假時間涵蓋整個班別的日子，無法套用'),
        '核准請假衝突',
        expect.objectContaining({ customClass: 'schedule-issue-dialog' })
      )
    })
  })

  it('editable cells only show shift selector without department/sub-department selectors', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      shifts: [{ _id: 'shift1', code: 'A', name: '早班' }],
      employees: [{ _id: 'e1', name: 'Emp1', department: 'd1', subDepartment: 'sd1' }],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }],
      monthlyWithoutSelf: [
        {
          _id: 'sch1',
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 'shift1',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()

    const editableCell = wrapper.findAllComponents({ name: 'ScheduleGridVirtualBody' })
      .find(component => component.props('row')?._id === 'e1' && component.props('day')?.date === 1)
    expect(editableCell).toBeTruthy()
    expect(editableCell.props('canEdit')).toBe(true)
    expect(editableCell.props()).not.toHaveProperty('departments')
    expect(editableCell.props()).not.toHaveProperty('subDepartments')
  })

  it('falls back to employee department fields when cell department fields are empty on select', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.currentMonth = '2026-03'
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: 'd1', subDepartmentId: 'sd1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        2: { shiftId: '', department: '', subDepartment: '' }
      }
    }
    await wrapper.vm.$nextTick()

    apiFetch.mockReset()
    apiFetch.mockImplementation(async url => {
      if (url === '/api/schedules') {
        return { ok: true, json: async () => ({ _id: 'sch-new', shiftId: 's1' }) }
      }
      if (url === '/api/schedules/summary') {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => [] }
    })

    await wrapper.vm.onSelect('e1', 2, 's1')

    const createCall = apiFetch.mock.calls.find(([url]) => url === '/api/schedules')
    expect(createCall).toBeTruthy()
    expect(JSON.parse(createCall[1].body)).toEqual({
      employee: 'e1',
      date: '2026-03-02',
      shiftId: 's1',
      department: 'd1',
      subDepartment: 'sd1'
    })
    expect(wrapper.vm.scheduleMap.e1[2]).toEqual(
      expect.objectContaining({
        id: 'sch-new',
        shiftId: 's1',
        department: 'd1',
        subDepartment: 'sd1'
      })
    )
  })

  it('normalizes populated department references before a supervisor creates a schedule', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.currentMonth = '2026-03'
    wrapper.vm.employees = [
      {
        _id: 'sup1',
        departmentId: { _id: 'd1', name: '護理部' },
        subDepartmentId: { _id: 'sd1', name: 'B' }
      }
    ]
    wrapper.vm.scheduleMap = {
      sup1: {
        2: {
          shiftId: '',
          department: { _id: 'd1', name: '護理部' },
          subDepartment: { _id: 'sd1', name: 'B' }
        }
      }
    }
    await wrapper.vm.$nextTick()

    apiFetch.mockReset()
    apiFetch.mockImplementation(async url => {
      if (url === '/api/schedules') {
        return { ok: true, json: async () => ({ _id: 'sch-self', shiftId: 's1' }) }
      }
      if (url === '/api/schedules/summary') {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => [] }
    })

    await wrapper.vm.onSelect('sup1', 2, 's1')

    const createCall = apiFetch.mock.calls.find(([url]) => url === '/api/schedules')
    expect(JSON.parse(createCall[1].body)).toEqual({
      employee: 'sup1',
      date: '2026-03-02',
      shiftId: 's1',
      department: 'd1',
      subDepartment: 'sd1'
    })
  })

  it('formats shift label with code and name when available', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    const shift = { code: 'S1', name: '早班' }
    expect(wrapper.vm.formatShiftLabel(shift)).toBe('S1(早班)')
    expect(wrapper.vm.formatShiftLabel({ code: 'S2', name: '' })).toBe('S2')
    expect(wrapper.vm.formatShiftLabel(null)).toBe('')
  })

  it('增量維護選取快取，避免不必要的全量重算', async () => {
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.employees = [
      { _id: 'e1', name: 'E1' },
      { _id: 'e2', name: 'E2' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: 's1' }, 2: { shiftId: 's1' } },
      e2: { 1: { shiftId: 's1' }, 2: { shiftId: 's1' } }
    }

    await wrapper.vm.toggleDay(1, true)
    expect(wrapper.vm.allSelectedCells.has('e1::1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2::1')).toBe(true)

    await wrapper.vm.toggleEmployee('e1', true)
    expect(wrapper.vm.allSelectedCells.has('e1::2')).toBe(true)

    await wrapper.vm.toggleDay(1, false)
    expect(wrapper.vm.allSelectedCells.has('e2::1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1::1')).toBe(true)

    await wrapper.vm.toggleEmployee('e1', false)
    expect(wrapper.vm.allSelectedCells.has('e1::1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1::2')).toBe(false)

    await wrapper.vm.toggleCell('e2', 2, true)
    expect(wrapper.vm.allSelectedCells.has('e2::2')).toBe(true)

    await wrapper.vm.toggleCell('e2', 2, false)
    expect(wrapper.vm.allSelectedCells.size).toBe(0)

    await wrapper.vm.clearSelection()
    expect(wrapper.vm.allSelectedCells.size).toBe(0)
  })

  it('裁剪與資料更新時會同步清理選取快取', async () => {
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.employees = [
      { _id: 'e1', name: 'E1' },
      { _id: 'e2', name: 'E2' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: 's1' }, 2: { shiftId: 's1' } },
      e2: { 1: { shiftId: 's1' }, 2: { shiftId: 's1' } }
    }

    await wrapper.vm.toggleEmployee('e1', true)
    await wrapper.vm.toggleDay(1, true)
    await wrapper.vm.toggleCell('e2', 2, true)
    expect(wrapper.vm.allSelectedCells.has('e1::1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e1::2')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2::1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2::2')).toBe(true)

    wrapper.vm.employees = [{ _id: 'e2', name: 'E2' }]
    wrapper.vm.scheduleMap.e1[2].leave = { approved: true }
    wrapper.vm.pruneSelections()
    await flush()

    expect(wrapper.vm.selectedEmployees.has('e1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1::1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1::2')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e2::1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2::2')).toBe(true)
  })

  it('renders shift legend items from API data', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          shifts: [
            { _id: 'shift1', code: 'M1', name: '早班' },
            { _id: 'shift2', code: 'N1', name: '夜班' }
          ]
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()

    const legendItems = wrapper.findAll('[data-test="shift-legend-item"]')
    expect(legendItems).toHaveLength(2)
    expect(legendItems[0].text()).toBe('M1(早班)')
    const firstStyle = styleToObject(legendItems[0].attributes('style'))
    const expectedMorning = buildShiftStyle({ _id: 'shift1', code: 'M1', name: '早班' })
    expect(firstStyle['--shift-base-color']).toBe(expectedMorning['--shift-base-color'])
    expect(firstStyle['--shift-text-color']).toBe(expectedMorning['--shift-text-color'])
    expect(legendItems[1].text()).toBe('N1(夜班)')
    const secondStyle = styleToObject(legendItems[1].attributes('style'))
    const expectedEvening = buildShiftStyle({ _id: 'shift2', code: 'N1', name: '夜班' })
    expect(secondStyle['--shift-base-color']).toBe(expectedEvening['--shift-base-color'])
    expect(secondStyle['--shift-text-color']).toBe(expectedEvening['--shift-text-color'])
    expect(wrapper.find('[data-test="shift-legend-empty"]').exists()).toBe(false)
  })

  it('shows default legend message when no shift data exists', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()

    const emptyLegend = wrapper.find('[data-test="shift-legend-empty"]')
    expect(emptyLegend.exists()).toBe(true)
    expect(emptyLegend.text()).toContain('尚未設定班別')
    expect(wrapper.findAll('[data-test="shift-legend-item"]').length).toBe(0)
  })

  it('filters subDepartments by department id', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    expect(wrapper.vm.filteredSubDepartments).toEqual([
      { _id: 'sd1', name: 'Sub A', department: 'd1' }
    ])
  })

  it('locks department options to supervisor department', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup2')
    setupSupervisorApiMock({
      supervisorProfile: {
        _id: 'sup2',
        department: { _id: 'd1', name: 'Dept A' },
        subDepartment: { _id: 'sd2', name: 'Sub B' }
      },
      directReports: [
        { _id: 'e1', subDepartment: { _id: 'sd2', name: 'Sub B' } }
      ],
      departments: [
        { _id: 'd1', name: 'Dept A' },
        { _id: 'd2', name: 'Dept B' }
      ],
      subDepartments: [
        { _id: 'sd2', name: 'Sub B', department: { _id: 'd1' } },
        { _id: 'sd3', name: 'Sub C', department: { _id: 'd2' } }
      ],
      employees: [
        {
          _id: 'e1',
          name: 'Employee 1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd2', name: 'Sub B' }
        }
      ]
    })
    const wrapper = mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees/schedule?supervisor=sup2&pageSize=200')
    expect(wrapper.vm.departments).toEqual([{ _id: 'd1', name: 'Dept A' }])
    expect(wrapper.vm.selectedDepartment).toBe('d1')
    expect(wrapper.vm.subDepartments).toEqual([
      { _id: 'sd2', name: 'Sub B', department: 'd1' }
    ])
    expect(wrapper.vm.selectedSubDepartment).toBe('sd2')
  })

  it('keeps all sub-departments for admin role', async () => {
    setRoleToken('admin')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd2', name: 'Sub B', department: 'd1' },
          { _id: 'sd3', name: 'Sub C', department: 'd1' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.subDepartments).toEqual([
      { _id: 'sd2', name: 'Sub B', department: 'd1' },
      { _id: 'sd3', name: 'Sub C', department: 'd1' }
    ])
  })

  it('fetches sub-departments when department changes', async () => {
    setupSupervisorApiMock({
      departments: [{ _id: 'd1', name: 'Dept A' }],
      subDepartments: [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }],
      employees: [{ _id: 'e1', name: 'E1', department: '', subDepartment: '' }]
    })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = 'd1'
    await wrapper.vm.onDepartmentChange()
    expect(apiFetch).toHaveBeenCalledWith('/api/sub-departments?department=d1')
    expect(wrapper.vm.subDepartments).toEqual([
      { _id: 'sd1', name: 'Sub A', department: 'd1' }
    ])
  })

  it('filters employees by name', async () => {
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: 'Alice', department: '', subDepartment: '' },
        { _id: 'e2', name: 'Bob', department: '', subDepartment: '' }
      ]
    })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employeeSearch = 'Ali'
    await flush()
    expect(wrapper.vm.filteredEmployees.length).toBe(1)
    expect(wrapper.vm.filteredEmployees[0].name).toBe('Alice')
  })

  it('filters employees by status', async () => {
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: 'A', department: '', subDepartment: '' },
        { _id: 'e2', name: 'B', department: '', subDepartment: '' }
      ],
      monthlyWithoutSelf: [{ employee: 'e2', shiftId: 's1' }],
      leaves: [{ employee: 'e2', status: 'approved' }]
    })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.statusFilter = 'unscheduled'
    await flush()
    expect(wrapper.vm.filteredEmployees.map(e => e._id)).toEqual(['e1'])
    wrapper.vm.statusFilter = 'onLeave'
    await flush()
    expect(wrapper.vm.filteredEmployees.map(e => e._id)).toEqual(['e2'])
  })

  it('renders cached status icons and readonly shift label without regression', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.shifts = [
      { _id: 's1', code: 'A1', name: '早班', startTime: '08:00', endTime: '17:00' }
    ]
    wrapper.vm.employees = [
      { _id: 'e1', name: '未排班員工', department: '', subDepartment: '' },
      { _id: 'e2', name: '請假員工', department: '', subDepartment: '' },
      { _id: 'e3', name: '正常員工', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: '' } },
      e2: { 1: { shiftId: '', leave: {} } },
      e3: { 1: { shiftId: 's1' } }
    }
    wrapper.vm.leaveIndex = { e2: { 1: true } }
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.employeeStatus('e1')).toBe('unscheduled')
    expect(wrapper.vm.employeeStatus('e2')).toBe('onLeave')
    expect(wrapper.vm.shiftInfo('s1')).toEqual(expect.objectContaining({ code: 'A1', name: '早班' }))
    expect(wrapper.vm.getCellMeta('e3', 1)).toEqual(
      expect.objectContaining({ hasShift: true, missingShift: false })
    )
  })

  it('lazy mode is disabled - schedule table always expanded', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = Array.from({ length: 51 }, (_, i) => ({
      _id: 'e' + i,
      name: 'E' + i,
      department: '',
      subDepartment: ''
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.shouldUseVirtualRender).toBe(false)
  })

  it('reverts change when update fails', async () => {
    setRoleToken('supervisor')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 's1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    apiFetch.mockResolvedValue({ ok: false, json: async () => ({}) })
    wrapper.vm.scheduleMap = { e1: { 1: { id: 'sch1', shiftId: 's1', department: 'd1', subDepartment: 'sd1' } } }
    await wrapper.vm.onSelect('e1', 1, 's2')
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s1')
  })

  it('reverts change when creation fails', async () => {
    setRoleToken('supervisor')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 's1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd1', name: 'Sub A' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: false })

    localStorage.setItem('employeeId', 's1')
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 2: { shiftId: '', department: 'd1', subDepartment: 'sd1' } } }
    await wrapper.vm.onSelect('e1', 2, 's1')
    expect(wrapper.vm.scheduleMap.e1?.[2]?.shiftId ?? '').toBe('')
  })

  it('shows employee, date and shift details when a single schedule conflicts', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.currentMonth = '2026-08'
    wrapper.vm.employees = [
      { _id: 'e1', employeeId: 'A0077', name: '石靜嫻', departmentId: 'd1', subDepartmentId: 'sd1' }
    ]
    wrapper.vm.shifts = [
      { _id: 'rest', code: '休', name: '休假' },
      { _id: 'day', code: 'D', name: '日班' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 21: { shiftId: '', department: 'd1', subDepartment: 'sd1' } }
    }
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'employee conflict',
        conflict: {
          employee: 'e1',
          date: '2026-08-21T00:00:00.000Z',
          existingScheduleId: 'schedule-existing',
          existingShiftId: 'day',
          requestedShiftId: 'rest'
        }
      })
    })

    await wrapper.vm.onSelect('e1', 21, 'rest')

    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      expect.stringContaining('A0077 石靜嫻：2026-08-21 已有排班「D(日班)」，無法再排「休(休假)」'),
      '排班資料衝突',
      expect.objectContaining({ customClass: 'schedule-issue-dialog', closeOnClickModal: false })
    )
    expect(wrapper.vm.scheduleMap.e1[21].shiftId).toBe('')
  })

  it('shows name column and weekday labels', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '1F', subDepartment: 'HR' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.days[0].label).toMatch(/^1\(.\)$/)
    const cols = wrapper.findAll('.col')
    expect(cols[0].attributes('data-label')).toBe('員工姓名')
    expect(cols[1].attributes('data-label')).toBe('單位')
    expect(cols[2].attributes('data-label')).toBe('職稱 / 職位')
    expect(cols[3].attributes('data-label')).toBe('特休剩餘')
    expect(cols[4].attributes('data-label')).toMatch(/^1\(.\)$/)
  })

  it('keeps all employee identity columns fixed on horizontal scroll', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: '1F', name: '1F' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'HR', name: 'HR', department: '1F' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'e1', name: 'E1', subDepartmentName: '急診', department: '1F', subDepartment: 'HR' }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()

    const cols = wrapper.findAll('.col')
    expect(cols[0].attributes('data-label')).toBe('員工姓名')
    expect(cols[0].attributes('data-fixed')).toBe('left')
    expect(cols[1].attributes('data-label')).toBe('單位')
    expect(cols[1].attributes('data-fixed')).toBe('left')
    expect(cols[2].attributes('data-label')).toBe('職稱 / 職位')
    expect(cols[2].attributes('data-fixed')).toBe('left')
    expect(cols[2].attributes('data-class-name')).toContain('title-position-column')
    expect(cols[3].attributes('data-label')).toBe('特休剩餘')
    expect(cols[3].attributes('data-fixed')).toBe('left')
    cols.slice(0, 4).forEach(column => {
      expect(column.attributes('data-class-name')).toContain('schedule-fixed-column')
    })
    expect(cols.slice(0, 4).map(column => column.attributes('data-width'))).toEqual(['160', '92', '166', '96'])
  })

  it('shows identical title and practice title only once', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const employee = {
      _id: 'e1',
      name: 'E1',
      department: 'd1',
      subDepartment: 'sd1',
      title: '專任管理員',
      practiceTitle: '專任管理員'
    }
    setupSupervisorApiMock({ employees: [employee], directReports: [employee] })

    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.find('.title-line').text()).toBe('專任管理員')
    expect(wrapper.findAll('.practice-title-line')).toHaveLength(0)
  })

  it('displays leave label when leave data exists', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setupSupervisorApiMock({
      employees: [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }],
      leaves: [{
        employee: 'e1',
        status: 'approved',
        startDate: `${month}-01`,
        endDate: `${month}-01`,
        leaveType: 'annual'
      }]
    })
    const wrapper = mountSchedule()
    await flush()
    const leaveCell = wrapper.findAllComponents({ name: 'ScheduleGridVirtualBody' })
      .find(component => component.props('row')?._id === 'e1' && component.props('day')?.date === 1)
    expect(leaveCell).toBeTruthy()
    expect(leaveCell.props('cellView').cellMeta.isLeave).toBe(true)
    expect(leaveCell.props('cellView').leaveTitle).toContain('已核准請假')
  })

  it('maps department ids to names', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(wrapper.vm.employees).toEqual([
      expect.objectContaining({
        _id: 'e1',
        name: 'E1',
        departmentId: 'd1',
        subDepartmentId: 'sd1',
        department: 'Dept A',
        subDepartment: 'Sub A',
        scheduleRowColor: null,
        annualLeave: {
          remainingDays: 0,
          remainingHours: 0
        }
      })
    ])
  })

  it('shows the remaining annual leave in hours (legacy day-only responses are converted, 1 day = 8 hours)', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1', annualLeave: { remainingHours: 20, remainingDays: 2.5 } },
          { _id: 'e2', name: 'E2', department: 'd1', subDepartment: 'sd1', annualLeave: { remainingDays: 3 } },
          { _id: 'e3', name: 'E3', department: 'd1', subDepartment: 'sd1', annualLeave: { remainingHours: -4 } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()

    const byId = Object.fromEntries(wrapper.vm.employees.map(employee => [employee._id, employee.annualLeave]))
    expect(byId.e1).toEqual({ remainingDays: 2.5, remainingHours: 20 })
    expect(byId.e2).toEqual({ remainingDays: 3, remainingHours: 24 })
    expect(byId.e3).toEqual({ remainingDays: 0, remainingHours: 0 })
  })

  it('provides fixed 8 row color options', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.vm.rowColorOptions).toHaveLength(8)
    expect(wrapper.vm.rowColorOptions).toEqual(ROW_COLOR_PALETTE)
  })

  it('applies row color to selected employees', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'sd1', name: 'Sub A', department: 'd1' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' },
          { _id: 'e2', name: 'E2', department: 'd1', subDepartment: 'sd1' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()

    await wrapper.vm.toggleEmployee('e1', true)
    wrapper.vm.batchRowColorIndex = 3
    wrapper.vm.applyRowColor()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.rowColorAssignments.e1).toBe(3)
    const style = wrapper.vm.scheduleRowStyle({ row: { _id: 'e1' } })
    expect(style.backgroundColor).toBe(ROW_COLOR_PALETTE[3].bg)
  })

  it('applies batch schedules to selected cells', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: 'd1', subDepartmentId: 'sd1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: '', department: 'd1', subDepartment: 'sd1' }
      }
    }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleCell('e1', 1, true)
    wrapper.vm.batchShiftId = 's1'
    wrapper.vm.batchDepartment = 'd2'
    wrapper.vm.batchSubDepartment = 'sd2'
    const inserted = [
      {
        _id: 'sch1',
        employee: 'e1',
        date: `${month}-01`,
        shiftId: 's1',
        department: 'd2',
        subDepartment: 'sd2'
      }
    ]
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => inserted })
    await wrapper.vm.applyBatch()
    const batchCall = apiFetch.mock.calls.findLast(([url]) => url === '/api/schedules/batch')
    expect(batchCall).toBeTruthy()
    expect(JSON.parse(batchCall[1].body)).toEqual({
      schedules: [
        {
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 's1',
          department: 'd2',
          subDepartment: 'sd2'
        }
      ]
    })
    expect(wrapper.vm.scheduleMap.e1[1]).toEqual(
      expect.objectContaining({ id: 'sch1', shiftId: 's1', department: 'd2', subDepartment: 'sd2' })
    )
    expect(ElMessage.success).toHaveBeenCalledWith('批次套用完成')
  })

  it('omits blank department references from batch payloads', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: '', subDepartmentId: '', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: '', department: '', subDepartment: '' }
      }
    }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleCell('e1', 1, true)
    wrapper.vm.batchShiftId = 's1'
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{
        _id: 'sch1',
        employee: 'e1',
        date: `${month}-01`,
        shiftId: 's1'
      }])
    })

    await wrapper.vm.applyBatch()

    const batchCall = apiFetch.mock.calls.findLast(([url]) => url === '/api/schedules/batch')
    expect(JSON.parse(batchCall[1].body)).toEqual({
      schedules: [{
        employee: 'e1',
        date: `${month}-01`,
        shiftId: 's1'
      }]
    })
  })

  it('updates existing schedules via batch apply', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: 'd1', subDepartmentId: 'sd1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { id: 'sch1', shiftId: 's0', department: 'd1', subDepartment: 'sd1' }
      }
    }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleCell('e1', 1, true)
    wrapper.vm.batchShiftId = 's2'
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          _id: 'sch1',
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 's2',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ])
    })
    await wrapper.vm.applyBatch()
    const batchCall = apiFetch.mock.calls.findLast(([url]) => url === '/api/schedules/batch')
    expect(batchCall).toBeTruthy()
    expect(JSON.parse(batchCall[1].body)).toEqual({
      schedules: [
        {
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 's2',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ]
    })
    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s2')
    expect(wrapper.vm.scheduleMap.e1[1].id).toBe('sch1')
    expect(ElMessage.success).toHaveBeenCalledWith('批次套用完成')
  })

  it('skips leave dates during batch apply selections', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', departmentId: 'd1', subDepartmentId: 'sd1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: '', department: 'd1', subDepartment: 'sd1' },
        2: { shiftId: '', department: 'd1', subDepartment: 'sd1', leave: { type: 'annual' } }
      }
    }
    wrapper.vm.leaveIndex = { e1: { 2: { type: 'annual' } } }
    await wrapper.vm.$nextTick()
    wrapper.vm.selectAllEmployees()
    wrapper.vm.selectAllDays()
    wrapper.vm.batchShiftId = 's1'
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          _id: 'sch1',
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 's1',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ]
    })
    await wrapper.vm.applyBatch()
    const batchCall = apiFetch.mock.calls.find(([url]) => url === '/api/schedules/batch')
    expect(JSON.parse(batchCall[1].body)).toEqual({
      schedules: [
        {
          employee: 'e1',
          date: `${month}-01`,
          shiftId: 's1',
          department: 'd1',
          subDepartment: 'sd1'
        }
      ]
    })
    expect(ElMessage.success).toHaveBeenCalledWith('批次套用完成')
  })

  it('分頁時點擊全部人員全選後切頁仍維持勾選', async () => {
    const allEmployees = [
      { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' },
      { _id: 'e2', name: 'E2', department: 'd1', subDepartment: 'sd1' },
      { _id: 'e3', name: 'E3', department: 'd1', subDepartment: 'sd1' }
    ]
    const pagedEmployees = {
      1: allEmployees.slice(0, 2),
      2: allEmployees.slice(2)
    }

    apiFetch.mockImplementation(async url => {
      if (url.startsWith('/api/departments')) return { ok: true, json: async () => [{ _id: 'd1', name: 'D1' }] }
      if (url.startsWith('/api/sub-departments')) {
        return { ok: true, json: async () => [{ _id: 'sd1', name: 'S1', department: { _id: 'd1' } }] }
      }
      if (url.startsWith('/api/shifts')) return { ok: true, json: async () => [] }
      if (url.startsWith('/api/schedules/summary')) return { ok: true, json: async () => [] }
      if (url.startsWith('/api/schedules/monthly')) return { ok: true, json: async () => [] }
      if (url.startsWith('/api/schedules/leave-approvals')) {
        return { ok: true, json: async () => ({ approvals: [], leaves: [] }) }
      }
      if (url.startsWith('/api/employees/schedule')) {
        const query = new URLSearchParams(url.split('?')[1] || '')
        const page = Number(query.get('page') || 1)
        const size = Number(query.get('pageSize') || 50)
        const list = size >= 3 ? allEmployees : (pagedEmployees[page] || [])
        return {
          ok: true,
          json: async () => ({
            employees: list,
            pagination: { total: allEmployees.length, page, pageSize: size }
          })
        }
      }
      return { ok: true, json: async () => [] }
    })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    wrapper.vm.days = [
      { date: 1, label: '1' },
      { date: 2, label: '2' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: 's1', day: 1 }, 2: { shiftId: 's1', day: 2 } },
      e2: { 1: { shiftId: 's1', day: 1 }, 2: { shiftId: 's1', day: 2 } },
      e3: { 1: { shiftId: 's1', day: 1 }, 2: { shiftId: 's1', day: 2 } }
    }
    wrapper.vm.serverPaginationTotal = 3
    wrapper.vm.pageSize = 2
    wrapper.vm.currentPage = 1
    await wrapper.vm.$nextTick()

    await wrapper.vm.selectAllEmployeesAcrossPages()
    expect(Array.from(wrapper.vm.selectedEmployees).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(wrapper.vm.selectedAllEmployeesAcrossPages).toBe(true)

    await wrapper.vm.onPageChange(2)
    await flush()
    await flush()

    expect(wrapper.vm.currentPage).toBe(2)
    expect(wrapper.vm.employees.map(emp => emp._id)).toEqual(['e3'])
    expect(wrapper.vm.selectedEmployees.has('e1')).toBe(true)
    expect(wrapper.vm.selectedEmployees.has('e2')).toBe(true)
    expect(wrapper.vm.selectedEmployees.has('e3')).toBe(true)
  })

  it('stores data and navigates when previewing month', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.scheduleMap = { e1: { 1: { shiftId: 's1' } } }
    wrapper.vm.employees = [{ _id: 'e1', name: 'E1' }]
    wrapper.vm.shifts = [{ _id: 's1', code: 'A' }]
    await wrapper.vm.preview('month')
    const stored = JSON.parse(sessionStorage.getItem('schedulePreview'))
    expect(stored.scheduleMap.e1[1].shiftId).toBe('s1')
    expect(pushMock).toHaveBeenCalledWith({ name: 'PreviewMonth' })
  })

  it('persists includeSelf preference when toggled', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const storageKey = 'schedule-include-self:sup1'
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }
      ],
      directReports: [{ subDepartment: { _id: 'sd1' } }],
      includeSelfPreference: true,
      monthlyWithSelf: [
        {
          _id: 'sch-sup',
          employee: 'sup1',
          date: `${month}-01`,
          shiftId: 'shift1'
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    wrapper.vm.includeSelf = true
    await wrapper.vm.$nextTick()
    await flush()

    expect(localStorage.getItem(storageKey)).toBe('true')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`) &&
      url.includes('includeSelf=true')
    )
    expect(monthlyCall).toBeTruthy()
  })

  it('切換 includeSelf 會立即刷新前台選單 API', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({ includeSelfPreference: false })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    apiFetch.mockClear()
    wrapper.vm.includeSelf = true
    await wrapper.vm.$nextTick()
    await flush()

    const menuCall = apiFetch.mock.calls.find(([url]) => url === '/api/menu')
    expect(menuCall).toBeTruthy()
  })

  it('restores includeSelf preference on mount', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    const storageKey = 'schedule-include-self:sup1'
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    localStorage.setItem(storageKey, 'true')
    setupSupervisorApiMock({
      includeSelfPreference: true,
      monthlyWithSelf: [
        {
          _id: 'sch-sup',
          employee: 'sup1',
          date: `${month}-01`,
          shiftId: 'shift1'
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    expect(wrapper.vm.includeSelf).toBe(true)
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`) &&
      url.includes('includeSelf=true')
    )
    expect(monthlyCall).toBeTruthy()
    expect(localStorage.getItem(storageKey)).toBe('true')
  })

  it('保留包含自己偏好於主管尚未排班時', async () => {
    const storageKey = 'schedule-include-self:sup1'
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    localStorage.setItem(storageKey, 'true')
    setupSupervisorApiMock({ includeSelfPreference: true })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    expect(wrapper.vm.includeSelf).toBe(true)
    expect(localStorage.getItem(storageKey)).toBe('true')
    expect(ElMessage.info).toHaveBeenCalledWith('尚未為主管建立班表，請先建立排班。')
  })

  it('clears includeSelf preference when role changes', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    const storageKey = 'schedule-include-self:sup1'
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    localStorage.setItem(storageKey, 'true')
    setupSupervisorApiMock({
      includeSelfPreference: true,
      monthlyWithSelf: [
        {
          _id: 'sch-sup',
          employee: 'sup1',
          date: `${month}-01`,
          shiftId: 'shift1'
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()
    await flush()

    expect(wrapper.vm.includeSelf).toBe(true)

    const authStore = useAuthStore()
    authStore.role = 'admin'
    await wrapper.vm.$nextTick()
    await flush()

    expect(wrapper.vm.includeSelf).toBe(false)
    expect(localStorage.getItem(storageKey)).toBe('false')
  })

  it('分頁載入僅為可見員工建立班表並保留已載入資料', async () => {
    const month = dayjs().add(1, 'month').format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const employees = [
      { _id: 'e1', name: '員工A', department: 'd1', subDepartment: 'sd1' },
      { _id: 'e2', name: '員工B', department: 'd1', subDepartment: 'sd1' },
      { _id: 'e3', name: '員工C', department: 'd1', subDepartment: 'sd1' }
    ]
    const schedules = [
      { _id: 'sch1', employee: { _id: 'e1', name: '員工A' }, date: `${month}-01`, shiftId: 'shiftA' },
      {
        _id: 'sch2',
        employee: { _id: 'e2', name: '員工B' },
        date: `${month}-01`,
        shiftId: 'shiftB',
        state: 'pending_confirmation',
        employeeResponse: 'pending'
      },
      { _id: 'sch3', employee: { _id: 'e3', name: '員工C' }, date: `${month}-02`, shiftId: 'shiftA' }
    ]
    setupSupervisorApiMock({
      employees,
      directReports: employees,
      monthlyWithSelf: schedules,
      monthlyWithoutSelf: schedules,
      shifts: [
        { _id: 'shiftA', name: '早班' },
        { _id: 'shiftB', name: '晚班' }
      ],
      departments: [{ _id: 'd1', name: 'Dept' }],
      subDepartments: [{ _id: 'sd1', name: 'Unit', department: { _id: 'd1' } }],
      leaves: [
        {
          employee: { _id: 'e2' },
          status: 'approved',
          startDate: `${month}-01`,
          endDate: `${month}-01`,
          leaveType: 'vacation'
        }
      ]
    })

    const wrapper = mountSchedule()
    wrapper.vm.pageSize = 1
    await flush()
    await flush()
    await flush()

    expect(Object.keys(wrapper.vm.scheduleMap)).toEqual(expect.arrayContaining(['e1']))
    expect(wrapper.vm.scheduleMap.e2).toBeUndefined()

    wrapper.vm.onPageChange(2)
    await flush()
    await flush()

    expect(wrapper.vm.scheduleMap.e1).toBeTruthy()
    expect(wrapper.vm.scheduleMap.e2?.[1]?.leave).toBeTruthy()
    expect(wrapper.vm.publishSummary.totalEmployees).toBe(3)
  })

  it('exports pdf and triggers download', async () => {
    setupSupervisorApiMock({
      employees: [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }],
      exportResponse: { ok: true, blob: async () => new Blob(['x']) }
    })

    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.selectedDepartment = ''
    wrapper.vm.selectedSubDepartment = ''
    await wrapper.vm.$nextTick()
    const click = vi.fn()
    const origCreate = document.createElement
    document.createElement = function createElement(tag, ...args) {
      return tag === 'a'
        ? { href: '', download: '', click }
        : origCreate.call(document, tag, ...args)
    }
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    global.URL.revokeObjectURL = vi.fn()
    await wrapper.vm.exportSchedules('pdf')
    expect(apiFetch).toHaveBeenCalledWith(
      `/api/schedules/export?month=${dayjs().add(1, 'month').format('YYYY-MM')}&format=pdf`
    )
    expect(click).toHaveBeenCalled()
    document.createElement = origCreate
  })

  it('toggles fullscreen and recalculates table height', async () => {
    const wrapper = mountSchedule()
    await flush()

    const defaultHeight = wrapper.vm.tableMaxHeight
    expect(wrapper.vm.isTableFullscreen).toBe(false)
    expect(wrapper.vm.dayColumnWidth).toBe(140)

    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isTableFullscreen).toBe(true)
    expect(wrapper.find('[data-test="schedule-card"]').classes()).toContain('is-fullscreen')
    expect(wrapper.find('[data-test="schedule-table-wrapper"]').classes()).toContain('is-fullscreen')
    expect(wrapper.vm.dayColumnWidth).toBe(92)
    expect(wrapper.vm.tableMaxHeight).toBeGreaterThan(defaultHeight)

    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()

    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.isTableFullscreen).toBe(false)
  })

  it('全螢幕模式將完整問題檢視器掛載在排班容器內', async () => {
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()

    await wrapper.vm.openScheduleIssueDialog(
      '排班規範檢核未通過',
      ['CODEX_TEST 全螢幕問題'],
      '檢核失敗',
      { record: false }
    )

    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      'CODEX_TEST 全螢幕問題',
      '排班規範檢核未通過',
      expect.objectContaining({
        customClass: 'schedule-issue-dialog',
        modalClass: 'schedule-issue-overlay',
        appendTo: wrapper.find('[data-test="schedule-card"]').element
      })
    )
  })

  it('全螢幕模式仍可看到簽核摘要，且可展開簽核詳細列表', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: '王小明', department: 'd1', subDepartment: 'sd1' },
        { _id: 'e2', name: '李小華', department: 'd1', subDepartment: 'sd1' }
      ],
      approvals: [
        {
          _id: 'ap1',
          status: 'pending',
          form: { _id: 'f1', name: '請假申請', category: 'leave' },
          applicant_employee: { _id: 'e1', name: '王小明' }
        },
        {
          _id: 'ap2',
          status: 'disputed',
          form: { _id: 'f2', name: '請假申請', category: 'leave' },
          applicant_employee: { _id: 'e2', name: '李小華' }
        }
      ]
    })

    const wrapper = mountSchedule()
    await flush()
    await wrapper.vm.$nextTick()
    wrapper.vm.selectedEmployees = new Set(['e1', 'e2'])
    wrapper.vm.approvalList = [
      {
        _id: 'ap1',
        status: 'pending',
        form: { _id: 'f1', name: '請假申請', category: 'leave' },
        applicant_employee: { _id: 'e1', name: '王小明' }
      },
      {
        _id: 'ap2',
        status: 'disputed',
        form: { _id: 'f2', name: '請假申請', category: 'leave' },
        applicant_employee: { _id: 'e2', name: '李小華' }
      }
    ]
    await wrapper.vm.$nextTick()

    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isTableFullscreen).toBe(true)
    expect(wrapper.find('[data-test="approval-summary-inline"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="approval-summary-pending"]').text()).toBe('1')
    expect(wrapper.find('[data-test="approval-summary-disputed"]').text()).toBe('1')

    expect(wrapper.vm.approvalCollapsed).toBe(true)
    wrapper.vm.approvalCollapsed = false
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.displayedApprovalRows.length).toBe(2)
  })

  it('進入全螢幕時保留工具列，仍可手動收合與展開', async () => {
    const auth = useAuthStore()
    auth.loadUser = vi.fn(() => {
      auth.user = { role: 'admin', id: 'admin1' }
      auth.role = 'admin'
    })
    setRoleToken('admin')

    const wrapper = mountSchedule()
    await flush()

    expect(wrapper.vm.canEditSchedule).toBe(true)
    const batchToolbar = () => wrapper.find('.batch-toolbar')
    const isBatchToolbarHidden = () => (batchToolbar().attributes('style') || '').includes('display: none')

    expect(batchToolbar().exists()).toBe(true)
    expect(isBatchToolbarHidden()).toBe(false)

    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isTableFullscreen).toBe(true)
    expect(wrapper.vm.isFullscreenToolbarCollapsed).toBe(false)
    expect(batchToolbar().exists()).toBe(true)
    expect(isBatchToolbarHidden()).toBe(false)

    wrapper.vm.toggleFullscreenToolbar()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isFullscreenToolbarCollapsed).toBe(true)
    expect(isBatchToolbarHidden()).toBe(true)

    wrapper.vm.toggleFullscreenToolbar()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isFullscreenToolbarCollapsed).toBe(false)
    expect(isBatchToolbarHidden()).toBe(false)
  })

  it('全螢幕模式可展開班別選單並成功回寫班別', async () => {
    const auth = useAuthStore()
    auth.loadUser = vi.fn(() => {
      auth.user = { role: 'admin', id: 'admin1' }
      auth.role = 'admin'
    })
    setRoleToken('admin')

    const wrapper = mountSchedule({
      global: {
        stubs: {
          ScheduleGridVirtualBody: {
            name: 'ScheduleGridVirtualBody',
            props: ['row', 'day', 'isFullscreen', 'fullscreenPopperTarget'],
            emits: ['select-shift'],
            template: `
              <button
                class="grid-cell-editor-stub"
                :data-fullscreen="String(!!isFullscreen)"
                :data-popper-target="String(!!fullscreenPopperTarget)"
                @click="$emit('select-shift', row._id, day.date, 's1')"
              >
                展開班別選單
              </button>
            `
          }
        }
      }
    })
    await flush()

    wrapper.vm.shifts = [{ _id: 's1', code: 'A', name: '早班' }]
    wrapper.vm.employees = [{ _id: 'e1', name: '員工A', department: 'd1', subDepartment: 'sd1' }]
    wrapper.vm.days = [{ date: 1, label: '1' }]
    wrapper.vm.scheduleMap = {
      e1: {
        1: { shiftId: '', department: 'd1', subDepartment: 'sd1' }
      }
    }
    apiFetch.mockImplementation(async (url, options) => {
      if (url === '/api/schedules' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ _id: 'created-s1', shiftId: 's1' }) }
      }
      return { ok: true, json: async () => [] }
    })
    await wrapper.vm.$nextTick()

    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.isTableFullscreen).toBe(true)

    const cellButton = wrapper.find('.grid-cell-editor-stub')
    expect(cellButton.exists()).toBe(true)
    expect(cellButton.attributes('data-fullscreen')).toBe('true')
    expect(cellButton.attributes('data-popper-target')).toBe('true')
    expect(wrapper.find('[data-test="fullscreen-popper-host"]').exists()).toBe(true)
    await cellButton.trigger('click')
    await flush()

    expect(
      apiFetch.mock.calls.some(
        ([url, options]) => url === '/api/schedules' && options?.method === 'POST'
      )
    ).toBe(true)
    expect(wrapper.vm.scheduleMap.e1[1]).toEqual(
      expect.objectContaining({
        id: 'created-s1',
        shiftId: 's1'
      })
    )
  })

  it('keeps editable cell state after exiting fullscreen', async () => {
    const auth = useAuthStore()
    auth.loadUser = vi.fn(() => {
      auth.user = { role: 'admin', id: 'admin1' }
      auth.role = 'admin'
    })
    setRoleToken('admin')

    const wrapper = mountSchedule()
    await flush()

    wrapper.vm.employees = [{ _id: 'e1', name: '員工A' }]
    wrapper.vm.scheduleMap = { e1: { 1: { shiftId: '', department: 'd1', subDepartment: 'sd1' } } }
    apiFetch.mockImplementation(async (url, options) => {
      if (url === '/api/schedules' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ _id: 'new-sch', shiftId: 's1' }) }
      }
      return { ok: true, json: async () => [] }
    })
    await wrapper.vm.$nextTick()

    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.onSelect('e1', 1, 's1')
    wrapper.vm.toggleTableFullscreen()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.scheduleMap.e1[1].shiftId).toBe('s1')
    expect(wrapper.vm.isTableFullscreen).toBe(false)
  })

  describe('part-time tag on the roster', () => {
    const rosterEmployees = [
      { _id: 'e1', employeeId: 'P001', name: '兼職員工', department: 'd1', subDepartment: 'sd1', partTime: true },
      { _id: 'e2', employeeId: 'F001', name: '正職員工', department: 'd1', subDepartment: 'sd1', partTime: false },
      { _id: 'e3', employeeId: 'N001', name: '舊資料員工', department: 'd1', subDepartment: 'sd1' }
    ]
    const directReports = rosterEmployees.map(employee => ({ _id: employee._id, subDepartment: { _id: 'sd1' } }))

    it('marks only employees whose partTime flag is true, and a missing flag counts as full-time', async () => {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock({ employees: rosterEmployees, directReports })
      const wrapper = mountSchedule()
      await flush()
      await flush()

      expect(wrapper.vm.employees.map(employee => [employee._id, employee.partTime])).toEqual([
        ['e1', true],
        ['e2', false],
        ['e3', false]
      ])
      const badges = wrapper.findAll('[data-test="part-time-badge"]')
      expect(badges).toHaveLength(1)
      expect(badges[0].text()).toBe('兼職')
      expect(badges[0].element.closest('.cell').textContent).toContain('兼職員工')
      wrapper.unmount()
    })

    it('does not tag a supervisor’s own row unless their profile is part-time', async () => {
      for (const partTime of [false, true]) {
        setRoleToken('supervisor')
        localStorage.setItem('employeeId', 'sup1')
        setupSupervisorApiMock({
          employees: [rosterEmployees[1]],
          directReports: [directReports[1]],
          includeSelfPreference: true,
          supervisorProfile: {
            _id: 'sup1',
            name: '主管',
            partTime,
            department: { _id: 'd1', name: 'Dept A' },
            subDepartment: { _id: 'sd1', name: 'Sub A' }
          }
        })
        const wrapper = mountSchedule()
        await flush()
        await flush()

        const selfRow = wrapper.vm.employees.find(employee => employee._id === 'sup1')
        expect(selfRow).toBeTruthy()
        expect(selfRow.partTime).toBe(partTime)
        expect(wrapper.findAll('[data-test="part-time-badge"]')).toHaveLength(partTime ? 1 : 0)
        wrapper.unmount()
      }
    })
  })

  describe('cross-month weeks that cannot be judged yet', () => {
    const pendingItem = (overrides = {}) => ({
      rule: 'weekly-rest-pending',
      employee: 'e1',
      weekStart: '2026-06-29',
      weekEnd: '2026-07-05',
      date: '2026-06-29',
      missingDates: ['2026-06-29', '2026-06-30'],
      missingMonths: ['2026-06'],
      message: '跨月週（2026-06-29～2026-07-05）：2026-06-29～2026-06-30 尚未排班，暫時無法判斷每週一例一休（目前缺例假、休息日）；2026年6月 班表排定後會重新檢核',
      ...overrides
    })
    const rosterOfTwo = [
      { _id: 'e1', employeeId: 'A0003', name: '王小美' },
      { _id: 'e2', employeeId: 'A0069', name: '林小華' }
    ]
    const validateResponse = (body, status = 200) => ({ ok: status === 200, status, json: async () => body })
    const pendingOnly = (items) => validateResponse({ ok: true, count: 0, violations: [], pendingWeeks: items })

    // 其餘請求照原本的替身回答，只把排班規則檢核換成指定的回應
    const answerValidateWith = (body) => {
      const base = apiFetch.getMockImplementation()
      apiFetch.mockImplementation(async (url, options) => {
        if (String(url).startsWith('/api/schedules/rules/validate')) return typeof body === 'function' ? body(url) : body
        return base(url, options)
      })
    }

    async function mountSupervisor(options = {}) {
      setRoleToken('supervisor')
      localStorage.setItem('employeeId', 'sup1')
      setupSupervisorApiMock(options)
      const wrapper = mountSchedule()
      await flush()
      wrapper.vm.employees = rosterOfTwo
      return wrapper
    }

    it('lists the weeks in their own section and keeps the precheck a pass (no violation section, no failure)', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(pendingOnly([pendingItem(), pendingItem({ employee: 'e2' })]))

      await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })
      await flush()

      const section = wrapper.find('[data-test="schedule-rule-pending"]')
      expect(section.exists()).toBe(true)
      expect(section.find('h3').text()).toBe('尚無法判斷的跨月週（共 2 項）')
      expect(section.text()).toContain('相鄰月份排定後會重新檢核')
      const items = section.findAll('li').map(item => item.text())
      expect(items).toHaveLength(2)
      expect(items[0]).toContain('A0003 王小美 2026-06-29 [每週一例一休（待判斷）]：跨月週（2026-06-29～2026-07-05）')
      expect(items[1]).toContain('A0069 林小華 2026-06-29')
      expect(wrapper.find('[data-test="schedule-rule-results"]').exists()).toBe(false)
      expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: true, count: 0, pendingCount: 2 })
      wrapper.unmount()
    })

    it('opens an info dialog (one line per week) instead of a plain success toast when only weeks are pending', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(pendingOnly([pendingItem(), pendingItem({ employee: 'e2' })]))

      await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })

      expect(ElMessageBox.alert).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.alert.mock.calls[0]
      expect(title).toBe('排班規範預檢已通過，另有 2 項跨月週尚無法判斷')
      expect(message).toContain('相鄰月份排定後會重新檢核')
      expect(message).toContain('・2026-06-29～2026-07-05：2 人（A0003 王小美、A0069 林小華）尚無法判斷，2026年6月尚未排班')
      expect(options).toMatchObject({ type: 'info', customClass: 'schedule-issue-dialog', zIndex: 4000 })
      expect(ElMessage.success).not.toHaveBeenCalled()
      // 這不是違規：不進完整檢核結果、不寫「待修正」通知
      expect(wrapper.vm.scheduleIssues.lines).toEqual([])
      expect(wrapper.vm.scheduleNotifications).toHaveLength(0)
      wrapper.unmount()
    })

    it('still reports a plain success when nothing is pending', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(validateResponse({ ok: true, count: 0, violations: [] }))

      await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })

      expect(ElMessage.success).toHaveBeenCalledWith('排班規範預檢已通過')
      expect(ElMessageBox.alert).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="schedule-rule-pending"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('keeps the success toast when the caller states the pending weeks itself (announcePending false)', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(pendingOnly([pendingItem()]))

      const result = await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true, announcePending: false })

      expect(ElMessage.success).toHaveBeenCalledWith('排班規範預檢已通過')
      expect(ElMessageBox.alert).not.toHaveBeenCalled()
      expect(result.pendingWeeks).toHaveLength(1)
      wrapper.unmount()
    })

    it('shows the pending weeks next to the violations without mixing them into the violation list', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(validateResponse({
        ok: false,
        count: 1,
        violations: [{ employee: 'e2', date: '2026-07-06', rule: 'continuous-work-days', message: '不得連續7日未安排休/例' }],
        pendingWeeks: [pendingItem()]
      }))

      await wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })
      await flush()

      expect(wrapper.find('[data-test="schedule-rule-results"]').findAll('li')).toHaveLength(1)
      expect(wrapper.find('[data-test="schedule-rule-pending"]').findAll('li')).toHaveLength(1)
      expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: false, count: 1, pendingCount: 1 })
      wrapper.unmount()
    })

    it('shows the pending count on the 排班檢核 badge only while there is no violation', async () => {
      const wrapper = await mountSupervisor()
      const badgeOf = () => wrapper.find('[data-test="schedule-rule-issues-button"]').element.closest('.badge-stub')

      apiFetch.mockResolvedValueOnce(pendingOnly([pendingItem(), pendingItem({ employee: 'e2' })]))
      await wrapper.vm.fetchScheduleRuleValidation({})
      await flush()
      expect(badgeOf().getAttribute('value')).toBe('2')
      expect(badgeOf().getAttribute('type')).toBe('info')

      apiFetch.mockResolvedValueOnce(validateResponse({
        ok: false,
        count: 1,
        violations: [{ employee: 'e2', date: '2026-07-06', rule: 'continuous-work-days', message: 'x' }],
        pendingWeeks: [pendingItem()]
      }))
      await wrapper.vm.fetchScheduleRuleValidation({})
      await flush()
      expect(badgeOf().getAttribute('value')).toBe('1')
      expect(badgeOf().getAttribute('type')).toBe('danger')
      wrapper.unmount()
    })

    it('quiet mode refreshes the badge, the result panels and the pending section without a dialog, a toast or a notification', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(validateResponse({
        ok: false,
        count: 1,
        violations: [{ employee: 'e2', date: '2026-07-06', rule: 'continuous-work-days', message: '新違規' }],
        pendingWeeks: [pendingItem()]
      }))

      await wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
      await flush()

      expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: false, count: 1, pendingCount: 1 })
      expect(wrapper.find('[data-test="schedule-rule-results"]').findAll('li')).toHaveLength(1)
      expect(wrapper.find('[data-test="schedule-rule-results"]').text()).toContain('新違規')
      expect(wrapper.find('[data-test="schedule-rule-pending"]').findAll('li')).toHaveLength(1)
      expect(ElMessageBox.alert).not.toHaveBeenCalled()
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(ElMessage.warning).not.toHaveBeenCalled()
      expect(wrapper.vm.scheduleNotifications).toHaveLength(0)
      wrapper.unmount()
    })

    it('clears the pending section when the month changes and then judges the new month again in the background', async () => {
      const wrapper = await mountSupervisor()
      apiFetch.mockResolvedValueOnce(pendingOnly([pendingItem()]))
      await wrapper.vm.fetchScheduleRuleValidation({})
      await flush()
      expect(wrapper.find('[data-test="schedule-rule-pending"]').exists()).toBe(true)

      const validateUrls = []
      answerValidateWith((url) => {
        validateUrls.push(String(url))
        return pendingOnly([pendingItem({ weekStart: '2026-07-27', weekEnd: '2026-08-02', date: '2026-07-27', missingMonths: ['2026-08'] })])
      })
      await wrapper.vm.onMonthChange('2026-08')
      await flush()

      // 切換月份後，背景重新檢核的是新月份；結果只更新徽章與提醒
      expect(validateUrls).toHaveLength(1)
      expect(new URL(validateUrls[0], 'http://localhost').searchParams.get('month')).toBe('2026-08')
      expect(wrapper.vm.scheduleRuleValidation.pendingCount).toBe(1)
      expect(wrapper.find('[data-test="schedule-rule-pending"]').text()).toContain('2026-07-27')
      expect(ElMessageBox.alert).not.toHaveBeenCalled()
      expect(wrapper.vm.scheduleNotifications).toHaveLength(0)
      wrapper.unmount()
    })

    it('does not run the background re-check for someone who cannot edit the schedule', async () => {
      setRoleToken('employee')
      setupSupervisorApiMock()
      const wrapper = mountSchedule()
      await flush()
      const validateUrls = []
      answerValidateWith((url) => {
        validateUrls.push(String(url))
        return pendingOnly([pendingItem()])
      })

      await wrapper.vm.onMonthChange('2026-08')
      await flush()

      expect(validateUrls).toEqual([])
      wrapper.unmount()
    })

    it('swallows a failed background re-check without disturbing the month change', async () => {
      const wrapper = await mountSupervisor()
      answerValidateWith(() => { throw new Error('network down') })

      await expect(wrapper.vm.onMonthChange('2026-08')).resolves.toBeUndefined()

      expect(wrapper.vm.currentMonth).toBe('2026-08')
      expect(ElMessage.warning).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    // 檢核還在跑的時候又來了新的要求（再切一次月份、發布、完成發布、排班檢核）：不能丟掉，要排在後面用「當下」的月份再檢核
    describe('a check is already running', () => {
      const draftSummary = {
        status: 'draft',
        pendingEmployees: [],
        disputedEmployees: [],
        publishedAt: null,
        hasSchedules: true,
        totalEmployees: 1,
        allEmployeesConfirmed: false
      }
      const publishPosts = () => apiFetch.mock.calls.filter(([url, options]) => url === '/api/schedules/publish' && options?.method === 'POST')
      const finalizePosts = () => apiFetch.mock.calls.filter(([url, options]) => url === '/api/schedules/publish/finalize' && options?.method === 'POST')

      // 排班規則檢核的回應由測試手動放行，模擬伺服器比使用者的下一個動作慢
      function holdValidate() {
        const calls = []
        answerValidateWith((url) => new Promise((resolve, reject) => {
          calls.push({ month: new URL(url, 'http://localhost').searchParams.get('month'), resolve, reject })
        }))
        return calls
      }
      async function waitUntil(predicate, what) {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (predicate()) return
          await flush()
        }
        throw new Error(`timed out waiting for ${what}`)
      }
      const settle = async () => { for (let i = 0; i < 12; i += 1) await flush() }
      const augustPending = () => pendingOnly([pendingItem({ weekStart: '2026-08-31', weekEnd: '2026-09-06', date: '2026-08-31', missingMonths: ['2026-09'] })])

      it('A→B→C: the check for the month the user ends on still runs after the one for B is thrown away as out of date', async () => {
        const wrapper = await mountSupervisor()
        const calls = holdValidate()

        const toB = wrapper.vm.onMonthChange('2026-08')
        await waitUntil(() => calls.length === 1, 'the check for 2026-08')
        const toC = wrapper.vm.onMonthChange('2026-09')
        await settle()

        // C 的檢核排在 B 後面，B 還沒回來就不會多送請求
        expect(calls.map(call => call.month)).toEqual(['2026-08'])
        expect(wrapper.vm.scheduleRuleValidation.checking).toBe(true)

        // B 的回應晚到，月份早就換成 C：直接丟掉，不能顯示在 C 的頁面上
        calls[0].resolve(pendingOnly([pendingItem()]))
        await waitUntil(() => calls.length === 2, 'the check for 2026-09')
        expect(calls[1].month).toBe('2026-09')
        expect(wrapper.vm.scheduleRuleValidation.pendingCount).toBe(0)
        expect(wrapper.find('[data-test="schedule-rule-pending"]').exists()).toBe(false)

        calls[1].resolve(augustPending())
        await Promise.all([toB, toC])
        await flush()

        expect(wrapper.vm.currentMonth).toBe('2026-09')
        expect(calls).toHaveLength(2)
        expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ checking: false, ok: true, count: 0, pendingCount: 1 })
        expect(wrapper.find('[data-test="schedule-rule-pending"]').text()).toContain('2026-08-31')
        // 背景檢核不彈窗、不跳提示、不寫通知
        expect(ElMessageBox.alert).not.toHaveBeenCalled()
        expect(ElMessage.success).not.toHaveBeenCalled()
        expect(wrapper.vm.scheduleNotifications).toHaveLength(0)
        wrapper.unmount()
      })

      it('several month switches while one check runs cost exactly one more check, for the month the user ended on', async () => {
        const wrapper = await mountSupervisor()
        const calls = holdValidate()

        const toB = wrapper.vm.onMonthChange('2026-08')
        await waitUntil(() => calls.length === 1, 'the check for 2026-08')
        const toC = wrapper.vm.onMonthChange('2026-09')
        const toD = wrapper.vm.onMonthChange('2026-10')
        await settle()
        expect(calls).toHaveLength(1)

        calls[0].resolve(pendingOnly([pendingItem()]))
        await waitUntil(() => calls.length === 2, 'the follow-up check')
        calls[1].resolve(augustPending())
        await Promise.all([toB, toC, toD])
        await settle()

        expect(calls.map(call => call.month)).toEqual(['2026-08', '2026-10'])
        expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ checking: false, pendingCount: 1 })
        wrapper.unmount()
      })

      it('identical background calls queued behind a running check share one run', async () => {
        const wrapper = await mountSupervisor()
        const calls = holdValidate()

        const first = wrapper.vm.fetchScheduleRuleValidation({})
        await waitUntil(() => calls.length === 1, 'the first check')
        const queuedA = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        const queuedB = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        expect(queuedB).toBe(queuedA)

        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await first
        await waitUntil(() => calls.length === 2, 'the queued check')
        calls[1].resolve(pendingOnly([pendingItem()]))
        const [resultA, resultB] = await Promise.all([queuedA, queuedB])
        await settle()

        expect(calls).toHaveLength(2)
        expect(resultA).toBe(resultB)
        expect(resultA.pendingWeeks).toHaveLength(1)
        expect(wrapper.vm.scheduleRuleValidation.checking).toBe(false)
        wrapper.unmount()
      })

      it('publishing while a month-change check is still running waits for it and then validates on its own, instead of doing nothing', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] }
        })
        await flush()
        const calls = holdValidate()

        const quiet = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the month-change check')
        const publishing = wrapper.vm.confirmPublish()
        await settle()
        expect(calls).toHaveLength(1)
        expect(ElMessageBox.confirm).not.toHaveBeenCalled()

        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await quiet
        await waitUntil(() => calls.length === 2, 'the publish check')
        calls[1].resolve(pendingOnly([pendingItem()]))
        await publishing

        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        expect(ElMessageBox.confirm.mock.calls[0][0]).toContain('另有 1 項跨月週尚無法判斷一例一休')
        expect(publishPosts()).toHaveLength(1)
        expect(wrapper.vm.scheduleRuleValidation.checking).toBe(false)
        wrapper.unmount()
      })

      // 客戶要求變更（排班規範不擋發布）：原本等到的違規會擋下發布，現在列在同一個確認視窗裡，按「仍要發布」照樣送出
      it('judges the publish by its own check: a violation found after waiting is listed in the confirmation, and the publish still goes ahead', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] }
        })
        await flush()
        const calls = holdValidate()

        const quiet = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the month-change check')
        const publishing = wrapper.vm.confirmPublish()
        await settle()

        // 背景檢核當時沒有違規，等它跑完之後，發布自己的檢核才看到新違規
        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await quiet
        await waitUntil(() => calls.length === 2, 'the publish check')
        calls[1].resolve(validateResponse({
          ok: false,
          count: 1,
          violations: [{ employee: 'e2', date: '2026-07-06', rule: 'continuous-work-days', message: '不得連續7日未安排休/例' }]
        }))
        await publishing

        expect(ElMessageBox.alert).not.toHaveBeenCalled()
        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('有 1 項排班規範提醒（不影響發布）')
        expect(message).toContain('・A0069 林小華 2026-07-06 [連續出勤限制]：不得連續7日未安排休/例')
        expect(options).toMatchObject({ confirmButtonText: '仍要發布', cancelButtonText: '取消' })
        expect(publishPosts()).toHaveLength(1)
        wrapper.unmount()
      })

      it('finalizing while a check is still running waits for it and then validates on its own', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          finalizeResult: { finalized: 1 }
        })
        await flush()
        const calls = holdValidate()

        const quiet = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the month-change check')
        const finalizing = wrapper.vm.confirmFinalize()
        await settle()
        expect(ElMessageBox.confirm).not.toHaveBeenCalled()

        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await quiet
        await waitUntil(() => calls.length === 2, 'the finalize check')
        calls[1].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await finalizing

        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        expect(ElMessageBox.confirm.mock.calls[0][1]).toBe('完成發布')
        expect(finalizePosts()).toHaveLength(1)
        wrapper.unmount()
      })

      it('the 排班檢核 button during a running check waits and then reports its own result', async () => {
        const wrapper = await mountSupervisor()
        const calls = holdValidate()

        const quiet = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the month-change check')
        const inspecting = wrapper.vm.inspectScheduleRules()
        await settle()
        expect(ElMessage.success).not.toHaveBeenCalled()

        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await quiet
        await waitUntil(() => calls.length === 2, 'the button check')
        calls[1].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        const result = await inspecting

        expect(result).toMatchObject({ ok: true })
        expect(ElMessage.success).toHaveBeenCalledWith('排班規範預檢已通過')
        wrapper.unmount()
      })

      it('keeps the publish and finalize buttons disabled while a check is running, and enables them again afterwards', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true }
        })
        await flush()
        const buttons = () => wrapper.findAll('.publish-btn')
        expect(buttons()).toHaveLength(2)
        expect(buttons().map(button => button.attributes('disabled'))).toEqual([undefined, undefined])
        const calls = holdValidate()

        const running = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the check')
        await flush()
        expect(buttons().map(button => button.attributes('disabled') !== undefined)).toEqual([true, true])

        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await running
        await flush()
        expect(buttons().map(button => button.attributes('disabled'))).toEqual([undefined, undefined])
        wrapper.unmount()
      })

      it('a failed check does not stop the queued one behind it', async () => {
        const wrapper = await mountSupervisor()
        const calls = holdValidate()

        const first = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the first check')
        const second = wrapper.vm.fetchScheduleRuleValidation({ showIssues: true })
        calls[0].reject(new Error('network down'))
        await expect(first).resolves.toBeNull()
        await waitUntil(() => calls.length === 2, 'the second check')
        calls[1].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await expect(second).resolves.toMatchObject({ ok: true })

        expect(ElMessage.success).toHaveBeenCalledWith('排班規範預檢已通過')
        expect(wrapper.vm.scheduleRuleValidation.checking).toBe(false)
        wrapper.unmount()
      })

      it('drops a queued check once the page is left', async () => {
        const wrapper = await mountSupervisor()
        const calls = holdValidate()

        const first = wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        await waitUntil(() => calls.length === 1, 'the first check')
        const queued = wrapper.vm.fetchScheduleRuleValidation({})
        wrapper.unmount()
        calls[0].resolve(validateResponse({ ok: true, count: 0, violations: [] }))
        await first
        await expect(queued).resolves.toBeNull()
        await settle()

        expect(calls).toHaveLength(1)
      })
    })

    describe('import confirmation', () => {
      const scheduleFile = () => new File(['schedule'], 'schedule.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })

      it('lists one line per cross-month week and the part-time employees that are exempt, without blocking the import', async () => {
        const wrapper = await mountSupervisor()
        importScheduleRecords
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              employees: 3,
              scheduleDays: 93,
              errors: [],
              warnings: [],
              violations: [],
              ruleExemptEmployees: [{ employeeId: 'P001', name: '兼職員工' }],
              pendingWeeks: [
                pendingItem(),
                pendingItem({ employee: 'e2' }),
                pendingItem({ employee: 'x9', employeeCode: 'A0141', employeeName: '陳小玲' }),
                pendingItem({ weekStart: '2026-07-27', weekEnd: '2026-08-02', missingMonths: ['2026-08'] })
              ],
              overwriteCount: 0
            })
          })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 93 }) })

        await wrapper.vm.onScheduleImportFile({ target: { files: [scheduleFile()], value: 'schedule.xlsx' } })

        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        const [message] = ElMessageBox.confirm.mock.calls[0]
        expect(message).toContain('其中 1 位兼職人員不套用排班規範檢核（P001 兼職員工）。')
        expect(message).toContain('跨月週尚無法判斷一例一休（4 項，不影響匯入，待相鄰月份班表排定後會重新檢核）：')
        expect(message).toContain('・2026-06-29～2026-07-05：3 人（A0003 王小美、A0069 林小華、A0141 陳小玲）尚無法判斷，2026年6月尚未排班')
        expect(message).toContain('・2026-07-27～2026-08-02：1 人（A0003 王小美）尚無法判斷，2026年8月尚未排班')
        expect(importScheduleRecords).toHaveBeenCalledTimes(2)
        expect(ElMessage.success).toHaveBeenCalledWith('已匯入 93 個班次')
        wrapper.unmount()
      })

      it('leaves the dialog text as before when the file has neither part-time employees nor pending weeks', async () => {
        const wrapper = await mountSupervisor()
        importScheduleRecords
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ employees: 1, scheduleDays: 30, errors: [], warnings: [], violations: [], ruleExemptEmployees: [], overwriteCount: 0 })
          })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 30 }) })

        await wrapper.vm.onScheduleImportFile({ target: { files: [scheduleFile()], value: 'schedule.xlsx' } })

        expect(ElMessageBox.confirm.mock.calls[0][0]).toBe('將匯入 1 名員工、30 個班次。')
        wrapper.unmount()
      })

      it('writes an info notification after the commit when weeks are still pending', async () => {
        const wrapper = await mountSupervisor()
        importScheduleRecords
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ employees: 1, scheduleDays: 31, errors: [], warnings: [], violations: [], overwriteCount: 0 })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ imported: 31, warnings: [], violations: [], pendingWeeks: [pendingItem(), pendingItem({ weekStart: '2026-07-27', weekEnd: '2026-08-02' })] })
          })

        await wrapper.vm.onScheduleImportFile({ target: { files: [scheduleFile()], value: 'schedule.xlsx' } })

        const notification = wrapper.vm.scheduleNotifications.find(item => item.title === '跨月週待判斷')
        expect(notification).toMatchObject({
          type: 'info',
          message: '匯入完成，另有 2 項跨月週尚無法判斷一例一休（相鄰月份尚未排班）。'
        })
        expect(notification.details).toHaveLength(2)
        expect(notification.details[0]).toMatchObject({ rule: 'weekly-rest-pending', employee: 'e1', date: '2026-06-29' })
        wrapper.unmount()
      })
    })

    describe('publish and finalize confirmation', () => {
      const draftSummary = {
        status: 'draft',
        pendingEmployees: [],
        disputedEmployees: [],
        publishedAt: null,
        hasSchedules: true,
        totalEmployees: 1,
        allEmployeesConfirmed: false
      }

      it('tells the user about the weeks that cannot be judged yet in the publish confirmation, and still publishes', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] }
        })
        await flush()
        answerValidateWith(pendingOnly([pendingItem(), pendingItem({ employee: 'e2' })]))

        await wrapper.vm.confirmPublish()

        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        const [message, title] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('批次發布')
        expect(message).toBe(
          '確認要將本月班表發送給員工確認嗎？\n\n另有 2 項跨月週尚無法判斷一例一休（相鄰月份尚未排班），不影響發布，待相鄰月份班表排定後會重新檢核。'
        )
        // 不另外跳出說明視窗，發布照常送出
        expect(ElMessageBox.alert).not.toHaveBeenCalled()
        expect(apiFetch.mock.calls.some(([url, options]) => url === '/api/schedules/publish' && options?.method === 'POST')).toBe(true)
        wrapper.unmount()
      })

      it('keeps the publish confirmation text unchanged when nothing is pending', async () => {
        const wrapper = await mountSupervisor({ publishSummary: draftSummary })
        await flush()
        answerValidateWith(validateResponse({ ok: true, count: 0, violations: [] }))

        await wrapper.vm.confirmPublish()

        expect(ElMessageBox.confirm.mock.calls[0][0]).toBe('確認要將本月班表發送給員工確認嗎？')
        wrapper.unmount()
      })

      const publishPosts = () => apiFetch.mock.calls.filter(([url, options]) => url === '/api/schedules/publish' && options?.method === 'POST')
      const finalizePosts = () => apiFetch.mock.calls.filter(([url, options]) => url === '/api/schedules/publish/finalize' && options?.method === 'POST')
      const continuousViolation = { employee: 'e2', date: '2026-07-06', rule: 'continuous-work-days', message: '不得連續7日未安排休/例' }
      const weeklyViolation = { employee: 'e1', date: '2026-07-13', rule: 'weekly-one-regular-rest-one-rest-day', message: '該週沒有例假' }

      // 客戶要求變更（「可以顯示規範，可是不要阻止發布」）：原本有違規時不跳確認、不發布，
      // 現在同一個確認視窗列出違規與跨月週說明，按「仍要發布」照樣發布
      it('lists the violations and the pending weeks in one publish confirmation, and publishes on 仍要發布', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] }
        })
        await flush()
        answerValidateWith(validateResponse({
          ok: false,
          count: 2,
          violations: [continuousViolation, weeklyViolation],
          pendingWeeks: [pendingItem()]
        }))

        await wrapper.vm.confirmPublish()

        // 只有一個視窗：不再先跳「排班規範檢核未通過」，也不跳「預檢已通過」
        expect(ElMessageBox.alert).not.toHaveBeenCalled()
        expect(ElMessage.success).not.toHaveBeenCalledWith('排班規範預檢已通過')
        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('有 2 項排班規範提醒（不影響發布）')
        expect(message).toBe([
          '確認要將本月班表發送給員工確認嗎？',
          [
            '以下 2 項排班規範問題不影響發布，建議儘快修正：',
            '・A0069 林小華 2026-07-06 [連續出勤限制]：不得連續7日未安排休/例',
            '・A0003 王小美 2026-07-13 [每週一例一休]：該週沒有例假'
          ].join('\n'),
          '另有 1 項跨月週尚無法判斷一例一休（相鄰月份尚未排班），不影響發布，待相鄰月份班表排定後會重新檢核。'
        ].join('\n\n'))
        expect(options).toMatchObject({
          type: 'warning',
          confirmButtonText: '仍要發布',
          cancelButtonText: '取消',
          customClass: 'schedule-issue-dialog',
          modalClass: 'schedule-issue-overlay',
          closeOnClickModal: false
        })
        expect(publishPosts()).toHaveLength(1)
        wrapper.unmount()
      })

      it('does not publish when the violation confirmation is cancelled', async () => {
        const wrapper = await mountSupervisor({ publishSummary: draftSummary })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [continuousViolation], pendingWeeks: [pendingItem()] }))
        ElMessageBox.confirm.mockRejectedValueOnce('cancel')

        await wrapper.vm.confirmPublish()

        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        expect(publishPosts()).toHaveLength(0)
        expect(wrapper.vm.isPublishing).toBe(false)
        expect(wrapper.vm.scheduleNotifications.some(item => item.title.startsWith('已發布'))).toBe(false)
        wrapper.unmount()
      })

      it('says the check could not be completed when the precheck fails, and still lets the user publish', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] }
        })
        await flush()
        answerValidateWith(() => { throw new Error('network down') })

        await wrapper.vm.confirmPublish()

        expect(ElMessage.warning).not.toHaveBeenCalled()
        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('排班規範檢核未完成')
        expect(message).toContain('排班規範檢核暫時無法完成')
        expect(message).toContain('排班規範不影響發布，仍可繼續；發布後請按「排班檢核」重新檢核。')
        expect(message).toContain('確認要將本月班表發送給員工確認嗎？')
        expect(options).toMatchObject({ confirmButtonText: '仍要發布', cancelButtonText: '取消' })
        expect(publishPosts()).toHaveLength(1)
        wrapper.unmount()
      })

      it('treats a server error from the precheck the same way (check not completed, finalize still possible)', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          finalizeResult: { finalized: 1 }
        })
        await flush()
        answerValidateWith(validateResponse({ error: 'internal error' }, 500))

        await wrapper.vm.confirmFinalize()

        const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('排班規範檢核未完成')
        expect(message).toContain('排班規範不影響完成發布，仍可繼續；完成發布後請按「排班檢核」重新檢核。')
        expect(message).toContain('全部員工已確認，是否完成發布並鎖定班表？')
        expect(options).toMatchObject({ confirmButtonText: '仍要完成發布', cancelButtonText: '取消' })
        expect(finalizePosts()).toHaveLength(1)
        wrapper.unmount()
      })

      it('records the violations the server reports after publishing as a warning, and keeps the rule badge in sync', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: {
            updated: 2,
            publishedAt: new Date().toISOString(),
            employees: [],
            // e9 不在目前載入的那一頁：用伺服器附上的代號與姓名
            violations: [continuousViolation, { ...weeklyViolation, employee: 'e9', employeeCode: 'A0999', employeeName: '張大明' }],
            pendingWeeks: [pendingItem()]
          }
        })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [continuousViolation] }))

        await wrapper.vm.confirmPublish()

        const notification = wrapper.vm.scheduleNotifications.find(item => item.title === '已發布，仍有 2 項排班規範問題')
        expect(notification).toMatchObject({
          type: 'warning',
          message: '班表已發送給員工確認；以下 2 項排班規範問題不影響發布，建議儘快修正。'
        })
        expect(notification.details.map(detail => wrapper.vm.formatLaborRuleViolation(detail))).toEqual([
          'A0069 林小華 2026-07-06 [連續出勤限制]：不得連續7日未安排休/例',
          'A0999 張大明 2026-07-13 [每週一例一休]：該週沒有例假'
        ])
        expect(ElMessage.success).toHaveBeenCalledWith('已將班表發送給員工確認')
        // 徽章與完整檢核結果以伺服器發布當下的檢核為準
        expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: false, count: 2, pendingCount: 1 })
        expect(wrapper.vm.scheduleIssues.lines).toHaveLength(2)
        wrapper.unmount()
      })

      it('reloads the schedules after publishing and after finalizing, so the status does not stay at the old step', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] },
          finalizeResult: { finalized: 1 }
        })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [continuousViolation] }))
        const monthlyFetches = () => apiFetch.mock.calls.filter(([url]) => String(url).startsWith('/api/schedules/monthly')).length
        // 先把畫面上的員工都載入：之後一般的重新整理不會再抓，只有 reset 才會
        await wrapper.vm.refreshScheduleData({ reset: true })
        await flush()
        const loaded = monthlyFetches()
        await wrapper.vm.refreshScheduleData({ reason: 'probe' })
        expect(monthlyFetches()).toBe(loaded)

        const beforePublish = monthlyFetches()
        await wrapper.vm.publishSchedulesForMonth()
        await flush()
        expect(monthlyFetches()).toBeGreaterThan(beforePublish)

        const beforeFinalize = monthlyFetches()
        await wrapper.vm.finalizeSchedulesForMonth()
        await flush()
        expect(monthlyFetches()).toBeGreaterThan(beforeFinalize)
        wrapper.unmount()
      })

      it('clears the badge when the server reports no violation at publish time, and records no warning', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: draftSummary,
          publishResult: { updated: 1, publishedAt: new Date().toISOString(), employees: [] }
        })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [continuousViolation] }))

        await wrapper.vm.confirmPublish()

        expect(publishPosts()).toHaveLength(1)
        expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: true, count: 0, pendingCount: 0 })
        expect(wrapper.vm.scheduleIssues.lines).toEqual([])
        expect(wrapper.vm.scheduleNotifications.some(item => item.title.startsWith('已發布'))).toBe(false)
        wrapper.unmount()
      })

      it('lists the violations in the finalize confirmation, finalizes on 仍要完成發布 and records what the server reports', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          finalizeResult: { finalized: 1, violations: [weeklyViolation] }
        })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [weeklyViolation] }))

        await wrapper.vm.confirmFinalize()

        expect(ElMessageBox.alert).not.toHaveBeenCalled()
        const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('有 1 項排班規範提醒（不影響完成發布）')
        expect(message).toBe([
          '全部員工已確認，是否完成發布並鎖定班表？',
          '以下 1 項排班規範問題不影響完成發布，建議儘快修正：\n・A0003 王小美 2026-07-13 [每週一例一休]：該週沒有例假'
        ].join('\n\n'))
        expect(options).toMatchObject({ type: 'warning', confirmButtonText: '仍要完成發布', cancelButtonText: '取消' })
        expect(finalizePosts()).toHaveLength(1)
        expect(ElMessage.success).toHaveBeenCalledWith('班表已完成發布')
        expect(wrapper.vm.scheduleNotifications.find(item => item.title === '已完成發布，仍有 1 項排班規範問題')).toMatchObject({
          type: 'warning',
          details: [expect.objectContaining({ message: 'A0003 王小美 2026-07-13 [每週一例一休]：該週沒有例假' })]
        })
        wrapper.unmount()
      })

      it('mounts the violation confirmation inside the schedule card in fullscreen mode', async () => {
        const wrapper = await mountSupervisor({ publishSummary: draftSummary })
        await flush()
        wrapper.vm.toggleTableFullscreen()
        await wrapper.vm.$nextTick()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [continuousViolation] }))

        await wrapper.vm.confirmPublish()

        expect(ElMessageBox.confirm.mock.calls[0][2]).toMatchObject({
          confirmButtonText: '仍要發布',
          appendTo: wrapper.find('[data-test="schedule-card"]').element
        })
        wrapper.unmount()
      })

      it('does not finalize when the violation confirmation is closed', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          finalizeResult: { finalized: 1 }
        })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [weeklyViolation] }))
        ElMessageBox.confirm.mockRejectedValueOnce('close')

        await wrapper.vm.confirmFinalize()

        expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
        expect(finalizePosts()).toHaveLength(0)
        wrapper.unmount()
      })

      // 員工不在目前載入的那一頁（分頁、搜尋）：預檢的違規帶著伺服器附上的代號與姓名，確認視窗顯示「代號 姓名」而不是「員工 <id>」
      it('names an employee outside the loaded page in the publish confirmation with the code and name from the precheck', async () => {
        const wrapper = await mountSupervisor({ publishSummary: draftSummary })
        await flush()
        answerValidateWith(validateResponse({
          ok: false,
          count: 1,
          violations: [{ ...continuousViolation, employee: '6ada31e22336f157fecd25c5', employeeCode: 'N001', employeeName: '王違規' }]
        }))
        ElMessageBox.confirm.mockRejectedValueOnce('cancel')

        await wrapper.vm.confirmPublish()

        const [message] = ElMessageBox.confirm.mock.calls[0]
        expect(message).toContain('・N001 王違規 2026-07-06 [連續出勤限制]：不得連續7日未安排休/例')
        expect(message).not.toContain('員工 6ada31e22336f157fecd25c5')
        expect(publishPosts()).toHaveLength(0)
        wrapper.unmount()
      })

      // 完成發布不被違規擋下之後，鎖定的月份按「排班檢核」：伺服器改檢核已鎖定的班表（finalized: true），
      // 畫面照實列出違規、徽章維持，不會變成「排班規範預檢已通過」，也不會把同一批問題再記一次
      it('keeps listing the violations of a month finalized despite them when 排班檢核 is pressed afterwards', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          finalizeResult: { finalized: 1, violations: [weeklyViolation] }
        })
        await flush()
        let finalizedOnServer = false
        answerValidateWith(() => validateResponse(finalizedOnServer
          ? { ok: false, count: 1, violations: [weeklyViolation], finalized: true }
          : { ok: false, count: 1, violations: [weeklyViolation] }))
        const base = apiFetch.getMockImplementation()
        apiFetch.mockImplementation(async (url, options) => {
          if (url === '/api/schedules/publish/finalize' && options?.method === 'POST') finalizedOnServer = true
          return base(url, options)
        })

        await wrapper.vm.confirmFinalize()
        expect(finalizePosts()).toHaveLength(1)
        ElMessageBox.alert.mockClear()
        ElMessage.success.mockClear()
        const notificationsBefore = wrapper.vm.scheduleNotifications.map(item => item.title)
        expect(notificationsBefore).toContain('已完成發布，仍有 1 項排班規範問題')

        await wrapper.vm.inspectScheduleRules()

        expect(ElMessage.success).not.toHaveBeenCalledWith('排班規範預檢已通過')
        expect(ElMessageBox.alert).toHaveBeenCalledTimes(1)
        const [message, title] = ElMessageBox.alert.mock.calls[0]
        expect(title).toBe('排班規範檢核未通過')
        expect(message).toBe('A0003 王小美 2026-07-13 [每週一例一休]：該週沒有例假')
        expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: false, count: 1 })
        expect(wrapper.vm.scheduleIssues.lines).toEqual(['A0003 王小美 2026-07-13 [每週一例一休]：該週沒有例假'])
        expect(wrapper.find('[data-test="schedule-rule-results"]').exists()).toBe(true)
        // 完成發布時已記過「已完成發布，仍有 1 項排班規範問題」，同一批問題不再另記一筆
        expect(wrapper.vm.scheduleNotifications.map(item => item.title)).toEqual(notificationsBefore)
        wrapper.unmount()
      })

      it('after a reload, the badge and 排班檢核 of a locked month still show its violations, logged as a finalized month, not a draft', async () => {
        const wrapper = await mountSupervisor({ publishSummary: { ...draftSummary, status: 'finalized', allEmployeesConfirmed: true } })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [weeklyViolation], finalized: true }))

        // 換月或重新整理後的背景檢核：徽章顯示違規數
        await wrapper.vm.fetchScheduleRuleValidation({ quiet: true })
        expect(wrapper.vm.scheduleRuleValidation).toMatchObject({ ok: false, count: 1 })

        await wrapper.vm.inspectScheduleRules()

        expect(ElMessage.success).not.toHaveBeenCalledWith('排班規範預檢已通過')
        expect(ElMessageBox.alert.mock.calls[0][1]).toBe('排班規範檢核未通過')
        const titles = wrapper.vm.scheduleNotifications.map(item => item.title)
        expect(titles).toContain('已完成發布的班表仍有排班規範問題')
        expect(titles).not.toContain('排班草稿待修正')
        wrapper.unmount()
      })

      it('still logs open drafts as 排班草稿待修正', async () => {
        const wrapper = await mountSupervisor({ publishSummary: draftSummary })
        await flush()
        answerValidateWith(validateResponse({ ok: false, count: 1, violations: [weeklyViolation] }))

        await wrapper.vm.inspectScheduleRules()

        expect(wrapper.vm.scheduleNotifications.find(item => item.title === '排班草稿待修正')).toMatchObject({
          type: 'warning',
          message: '目前共有 1 項排班規範問題。'
        })
        wrapper.unmount()
      })

      it('mentions the pending weeks in the finalize confirmation too', async () => {
        const wrapper = await mountSupervisor({
          publishSummary: { ...draftSummary, status: 'ready', allEmployeesConfirmed: true },
          finalizeResult: { finalized: 1 }
        })
        await flush()
        answerValidateWith(pendingOnly([pendingItem()]))

        await wrapper.vm.confirmFinalize()

        const [message, title] = ElMessageBox.confirm.mock.calls[0]
        expect(title).toBe('完成發布')
        expect(message).toBe(
          '全部員工已確認，是否完成發布並鎖定班表？\n\n另有 1 項跨月週尚無法判斷一例一休（相鄰月份尚未排班），不影響發布，待相鄰月份班表排定後會重新檢核。'
        )
        wrapper.unmount()
      })
    })
  })
})
