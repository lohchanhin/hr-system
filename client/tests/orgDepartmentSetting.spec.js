import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import OrgDepartmentSetting from '../src/components/backComponents/OrgDepartmentSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('OrgDepartmentSetting.vue', () => {
  beforeEach(() => {
    apiFetch.mockClear()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('alert', vi.fn())
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches all lists on mount', async () => {
    mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await new Promise(resolve => setTimeout(resolve, 0))
    const calls = apiFetch.mock.calls
    expect(calls.find(c => c[0] === '/api/organizations')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/departments')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/sub-departments')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/dept-managers')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/shifts')).toBeTruthy()
  })

  it('posts to correct endpoint when creating org', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    wrapper.vm.openDialog('org')
    wrapper.vm.form = { name: 'A', systemCode: 'SC' }
    wrapper.vm.editIndex = null
    await wrapper.vm.saveItem()
    expect(apiFetch).toHaveBeenCalledWith('/api/organizations', expect.objectContaining({ method: 'POST' }))
  })

  it('shows organization select in dept form', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await wrapper.vm.openDialog('dept')
    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
    expect(wrapper.vm.form).toHaveProperty('organization')
    expect(wrapper.vm.form).toHaveProperty('defaultTwoDayOff', true)
    expect(wrapper.vm.form).toHaveProperty('uniformNumber', '')
  })

  it('fetchList adds parent id query', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ([{ _id: 'd1', name: 'HR' }])
      })
    )
    await wrapper.vm.fetchList('dept', '123')
    expect(apiFetch).toHaveBeenCalledWith('/api/departments?organization=123')
    expect(wrapper.vm.deptList).toEqual([
      expect.objectContaining({ _id: 'd1', organization: '123' })
    ])
  })

  it('merges schedule defaults when editing dept without data', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.deptList = [
      {
        _id: 'd1',
        name: 'HR',
        organization: 'org1',
        defaultTwoDayOff: false
      }
    ]
    await wrapper.vm.openDialog('dept', 0)
    expect(wrapper.vm.form.defaultTwoDayOff).toBe(false)
    expect(wrapper.vm.form.tempChangeAllowed).toBe(false)
    expect(wrapper.vm.form).toHaveProperty('deptManager', '')
    expect(wrapper.vm.form.uniformNumber).toBe('')
  })

  it('saves department with schedule fields', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.openDialog('dept')
    wrapper.vm.form = {
      ...wrapper.vm.form,
      name: '人資',
      organization: 'org1',
      code: 'D1',
      unitName: '',
      institutionCode: 'IC-010',
      uniformNumber: '12345678',
      laborInsuranceNumber: 'LAB123',
      healthInsuranceNumber: 'HEA123',
      taxRegistrationNumber: 'TAX123',
      location: '',
      phone: '',
      manager: '',
      responsiblePerson: '王主管',
      defaultTwoDayOff: false,
      tempChangeAllowed: true,
      deptManager: 'mgr1',
      scheduleNotes: '備註'
    }
    wrapper.vm.editIndex = null
    await wrapper.vm.saveItem()
    const postCall = apiFetch.mock.calls.find(([url, options]) => url === '/api/departments' && options?.method === 'POST')
    expect(postCall).toBeTruthy()
    const [, options] = postCall
    const payload = JSON.parse(options.body)
    expect(payload).toMatchObject({
      defaultTwoDayOff: false,
      tempChangeAllowed: true,
      deptManager: 'mgr1',
      scheduleNotes: '備註',
      uniformNumber: '12345678',
      responsiblePerson: '王主管'
    })
    expect(apiFetch.mock.calls.some(([url]) => url.includes('break-settings'))).toBe(false)
  })

  it('小單位表單開啟時會載入班別選項', async () => {
    const shifts = [{ _id: 's1', name: '早班', code: 'A1' }]
    apiFetch.mockImplementation(url => {
      if (url === '/api/shifts') {
        return Promise.resolve({ ok: true, json: async () => shifts })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await Promise.resolve()
    await Promise.resolve()
    apiFetch.mockClear()
    await wrapper.vm.openDialog('sub')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(apiFetch.mock.calls.some(([url]) => url === '/api/shifts')).toBe(true)
    expect(wrapper.vm.shiftOptions).toEqual(shifts)
  })

  it('編輯小單位時會帶入既有班別', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await new Promise(resolve => setTimeout(resolve, 0))
    wrapper.vm.subList = [
      { _id: 'sd1', name: '夜班組', department: 'dept1', shift: 's2' }
    ]
    await wrapper.vm.$nextTick()
    await wrapper.vm.openDialog('sub', 0)
    expect(wrapper.vm.form.shiftId).toBe('s2')
    expect(wrapper.vm.form).not.toHaveProperty('shift')
  })

  it('儲存小單位時會包含班別ID', async () => {
    apiFetch.mockImplementation(url => {
      if (url === '/api/shifts') {
        return Promise.resolve({ ok: true, json: async () => [{ _id: 's1', name: '早班' }] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await wrapper.vm.openDialog('sub')
    await Promise.resolve()
    await Promise.resolve()
    wrapper.vm.form = {
      ...wrapper.vm.form,
      name: '夜班組',
      department: 'dept1',
      shiftId: 's1',
      uniformNumber: '12345678',
      laborInsuranceNumber: 'LAB001',
      healthInsuranceNumber: 'HEA001',
      taxRegistrationNumber: 'TAX001'
    }
    wrapper.vm.editIndex = null
    apiFetch.mockClear()
    await wrapper.vm.saveItem()
    const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/sub-departments' && options?.method === 'POST')
    expect(call).toBeTruthy()
    const [, options] = call
    const payload = JSON.parse(options.body)
    expect(payload.shiftId).toBe('s1')
    expect(payload).not.toHaveProperty('shift')
    expect(payload.uniformNumber).toBe('12345678')
  })

  it('顯示選取部門的機構與部門組合', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.orgList = [
      { _id: 'org1', name: '總公司' },
      { _id: 'org2', name: '分公司' }
    ]
    wrapper.vm.deptList = [
      { _id: 'dept1', name: '人資部', organization: 'org1' },
      { _id: 'dept2', name: '研發部', organization: 'org2' }
    ]

    wrapper.vm.selectedDept = 'dept1'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dept-context-tag').text()).toBe('總公司-人資部')

    wrapper.vm.selectedDept = 'dept2'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dept-context-tag').text()).toBe('分公司-研發部')

    wrapper.vm.selectedDept = ''
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dept-context-tag').text()).toBe('請選擇部門')
  })

  describe('排班人員、使用班別、使用簽核表單', () => {
    const managers = [
      { label: '王小明', value: 'e1', employeeId: 'N001', role: 'employee', active: true },
      { label: '李主管', value: 'e2', employeeId: 'S001', role: 'supervisor', active: true },
      { label: '陳離職', value: 'e3', employeeId: 'N009', role: 'employee', active: false }
    ]
    const shifts = [
      { _id: 'day', name: '白班', code: 'D', semanticType: 'work' },
      { _id: 'night', name: '大夜', code: 'N', semanticType: 'work' },
      { _id: 'rest', name: '休息日', code: '休', semanticType: 'rest_day' }
    ]
    const forms = [
      { _id: 'f1', name: '請假單', is_active: true },
      { _id: 'f2', name: '加班單', is_active: true },
      { _id: 'f3', name: '舊表單', is_active: false }
    ]

    beforeEach(() => {
      apiFetch.mockImplementation(url => {
        if (url === '/api/dept-managers') return Promise.resolve({ ok: true, json: async () => managers })
        if (url === '/api/shifts') return Promise.resolve({ ok: true, json: async () => shifts })
        if (url === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => forms })
        return Promise.resolve({ ok: true, json: async () => [] })
      })
    })

    it('lists any active employee (with employee code) for the unit schedulers, keeping an inactive one only when already chosen', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      await wrapper.vm.openDialog('sub')
      expect(wrapper.vm.schedulerSelectOptions).toEqual([
        { value: 'e1', label: '王小明（N001）' },
        { value: 'e2', label: '李主管（S001）' }
      ])
      wrapper.vm.form.schedulers = ['e3', 'gone']
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.schedulerSelectOptions).toEqual(expect.arrayContaining([
        { value: 'e3', label: '陳離職（N009）（已停用）' },
        { value: 'gone', label: '已刪除的員工' }
      ]))
    })

    it('saves the schedulers and the shifts of a unit, and copies them when editing', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      wrapper.vm.subList = [{ _id: 'sd1', name: '內科', department: 'dept1', schedulers: ['e1'], allowedShiftIds: ['night'] }]
      await wrapper.vm.openDialog('sub', 0)
      expect(wrapper.vm.form.schedulers).toEqual(['e1'])
      expect(wrapper.vm.form.allowedShiftIds).toEqual(['night'])
      wrapper.vm.form.schedulers.push('e2')
      expect(wrapper.vm.subList[0].schedulers).toEqual(['e1'])

      wrapper.vm.form.allowedShiftIds = ['night', 'rest']
      apiFetch.mockClear()
      await wrapper.vm.saveItem()
      const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/sub-departments/sd1' && options?.method === 'PUT')
      expect(JSON.parse(call[1].body)).toMatchObject({ schedulers: ['e1', 'e2'], allowedShiftIds: ['night', 'rest'] })
    })

    it('warns when the chosen shifts have no day-off shift', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      await wrapper.vm.openDialog('sub')
      expect(wrapper.vm.missingNonWorkShift).toBe(false)
      wrapper.vm.form.allowedShiftIds = ['day', 'night']
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.missingNonWorkShift).toBe(true)
      wrapper.vm.form.allowedShiftIds = ['day', 'rest']
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.missingNonWorkShift).toBe(false)
    })

    it('saves the 使用簽核表單 of a department from the active forms', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      wrapper.vm.deptList = [{ _id: 'd1', name: '護理部', organization: 'org1', allowedFormIds: ['f3'], deptManager: 'e1' }]
      await wrapper.vm.openDialog('dept', 0)
      expect(wrapper.vm.formSelectOptions).toEqual([
        { value: 'f1', label: '請假單' },
        { value: 'f2', label: '加班單' },
        { value: 'f3', label: '舊表單（已停用）' }
      ])
      expect(wrapper.vm.deptManagerOptions.map(opt => opt.value)).toEqual(['e1', 'e2'])

      wrapper.vm.form.allowedFormIds = ['f1']
      apiFetch.mockClear()
      await wrapper.vm.saveItem()
      const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/departments/d1' && options?.method === 'PUT')
      expect(JSON.parse(call[1].body)).toMatchObject({ allowedFormIds: ['f1'], deptManager: 'e1' })
    })

    it('summarises the settings in the tables', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      expect(wrapper.vm.formScopeText({ allowedFormIds: [] })).toBe('全部表單')
      expect(wrapper.vm.formScopeText({ allowedFormIds: ['f1', 'f2'] })).toBe('2 張表單')
      expect(wrapper.vm.schedulerNames({ schedulers: ['e1', 'gone'] })).toBe('王小明、已刪除的員工')
      expect(wrapper.vm.schedulerNames({})).toBe('未指定')
      expect(wrapper.vm.shiftScopeText({ allowedShiftIds: [] })).toBe('全部班別')
      expect(wrapper.vm.shiftScopeText({ allowedShiftIds: ['night', 'rest'] })).toBe('N、休')
    })
  })

  it('選取部門時顯示名稱會更新', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.deptList = [
      { _id: 'd1', name: '人資部' },
      { _id: 'd2', name: '財務部' }
    ]

    wrapper.vm.selectedDept = 'd1'
    await wrapper.vm.$nextTick()
    expect(wrapper.html()).toContain('目前部門：人資部')

    wrapper.vm.selectedDept = 'd2'
    await wrapper.vm.$nextTick()
    expect(wrapper.html()).toContain('目前部門：財務部')
  })
})
