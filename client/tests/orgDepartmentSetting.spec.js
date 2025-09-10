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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches all lists on mount', async () => {
    mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    const calls = apiFetch.mock.calls
    expect(calls.find(c => c[0] === '/api/organizations')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/departments')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/sub-departments')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/dept-managers')).toBeTruthy()
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

  it('shows organization select in dept form', () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.openDialog('dept')
    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
    expect(wrapper.vm.form).toHaveProperty('organization')
  })

  it('fetchList adds parent id query', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.fetchList('dept', '123')
    expect(apiFetch).toHaveBeenCalledWith('/api/departments?organization=123', expect.anything())
  })

  it('saves dept schedule to correct endpoint', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.saveDeptSchedule()
    expect(apiFetch).toHaveBeenCalledWith('/api/dept-schedules', expect.objectContaining({ method: 'POST' }))
  })

  it('saves break setting to correct endpoint', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.saveBreakSetting()
    expect(apiFetch).toHaveBeenCalledWith('/api/break-settings', expect.objectContaining({ method: 'POST' }))
  })
})
