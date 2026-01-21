import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { createPinia, setActivePinia } from 'pinia'
import { buildShiftStyle } from '../src/utils/shiftColors'
import { useAuthStore } from '../src/stores/auth'

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

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
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

import { apiFetch } from '../src/api'
import Schedule from '../src/views/front/Schedule.vue'

describe('Schedule.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
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
      props: ['label'],
      template: `
        <div class="col" :data-label="label">
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
    const TimelineStub = { name: 'ElTimeline', template: '<div class="timeline-stub"><slot></slot></div>' }
    const TimelineItemStub = {
      name: 'ElTimelineItem',
      template: '<div class="timeline-item-stub"><slot></slot></div>'
    }
    return shallowMount(Schedule, {
      global: {
        stubs: {
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
          'el-button': ButtonStub,
          'el-progress': ProgressStub,
          'el-pagination': PaginationStub,
          'el-switch': SwitchStub,
          'el-divider': DividerStub,
          'el-descriptions': DescriptionsStub,
          'el-descriptions-item': DescriptionsItemStub,
          'el-dialog': DialogStub,
          'el-timeline': TimelineStub,
          'el-timeline-item': TimelineItemStub,
          ScheduleDashboard: { name: 'ScheduleDashboard', template: '<div class="dashboard-stub"></div>', props: ['summary'] }
        }
      },
      ...options
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
    leaveApprovalsHandler,
    publishHandler,
    finalizeHandler,
    publishResult = null,
    finalizeResult = null,
    publishSummary,
    supervisorProfile = {
      _id: 'sup1',
      name: '主管',
      department: { _id: 'd1', name: 'Dept A' },
      subDepartment: { _id: 'sd1', name: 'Sub A' }
    }
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

      if (pathname === '/api/shifts') {
        return { ok: true, json: async () => shifts }
      }

      if (pathname === `/api/employees/${supervisorProfile?._id ?? ''}`) {
        return { ok: true, json: async () => supervisorProfile }
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

      return { ok: true, json: async () => [] }
    })
  }

  it('includes supervisor id in requests when present', async () => {
    const month = dayjs().format('YYYY-MM')
    const storageKey = 'schedule-include-self:sup1'
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 'sup1',
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
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees?supervisor=sup1')
    const employeesCall = apiFetch.mock.calls
      .map(([url]) => url)
      .find(url => url.startsWith('/api/employees?') && url.includes('department='))
    expect(employeesCall).toBe('/api/employees?supervisor=sup1&department=d1&subDepartment=sd1')
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
    const month = dayjs().format('YYYY-MM')
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
    const month = dayjs().format('YYYY-MM')
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
    const month = dayjs().format('YYYY-MM')
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
    const month = dayjs().format('YYYY-MM')
    setRoleToken('employee')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    mountSchedule()
    await flush()
    const employeesCall = apiFetch.mock.calls.find(([url]) => url.startsWith('/api/employees'))
    expect(employeesCall?.[0]).toBe('/api/employees')
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
        { _id: 'e1', name: '員工A', department: 'd1', subDepartment: 'sd1' }
      ],
      directReports: [{ _id: 'e1', subDepartment: { _id: 'sd1' } }],
      monthlyWithSelf: [],
      monthlyWithoutSelf: [],
      approvals: [],
      leaves: []
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

  it('顯示待處理審批的簽核類型', async () => {
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')

    setupSupervisorApiMock({
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
          applicant_employee: { _id: 'e2', name: '李小華' }
        }
      ],
      leaves: []
    })

    const wrapper = mountSchedule()
    await flush()
    await wrapper.vm.$nextTick()

    const typeColumn = wrapper.find('[data-label="申請類型"]')
    const typeTexts = typeColumn
      .findAll('.cell')
      .map(cell => cell.text().trim())
      .filter(Boolean)

    expect(typeTexts).toContain('請假')
    expect(typeTexts).toContain('加班單')
  })

  it('does not append supervisor param for employee role even when id exists', async () => {
    const month = dayjs().format('YYYY-MM')
    setRoleToken('employee')
    localStorage.setItem('employeeId', 'sup1')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    mountSchedule()
    await flush()
    const employeesCall = apiFetch.mock.calls.find(([url]) => url.startsWith('/api/employees'))
    expect(employeesCall?.[0]).toBe('/api/employees')
    const monthlyCall = apiFetch.mock.calls.find(([url]) =>
      url.startsWith(`/api/schedules/monthly?month=${month}`)
    )
    expect(monthlyCall?.[0]).toBe(`/api/schedules/monthly?month=${month}`)
  })

  it('fetches summary and passes to dashboard', async () => {
    const month = dayjs().format('YYYY-MM')
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { shiftCount: 1, leaveCount: 0 },
          { shiftCount: 0, leaveCount: 1 }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith(`/api/schedules/summary?month=${month}`)
    const dash = wrapper.findComponent({ name: 'ScheduleDashboard' })
    expect(dash.props('summary')).toEqual({ direct: 2, unscheduled: 1, onLeave: 1 })
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

  it('shows loading state while applying batch schedules', async () => {
    const month = dayjs().format('YYYY-MM')
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
    expect(loadingServiceMock).toHaveBeenCalledTimes(1)
    const loadingInstance = loadingServiceMock.mock.results[0]?.value
    expect(typeof loadingInstance?.close).toBe('function')

    resolveFetch()
    await applyPromise
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isApplyingBatch).toBe(false)
    expect(button.attributes('loading')).toBe('false')
    expect(button.element.disabled).toBe(false)
    expect(loadingInstance.close).toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('批次套用完成')
  })

  it('renders leave indicator and prevents editing when leave exists', async () => {
    const month = dayjs().format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          shifts: [
            { _id: 'shift1', code: 'A', name: '早班', startTime: '08:00', endTime: '17:00' }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 'sup1',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd1', name: 'Sub A' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'e1', subDepartment: { _id: 'sd1' } }]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ _id: 'e1', name: 'Emp1', department: 'd1', subDepartment: 'sd1' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approvals: [],
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
      })

    const wrapper = mountSchedule()
    await flush()

    const leaveIndicator = wrapper.find('[data-test="leave-indicator"]')
    expect(leaveIndicator.exists()).toBe(true)
    expect(leaveIndicator.text()).toContain('休假中')
    expect(leaveIndicator.text()).toContain('不列入工時')
    expect(leaveIndicator.find('select').exists()).toBe(false)
    expect(wrapper.vm.scheduleMap.e1[1].leave.excludesHours).toBe(true)

    const initialCalls = apiFetch.mock.calls.length
    await wrapper.vm.onSelect('e1', 1, 'shift1')
    await flush()
    expect(apiFetch.mock.calls.length).toBe(initialCalls)
    expect(ElMessage.info).toHaveBeenCalledWith('該日已核准請假，無法調整排班')
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
    expect(wrapper.vm.allSelectedCells.has('e1-1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2-1')).toBe(true)

    await wrapper.vm.toggleEmployee('e1', true)
    expect(wrapper.vm.allSelectedCells.has('e1-2')).toBe(true)

    await wrapper.vm.toggleDay(1, false)
    expect(wrapper.vm.allSelectedCells.has('e2-1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1-1')).toBe(true)

    await wrapper.vm.toggleEmployee('e1', false)
    expect(wrapper.vm.allSelectedCells.has('e1-1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1-2')).toBe(false)

    await wrapper.vm.toggleCell('e2', 2, true)
    expect(wrapper.vm.allSelectedCells.has('e2-2')).toBe(true)

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
    expect(wrapper.vm.allSelectedCells.has('e1-1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e1-2')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2-1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2-2')).toBe(true)

    wrapper.vm.employees = [{ _id: 'e2', name: 'E2' }]
    wrapper.vm.scheduleMap.e1[2].leave = { approved: true }
    wrapper.vm.pruneSelections()
    await flush()

    expect(wrapper.vm.selectedEmployees.has('e1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1-1')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e1-2')).toBe(false)
    expect(wrapper.vm.allSelectedCells.has('e2-1')).toBe(true)
    expect(wrapper.vm.allSelectedCells.has('e2-2')).toBe(true)
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
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 'sup2',
          department: { _id: 'd1', name: 'Dept A' },
          subDepartment: { _id: 'sd2', name: 'Sub B' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', subDepartment: { _id: 'sd2', name: 'Sub B' } }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'd1', name: 'Dept A' },
          { _id: 'd2', name: 'Dept B' }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd2', name: 'Sub B', department: { _id: 'd1' } },
          { _id: 'sd3', name: 'Sub C', department: { _id: 'd2' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/api/employees?supervisor=sup2')
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
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'd1', name: 'Dept A' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: '', subDepartment: '' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'sd1', name: 'Sub A', department: { _id: 'd1' } }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })

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
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { _id: 'e1', name: 'Alice', department: '', subDepartment: '' },
          { _id: 'e2', name: 'Bob', department: '', subDepartment: '' }
        ]
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employeeSearch = 'Ali'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees.length).toBe(1)
    expect(wrapper.vm.filteredEmployees[0].name).toBe('Alice')
  })

  it('filters employees by status', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] })
    const wrapper = mountSchedule()
    await flush()
    wrapper.vm.employees = [
      { _id: 'e1', name: 'A', department: '', subDepartment: '' },
      { _id: 'e2', name: 'B', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = {
      e1: { 1: { shiftId: '', department: '', subDepartment: '' } },
      e2: { 1: { shiftId: 's1', department: '', subDepartment: '', leave: {} } }
    }
    wrapper.vm.statusFilter = 'unscheduled'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees.map(e => e._id)).toEqual(['e1'])
    wrapper.vm.statusFilter = 'onLeave'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.filteredEmployees.map(e => e._id)).toEqual(['e2'])
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
    // Lazy mode is now always disabled to auto-expand schedule table
    expect(wrapper.vm.lazyMode).toBe(false)
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

  it('shows floor column and weekday labels', async () => {
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
    expect(cols[0].attributes('data-label')).toBe('部門／單位')
    expect(cols[1].attributes('data-label')).toBe('員工姓名')
    expect(cols[2].attributes('data-label')).toMatch(/^1\(.\)$/)
  })

  it('displays leave label when leave data exists', async () => {
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
    wrapper.vm.employees = [
      { _id: undefined, name: 'E1', department: '', subDepartment: '' }
    ]
    wrapper.vm.scheduleMap = { undefined: { 1: { leave: {} } } }
    await wrapper.vm.$nextTick()
    const indicatorText = wrapper.find('.leave-indicator').text()
    expect(indicatorText).toContain('休假中')
    expect(indicatorText).toContain('不列入工時')
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
      {
        _id: 'e1',
        name: 'E1',
        departmentId: 'd1',
        subDepartmentId: 'sd1',
        department: 'Dept A',
        subDepartment: 'Sub A'
      }
    ])
  })

  it('applies batch schedules to selected cells', async () => {
    const month = dayjs().format('YYYY-MM')
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

  it('updates existing schedules via batch apply', async () => {
    const month = dayjs().format('YYYY-MM')
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
    const month = dayjs().format('YYYY-MM')
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
    const month = dayjs().format('YYYY-MM')
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    const storageKey = 'schedule-include-self:sup1'
    setupSupervisorApiMock({
      employees: [
        { _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }
      ],
      directReports: [{ subDepartment: { _id: 'sd1' } }],
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

  it('restores includeSelf preference on mount', async () => {
    const month = dayjs().format('YYYY-MM')
    const storageKey = 'schedule-include-self:sup1'
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    localStorage.setItem(storageKey, 'true')
    setupSupervisorApiMock({
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
    setupSupervisorApiMock()

    const wrapper = mountSchedule()
    await flush()
    await flush()

    expect(wrapper.vm.includeSelf).toBe(true)
    expect(localStorage.getItem(storageKey)).toBe('true')
    expect(ElMessage.info).toHaveBeenCalledWith('尚未為主管建立班表，請先建立排班。')
  })

  it('clears includeSelf preference when role changes', async () => {
    const month = dayjs().format('YYYY-MM')
    const storageKey = 'schedule-include-self:sup1'
    setRoleToken('supervisor')
    localStorage.setItem('employeeId', 'sup1')
    localStorage.setItem(storageKey, 'true')
    setupSupervisorApiMock({
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
    const month = dayjs().format('YYYY-MM')
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
    await flush()
    wrapper.vm.pageSize = 1
    wrapper.vm.currentPage = 1
    await wrapper.vm.fetchSchedules({ reset: true })
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
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: 'e1', name: 'E1', department: 'd1', subDepartment: 'sd1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals: [], leaves: [] }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) })

    const wrapper = mountSchedule()
    await flush()
    const click = vi.fn()
    const origCreate = document.createElement
    document.createElement = tag => (tag === 'a' ? { href: '', download: '', click } : origCreate(tag))
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    global.URL.revokeObjectURL = vi.fn()
    await wrapper.vm.exportSchedules('pdf')
    expect(apiFetch).toHaveBeenCalledWith(
      `/api/schedules/export?month=${dayjs().format('YYYY-MM')}&format=pdf`
    )
    expect(click).toHaveBeenCalled()
    document.createElement = origCreate
  })
})
