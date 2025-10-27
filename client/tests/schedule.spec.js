import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { createPinia, setActivePinia } from 'pinia'
import { buildShiftStyle } from '../src/utils/shiftColors'

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
    return shallowMount(Schedule, {
      global: {
        stubs: {
          'el-date-picker': true,
          'el-table': TableStub,
          'el-table-column': ColumnStub,
          'el-select': SelectStub,
          'el-option': OptionStub,
          'el-checkbox': CheckboxStub,
          'el-input': InputStub,
          'el-popover': PopoverStub,
          'el-tag': TagStub,
          'el-button': ButtonStub,
          ScheduleDashboard: { name: 'ScheduleDashboard', template: '<div class="dashboard-stub"></div>', props: ['summary'] }
        }
      },
      ...options
    })
  }

  function flush() {
    return new Promise(resolve => setTimeout(resolve))
  }

  it('includes supervisor id in requests when present', async () => {
    const month = dayjs().format('YYYY-MM')
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
    expect(monthlyCall?.[0]).toBe(`/api/schedules/monthly?month=${month}&supervisor=sup1`)
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
    expect(monthlyCall?.[0]).toBe(`/api/schedules/monthly?month=${month}`)
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

  it('toggles row expansion in lazy mode', async () => {
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
    expect(wrapper.vm.lazyMode).toBe(true)
    wrapper.vm.toggleRow('e1')
    expect(wrapper.vm.expandedRows.has('e1')).toBe(true)
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
