import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import Approval from '../src/views/front/Approval.vue'
import { createPinia, setActivePinia } from 'pinia'
// 選項整理與附件顯示已經不在頁面元件上（明細改用共用的 ApprovalDetailContent、欄位用 ApprovalFormFields），直接測共用的工具
import { formatFormValue, normalizeFieldOptions } from '../src/utils/approvalDisplay'
import { attachmentDisplayName, attachmentItems } from '../src/utils/approvalDetail'

// 簽核頁的提示與確認改用 Element Plus 的訊息與確認框（utils/approvalNotify）：測試裡接回 window.alert / window.confirm
vi.mock('../src/utils/approvalNotify', () => ({
  notifySuccess: (message, warnings = []) => window.alert([message, ...warnings].join('\n')),
  notifyFailure: (title, message) => window.alert(title ? `${title}：${message}` : message),
  confirmAction: (message) => Promise.resolve(window.confirm(message)),
}))

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

  // 2026/11 介面整理：待我簽核改成「等最久的排最前面」（以前是最新的在前，舊的單會被擠到後面沒人簽）
  it('sorts inbox approvals oldest first, so the request that waited longest is on top', async () => {
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

    const expectedOrder = [...inboxDocs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    expect(wrapper.vm.inboxList.map(doc => doc._id)).toEqual(expectedOrder.map(doc => doc._id))
    expect(wrapper.vm.inboxList.map(doc => doc._id)).toEqual(['req-old', 'req-mid', 'req-new'])
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
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const wrapper = shallowMount(Approval, { global: { stubs } })
    await flushPromises()

    await wrapper.vm.cancelMyRequest({ _id: 'a1', status: 'pending' })
    await flushPromises()

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/approvals/a1/cancel'),
      expect.objectContaining({ method: 'POST' }),
    )
    // 撤回成功要有訊息（以前簽核中的單撤回成功什麼都不顯示）
    expect(alertSpy).toHaveBeenCalledWith('已撤回')
    alertSpy.mockRestore()
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

  it('欄位選項把字串、{label,value}、{name,code} 統一成 {label,value}，不會出現 undefined 標籤', () => {
    const getOptions = normalizeFieldOptions

    // 既有行為不變
    expect(getOptions({ options: ['休假', '事假'] })).toEqual([
      { label: '休假', value: '休假' },
      { label: '事假', value: '事假' }
    ])
    expect(getOptions({ options: [{ label: '特休假', value: 'ANNUAL' }] })).toEqual([
      { label: '特休假', value: 'ANNUAL' }
    ])
    expect(getOptions({ options: [{ label: '病假' }, { value: '公假' }] })).toEqual([
      { label: '病假', value: '病假' },
      { label: '公假', value: '公假' }
    ])
    expect(getOptions({ options: { A: '甲', B: '乙' } })).toEqual([
      { label: '甲', value: 'A' },
      { label: '乙', value: 'B' }
    ])
    expect(getOptions({})).toEqual([])

    // 字典 / 自訂欄位的 {name, code} 選項：標籤用名稱
    const options = getOptions({ options: [{ name: '特休假', code: 'ANNUAL' }, { name: '病假' }, { code: 'ONLY_CODE' }] })
    expect(options.map(opt => opt.label)).toEqual(['特休假', '病假', 'ONLY_CODE'])
    expect(options.every(opt => typeof opt.label === 'string' && opt.label && opt.value)).toBe(true)
    // 值與伺服器解析字典時一樣用名稱（請假 / 特休扣減比對的是名稱）
    expect(options[0]).toEqual({ label: '特休假', value: '特休假' })
    // label / value 優先於 name / code
    expect(getOptions({ options: [{ label: 'L', value: 'V', name: 'N', code: 'C' }] })).toEqual([
      { label: 'L', value: 'V' }
    ])
  })

  it('renders attachment metadata as a filename instead of an object string', () => {
    const renderValue = (value, field) => formatFormValue(field, value)
    const attachment = {
      name: 'CODEX_TEST_20260802_PROOF.pdf',
      url: '/upload/approvals/generated-proof.pdf',
    }

    expect(attachmentItems([attachment])).toEqual([attachment])
    expect(attachmentDisplayName(attachment)).toBe('CODEX_TEST_20260802_PROOF.pdf')
    expect(renderValue(attachment)).toBe('CODEX_TEST_20260802_PROOF.pdf')
    expect(renderValue(attachment)).not.toBe('[object Object]')
  })
})
