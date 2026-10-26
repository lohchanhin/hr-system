import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// R5「避免主管沒辦法當自己主管」：通用流程規則裡的「無上級主管時的簽核人（全部表單共用）」。
// GET / PUT /api/approvals/top-level-approvers；空白 = 改送所有在職的系統管理員。

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

const EMPLOYEES = [
  { id: 'e-ceo', name: '院長', username: 'ceo', role: 'supervisor' },
  { id: 'e-admin', name: '人資管理員', username: 'hr', role: 'admin' },
  { id: 'e-left', name: '離職主任', username: 'left', role: 'supervisor', status: '離職員工' },
]

let setting
let failRead

function installApi() {
  apiFetch.mockImplementation((url, opts) => {
    const method = opts?.method || 'GET'
    if (url === '/api/approvals/top-level-approvers') {
      if (method === 'PUT') {
        const ids = JSON.parse(opts.body).ids
        setting = {
          ...setting,
          ids,
          approvers: ids.map((id) => ({ ...EMPLOYEES.find((emp) => emp.id === id), id, employeeId: '', eligible: true, ineligibleReason: '' })),
        }
        return Promise.resolve(json(setting))
      }
      return Promise.resolve(failRead ? json({ error: '無法讀取' }, 500) : json(setting))
    }
    if (method !== 'GET') return Promise.resolve(json({ ok: true }))
    switch (url) {
      case '/api/approvals/forms': return Promise.resolve(json([]))
      case '/api/employees/options': return Promise.resolve(json(EMPLOYEES))
      case '/api/employees/sign-tags': return Promise.resolve(json({ tags: [] }))
      case '/api/other-control-settings': return Promise.resolve(json({ customFields: [] }))
      case '/api/other-control-settings/item-settings': return Promise.resolve(json({}))
      case '/api/other-control-settings/form-categories': return Promise.resolve(json([]))
      default: return Promise.resolve(json([]))
    }
  })
}

let warnSpy
beforeEach(() => {
  setting = { ids: [], approvers: [], admins: [{ id: 'e-admin', name: '人資管理員', employeeId: 'A001', role: 'admin' }], maxCount: 50 }
  failRead = false
  apiFetch.mockReset()
  installApi()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function mountPage() {
  const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

const card = (wrapper) => wrapper.find('[data-test="top-level-approvers"]')
const approverSelect = (wrapper) => wrapper.findAllComponents({ name: 'ElSelect' })
  .find((select) => select.props('placeholder') === '不選 = 改送系統管理員')

describe('無上級主管時的簽核人（全部表單共用）', () => {
  it('explains the rule and says the admins get the requests while nobody is chosen', async () => {
    const wrapper = await mountPage()

    expect(card(wrapper).exists()).toBe(true)
    expect(card(wrapper).text()).toContain('申請人本人一律不會是自己的簽核人')
    expect(wrapper.find('[data-test="top-level-approvers-summary"]').text()).toBe('目前沒有指定：改送系統管理員（人資管理員（A001））')
    expect(warnSpy.mock.calls.map((call) => call.join(' ')).filter((text) => text.includes('[Vue warn]'))).toEqual([])
  })

  it('offers every employee, but not the ones who cannot sign', async () => {
    const wrapper = await mountPage()
    const byId = Object.fromEntries(wrapper.vm.topLevelOptions.map((option) => [option.id, option]))
    expect(byId['e-ceo']).toMatchObject({ label: '院長（ceo）', disabled: false })
    expect(byId['e-left']).toMatchObject({ label: '離職主任（left）（已離職）', disabled: true })
  })

  it('saves the chosen people and shows them', async () => {
    const wrapper = await mountPage()
    approverSelect(wrapper).vm.$emit('update:modelValue', ['e-ceo'])
    await flushPromises()

    await wrapper.find('[data-test="top-level-approvers-save"]').trigger('click')
    await flushPromises()

    const put = apiFetch.mock.calls.find(([url, opts]) => url === '/api/approvals/top-level-approvers' && opts?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ ids: ['e-ceo'] })
    expect(ElMessage.success).toHaveBeenCalledWith('已儲存無上級主管時的簽核人')
    expect(wrapper.find('[data-test="top-level-approvers-summary"]').text()).toBe('目前指定：院長')
  })

  it('goes back to the admins when the list is cleared', async () => {
    setting = { ...setting, ids: ['e-ceo'], approvers: [{ id: 'e-ceo', name: '院長', employeeId: '', eligible: true, ineligibleReason: '' }] }
    const wrapper = await mountPage()
    expect(wrapper.find('[data-test="top-level-approvers-summary"]').text()).toBe('目前指定：院長')

    approverSelect(wrapper).vm.$emit('update:modelValue', [])
    await wrapper.find('[data-test="top-level-approvers-save"]').trigger('click')
    await flushPromises()

    expect(ElMessage.success).toHaveBeenCalledWith('已改回預設：改送系統管理員')
    expect(wrapper.find('[data-test="top-level-approvers-summary"]').text()).toContain('改送系統管理員')
  })

  it('warns about a saved person who left since', async () => {
    setting = { ...setting, ids: ['e-left'], approvers: [{ id: 'e-left', name: '離職主任', employeeId: 'S9', eligible: false, ineligibleReason: '已離職' }] }
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="top-level-approvers-warning"]').text()).toBe('「離職主任（S9）」已離職，簽核時會略過，請移除或改選其他人')
  })

  it('says so inside the card (no pop-up) and does not allow saving when the setting cannot be read', async () => {
    failRead = true
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="top-level-approvers-error"]').text()).toBe('無法讀取無上級主管時的簽核人設定，請重新整理頁面')
    expect(wrapper.find('[data-test="top-level-approvers-save"]').attributes('disabled')).toBeDefined()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })
})
