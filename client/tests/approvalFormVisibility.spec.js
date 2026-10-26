import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Approval from '../src/views/front/Approval.vue'
import { useAuthStore } from '../src/stores/auth'

// 2026/10 重大調整在申請頁的部分：
//  R2 部門的「使用簽核表單」：伺服器已經依部門篩選表單清單（回應標頭 X-Form-Visibility: department），申請頁提示；
//     選好的表單不見了（停用、部門不再開放、送出時 403 FORM_NOT_ALLOWED）時說明原因並清掉選擇。
//  R5 主管關卡找不到主管、改由最高層簽核人簽核：流程預覽先告訴申請人。
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, onBeforeRouteLeave: () => {} }
})

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: () => Promise.resolve(body),
})

const LEAVE = { _id: 'f-leave', name: '請假', category: '請假類', is_active: true, semanticType: 'leave' }
const OVERTIME = { _id: 'f-ot', name: '加班申請', category: '人事類', is_active: true, semanticType: 'overtime' }

function installFetch(routes = []) {
  const calls = []
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, method: init.method || 'GET', body: init.body })
    for (const [matcher, responder] of routes) {
      const hit = typeof matcher === 'function' ? matcher(text, init) : text.includes(matcher)
      if (hit) return Promise.resolve(typeof responder === 'function' ? responder(text, init) : responder)
    }
    return Promise.resolve(json([]))
  })
  return calls
}

const isFormsList = (url, init) => (init?.method || 'GET') === 'GET' && url.includes('/api/approvals/forms?')

const mounted = []
async function mountPage() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Approval, { global: { plugins: [ElementPlus, pinia] } })
  mounted.push(wrapper)
  useAuthStore().role = 'employee'
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
})

describe('部門的「使用簽核表單」在申請頁', () => {
  it('says the list only has the forms of the department when the server filtered it', async () => {
    installFetch([[isFormsList, json([LEAVE], 200, { 'X-Form-Visibility': 'department' })]])
    const wrapper = await mountPage()

    expect(wrapper.vm.formTemplates.map(form => form.name)).toEqual(['請假'])
    expect(wrapper.find('[data-test="form-visibility-hint"]').text()).toBe('目前只列出您所屬部門開放使用的表單；找不到需要的表單請洽管理員')
  })

  it('shows no hint when the department has no selection (or the server is older)', async () => {
    installFetch([[isFormsList, json([LEAVE, OVERTIME], 200, { 'X-Form-Visibility': 'all' })]])
    const wrapper = await mountPage()
    expect(wrapper.find('[data-test="form-visibility-hint"]').exists()).toBe(false)
  })

  it('explains why the chosen form disappeared after reloading the list', async () => {
    let list = [LEAVE, OVERTIME]
    installFetch([
      [isFormsList, () => json(list, 200, { 'X-Form-Visibility': 'department' })],
      ['/api/approvals/forms/f-ot/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f-ot/workflow', json({ steps: [] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f-ot'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    list = [LEAVE]
    await wrapper.vm.reloadSelectedForm()
    await flushPromises()

    expect(wrapper.vm.applyState.formId).toBe('')
    expect(wrapper.find('[data-test="form-gone-notice"]').text()).toContain('「加班申請」已不在可申請的表單中（可能已停用，或您所屬的部門未開放使用），請改選其他表單')

    // 選了別的表單就不再提示
    installFetch([
      [isFormsList, json([LEAVE])],
      ['/api/approvals/forms/f-leave/fields', json([])],
      ['/api/approvals/forms/f-leave/workflow', json({ steps: [] })],
    ])
    wrapper.vm.applyState.formId = 'f-leave'
    await wrapper.vm.onSelectForm()
    await flushPromises()
    expect(wrapper.find('[data-test="form-gone-notice"]').exists()).toBe(false)
  })

  it('reloads the list and clears the form when the server refuses it (403 FORM_NOT_ALLOWED)', async () => {
    let list = [LEAVE, OVERTIME]
    const message = '您所屬的部門未開放使用【加班申請】，請改選其他表單；如需使用請洽管理員'
    const calls = installFetch([
      [isFormsList, () => json(list)],
      ['/api/approvals/forms/f-ot/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f-ot/workflow', json({ steps: [{ approver_type: 'tag', approver_value: '人資' }] })],
      [(url, init) => init?.method === 'POST' && url.endsWith('/api/approvals'), () => {
        list = [LEAVE] // 管理員剛把部門設定改掉
        return json({ error: message, code: 'FORM_NOT_ALLOWED' }, 403)
      }],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f-ot'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    await wrapper.vm.submitApply()
    await flushPromises()

    expect(calls.filter(call => isFormsList(call.url, { method: call.method }))).toHaveLength(2)
    expect(wrapper.vm.applyState.formId).toBe('')
    expect(wrapper.vm.formTemplates.map(form => form.name)).toEqual(['請假'])
    expect(wrapper.find('[data-test="form-gone-notice"]').text()).toContain(message)
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining(message))
  })
})

describe('流程預覽：無上級主管改由最高層簽核人', () => {
  it('tells the applicant before filing that the manager step goes to the admins, and why', async () => {
    installFetch([
      [isFormsList, json([LEAVE])],
      ['/api/approvals/forms/f-leave/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f-leave/workflow', json({ steps: [{
        approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', is_required: true,
        resolved_count: 2, unresolved_reason: null,
        fallback_text: '無上級主管，改由系統管理員簽核（任一位核准即可）', fallback_reason: '申請人沒有設定直屬主管',
      }] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f-leave'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    expect(wrapper.vm.workflowSteps).toEqual([{
      label: '第 1 關',
      approvers: '申請者的主管',
      warning: '',
      fallback: '無上級主管，改由系統管理員簽核（任一位核准即可）（申請人沒有設定直屬主管）',
    }])
    expect(wrapper.find('[data-test="workflow-step-fallback"]').text()).toBe('無上級主管，改由系統管理員簽核（任一位核准即可）（申請人沒有設定直屬主管）')
  })
})
