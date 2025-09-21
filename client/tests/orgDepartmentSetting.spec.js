import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import OrgDepartmentSetting from '../src/components/backComponents/OrgDepartmentSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('OrgDepartmentSetting.vue', () => {
  beforeEach(() => {
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
  })

  it('fetchList adds parent id query', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.fetchList('dept', '123')
    expect(apiFetch).toHaveBeenCalledWith('/api/departments?organization=123')
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
  })

  it('saves department with schedule fields', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.openDialog('dept')
    wrapper.vm.form = {
      name: '人資',
      organization: 'org1',
      code: 'D1',
      unitName: '',
      location: '',
      phone: '',
      manager: '',
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
      scheduleNotes: '備註'
    })
  })

  it('部門對話框可載入中場休息設定', async () => {
    const breakSetting = {
      _id: 'break1',
      department: 'dept1',
      enableGlobalBreak: true,
      breakMinutes: 45,
      allowMultiBreak: true
    }

    apiFetch.mockReset()
    apiFetch.mockImplementation(url => {
      if (url === '/api/break-settings?department=dept1') {
        return Promise.resolve({ ok: true, json: async () => [breakSetting] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.deptList = [
      { _id: 'dept1', name: '人資部', organization: 'org1' }
    ]

    await wrapper.vm.openDialog('dept', 0)

    expect(apiFetch).toHaveBeenCalledWith('/api/break-settings?department=dept1')
    expect(wrapper.vm.form.enableGlobalBreak).toBe(true)
    expect(wrapper.vm.form.breakMinutes).toBe(45)
    expect(wrapper.vm.form.allowMultiBreak).toBe(true)
    expect(wrapper.vm.form.breakSettingId).toBe('break1')
  })

  it('儲存部門時會同步儲存中場休息設定', async () => {
    apiFetch.mockReset()
    apiFetch.mockImplementation((url, options) => {
      if (url === '/api/departments' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ _id: 'dept99' }),
          headers: { get: () => 'application/json' }
        })
      }
      if (url === '/api/break-settings') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ _id: 'break99' }),
          headers: { get: () => 'application/json' }
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })

    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await wrapper.vm.openDialog('dept')
    wrapper.vm.form = {
      ...wrapper.vm.form,
      name: '資訊部',
      organization: 'org1',
      enableGlobalBreak: true,
      breakMinutes: 50,
      allowMultiBreak: false
    }
    wrapper.vm.editIndex = null

    await wrapper.vm.saveItem()

    const deptCall = apiFetch.mock.calls.find(([url, opts]) => url === '/api/departments' && opts?.method === 'POST')
    expect(deptCall).toBeTruthy()
    const breakCall = apiFetch.mock.calls.find(([url]) => url === '/api/break-settings')
    expect(breakCall).toBeTruthy()
    const [, breakOptions] = breakCall
    const breakPayload = JSON.parse(breakOptions.body)
    expect(breakPayload).toMatchObject({
      department: 'dept99',
      enableGlobalBreak: true,
      breakMinutes: 50,
      allowMultiBreak: false
    })
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
      shiftId: 's1'
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
  })

  it('選取部門時顯示名稱會更新', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
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
