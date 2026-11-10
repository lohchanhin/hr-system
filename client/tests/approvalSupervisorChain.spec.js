import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Approval from '../src/views/front/Approval.vue'
import ApprovalDetailContent from '../src/views/front/ApprovalDetailContent.vue'
import { useAuthStore } from '../src/stores/auth'
import {
  actionLabel,
  buildLogRows,
  describeChainPreview,
  describeRepeatPreview,
  describeStepConditionPreview,
  requestStepNote,
  requestStepTitle,
} from '../src/utils/approvalDetail'

// 主管鏈與請假長度條件在申請人、簽核人看到的畫面（docs/approval-supervisor-chain.md）：
// - 申請頁的流程預覽：主管鏈列出會簽的級數（不含姓名）、「請假滿 56 小時才需要」、會被略過的重複簽核人。
// - 單據明細：主管鏈每一關的名稱（第n級主管）與略過離職主管的說明；簽核紀錄的新動作。
// - 我已簽核：決議後面附上「第n級主管」。
// 回應內容照伺服器實際的 JSON 形狀（GET /forms/:id/workflow、GET /api/approvals/:id、GET /api/approvals/history）。
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
  blob: () => Promise.resolve(new Blob(['x'])),
})

const LEAVE = { _id: 'f-leave', name: '請假', category: '請假類', is_active: true, semanticType: 'leave' }

// 客戶的設定（第1關 主管鏈到「一般假單決行」；第2關 主管鏈到「長假決行」、請假滿 56 小時才需要），以護理師當申請人時的預覽
const PREVIEW = {
  _id: 'wf1',
  form: 'f-leave',
  policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none', skipRepeatedApprovers: false },
  steps: [
    {
      step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行', maxLevels: 5 }, scope_type: 'none',
      is_required: true, all_must_approve: true, can_return: true,
      resolved_count: 2, unresolved_reason: null, fallback_text: null, fallback_reason: null,
      chain_levels: [{ level: 1, label: '第1級主管', repeated: false }, { level: 2, label: '第2級主管', repeated: false }],
    },
    {
      step_order: 2, approver_type: 'manager_chain', approver_value: { stopAtTag: '長假決行', maxLevels: 5 }, scope_type: 'none',
      is_required: false, all_must_approve: true, can_return: true, condition: { kind: 'leave_hours_gte', value: 56 },
      resolved_count: 3, unresolved_reason: null, fallback_text: null, fallback_reason: null,
      condition_text: '請假滿 56 小時才需要', repeated_count: 2,
      chain_levels: [
        { level: 1, label: '第1級主管', repeated: true },
        { level: 2, label: '第2級主管', repeated: true },
        { level: 3, label: '第3級主管', repeated: false },
      ],
    },
  ],
}

// 7 日的假單（第3級主管 = 醫療副院長），護理長留職停薪時第1關由主任簽
const REQUEST = {
  _id: 'r7',
  status: 'pending',
  form: { _id: 'f-leave', name: '請假', semanticType: 'leave', fields: [] },
  form_data: {},
  applicant_employee: { _id: 'n1', name: '護理師甲', employeeId: 'E0008' },
  current_step_index: 0,
  steps: [
    {
      step_order: 1, name: '第2級主管', note: '已略過留職停薪的護理長乙（E0036）（第1級主管），改由上一級主管簽核',
      all_must_approve: true, is_required: true, can_return: true,
      approvers: [{ approver: { _id: 'd1', name: '主任丙' }, decision: 'pending' }],
    },
    {
      step_order: 2, name: '第3級主管', all_must_approve: true, is_required: false, can_return: true,
      approvers: [{ approver: { _id: 'v1', name: '副院長丁' }, decision: 'pending' }],
    },
  ],
  logs: [
    { action: 'create', by_employee: { _id: 'n1', name: '護理師甲' }, at: '2026-11-05T01:00:00.000Z', message: '建立送審單' },
    { action: 'manager_chain', at: '2026-11-05T01:00:00.000Z', message: '第1關（主管鏈，到「一般假單決行」為止）：已略過留職停薪的護理長乙（E0036）（第1級主管），改由上一級主管簽核' },
    { action: 'skip_repeated_approver', at: '2026-11-05T01:00:00.000Z', message: '第2關（主管鏈，到「長假決行」為止）略過已是前面關卡簽核人的主任丙（E0013）（第2級主管）' },
  ],
  viewer: { can_act: false, can_override: false, is_applicant: true },
}

function installFetch(routes = []) {
  const calls = []
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const text = String(url)
    calls.push({ url: text, method: init.method || 'GET' })
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
async function mountPage(role = 'employee') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Approval, { global: { plugins: [ElementPlus, pinia] }, attachTo: document.body })
  mounted.push(wrapper)
  useAuthStore().role = role
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
  document.body.innerHTML = ''
})

describe('申請頁的流程預覽：主管鏈與請假長度條件', () => {
  it('lists the levels that will sign, the condition, and the repeats that are skipped', async () => {
    installFetch([
      [isFormsList, json([LEAVE])],
      ['/api/approvals/forms/f-leave/fields', json([{ _id: 'a', label: '事由', type_1: 'text' }])],
      ['/api/approvals/forms/f-leave/workflow', json(PREVIEW)],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f-leave'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    expect(wrapper.vm.workflowSteps).toEqual([
      { label: '第 1 關', approvers: '主管鏈：第1級主管 → 第2級主管（到持有「一般假單決行」標籤的主管為止，最多 5 級）', warning: '' },
      {
        label: '第 2 關',
        approvers: '主管鏈：第3級主管（到持有「長假決行」標籤的主管為止，最多 5 級）',
        warning: '',
        condition: '請假滿 56 小時才需要',
        repeat: '已在前面關卡簽核的 2 位不會重複簽核',
      },
    ])
    expect(wrapper.find('[data-test="workflow-step-condition"]').text()).toBe('請假滿 56 小時才需要')
    expect(wrapper.find('[data-test="workflow-step-repeat"]').text()).toBe('已在前面關卡簽核的 2 位不會重複簽核')
  })

  it('does not warn about a required step that will be skipped because everyone already signed', async () => {
    installFetch([
      [isFormsList, json([LEAVE])],
      ['/api/approvals/forms/f-leave/fields', json([])],
      ['/api/approvals/forms/f-leave/workflow', json({ steps: [
        { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', is_required: true, resolved_count: 1, unresolved_reason: null },
        { step_order: 2, approver_type: 'user', approver_value: ['s1'], is_required: true, resolved_count: 1, unresolved_reason: null, repeated_count: 1, skipped_as_repeat: true },
      ] })],
    ])
    const wrapper = await mountPage()
    wrapper.vm.applyState.formId = 'f-leave'
    await wrapper.vm.onSelectForm()
    await flushPromises()

    expect(wrapper.vm.workflowSteps[1]).toMatchObject({ warning: '', repeat: '這一關的簽核人都已在前面的關卡簽核，送出時會自動略過' })
  })
})

describe('單據明細與我已簽核：第n級主管', () => {
  it('shows the level name and the note of each chain step in the detail of the approval page', async () => {
    installFetch([
      [(url) => url.endsWith('/api/approvals/r7'), json(REQUEST)],
    ])
    const wrapper = await mountPage()
    await wrapper.vm.openDetail('r7')
    await flushPromises()

    const timestamps = [...document.body.querySelectorAll('.el-timeline-item__timestamp')].map(node => node.textContent.trim())
    expect(timestamps).toEqual(['第 1 關・第2級主管', '第 2 關・第3級主管'])
    // 簽核頁的明細改用共用的 ApprovalDetailContent（與排班頁同一個元件），說明的 data-test 是 step-note
    expect(document.body.querySelector('[data-test="step-note"]').textContent.trim())
      .toBe('已略過留職停薪的護理長乙（E0036）（第1級主管），改由上一級主管簽核')
    const logText = document.body.querySelector('.detail-logs').textContent
    expect(logText).toContain('主管鏈')
    expect(logText).toContain('略過重複簽核人')
  })

  it('adds the level name after the decision in 我已簽核', async () => {
    installFetch([
      [(url) => url.includes('/api/approvals/history'), json({
        items: [{
          _id: 'r7', status: 'pending', form: { _id: 'f-leave', name: '請假' }, applicant_employee: { name: '護理師甲' },
          createdAt: '2026-11-05T01:00:00.000Z', updatedAt: '2026-11-05T02:00:00.000Z',
          my_approvals: [{ step_order: 1, step_name: '第2級主管', decision: 'approved', decided_at: '2026-11-05T02:00:00.000Z', comment: '' }],
        }, {
          _id: 'r8', status: 'approved', form: { _id: 'f-leave', name: '請假' }, applicant_employee: { name: '護理師乙' },
          createdAt: '2026-11-04T01:00:00.000Z', updatedAt: '2026-11-04T02:00:00.000Z',
          my_approvals: [{ step_order: 1, decision: 'approved', decided_at: '2026-11-04T02:00:00.000Z', comment: '' }],
        }],
        total: 2, page: 1, limit: 50,
      })],
    ])
    const wrapper = await mountPage('supervisor')
    await wrapper.vm.fetchHistory(1)
    await flushPromises()

    expect(wrapper.vm.historyList.map(row => wrapper.vm.historyDecisionText(row))).toEqual(['已核可（第2級主管）', '已核可'])
  })

  it('shows the level name and note in the detail used by the schedule page', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(json(REQUEST))
    const wrapper = mount(ApprovalDetailContent, { props: { approvalId: 'r7' }, global: { plugins: [ElementPlus] } })
    mounted.push(wrapper)
    await flushPromises()

    expect(wrapper.findAll('.el-timeline-item__timestamp').map(node => node.text())).toEqual(['第 1 關・第2級主管', '第 2 關・第3級主管'])
    expect(wrapper.find('[data-test="step-note"]').text()).toBe('已略過留職停薪的護理長乙（E0036）（第1級主管），改由上一級主管簽核')
  })
})

describe('approvalDetail 的關卡名稱與預覽文字', () => {
  it('keeps old steps exactly as before (no name, no note)', () => {
    expect(requestStepTitle({ step_order: 1 }, 0)).toBe('第 1 關')
    expect(requestStepTitle({ name: '  ' }, 2)).toBe('第 3 關')
    expect(requestStepNote({})).toBe('')
    expect(describeStepConditionPreview({ approver_type: 'tag' })).toBe('')
    expect(describeRepeatPreview({ resolved_count: 1 })).toBe('')
  })

  it('describes a chain without levels (no supervisor) and one without a stop tag', () => {
    expect(describeChainPreview({ approver_value: { stopAtTag: '一般假單決行', maxLevels: 5 }, chain_levels: [] }))
      .toBe('主管鏈（到持有「一般假單決行」標籤的主管為止，最多 5 級）')
    expect(describeChainPreview({ approver_value: { maxLevels: 3 }, chain_levels: [{ level: 1, label: '第1級主管' }] }))
      .toBe('主管鏈：第1級主管（最多 3 級）')
  })

  it('names the new log actions in Chinese', () => {
    expect(['step_not_applicable', 'step_condition', 'skip_repeated_approver', 'manager_chain'].map(actionLabel))
      .toEqual(['關卡不適用', '關卡照常簽核', '略過重複簽核人', '主管鏈'])
    const rows = buildLogRows({ logs: [{ action: 'step_not_applicable', message: '第2關不適用（請假未滿 56 小時，本次 52 小時）' }] })
    expect(rows[0]).toMatchObject({ actor: '系統', action: '關卡不適用', message: '第2關不適用（請假未滿 56 小時，本次 52 小時）' })
  })
})
