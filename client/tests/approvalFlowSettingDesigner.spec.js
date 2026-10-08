import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// 用真正的 Element Plus 渲染流程設計畫面：確認新的標籤 / 失效提醒 / 補齊報告都能渲染，且沒有 Vue 警告

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

const E1 = '64b7f0f0f0f0f0f0f0f0b001'
const E2 = '64b7f0f0f0f0f0f0f0f0b002'
const GONE = '64b7f0f0f0f0f0f0f0f0bfff'

const employees = [
  { id: E1, name: '王主管', username: 'boss', role: 'supervisor', signTags: ['人資'], department: { id: 'd1', name: '人資部' }, organization: 'org1', displayName: '王主管（boss）' },
  { id: E2, name: '陳離職', username: 'chen', role: 'employee', status: '離職員工', signTags: [], organization: 'org1', displayName: '陳離職（chen）' },
]

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

let workflow
let restoreBody
let warnSpy

beforeEach(() => {
  workflow = {
    policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' },
    steps: [
      { step_order: 1, approver_type: 'manager', approver_value: GONE },
      { step_order: 2, approver_type: 'tag', approver_value: '排班負責人' },
      { step_order: 3, approver_type: 'user', approver_value: [E2] },
      { step_order: 4, approver_type: 'role', approver_value: 'R004' },
    ],
  }
  restoreBody = {
    success: true, count: 1, createdCount: 1, preservedCount: 7, repairedCount: 0, forms: [],
    warnings: [{ type: 'tag_without_holder', form: '加班申請', formId: 'f6', step: 2, tag: '排班負責人', message: '「加班申請」第 2 關需要有「排班負責人」標籤的在職員工，目前沒有任何人持有。' }],
    templates: [{ key: 'overtime', name: '加班申請', formId: 'f6', status: 'created', requiredTags: [{ tag: '排班負責人', step: 2, holders: 0, required: true }] }],
  }
  apiFetch.mockReset()
  apiFetch.mockImplementation((url, opts) => {
    const method = opts?.method || 'GET'
    if (method === 'POST' && url === '/api/approvals/restore-defaults') return Promise.resolve(json(restoreBody))
    if (method !== 'GET') return Promise.resolve(json({ ok: true }))
    switch (url) {
      case '/api/approvals/forms': return Promise.resolve(json([{ _id: 'f1', name: '加班申請', category: '人事', is_active: true, semanticType: 'overtime' }]))
      case '/api/approvals/forms/f1/workflow': return Promise.resolve(json(workflow))
      case '/api/approvals/forms/f1/fields': return Promise.resolve(json([
        { _id: 'a', label: '事由', type_1: 'text', order: 0, required: false },
        { _id: 'b', label: '舊欄位', type_1: 'text', order: 1, required: false, is_active: false },
      ]))
      case '/api/employees/options': return Promise.resolve(json(employees))
      case '/api/employees/sign-tags': return Promise.resolve(json({ tags: [{ name: '人資', count: 1, requiredByWorkflows: 2 }, { name: '排班負責人', count: 0, requiredByWorkflows: 1 }] }))
      case '/api/approvals/sign-roles': return Promise.resolve(json([{ value: 'R004', label: '核定' }]))
      case '/api/approvals/sign-levels': return Promise.resolve(json([{ value: 'U001', label: 'L1' }]))
      case '/api/departments': return Promise.resolve(json([{ _id: 'd1', name: '人資部' }]))
      case '/api/organizations': return Promise.resolve(json([{ _id: 'org1', name: '台北總部' }]))
      case '/api/sub-departments': return Promise.resolve(json([]))
      case '/api/other-control-settings': return Promise.resolve(json({ customFields: [] }))
      case '/api/other-control-settings/item-settings': return Promise.resolve(json({}))
      case '/api/other-control-settings/form-categories': return Promise.resolve(json([{ id: 'c1', name: '人事', code: '人事' }]))
      default: return Promise.resolve(json({}, 404))
    }
  })
  vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function vueWarnings() {
  return warnSpy.mock.calls.map((call) => call.join(' ')).filter((text) => text.includes('[Vue warn]'))
}

describe('ApprovalFlowSetting 流程設計（真正的 Element Plus 渲染）', () => {
  it('流程視窗：顯示標籤警示、已失效的主管、不能簽核的人，操作欄有上移 / 下移，沒有 Vue 警告', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('目前沒有人持有此標籤')
    expect(text).toContain('已失效：指定的主管已找不到')
    expect(text).toContain('包含不能簽核的人員：陳離職（已離職）')
    expect(text).toContain('上移')
    expect(text).toContain('下移')
    expect(text).toContain('關卡說明')
    // 角色 / 層級的說明文字
    expect(text).toContain('R001–R007')
    expect(vueWarnings()).toEqual([])
  })

  it('標籤下拉可以輸入新標籤（allow-create），標籤選項帶出持有人數', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()

    const tagSelect = wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.props('placeholder') === '選擇或輸入標籤')
    expect(tagSelect).toBeTruthy()
    expect(tagSelect.props('allowCreate')).toBe(true)
    const labels = wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))
    expect(labels).toContain('人資（1 人）')
    expect(labels).toContain('排班負責人（0 人，目前沒有人持有）')
  })

  it('離職員工的選項是灰掉的（disabled），在職的人可選', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()

    const options = wrapper.findAllComponents({ name: 'ElOption' })
    const resigned = options.find((option) => option.props('value') === E2)
    expect(resigned.props('disabled')).toBe(true)
    expect(resigned.props('label')).toBe('陳離職（chen）（已離職）')
    const active = options.find((option) => option.props('value') === E1)
    expect(active.props('disabled')).toBeFalsy()
  })

  it('通用規則分頁標示尚未啟用', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const notice = wrapper.find('[data-test="policy-not-effective"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('尚未啟用（僅記錄設定）')
    expect(vueWarnings()).toEqual([])
  })

  it('補齊預設值之後顯示檢查報告', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.vm.restoreDefaults()
    await flushPromises()

    const report = wrapper.find('[data-test="restore-report"]')
    expect(report.exists()).toBe(true)
    expect(report.text()).toContain('「加班申請」第 2 關需要有「排班負責人」標籤')
    expect(report.text()).toContain('排班負責人（0 人）')
    expect(vueWarnings()).toEqual([])
  })

  it('欄位分頁：停用的欄位有「已停用」標示，沒有 Vue 警告', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    wrapper.vm.activeTab = 'fields'
    await flushPromises()

    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).not.toContain('型別2')
    expect(vueWarnings()).toEqual([])
  })

  it('儲存時要確認的事項（失效主管、沒人持有的標籤、離職的人）合併成一次確認', async () => {
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openWorkflowDialog({ _id: 'f1' })
    await flushPromises()

    await wrapper.vm.saveWorkflow()

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
    const text = JSON.stringify(message)
    expect(title).toBe('儲存前請確認')
    expect(options.confirmButtonText).toBe('移除失效項目並儲存')
    expect(text).toContain('第1關（主管）')
    expect(text).toContain('第2關（標籤）')
    expect(text).toContain('第3關（員工）')
    const put = apiFetch.mock.calls.find(([url, opts]) => url === '/api/approvals/forms/f1/workflow' && opts?.method === 'PUT')
    const body = JSON.parse(put[1].body)
    expect(Object.keys(body)).toEqual(['steps'])
    expect(body.steps[0].approver_value).toBe('APPLICANT_SUPERVISOR')
    expect(body.steps[1].approver_value).toBe('排班負責人')
    expect(body.steps[2].approver_value).toEqual([E2])
  })
})
