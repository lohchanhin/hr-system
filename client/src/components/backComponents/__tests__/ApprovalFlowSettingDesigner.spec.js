import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { computed, defineComponent, h, inject, provide } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ApprovalFlowSetting from '../ApprovalFlowSetting.vue'
import * as apiModule from '../../../api'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() }
}))

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

// 讓 el-table-column 的 slot 依 el-table 的 data 逐列渲染，才能驗證每一關裡的提醒文字
const ElTableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    provide('stubTableRows', computed(() => props.data || []))
    return () => h('table', slots.default?.())
  }
})
const ElTableColumnStub = defineComponent({
  setup(_, { slots }) {
    const rows = inject('stubTableRows', computed(() => []))
    return () => h('div', (rows.value || []).map((row, index) => slots.default?.({ row, $index: index })))
  }
})

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-select': { template: '<select><slot /></select>' },
  'el-option': { template: '<option><slot /></option>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-table': ElTableStub,
  'el-table-column': ElTableColumnStub,
  'el-dialog': { template: '<div><slot /><slot name="footer" /></div>', props: ['modelValue'] },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div><slot /></div>' },
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-tag': { template: '<span class="tag"><slot /></span>' },
  'el-alert': { template: '<div class="alert"><span>{{ title }}</span><slot /></div>', props: ['title', 'type'] }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const E1 = '64b7f0f0f0f0f0f0f0f0b001' // 在職主管
const E2 = '64b7f0f0f0f0f0f0f0f0b002' // 在職員工
const E3 = '64b7f0f0f0f0f0f0f0f0b003' // 離職員工
const E4 = '64b7f0f0f0f0f0f0f0f0b004' // 帳號停用
const GONE = '64b7f0f0f0f0f0f0f0f0bfff' // 已刪除的員工
const DEPT = '64b7f0f0f0f0f0f0f0f0c001'
const DEPT_ONLY_IN_LIST = '64b7f0f0f0f0f0f0f0f0c002' // 沒有任何員工的部門

const EMPLOYEES = [
  { id: E1, name: '王主管', username: 'boss', role: 'supervisor', signTags: ['人資'], department: { id: DEPT, name: '人資部' }, organization: 'org1', displayName: '王主管（boss）' },
  { id: E2, name: '李員工', username: 'lee', role: 'employee', signTags: [], department: { id: DEPT, name: '人資部' }, organization: 'org1', displayName: '李員工（lee）' },
  { id: E3, name: '陳離職', username: 'chen', role: 'supervisor', status: '離職員工', signTags: ['人資', '離職專用'], organization: 'org1', displayName: '陳離職（chen）' },
  { id: E4, name: '林停用', username: 'lin', role: 'employee', accountEnabled: false, status: '正職員工', signTags: [], organization: 'org1', displayName: '林停用（lin）' },
]

describe('ApprovalFlowSetting 流程設計', () => {
  let apiFetchMock
  // 各測試可改的伺服器狀態
  let server

  function resetServer() {
    server = {
      forms: [{ _id: 'form1', name: '加班申請', category: '人事', is_active: true, semanticType: 'overtime' }],
      workflow: {
        policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' },
        steps: [
          { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
          { step_order: 2, approver_type: 'tag', approver_value: '排班負責人' },
        ],
      },
      workflowStatus: 200,
      fields: [],
      employees: EMPLOYEES,
      tags: { tags: [{ name: '人資', count: 1, requiredByWorkflows: 3 }, { name: '財務覆核', count: 0, requiredByWorkflows: 1 }] },
      tagsStatus: 200,
      departments: [{ _id: DEPT, name: '人資部' }, { _id: DEPT_ONLY_IN_LIST, name: '新設部門' }],
      signRoles: [{ value: 'R001', label: '填報' }, { value: 'R004', label: '核定' }],
      signLevels: [{ value: 'U001', label: 'L1' }, { value: 'U002', label: 'L2' }],
      write: () => json({ ok: true }),
      writeCalls: [],
    }
  }

  function installApi() {
    apiFetchMock.mockImplementation((path, options = {}) => {
      const method = options?.method || 'GET'
      if (method !== 'GET') {
        server.writeCalls.push({ method, path, body: options.body ? JSON.parse(options.body) : undefined })
        return Promise.resolve(server.write(method, path))
      }
      switch (path) {
        case '/api/approvals/forms': return Promise.resolve(json(server.forms))
        case '/api/approvals/forms/form1/workflow':
          return Promise.resolve(server.workflowStatus === 200 ? json(server.workflow) : json({ error: 'x' }, server.workflowStatus))
        case '/api/approvals/forms/form1/fields': return Promise.resolve(json(server.fields))
        case '/api/employees/options': return Promise.resolve(json(server.employees))
        case '/api/employees/sign-tags':
          return Promise.resolve(server.tagsStatus === 200 ? json(server.tags) : json({ error: 'x' }, server.tagsStatus))
        case '/api/departments': return Promise.resolve(json(server.departments))
        case '/api/approvals/sign-roles': return Promise.resolve(json(server.signRoles))
        case '/api/approvals/sign-levels': return Promise.resolve(json(server.signLevels))
        case '/api/other-control-settings': return Promise.resolve(json({ customFields: [] }))
        case '/api/other-control-settings/item-settings': return Promise.resolve(json({}))
        case '/api/other-control-settings/form-categories': return Promise.resolve(json([{ id: 'c1', name: '人事', code: '人事' }]))
        default: return Promise.resolve(new Response('', { status: 404 }))
      }
    })
  }

  async function mountDesigner() {
    const wrapper = shallowMount(ApprovalFlowSetting, { global: { stubs: elementStubs } })
    await flushPromises()
    return wrapper
  }

  async function openWorkflow(wrapper) {
    await wrapper.vm.openWorkflowDialog({ _id: 'form1' })
    await flushPromises()
  }

  const writesTo = (method, path) => server.writeCalls.filter((call) => call.method === method && call.path === path)

  beforeEach(() => {
    resetServer()
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch')
    installApi()
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessageBox.confirm.mockReset()
    ElMessageBox.confirm.mockResolvedValue('confirm')
  })

  afterEach(() => {
    apiFetchMock.mockRestore()
  })

  describe('通用流程規則（W1）', () => {
    it('標示為「尚未啟用（僅記錄設定）」', async () => {
      const wrapper = await mountDesigner()

      const notice = wrapper.find('[data-test="policy-not-effective"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('尚未啟用（僅記錄設定）')
      expect(wrapper.findAll('.policy-tag').length).toBe(4)
    })

    it('儲存通用規則只送 policy（四個欄位），不帶 steps，成功才顯示成功訊息', async () => {
      const wrapper = await mountDesigner()
      wrapper.vm.policyForm.overdueDays = 7
      wrapper.vm.policyForm.overdueAction = 'autoPass'

      await wrapper.vm.savePolicy()

      const calls = writesTo('PUT', '/api/approvals/forms/form1/workflow')
      expect(calls).toHaveLength(1)
      expect(Object.keys(calls[0].body)).toEqual(['policy'])
      expect(calls[0].body.policy).toEqual({ maxApprovalLevel: 5, allowDelegate: false, overdueDays: 7, overdueAction: 'autoPass' })
      expect(ElMessage.success).toHaveBeenCalledWith('已儲存通用規則')
      expect(ElMessage.error).not.toHaveBeenCalled()
    })

    it('儲存通用規則失敗時顯示伺服器的錯誤，不顯示成功', async () => {
      server.write = () => json({ error: '逾時處理方式只能選不處理、自動通過或自動退回' }, 400)
      const wrapper = await mountDesigner()

      await wrapper.vm.savePolicy()

      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(ElMessage.error).toHaveBeenCalledTimes(1)
      expect(ElMessage.error.mock.calls[0][0]).toBe('儲存通用規則失敗：逾時處理方式只能選不處理、自動通過或自動退回')
    })

    it('儲存通用規則時網路中斷：顯示「儲存失敗，請檢查網路後再試」', async () => {
      const wrapper = await mountDesigner()
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))

      await wrapper.vm.savePolicy()

      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(ElMessage.error).toHaveBeenCalledWith('儲存失敗，請檢查網路後再試')
    })

    it('切換樣板時，上一張表單的規則不會殘留（沒有 policy 就回到預設值）', async () => {
      server.workflow = { steps: [], policy: { overdueDays: 9 } }
      const wrapper = await mountDesigner()
      expect(wrapper.vm.policyForm.overdueDays).toBe(9)

      server.workflow = { steps: [] }
      await wrapper.vm.loadWorkflow()

      expect(wrapper.vm.policyForm).toEqual({ maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' })
    })
  })

  describe('切換表單時的規則與關卡不會被慢回來的舊回應蓋掉', () => {
    const DEFAULT_POLICY = { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' }
    const tagStep = (tag) => ({ step_order: 1, approver_type: 'tag', approver_value: tag })

    // 掛載完成後，讓之後的 workflow GET 先等著，由測試決定何時、用什麼內容回覆
    function deferWorkflowRequests() {
      const pending = {}
      const base = apiFetchMock.getMockImplementation()
      apiFetchMock.mockImplementation((path, options = {}) => {
        const match = /^\/api\/approvals\/forms\/(\w+)\/workflow$/.exec(path)
        if (match && (options?.method || 'GET') === 'GET') {
          return new Promise((resolve) => {
            pending[match[1]] = pending[match[1]] || []
            pending[match[1]].push({ respond: (body, status = 200) => resolve(json(body, status)) })
          })
        }
        return base(path, options)
      })
      return pending
    }

    // 指定某張表單的 workflow GET 立刻回的內容（每次呼叫產生新的 Response）
    function serveWorkflow(formId, responder) {
      const base = apiFetchMock.getMockImplementation()
      apiFetchMock.mockImplementation((path, options = {}) => {
        if (path === `/api/approvals/forms/${formId}/workflow` && (options?.method || 'GET') === 'GET') {
          return Promise.resolve(responder())
        }
        return base(path, options)
      })
    }

    it('先開 A（回應很慢）再開 B：A 晚到的關卡與規則不會蓋掉 B，儲存也只會寫到 B', async () => {
      const wrapper = await mountDesigner()
      const pending = deferWorkflowRequests()

      const openA = wrapper.vm.openWorkflowDialog({ _id: 'form1' })
      const openB = wrapper.vm.openWorkflowDialog({ _id: 'form2' })
      await flushPromises()
      expect(wrapper.vm.selectedFormId).toBe('form2')
      expect(wrapper.vm.workflowLoaded).toBe(false)

      pending.form2[0].respond({ steps: [tagStep('人資')], policy: { overdueDays: 8 } })
      await openB
      expect(wrapper.vm.workflowLoaded).toBe(true)

      pending.form1[0].respond({ steps: [tagStep('排班負責人'), tagStep('財務覆核')], policy: { overdueDays: 2, overdueAction: 'autoPass' } })
      await openA
      await flushPromises()

      expect(wrapper.vm.selectedFormId).toBe('form2')
      expect(wrapper.vm.workflowSteps.map((step) => step.approver_value)).toEqual(['人資'])
      expect(wrapper.vm.policyForm).toEqual({ ...DEFAULT_POLICY, overdueDays: 8 })

      await wrapper.vm.saveWorkflow()
      const writes = writesTo('PUT', '/api/approvals/forms/form2/workflow')
      expect(writes).toHaveLength(1)
      expect(writes[0].body.steps.map((step) => step.approver_value)).toEqual(['人資'])
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
    })

    it('B 還沒回來時，A 先回來的內容也不能先顯示出來（儲存維持停用）', async () => {
      const wrapper = await mountDesigner()
      const pending = deferWorkflowRequests()

      const openA = wrapper.vm.openWorkflowDialog({ _id: 'form1' })
      const openB = wrapper.vm.openWorkflowDialog({ _id: 'form2' })
      await flushPromises()
      pending.form1[0].respond({ steps: [tagStep('排班負責人')], policy: { overdueDays: 2 } })
      await openA
      await flushPromises()

      expect(wrapper.vm.workflowSteps).toEqual([])
      expect(wrapper.vm.workflowLoaded).toBe(false)
      await wrapper.vm.saveWorkflow()
      expect(ElMessage.error).toHaveBeenCalledWith('流程關卡還沒有成功載入，請關閉後重新開啟再編輯')
      expect(server.writeCalls).toHaveLength(0)

      pending.form2[0].respond({ steps: [tagStep('人資')] })
      await openB
      expect(wrapper.vm.workflowSteps.map((step) => step.approver_value)).toEqual(['人資'])
    })

    it('A 晚到的失敗回應不會對 B 顯示錯誤，也不會清掉 B 的關卡', async () => {
      const wrapper = await mountDesigner()
      const pending = deferWorkflowRequests()

      const openA = wrapper.vm.openWorkflowDialog({ _id: 'form1' })
      const openB = wrapper.vm.openWorkflowDialog({ _id: 'form2' })
      await flushPromises()
      pending.form2[0].respond({ steps: [tagStep('人資')] })
      await openB
      ElMessage.error.mockClear()

      pending.form1[0].respond({ error: 'boom' }, 500)
      await openA
      await flushPromises()

      expect(ElMessage.error).not.toHaveBeenCalled()
      expect(wrapper.vm.workflowLoaded).toBe(true)
      expect(wrapper.vm.workflowSteps.map((step) => step.approver_value)).toEqual(['人資'])
    })

    it('同一張表單連開兩次，只採用最後一次的回應', async () => {
      const wrapper = await mountDesigner()
      const pending = deferWorkflowRequests()

      const first = wrapper.vm.openWorkflowDialog({ _id: 'form1' })
      const second = wrapper.vm.openWorkflowDialog({ _id: 'form1' })
      await flushPromises()
      pending.form1[1].respond({ steps: [tagStep('人資')] })
      await second
      pending.form1[0].respond({ steps: [tagStep('財務覆核')] })
      await first
      await flushPromises()

      expect(wrapper.vm.workflowSteps.map((step) => step.approver_value)).toEqual(['人資'])
    })

    it('通用規則：連續切換表單，慢回來的舊規則不會蓋掉現在這張', async () => {
      const wrapper = await mountDesigner()
      const pending = deferWorkflowRequests()

      wrapper.vm.selectedFormId = 'form1'
      const loadA = wrapper.vm.loadWorkflow()
      wrapper.vm.selectedFormId = 'form2'
      const loadB = wrapper.vm.loadWorkflow()
      await flushPromises()

      pending.form2[0].respond({ steps: [], policy: { overdueDays: 8 } })
      await loadB
      pending.form1[0].respond({ steps: [], policy: { overdueDays: 2, overdueAction: 'autoPass' } })
      await loadA
      await flushPromises()

      expect(wrapper.vm.policyForm).toEqual({ ...DEFAULT_POLICY, overdueDays: 8 })
      expect(wrapper.vm.policyLoaded).toBe(true)
    })

    it('沒有流程文件（404）的表單不會沿用上一張表單的規則，儲存的是預設值', async () => {
      server.workflow = { steps: [], policy: { overdueDays: 9, overdueAction: 'autoPass' } }
      const wrapper = await mountDesigner()
      expect(wrapper.vm.policyForm).toMatchObject({ overdueDays: 9, overdueAction: 'autoPass' })

      serveWorkflow('form2', () => json({ error: '這張表單還沒有簽核流程' }, 404))
      wrapper.vm.selectedFormId = 'form2'
      await wrapper.vm.loadWorkflow()

      expect(wrapper.vm.policyForm).toEqual(DEFAULT_POLICY)
      expect(wrapper.vm.policyLoaded).toBe(true)
      expect(ElMessage.error).not.toHaveBeenCalled()

      await wrapper.vm.savePolicy()
      const writes = writesTo('PUT', '/api/approvals/forms/form2/workflow')
      expect(writes).toHaveLength(1)
      expect(writes[0].body.policy).toEqual(DEFAULT_POLICY)
    })

    it('讀取失敗（非 404）時顯示錯誤、規則回到預設值，而且不能把它儲存到這張表單', async () => {
      server.workflow = { steps: [], policy: { overdueDays: 9, overdueAction: 'autoPass' } }
      const wrapper = await mountDesigner()

      serveWorkflow('form2', () => json({ error: '資料庫忙碌中' }, 500))
      wrapper.vm.selectedFormId = 'form2'
      await wrapper.vm.loadWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('載入通用規則失敗：資料庫忙碌中')
      expect(wrapper.vm.policyForm).toEqual(DEFAULT_POLICY)
      expect(wrapper.vm.policyLoaded).toBe(false)
      expect(wrapper.find('button[disabled]').exists()).toBe(true)

      ElMessage.error.mockClear()
      await wrapper.vm.savePolicy()
      expect(ElMessage.error).toHaveBeenCalledWith('這張表單的通用規則還沒有成功載入，請重新選擇表單樣板後再儲存')
      expect(writesTo('PUT', '/api/approvals/forms/form2/workflow')).toHaveLength(0)
    })

    it('網路中斷時也提示，而且規則不能儲存', async () => {
      const wrapper = await mountDesigner()
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
      wrapper.vm.selectedFormId = 'form2'
      await wrapper.vm.loadWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('載入失敗，請檢查網路後再試')
      expect(wrapper.vm.policyLoaded).toBe(false)
    })

    it('開啟沒有流程文件的表單：關卡從空白開始，通用規則也是預設值，不是上一張的', async () => {
      server.workflow = { steps: [tagStep('人資')], policy: { overdueDays: 9 } }
      const wrapper = await mountDesigner()
      expect(wrapper.vm.policyForm.overdueDays).toBe(9)

      serveWorkflow('form2', () => json({ error: '這張表單還沒有簽核流程' }, 404))
      await wrapper.vm.openWorkflowDialog({ _id: 'form2' })
      await flushPromises()

      expect(wrapper.vm.selectedFormId).toBe('form2')
      expect(wrapper.vm.workflowSteps).toEqual([])
      expect(wrapper.vm.workflowLoaded).toBe(true)
      expect(wrapper.vm.policyForm).toEqual(DEFAULT_POLICY)
      expect(wrapper.vm.policyLoaded).toBe(true)
    })
  })

  describe('儲存流程（W1 / W4）', () => {
    it('只送 steps，不帶 policy（通用規則在自己的分頁儲存）', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      wrapper.vm.workflowSteps[0].name = '  直屬主管 '

      await wrapper.vm.saveWorkflow()

      const call = writesTo('PUT', '/api/approvals/forms/form1/workflow')[0]
      expect(Object.keys(call.body)).toEqual(['steps'])
      expect(call.body.steps.map((step) => [step.step_order, step.approver_type, step.approver_value])).toEqual([
        [1, 'manager', 'APPLICANT_SUPERVISOR'],
        [2, 'tag', '排班負責人'],
      ])
      expect(call.body.steps[0].name).toBe('直屬主管')
      expect(call.body.steps[1]).not.toHaveProperty('name')
      expect(call.body.steps.every((step) => !('__meta' in step))).toBe(true)
      expect(wrapper.vm.workflowDialogVisible).toBe(false)
      expect(ElMessage.success).toHaveBeenCalledWith('流程已儲存')
    })

    it('伺服器拒絕時顯示中文錯誤、保持視窗開啟、不顯示成功', async () => {
      server.write = () => json({ error: '第2關（標籤）：請選擇或輸入簽核標籤', step: 2 }, 400)
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      await wrapper.vm.saveWorkflow()

      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(ElMessage.error).toHaveBeenCalledWith('儲存流程失敗：第2關（標籤）：請選擇或輸入簽核標籤')
      expect(wrapper.vm.workflowDialogVisible).toBe(true)
    })

    it('伺服器 500 且沒有錯誤文字時顯示預設中文訊息', async () => {
      server.write = () => new Response('', { status: 500 })
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      await wrapper.vm.saveWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('儲存流程失敗，請稍後再試')
      expect(wrapper.vm.workflowDialogVisible).toBe(true)
    })

    it('網路中斷時顯示「儲存失敗，請檢查網路後再試」並保持視窗開啟', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))

      await wrapper.vm.saveWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('儲存失敗，請檢查網路後再試')
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(wrapper.vm.workflowDialogVisible).toBe(true)
    })

    it('流程沒有成功載入時不能儲存（避免用空清單覆蓋伺服器上的流程）', async () => {
      server.workflowStatus = 500
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.workflowLoaded).toBe(false)
      await wrapper.vm.saveWorkflow()

      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
      expect(ElMessage.error).toHaveBeenCalledWith('流程關卡還沒有成功載入，請關閉後重新開啟再編輯')
    })

    it('開啟流程時網路中斷：顯示載入失敗，也不能儲存', async () => {
      const wrapper = await mountDesigner()
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))

      await wrapper.vm.openWorkflowDialog({ _id: 'form1' })
      await wrapper.vm.saveWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('載入失敗，請檢查網路後再試')
      expect(wrapper.vm.workflowLoaded).toBe(false)
    })

    it('這張表單還沒有流程（404）時從空白開始設定', async () => {
      server.workflowStatus = 404
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.workflowLoaded).toBe(true)
      expect(wrapper.vm.workflowSteps).toEqual([])
    })

    it('清空所有關卡再儲存時，先請管理者確認；取消就不送出', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      wrapper.vm.removeStep(1)
      wrapper.vm.removeStep(0)
      ElMessageBox.confirm.mockRejectedValueOnce('cancel')

      await wrapper.vm.saveWorkflow()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
      expect(wrapper.vm.workflowDialogVisible).toBe(true)

      ElMessageBox.confirm.mockResolvedValueOnce('confirm')
      await wrapper.vm.saveWorkflow()
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body).toEqual({ steps: [] })
    })

    it('關卡超過 20 關時不能再新增', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      for (let i = 0; i < 25; i += 1) wrapper.vm.addStep()

      expect(wrapper.vm.workflowSteps).toHaveLength(20)
      expect(ElMessage.error).toHaveBeenCalledWith('最多只能設定 20 關')
    })
  })

  describe('標籤關卡（W3 / K2）', () => {
    it('開啟編輯時已儲存的標籤不會被清掉，即使目前沒有人持有', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      const tagStep = wrapper.vm.workflowSteps[1]
      expect(tagStep.approver_type).toBe('tag')
      expect(tagStep.approver_value).toBe('排班負責人')
      expect(tagStep.__meta.hasApprover).toBe(true)
    })

    it('標籤選項 = 伺服器詞彙表 ∪ 員工標籤 ∪ 目前關卡使用的標籤，並帶出持有人數', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      const byValue = Object.fromEntries(wrapper.vm.tagOptions.map((opt) => [opt.value, opt]))
      expect(Object.keys(byValue).sort((a, b) => a.localeCompare(b, 'zh-Hant'))).toEqual(
        ['人資', '財務覆核', '排班負責人', '離職專用'].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      )
      expect(byValue['人資']).toMatchObject({ count: 1, label: '人資（1 人）' })
      expect(byValue['財務覆核']).toMatchObject({ count: 0, label: '財務覆核（0 人，目前沒有人持有）' })
      expect(byValue['排班負責人']).toMatchObject({ count: 0 })
      // 只有離職員工持有的標籤，可簽核人數是 0
      expect(byValue['離職專用']).toMatchObject({ count: 0 })
    })

    it('目前沒有人持有的標籤顯示警示，持有的標籤顯示人數', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('目前沒有人持有此標籤')
      wrapper.vm.workflowSteps[1].approver_value = '人資'
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('目前 1 人持有此標籤')
    })

    it('可以輸入還沒有人持有的新標籤（會做 NFKC / 去空白）', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      const step = wrapper.vm.workflowSteps[1]

      step.approver_value = '　新標籤　 一 '
      wrapper.vm.handleTagChange(step)

      expect(step.approver_value).toBe('新標籤 一')
      expect(wrapper.vm.tagOptions.map((opt) => opt.value)).toContain('新標籤 一')
    })

    it('伺服器的標籤清單讀取失敗時視為沒有額外標籤，仍可編輯並改用員工身上的標籤計數', async () => {
      server.tagsStatus = 500
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.signTagsLoaded).toBe(false)
      expect(wrapper.vm.tagOptions.map((opt) => opt.value).sort()).toEqual(['人資', '排班負責人', '離職專用'].sort())
      const byValue = Object.fromEntries(wrapper.vm.tagOptions.map((opt) => [opt.value, opt]))
      expect(byValue['人資'].count).toBe(1) // 離職員工不算
      expect(ElMessage.error).not.toHaveBeenCalled()
    })

    it('標籤清單與員工清單都讀不到時，不產生「沒人持有」的誤報，也不擋儲存', async () => {
      server.tagsStatus = 500
      server.employees = []
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.tagOptions.find((opt) => opt.value === '排班負責人').count).toBeNull()

      await wrapper.vm.saveWorkflow()

      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(1)
    })

    it('儲存時標籤沒人持有：用警告確認取代阻擋，確認後照樣儲存', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      await wrapper.vm.saveWorkflow()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
      expect(title).toBe('儲存前請確認')
      expect(options).toMatchObject({ confirmButtonText: '仍要儲存', cancelButtonText: '回去修改', type: 'warning' })
      const texts = JSON.stringify(message)
      expect(texts).toContain('第2關（標籤）')
      expect(texts).toContain('排班負責人')
      expect(texts).toContain('目前沒有任何在職員工持有')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(1)
      expect(wrapper.vm.workflowDialogVisible).toBe(false)
    })

    it('在警告確認按「回去修改」時不送出、視窗保持開啟', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      ElMessageBox.confirm.mockRejectedValueOnce('cancel')

      await wrapper.vm.saveWorkflow()

      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
      expect(wrapper.vm.workflowDialogVisible).toBe(true)
      expect(ElMessage.error).not.toHaveBeenCalled()
    })

    it('有人持有的標籤、或不必簽的關卡，不需要警告確認', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      wrapper.vm.workflowSteps[1].approver_value = '人資'

      await wrapper.vm.saveWorkflow()
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()

      wrapper.vm.workflowDialogVisible = true
      wrapper.vm.workflowSteps[1].approver_value = '排班負責人'
      wrapper.vm.workflowSteps[1].is_required = false
      await wrapper.vm.saveWorkflow()
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    })

    it('沒有填標籤時仍然擋下（只有空值會被擋）', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      wrapper.vm.workflowSteps[1].approver_value = ''

      await wrapper.vm.saveWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('第2關（標籤）缺少有效簽核人')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
    })

    it('換成「標籤」類型時，舊類型的值不會被當成標籤帶過來', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      const step = wrapper.vm.workflowSteps[0]

      step.approver_type = 'user'
      wrapper.vm.handleApproverTypeChange(step)
      expect(step.approver_value).toEqual([])
      step.approver_value = [E2]
      step.approver_type = 'tag'
      wrapper.vm.handleApproverTypeChange(step)

      expect(step.approver_value).toBe('')
    })
  })

  describe('角色 / 層級（W3 / K4）', () => {
    it('角色選項包含系統權限與簽核角色 R001–R007，層級選項是 U001–U005', async () => {
      const wrapper = await mountDesigner()

      expect(wrapper.vm.roleOptions.map((opt) => opt.value)).toEqual(['admin', 'supervisor', 'employee', 'R001', 'R004'])
      expect(wrapper.vm.roleOptions[0].label).toContain('系統權限')
      expect(wrapper.vm.roleOptions[3].label).toBe('簽核角色：填報（R001）')
      expect(wrapper.vm.levelOptions.map((opt) => opt.value)).toEqual(['U001', 'U002'])
    })

    it('每種簽核類型都有說明它會送給誰', async () => {
      const wrapper = await mountDesigner()

      for (const type of ['manager', 'user', 'tag', 'role', 'level', 'department', 'org', 'group']) {
        expect(wrapper.vm.approverTypeHint(type).length).toBeGreaterThan(10)
      }
      expect(wrapper.vm.approverTypeHint('role')).toContain('R001')
      expect(wrapper.vm.approverTypeHint('level')).toContain('U001')
      expect(wrapper.vm.approverTypeHint('tag')).toContain('員工管理')
    })

    it('範圍只在標籤 / 角色 / 層級 / 群組關卡出現，且沒有「群組」這個範圍值', async () => {
      const wrapper = await mountDesigner()

      // 伺服器解析簽核人時也會套用群組關卡的範圍，所以群組關卡保留並可編輯範圍
      expect(['tag', 'role', 'level', 'group'].every((type) => wrapper.vm.scopeApplies(type))).toBe(true)
      expect(['manager', 'user', 'department', 'org'].every((type) => !wrapper.vm.scopeApplies(type))).toBe(true)
      expect(wrapper.vm.scopeOptionsFor({ scope_type: 'dept' }).map((opt) => opt.value)).toEqual(['none', 'dept', 'org'])
    })

    it('群組關卡已存的範圍（同部門 / 同機構）保留並可編輯，儲存時不會被悄悄放寬成不限', async () => {
      const SUB = '64b7f0f0f0f0f0f0f0f0d001'
      server.workflow.steps = [
        { step_order: 1, approver_type: 'group', approver_value: [SUB], scope_type: 'dept' },
        { step_order: 2, approver_type: 'group', approver_value: [SUB], scope_type: 'org' },
        { step_order: 3, approver_type: 'department', approver_value: DEPT, scope_type: 'dept' },
      ]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.workflowSteps.map((step) => step.scope_type)).toEqual(['dept', 'org', 'dept'])
      expect(wrapper.vm.collectSaveIssues(wrapper.vm.workflowSteps).filter((issue) => issue.kind === 'remove')).toEqual([])
      wrapper.vm.workflowSteps[1].scope_type = 'dept' // 管理員改成同部門
      await wrapper.vm.saveWorkflow()

      const steps = writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps
      expect(steps.map((step) => [step.approver_type, step.scope_type])).toEqual([
        ['group', 'dept'],
        ['group', 'dept'],
        ['department', 'none'], // 部門關卡沒有範圍，照舊重設
      ])
    })

    it('換成不適用範圍的類型（群組 → 員工）時範圍重設為不限，換到適用的類型（標籤 → 群組）則保留', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      const step = wrapper.vm.workflowSteps[1]
      step.scope_type = 'org'

      step.approver_type = 'group'
      wrapper.vm.handleApproverTypeChange(step)
      expect(step.scope_type).toBe('org')

      step.approver_type = 'user'
      wrapper.vm.handleApproverTypeChange(step)
      expect(step.scope_type).toBe('none')
    })

    it('切換成不適用範圍的類型時，範圍重設為不限，儲存時也不會送出範圍', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      const step = wrapper.vm.workflowSteps[1]
      step.scope_type = 'dept'

      step.approver_type = 'user'
      wrapper.vm.handleApproverTypeChange(step)
      step.approver_value = [E2]
      await wrapper.vm.saveWorkflow()

      expect(step.scope_type).toBe('none')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps[1].scope_type).toBe('none')
    })

    it('舊資料的「群組」範圍標示為已失效，儲存時詢問並改為不限', async () => {
      server.workflow.steps[1] = { step_order: 2, approver_type: 'tag', approver_value: '人資', scope_type: 'group' }
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.scopeOptionsFor(wrapper.vm.workflowSteps[1]).find((opt) => opt.value === 'group')).toMatchObject({ disabled: true })
      expect(wrapper.vm.stepNotices(wrapper.vm.workflowSteps[1]).map((notice) => notice.text).join()).toContain('已失效：範圍「group」')

      await wrapper.vm.saveWorkflow()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      expect(ElMessageBox.confirm.mock.calls[0][2].confirmButtonText).toBe('移除失效項目並儲存')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps[1].scope_type).toBe('none')
    })
  })

  describe('調整順序（W3）', () => {
    it('可以上移 / 下移關卡，並依新順序重新編號後儲存', async () => {
      server.workflow.steps.push({ step_order: 3, approver_type: 'tag', approver_value: '人資' })
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      wrapper.vm.moveStep(2, -1)
      expect(wrapper.vm.workflowSteps.map((step) => step.approver_value)).toEqual(['APPLICANT_SUPERVISOR', '人資', '排班負責人'])
      wrapper.vm.moveStep(0, 1)
      expect(wrapper.vm.workflowSteps.map((step) => step.approver_type)).toEqual(['tag', 'manager', 'tag'])
      wrapper.vm.moveStep(0, -1) // 已在最上面，不動
      wrapper.vm.moveStep(2, 1) // 已在最下面，不動
      expect(wrapper.vm.workflowSteps.map((step) => step.step_order)).toEqual([1, 2, 3])

      await wrapper.vm.saveWorkflow()

      const steps = writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps
      expect(steps.map((step) => [step.step_order, step.approver_value])).toEqual([[1, '人資'], [2, 'APPLICANT_SUPERVISOR'], [3, '排班負責人']])
    })

    it('開啟時依儲存的 step_order 排好（與伺服器執行的順序一致）', async () => {
      server.workflow.steps = [
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
        { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      ]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.workflowSteps.map((step) => step.approver_type)).toEqual(['manager', 'tag'])
      expect(wrapper.vm.workflowSteps.map((step) => step.step_order)).toEqual([1, 2])
    })

    it('操作欄有上移 / 下移按鈕', async () => {
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      const text = wrapper.text()
      expect(text).toContain('上移')
      expect(text).toContain('下移')
    })
  })

  describe('已失效的設定不再被悄悄改寫（W3）', () => {
    it('已刪除的主管不會被悄悄換成「申請者的主管」，而是標示為已失效', async () => {
      server.workflow.steps = [{ step_order: 1, approver_type: 'manager', approver_value: GONE }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      await wrapper.vm.$nextTick()

      const step = wrapper.vm.workflowSteps[0]
      expect(step.approver_value).toBe(GONE)
      expect(step.__meta.staleValues).toEqual([GONE])
      expect(wrapper.vm.managerOptionsFor(step).find((opt) => opt.value === GONE)).toMatchObject({ disabled: true, label: `（已失效）${GONE}` })
      expect(wrapper.text()).toContain('已失效：指定的主管已找不到')
    })

    it('儲存時詢問：確認後把已失效的主管改為「申請者的主管」，取消則什麼都不送', async () => {
      server.workflow.steps = [{ step_order: 1, approver_type: 'manager', approver_value: GONE }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      ElMessageBox.confirm.mockRejectedValueOnce('cancel')

      await wrapper.vm.saveWorkflow()
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
      expect(wrapper.vm.workflowSteps[0].approver_value).toBe(GONE) // 沒有被悄悄改掉

      await wrapper.vm.saveWorkflow()
      const [message, , options] = ElMessageBox.confirm.mock.calls[1]
      expect(JSON.stringify(message)).toContain('儲存後會改為「申請者的主管」')
      expect(options.confirmButtonText).toBe('移除失效項目並儲存')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps[0].approver_value).toBe('APPLICANT_SUPERVISOR')
    })

    it('已被刪除的員工留在清單裡標示失效，確認後只移除這些人', async () => {
      server.workflow.steps = [{ step_order: 1, approver_type: 'user', approver_value: [E2, GONE] }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      const step = wrapper.vm.workflowSteps[0]
      expect(step.approver_value).toEqual([E2, GONE])
      expect(wrapper.vm.userOptionsFor(step).find((opt) => opt.value === GONE)).toMatchObject({ disabled: true })

      await wrapper.vm.saveWorkflow()

      expect(JSON.stringify(ElMessageBox.confirm.mock.calls[0][0])).toContain('有 1 位員工已找不到')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps[0].approver_value).toEqual([E2])
    })

    it('員工全部失效時直接擋下並說明原因，不送出', async () => {
      server.workflow.steps = [{ step_order: 1, approver_type: 'user', approver_value: [GONE] }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      await wrapper.vm.saveWorkflow()

      expect(ElMessage.error).toHaveBeenCalledWith('第1關（員工）缺少有效簽核人（原本選的對象已失效，請重新選擇）')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')).toHaveLength(0)
    })

    it('找不到的部門 / 角色 / 層級也不會被清空，而是標示失效', async () => {
      server.workflow.steps = [
        { step_order: 1, approver_type: 'department', approver_value: '64b7f0f0f0f0f0f0f0f0cabc' },
        { step_order: 2, approver_type: 'role', approver_value: 'R999' },
        { step_order: 3, approver_type: 'level', approver_value: 'U009' },
      ]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.workflowSteps.map((step) => step.approver_value)).toEqual(['64b7f0f0f0f0f0f0f0f0cabc', 'R999', 'U009'])
      expect(wrapper.vm.workflowSteps.map((step) => step.__meta.staleValues.length)).toEqual([1, 1, 1])
    })

    it('部門選項來自部門清單與員工的部門（沒有員工的部門也能選）', async () => {
      const wrapper = await mountDesigner()

      expect(wrapper.vm.departmentOptions).toEqual([
        { value: DEPT, label: '人資部' },
        { value: DEPT_ONLY_IN_LIST, label: '新設部門' },
      ])
    })

    it('選項還沒載入時無法判斷，不會誤判成失效', async () => {
      server.employees = []
      server.signRoles = []
      server.signLevels = []
      server.departments = []
      server.workflow.steps = [
        { step_order: 1, approver_type: 'role', approver_value: 'R004' },
        { step_order: 2, approver_type: 'level', approver_value: 'U002' },
        { step_order: 3, approver_type: 'user', approver_value: [E2] },
      ]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.workflowSteps.map((step) => step.__meta.staleValues)).toEqual([[], [], []])
    })
  })

  describe('不能簽核的人員（W3 / K1）', () => {
    it('離職、留職停薪、帳號停用的人在選項中灰掉並標明原因；在職的人維持原樣', async () => {
      const wrapper = await mountDesigner()

      const byValue = Object.fromEntries(wrapper.vm.userApproverOptions.map((opt) => [opt.value, opt]))
      expect(byValue[E1]).toEqual({ value: E1, label: '王主管（boss）' })
      expect(byValue[E3]).toEqual({ value: E3, label: '陳離職（chen）（已離職）', disabled: true })
      expect(byValue[E4]).toEqual({ value: E4, label: '林停用（lin）（帳號已停用）', disabled: true })
      const managers = Object.fromEntries(wrapper.vm.managerApproverOptions.map((opt) => [opt.value, opt]))
      expect(managers[E3].disabled).toBe(true)
      expect(managers[E1].disabled).toBeUndefined()
    })

    it('留職停薪的人同樣不能簽核', async () => {
      server.employees = [{ ...EMPLOYEES[1], status: '留職停薪' }]
      const wrapper = await mountDesigner()

      expect(wrapper.vm.userApproverOptions[0]).toMatchObject({ disabled: true })
      expect(wrapper.vm.userApproverOptions[0].label).toContain('留職停薪')
    })

    it('已儲存的簽核人後來離職：保留在清單中並標示，儲存時若整關都不能簽核會警告', async () => {
      server.workflow.steps = [{ step_order: 1, approver_type: 'user', approver_value: [E3, E4] }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.workflowSteps[0].approver_value).toEqual([E3, E4])
      expect(wrapper.text()).toContain('包含不能簽核的人員')

      await wrapper.vm.saveWorkflow()

      expect(JSON.stringify(ElMessageBox.confirm.mock.calls[0][0])).toContain('選擇的人員目前都不能簽核')
      expect(writesTo('PUT', '/api/approvals/forms/form1/workflow')[0].body.steps[0].approver_value).toEqual([E3, E4])
    })

    it('整關還有在職的人時不需要警告', async () => {
      server.workflow.steps = [{ step_order: 1, approver_type: 'user', approver_value: [E3, E2] }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      await wrapper.vm.saveWorkflow()

      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    })

    it('標籤只有離職員工持有時，持有人數為 0', async () => {
      server.tagsStatus = 500
      server.workflow.steps = [{ step_order: 1, approver_type: 'tag', approver_value: '離職專用' }]
      const wrapper = await mountDesigner()
      await openWorkflow(wrapper)

      expect(wrapper.vm.stepNotices(wrapper.vm.workflowSteps[0]).map((notice) => notice.text)).toContain('目前沒有人持有此標籤')
    })
  })

  describe('刪除樣板（W2 / W4）', () => {
    it('刪除前一定先確認，並說明「已有申請單時改為停用」', async () => {
      const wrapper = await mountDesigner()

      await wrapper.vm.removeForm({ _id: 'form1', name: '加班申請' })

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
      const text = JSON.stringify(message)
      expect(text).toContain('加班申請')
      expect(text).toContain('改為「停用」')
      expect(text).toContain('無法復原')
      expect(title).toBe('確認刪除表單樣板')
      expect(options).toMatchObject({ confirmButtonText: '確定刪除', type: 'warning' })
    })

    it('取消確認就不會送出刪除', async () => {
      const wrapper = await mountDesigner()
      ElMessageBox.confirm.mockRejectedValue('cancel')

      await wrapper.vm.removeForm({ _id: 'form1', name: '加班申請' })

      expect(writesTo('DELETE', '/api/approvals/forms/form1')).toHaveLength(0)
      expect(ElMessage.error).not.toHaveBeenCalled()
      expect(ElMessage.success).not.toHaveBeenCalled()
    })

    it('從上方「刪除樣板」按鈕（沒有帶列資料）刪除目前選的樣板', async () => {
      const wrapper = await mountDesigner()
      server.write = () => json({ success: true, deleted: true })

      await wrapper.vm.removeForm(new MouseEvent('click'))

      expect(writesTo('DELETE', '/api/approvals/forms/form1')).toHaveLength(1)
      expect(ElMessageBox.confirm.mock.calls[0][0]).toBeTruthy()
      expect(wrapper.vm.selectedFormId).toBe('')
    })

    it('沒有申請單時刪除成功：顯示成功並重新讀取列表', async () => {
      server.write = () => json({ success: true, deleted: true, deactivated: false })
      const wrapper = await mountDesigner()
      const loadsBefore = apiFetchMock.mock.calls.filter(([path, o]) => path === '/api/approvals/forms' && !o?.method).length

      await wrapper.vm.removeForm({ _id: 'form1', name: '加班申請' })

      expect(ElMessage.success).toHaveBeenCalledWith('已刪除表單樣板')
      expect(apiFetchMock.mock.calls.filter(([path, o]) => path === '/api/approvals/forms' && !o?.method).length).toBe(loadsBefore + 1)
      expect(wrapper.vm.selectedFormId).toBe('')
    })

    it('已有申請單時伺服器改為停用：顯示伺服器的說明，保留目前選取的樣板', async () => {
      server.write = () => json({ success: true, deleted: false, deactivated: true, requestCount: 5, pendingCount: 2, message: '這張表單已有 5 筆申請單，已改為停用而沒有刪除。' })
      const wrapper = await mountDesigner()

      await wrapper.vm.removeForm({ _id: 'form1', name: '加班申請' })

      expect(ElMessage.success).toHaveBeenCalledWith('這張表單已有 5 筆申請單，已改為停用而沒有刪除。')
      expect(wrapper.vm.selectedFormId).toBe('form1')
    })

    it('刪除失敗：顯示伺服器的錯誤，不顯示成功', async () => {
      server.write = () => json({ error: '找不到這張表單樣板' }, 404)
      const wrapper = await mountDesigner()

      await wrapper.vm.removeForm({ _id: 'form1', name: '加班申請' })

      expect(ElMessage.error).toHaveBeenCalledWith('刪除樣板失敗：找不到這張表單樣板')
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(wrapper.vm.selectedFormId).toBe('form1')
    })

    it('刪除時網路中斷：顯示「儲存失敗，請檢查網路後再試」', async () => {
      const wrapper = await mountDesigner()
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))

      await wrapper.vm.removeForm({ _id: 'form1', name: '加班申請' })

      expect(ElMessage.error).toHaveBeenCalledWith('儲存失敗，請檢查網路後再試')
      expect(ElMessage.success).not.toHaveBeenCalled()
    })
  })

  describe('樣板與欄位的寫入失敗都看得到（W4）', () => {
    it('新增樣板網路中斷：顯示訊息並保持視窗開啟', async () => {
      const wrapper = await mountDesigner()
      wrapper.vm.openFormDialog()
      wrapper.vm.formDialog.name = '補休申請'
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))

      await wrapper.vm.saveFormTemplate()

      expect(ElMessage.error).toHaveBeenCalledWith('儲存失敗，請檢查網路後再試')
      expect(wrapper.vm.formDialogVisible).toBe(true)
    })

    it('重複的樣板名稱顯示伺服器的中文訊息', async () => {
      server.write = () => json({ error: '已經有同名的表單樣板，請換一個名稱' }, 409)
      const wrapper = await mountDesigner()
      wrapper.vm.openFormDialog()
      wrapper.vm.formDialog.name = '加班申請'

      await wrapper.vm.saveFormTemplate()

      expect(ElMessage.error).toHaveBeenCalledWith('儲存樣板失敗：已經有同名的表單樣板，請換一個名稱')
      expect(wrapper.vm.formDialogVisible).toBe(true)
    })

    it('表單名稱空白時不送出', async () => {
      const wrapper = await mountDesigner()
      wrapper.vm.openFormDialog()
      wrapper.vm.formDialog.name = '   '

      await wrapper.vm.saveFormTemplate()

      expect(ElMessage.error).toHaveBeenCalledWith('請輸入表單名稱')
      expect(server.writeCalls).toHaveLength(0)
    })

    it('名稱前後的空白會去掉再送出', async () => {
      const wrapper = await mountDesigner()
      wrapper.vm.openFormDialog()
      wrapper.vm.formDialog.name = '  補休申請 '

      await wrapper.vm.saveFormTemplate()

      expect(writesTo('POST', '/api/approvals/forms')[0].body.name).toBe('補休申請')
    })

    it('儲存欄位網路中斷：顯示訊息並保持視窗開啟', async () => {
      const wrapper = await mountDesigner()
      wrapper.vm.selectedFormId = 'form1'
      wrapper.vm.openFieldDialog()
      wrapper.vm.fieldDialog.label = '備註'
      apiFetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))

      await wrapper.vm.saveField()

      expect(ElMessage.error).toHaveBeenCalledWith('儲存失敗，請檢查網路後再試')
      expect(wrapper.vm.fieldDialogVisible).toBe(true)
    })

    it('必填開關、排序、停用欄位網路中斷也有訊息，並以伺服器資料還原畫面', async () => {
      server.fields = [{ _id: 'a', label: 'A', type_1: 'text', order: 0 }, { _id: 'b', label: 'B', type_1: 'text', order: 1 }]
      const wrapper = await mountDesigner()
      wrapper.vm.selectedFormId = 'form1'
      await wrapper.vm.loadFields()
      const reject = () => apiFetchMock.mockImplementation((path, options = {}) => (
        options?.method ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(json(server.fields))
      ))
      reject()

      await wrapper.vm.updateField({ _id: 'a', label: 'A', type_1: 'text', required: true, order: 0 })
      await wrapper.vm.moveField(1, -1)
      await wrapper.vm.setFieldActive({ _id: 'a', label: 'A', type_1: 'text' }, false)
      await wrapper.vm.removeField({ _id: 'a', label: 'A' })

      expect(ElMessage.error).toHaveBeenCalledTimes(4)
      expect(ElMessage.error.mock.calls.every(([text]) => text === '儲存失敗，請檢查網路後再試')).toBe(true)
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(wrapper.vm.fields.map((field) => field._id)).toEqual(['a', 'b'])
    })

    it('載入表單樣板網路中斷：顯示訊息，其餘載入流程仍會繼續', async () => {
      apiFetchMock.mockImplementation((path) => (
        path === '/api/approvals/forms' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(json([]))
      ))

      const wrapper = await mountDesigner()

      expect(ElMessage.error).toHaveBeenCalledWith('載入失敗，請檢查網路後再試')
      expect(wrapper.vm.forms).toEqual([])
      expect(apiFetchMock.mock.calls.some(([path]) => path === '/api/employees/options')).toBe(true)
    })

    it('任一個選項清單讀取時網路中斷都不會讓整個編輯器壞掉', async () => {
      apiFetchMock.mockImplementation((path) => (
        ['/api/employees/options', '/api/employees/sign-tags', '/api/departments', '/api/approvals/sign-roles', '/api/organizations'].includes(path)
          ? Promise.reject(new TypeError('Failed to fetch'))
          : (path === '/api/approvals/forms' ? Promise.resolve(json(server.forms)) : Promise.resolve(json({})))
      ))

      const wrapper = await mountDesigner()

      expect(wrapper.vm.employeeOptions).toEqual([])
      expect(wrapper.vm.signTagInfo).toEqual([])
      expect(ElMessage.error).not.toHaveBeenCalled()
    })
  })

  describe('欄位刪除 / 停用（W2）', () => {
    beforeEach(() => {
      server.fields = [
        { _id: 'a', label: '事由', type_1: 'text', order: 0 },
        { _id: 'b', label: '舊欄位', type_1: 'text', order: 1, is_active: false },
      ]
    })

    async function mountFields() {
      const wrapper = await mountDesigner()
      wrapper.vm.activeTab = 'fields'
      wrapper.vm.selectedFormId = 'form1'
      await flushPromises()
      return wrapper
    }

    it('刪除前先確認，並說明已有申請單時會改為停用', async () => {
      const wrapper = await mountFields()

      await wrapper.vm.removeField({ _id: 'a', label: '事由' })

      const [message, title] = ElMessageBox.confirm.mock.calls[0]
      expect(title).toBe('確認刪除欄位')
      expect(JSON.stringify(message)).toContain('事由')
      expect(JSON.stringify(message)).toContain('改為「停用」')
      expect(writesTo('DELETE', '/api/approvals/forms/form1/fields/a')).toHaveLength(1)
    })

    it('取消確認就不會送出刪除，也不重新讀取', async () => {
      const wrapper = await mountFields()
      ElMessageBox.confirm.mockRejectedValue('cancel')

      await wrapper.vm.removeField({ _id: 'a', label: '事由' })

      expect(writesTo('DELETE', '/api/approvals/forms/form1/fields/a')).toHaveLength(0)
    })

    it('伺服器改為停用時顯示說明', async () => {
      server.write = () => json({ success: true, deactivated: true, message: '欄位「事由」已改為停用而沒有刪除。' })
      const wrapper = await mountFields()

      await wrapper.vm.removeField({ _id: 'a', label: '事由' })

      expect(ElMessage.success).toHaveBeenCalledWith('欄位「事由」已改為停用而沒有刪除。')
    })

    it('已停用的欄位在表格中灰掉並標示，可以重新啟用', async () => {
      const wrapper = await mountFields()

      expect(wrapper.text()).toContain('已停用')
      expect(wrapper.vm.fieldRowClass({ row: wrapper.vm.fields[1] })).toBe('field-row-inactive')
      expect(wrapper.vm.fieldRowClass({ row: wrapper.vm.fields[0] })).toBe('')

      await wrapper.vm.setFieldActive(wrapper.vm.fields[1], true)

      expect(writesTo('PUT', '/api/approvals/forms/form1/fields/b')[0].body).toEqual({ is_active: true })
      expect(ElMessage.success).toHaveBeenCalledWith('已啟用欄位')
    })

    it('欄位表格與視窗不再顯示用不到的「型別2」', async () => {
      const wrapper = await mountFields()

      wrapper.vm.openFieldDialog()
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).not.toContain('型別2')
    })
  })

  describe('補齊預設值（W5）', () => {
    const REPORT = {
      success: true,
      count: 2,
      createdCount: 2,
      preservedCount: 6,
      repairedCount: 1,
      forms: [],
      warnings: [
        { type: 'tag_without_holder', form: '加班申請', formId: 'f6', step: 2, tag: '排班負責人', message: '「加班申請」第 2 關需要有「排班負責人」標籤的在職員工，目前沒有任何人持有，員工送出申請時會被擋下。請到員工管理為負責的人加上此標籤。' },
      ],
      templates: [
        { key: 'leave', name: '請假', formId: 'f1', status: 'preserved', requiredTags: [{ tag: '人資', step: 2, holders: 3, required: true }] },
        { key: 'overtime', name: '加班申請', formId: 'f6', status: 'created', requiredTags: [{ tag: '排班負責人', step: 2, holders: 0, required: true }, { tag: '人資', step: 3, holders: 3, required: true }] },
        { key: 'x', name: '離職證明', formId: 'f5', status: 'created', requiredTags: [{ tag: '人資', step: 2, holders: null, required: true }] },
      ],
    }

    it('完成後顯示每張預設表單需要的標籤與持有人數，以及找不到簽核人的關卡', async () => {
      server.write = () => json(REPORT)
      const wrapper = await mountDesigner()

      await wrapper.vm.restoreDefaults()
      await flushPromises()

      expect(ElMessage.success).toHaveBeenCalledWith('已補齊預設值，新增 2 個，保留 6 個，補回 1 個表單的關卡')
      const report = wrapper.find('[data-test="restore-report"]')
      expect(report.exists()).toBe(true)
      const text = report.text()
      expect(text).toContain('有 1 個關卡目前找不到可簽核的人')
      expect(text).toContain('「加班申請」第 2 關需要有「排班負責人」標籤')
      expect(text).toContain('人資（3 人）')
      expect(text).toContain('排班負責人（0 人）')
      expect(text).toContain('人資（人數未知）')
    })

    it('沒有警告時顯示所有標籤都有人持有', async () => {
      server.write = () => json({ ...REPORT, warnings: [] })
      const wrapper = await mountDesigner()

      await wrapper.vm.restoreDefaults()
      await flushPromises()

      expect(wrapper.find('[data-test="restore-report"]').text()).toContain('所有預設表單需要的簽核標籤都已有在職員工持有')
      expect(wrapper.vm.restoreReport.warnings).toEqual([])
    })

    it('舊版伺服器沒有 warnings / templates 欄位時也能正常完成', async () => {
      server.write = () => json({ success: true, count: 8, createdCount: 8, preservedCount: 0 })
      const wrapper = await mountDesigner()

      await wrapper.vm.restoreDefaults()
      await flushPromises()

      expect(ElMessage.success).toHaveBeenCalledWith('已補齊預設值，新增 8 個，保留 0 個')
      expect(wrapper.vm.restoreReport).toMatchObject({ warnings: [], templates: [] })
    })

    it('補齊後重新讀取標籤與持有人數', async () => {
      server.write = () => json(REPORT)
      const wrapper = await mountDesigner()
      const before = apiFetchMock.mock.calls.filter(([path]) => path === '/api/employees/sign-tags').length

      await wrapper.vm.restoreDefaults()
      await flushPromises()

      expect(apiFetchMock.mock.calls.filter(([path]) => path === '/api/employees/sign-tags').length).toBe(before + 1)
    })

    it('伺服器失敗時顯示錯誤、不顯示報告', async () => {
      server.write = () => json({ error: 'Database error' }, 500)
      const wrapper = await mountDesigner()

      await wrapper.vm.restoreDefaults()
      await flushPromises()

      expect(ElMessage.error).toHaveBeenCalledWith('恢復失敗: Database error')
      expect(wrapper.vm.restoreReport).toBeNull()
    })
  })

  describe('表單性質名稱推斷（W7）', () => {
    it('銷假單、出差類名稱不會被當成請假單（與伺服器 inferSemanticType 一致）', async () => {
      const wrapper = await mountDesigner()
      wrapper.vm.openFormDialog()

      const cases = [
        ['銷假單', 'general'],
        ['公假出差申請', 'general'],
        ['出差(公假)', 'general'],
        ['出差申請', 'general'],
        ['出差加班申請', 'overtime'],
        ['公假', 'leave'],
        ['請假', 'leave'],
        ['特休申請', 'leave'],
      ]
      for (const [name, expected] of cases) {
        wrapper.vm.formDialog.name = name
        await wrapper.vm.$nextTick()
        expect(wrapper.vm.formDialog.semanticType, name).toBe(expected)
      }
    })
  })
})
