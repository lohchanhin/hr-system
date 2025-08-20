import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'
global.ElMessage = { success: vi.fn() }

describe('ApprovalFlowSetting field tab', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  it('loads fields and adds new field', async () => {
    const fields = []
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => [{ _id:'f1', name:'F1', category:'', is_active:true }] })
      if (url === '/api/employees/options') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/roles') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/approvals/forms/f1/fields' && !opts) return Promise.resolve({ ok: true, json: async () => fields })
      if (url === '/api/approvals/forms/f1/fields' && opts?.method === 'POST') {
        fields.push({ _id:'fld1', ...JSON.parse(opts.body) })
        return Promise.resolve({ ok: true, json: async () => fields[0] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.loadFields()
    expect(apiFetch).toHaveBeenCalledWith('/api/approvals/forms/f1/fields', undefined)
    wrapper.vm.openFieldDialog()
    wrapper.vm.fieldDialog.label = 'Name'
    await wrapper.vm.saveField()
    const call = apiFetch.mock.calls.find(c => c[0] === '/api/approvals/forms/f1/fields' && c[1].method === 'POST')
    expect(call).toBeTruthy()
  })

  it('moves field and updates order', async () => {
    const fields = [
      { _id:'a', label:'A', type_1:'text', order:0, required:false },
      { _id:'b', label:'B', type_1:'text', order:1, required:false }
    ]
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => [{ _id:'f1', name:'F1', category:'', is_active:true }] })
      if (url === '/api/employees/options') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/roles') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/approvals/forms/f1/fields' && !opts) return Promise.resolve({ ok: true, json: async () => fields })
      if (url.startsWith('/api/approvals/forms/f1/fields/') && opts?.method === 'PUT') return Promise.resolve({ ok: true })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.selectedFormId = 'f1'
    await wrapper.vm.loadFields()
    await wrapper.vm.moveField(1, -1)
    const call = apiFetch.mock.calls.find(c => c[0] === '/api/approvals/forms/f1/fields/a' && c[1].method === 'PUT')
    expect(call).toBeTruthy()
  })
})
