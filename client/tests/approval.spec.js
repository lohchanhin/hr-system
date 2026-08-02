import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import Approval from '../src/views/front/Approval.vue'
import { createPinia, setActivePinia } from 'pinia'

const stubs = {
  'el-option': true,
  'el-select': true,
  'el-button': true,
  'el-form-item': true,
  'el-divider': true,
  'el-input': true,
  'el-input-number': true,
  'el-checkbox': true,
  'el-checkbox-group': true,
  'el-date-picker': true,
  'el-time-picker': true,
  'el-upload': true,
  'el-form': true,
  'el-tab-pane': true,
  'el-table-column': true,
  'el-tag': true,
  'el-table': true,
  'el-tabs': true,
  'el-descriptions-item': true,
  'el-descriptions': true,
  'el-timeline-item': true,
  'el-timeline': true,
  'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' }
}

describe('Approval.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('fetches list on mount', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/approvals'), expect.any(Object))
    expect(window.fetch.mock.calls.some(([url]) => url.includes('/ensure-leave-form'))).toBe(false)
    window.fetch.mockRestore()
  })

  it('sorts inbox approvals by createdAt descending', async () => {
    const inboxDocs = [
      {
        _id: 'req-old',
        createdAt: '2024-01-01T00:00:00.000Z',
        current_step_index: 0,
        applicant_employee: { _id: 'app1', name: '王小明', employeeId: 'E001', department: 'HR', organization: '總部' },
        steps: [{ approvers: [{ approver: { _id: 'u1', name: 'Alice' }, decision: 'pending' }] }],
      },
      {
        _id: 'req-new',
        createdAt: '2024-03-01T00:00:00.000Z',
        current_step_index: 0,
        applicant_employee: { _id: 'app2', name: '李小華', employeeId: 'E002', department: 'Finance', organization: '總部' },
        steps: [{ approvers: [{ approver: { _id: 'u1', name: 'Alice' }, decision: 'pending' }] }],
      },
      {
        _id: 'req-mid',
        createdAt: '2024-02-01T00:00:00.000Z',
        current_step_index: 0,
        applicant_employee: { _id: 'app3', name: '陳大雄', employeeId: 'E003', department: 'IT', organization: '分部' },
        steps: [{ approvers: [{ approver: { _id: 'u1', name: 'Alice' }, decision: 'pending' }] }],
      },
    ]
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/approvals/inbox')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([...inboxDocs]) })
      }
      if (url.includes('/api/approvals')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })

    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()

    const expectedOrder = [...inboxDocs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    expect(wrapper.vm.inboxList.map(doc => doc._id)).toEqual(expectedOrder.map(doc => doc._id))
    window.fetch.mockRestore()
  })

  it('loads fields and workflow for selected form', async () => {
    let employeeCall = 0
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/forms/f1/fields')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/forms/f1/workflow')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ steps: [{ approver_type: 'user', approver_value: ['u1'] }] })
        })
      }
      if (url.includes('/employees')) {
        employeeCall++
        if (employeeCall === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ _id: 'u1', name: 'Alice' }]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    wrapper.vm.applyState.formId = 'f1'
    window.fetch.mockClear()
    await wrapper.vm.onSelectForm()
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/approvals/forms/f1/fields'), expect.any(Object))
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/approvals/forms/f1/workflow'), expect.any(Object))
    expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/employees'), expect.any(Object))
    expect(wrapper.vm.workflowSteps[0].approvers).toBe('Alice')
    window.fetch.mockRestore()
  })

  it('submits form with file upload without error', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/approvals/attachments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            files: [{ name: 'a.pdf', url: '/upload/approvals/generated.pdf' }]
          })
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()

    wrapper.vm.applyState.formId = 'f1'
    wrapper.vm.applyState.formData = { f2: 'text' }
    wrapper.vm.fileBuffers = { f3: [new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' })] }

    await wrapper.vm.submitApply()
    await flushPromises()

    const postCall = window.fetch.mock.calls.find(([url, opt]) => url.endsWith('/api/approvals') && opt?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(postCall[1].headers['Idempotency-Key']).toEqual(expect.any(String))
    expect(postCall[1].headers['Idempotency-Key'].length).toBeGreaterThan(8)
    expect(postCall[1].body).toContain('"url":"/upload/approvals/generated.pdf"')
    expect(wrapper.vm.applyError).toBe('')
    window.fetch.mockRestore()
    alertSpy.mockRestore()
  })

  it('lets the applicant cancel a pending request through the protected action endpoint', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/approvals/a1/cancel')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ _id: 'a1', status: 'canceled' }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()

    await wrapper.vm.cancelMyRequest({ _id: 'a1', status: 'pending' })
    await flushPromises()

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/approvals/a1/cancel'),
      expect.objectContaining({ method: 'POST' }),
    )
    confirmSpy.mockRestore()
    window.fetch.mockRestore()
  })

  it('shows detail dialog after viewing', async () => {
    const doc = {
      _id: 'a1',
      form: { name: '請假單', category: '請假', fields: [{ _id: 'f1', label: '事由' }] },
      applicant_employee: { name: 'Bob' },
      status: 'pending',
      form_data: { f1: '測試' },
      steps: []
    }
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/approvals/a1')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(doc) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    await wrapper.vm.openDetail('a1')
    await flushPromises()
    expect(wrapper.vm.detail.visible).toBe(true)
    expect(wrapper.vm.detail.doc.form.fields[0].label).toBe('事由')
    expect(wrapper.vm.detail.doc.form_data.f1).toBe('測試')
    window.fetch.mockRestore()
  })

  it('renders approver name when approver object returned', async () => {
    const doc = {
      _id: 'a1',
      form: { name: '請假單', category: '請假', fields: [] },
      applicant_employee: { name: 'Bob' },
      status: 'pending',
      form_data: {},
      steps: [
        { approvers: [{ approver: { _id: 'u1', name: 'Alice' }, decision: 'pending' }] }
      ]
    }
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/approvals/a1')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(doc) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    await wrapper.vm.openDetail('a1')
    await flushPromises()
    const text = wrapper.vm.approverName(wrapper.vm.detail.doc.steps[0].approvers[0].approver)
    expect(text).toBe('Alice')
    expect(text).not.toContain('{')
    window.fetch.mockRestore()
  })

  it('handles non-array approvers in detail steps', async () => {
    const doc = {
      _id: 'a1',
      form: { name: '請假單', category: '請假', fields: [] },
      applicant_employee: { name: 'Bob' },
      status: 'pending',
      form_data: {},
      steps: [{ approvers: true }]
    }
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/approvals/a1')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(doc) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    await expect(wrapper.vm.openDetail('a1')).resolves.toBeUndefined()
    expect(wrapper.vm.detail.visible).toBe(true)
    window.fetch.mockRestore()
  })

  it('renders attachment metadata as a filename instead of an object string', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()
    const attachment = {
      name: 'CODEX_TEST_20260802_PROOF.pdf',
      url: '/upload/approvals/generated-proof.pdf',
    }

    expect(wrapper.vm.attachmentItems([attachment])).toEqual([attachment])
    expect(wrapper.vm.attachmentDisplayName(attachment)).toBe('CODEX_TEST_20260802_PROOF.pdf')
    expect(wrapper.vm.renderValue(attachment)).toBe('CODEX_TEST_20260802_PROOF.pdf')
    expect(wrapper.vm.renderValue(attachment)).not.toBe('[object Object]')
    window.fetch.mockRestore()
  })
})
