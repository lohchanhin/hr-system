import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))
import { apiFetch } from '../src/api'
import SocialInsuranceRetirementSetting from '../src/components/backComponents/SocialInsuranceRetirementSetting.vue'

const buttonStub = {
  props: ['type'],
  template: '<button v-bind="$attrs" type="button" :data-type-prop="type || $attrs.type" @click="$emit(\'click\')"><slot /></button>'
}

const elStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-table': { template: '<table><slot /></table>' },
  'el-table-column': { template: '<col />' },
  'el-button': buttonStub,
  'ElButton': buttonStub,
  'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
  'el-space': { template: '<div><slot /></div>' }
}

describe('SocialInsuranceRetirementSetting.vue', () => {
  beforeEach(() => {
    apiFetch.mockClear()
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }))
  })

  it('fetches official rate tables for each tab on mount', async () => {
    mount(SocialInsuranceRetirementSetting, { global: { stubs: elStubs } })
    await flushPromises()
    const urls = apiFetch.mock.calls.map(call => call[0])
    expect(urls).toContain('/api/payroll/insurance/rates?type=laborInsurance')
    expect(urls).toContain('/api/payroll/insurance/rates?type=healthInsurance')
    expect(urls).toContain('/api/payroll/insurance/rates?type=retirement')
  })

  it('refreshes active tab rates with correct endpoint and shows status', async () => {
    const responses = {
      '/api/payroll/insurance/rates?type=laborInsurance': [],
      '/api/payroll/insurance/rates?type=healthInsurance': [],
      '/api/payroll/insurance/rates?type=retirement': [],
      '/api/payroll/insurance/refresh?type=healthInsurance': {
        message: 'health updated',
        rates: [{ level: 1, insuredSalary: 1000, workerFee: 10, employerFee: 20 }]
      }
    }
    apiFetch.mockImplementation((url, opts) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? (opts?.method === 'POST' ? { rates: [] } : [])
      })
    )

    const wrapper = mount(SocialInsuranceRetirementSetting, { global: { stubs: elStubs } })
    await flushPromises()

    wrapper.vm.activeTab = 'healthInsurance'
    await flushPromises()

    const healthButton = wrapper.findAll('button').find(btn => btn.text().includes('健保'))
    await healthButton.trigger('click')
    await flushPromises()

    const postCall = apiFetch.mock.calls.find(
      call => call[0] === '/api/payroll/insurance/refresh?type=healthInsurance'
    )
    expect(postCall?.[1]?.method).toBe('POST')
    expect(wrapper.text()).toContain('health updated')
  })

  it('uses consistent primary style for manual fetch buttons', async () => {
    const wrapper = mount(SocialInsuranceRetirementSetting, { global: { stubs: elStubs } })
    await flushPromises()
    const refreshButtons = wrapper.findAll('button').filter(btn => btn.text().includes('手動取得'))
    expect(refreshButtons.length).toBeGreaterThan(0)
    refreshButtons.forEach(btn => {
      expect(btn.attributes()['data-type-prop']).toBe('primary')
    })
  })
})
