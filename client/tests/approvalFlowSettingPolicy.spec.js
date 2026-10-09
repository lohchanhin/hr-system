import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// 用真正的 Element Plus 與伺服器格式的 JSON 驗證：
// 1. 通用規則跟著 selectedFormId，不管是哪個下拉選單換掉表單
// 2. 補齊預設值報告的文字依 warning.type 分開計算

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

const FORM_A = 'f64b7f0f0f0f0f0f0f0f0a001'
const FORM_B = 'f64b7f0f0f0f0f0f0f0f0a002'
const POLICY_A = { maxApprovalLevel: 9, allowDelegate: true, overdueDays: 9, overdueAction: 'autoPass' }
const DEFAULT_POLICY = { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' }

let server
let restoreBody

function resetServer() {
  server = {
    forms: [
      { _id: FORM_A, name: '請假', category: '人事', is_active: true, semanticType: 'leave' },
      { _id: FORM_B, name: '加班申請', category: '人事', is_active: true, semanticType: 'overtime' },
    ],
    workflows: {
      [FORM_A]: { steps: [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }], policy: POLICY_A },
      // B 還沒有流程文件 → 404
    },
    // 想讓某張表單的 workflow GET 先等著時，放一個 deferred
    deferred: {},
  }
}

function installApi() {
  apiFetch.mockImplementation((url, opts) => {
    const method = opts?.method || 'GET'
    if (method === 'POST' && url === '/api/approvals/restore-defaults') return Promise.resolve(json(restoreBody))
    if (method !== 'GET') return Promise.resolve(json({ ok: true }))
    const workflowMatch = /^\/api\/approvals\/forms\/([^/]+)\/workflow$/.exec(url)
    if (workflowMatch) {
      const formId = workflowMatch[1]
      if (server.deferred[formId]) {
        return new Promise((resolve) => {
          server.deferred[formId].resolvers.push(resolve)
        })
      }
      const workflow = server.workflows[formId]
      return Promise.resolve(workflow ? json(workflow) : json({ error: '這張表單還沒有簽核流程' }, 404))
    }
    if (/^\/api\/approvals\/forms\/[^/]+\/fields$/.test(url)) return Promise.resolve(json([]))
    switch (url) {
      case '/api/approvals/forms': return Promise.resolve(json(server.forms))
      case '/api/employees/options': return Promise.resolve(json([]))
      case '/api/employees/sign-tags': return Promise.resolve(json({ tags: [] }))
      case '/api/approvals/sign-roles': return Promise.resolve(json([]))
      case '/api/approvals/sign-levels': return Promise.resolve(json([]))
      case '/api/departments': return Promise.resolve(json([]))
      case '/api/organizations': return Promise.resolve(json([]))
      case '/api/sub-departments': return Promise.resolve(json([]))
      case '/api/other-control-settings': return Promise.resolve(json({ customFields: [] }))
      case '/api/other-control-settings/item-settings': return Promise.resolve(json({}))
      case '/api/other-control-settings/form-categories': return Promise.resolve(json([{ id: 'c1', name: '人事', code: '人事' }]))
      default: return Promise.resolve(json({}, 404))
    }
  })
}

let warnSpy
beforeEach(() => {
  resetServer()
  restoreBody = { success: true, count: 0, createdCount: 0, preservedCount: 8, repairedCount: 0, forms: [], warnings: [], templates: [] }
  apiFetch.mockReset()
  installApi()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const workflowGets = (formId) => apiFetch.mock.calls.filter(
  ([url, opts]) => url === `/api/approvals/forms/${formId}/workflow` && !opts?.method
)
const workflowPuts = (formId) => apiFetch.mock.calls.filter(
  ([url, opts]) => url === `/api/approvals/forms/${formId}/workflow` && opts?.method === 'PUT'
)
const formSelects = (wrapper) => wrapper.findAllComponents({ name: 'ElSelect' })
  .filter((select) => select.props('placeholder') === '選擇表單樣板')

// 像使用者在下拉選單挑一個選項：el-select 先更新 v-model，再發出 change
function chooseForm(select, formId) {
  select.vm.$emit('update:modelValue', formId)
  select.vm.$emit('change', formId)
}

async function mountPage() {
  const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

describe('通用規則跟著目前選的表單，不管是哪個下拉選單換的', () => {
  it('畫面上有兩個表單選單（通用規則、欄位設定），共用同一個 selectedFormId', async () => {
    const wrapper = await mountPage()
    expect(formSelects(wrapper)).toHaveLength(2)
    expect(wrapper.vm.selectedFormId).toBe(FORM_A)
    expect(wrapper.vm.policyForm).toEqual(POLICY_A)
    expect(wrapper.vm.policyLoaded).toBe(true)
  })

  it('在「欄位設定」分頁換成 B：回到通用規則時顯示的是 B 的規則，儲存也只寫到 B', async () => {
    const wrapper = await mountPage()
    expect(workflowGets(FORM_B)).toHaveLength(0)

    wrapper.vm.activeTab = 'fields'
    await flushPromises()
    chooseForm(formSelects(wrapper)[1], FORM_B)
    await flushPromises()

    expect(wrapper.vm.selectedFormId).toBe(FORM_B)
    // B 還沒有流程文件：規則是預設值，不是 A 的
    expect(workflowGets(FORM_B).length).toBeGreaterThan(0)
    expect(wrapper.vm.policyForm).toEqual(DEFAULT_POLICY)
    expect(wrapper.vm.policyLoaded).toBe(true)

    wrapper.vm.activeTab = 'commonRule'
    await flushPromises()
    await wrapper.vm.savePolicy()
    await flushPromises()

    expect(workflowPuts(FORM_A)).toHaveLength(0)
    expect(workflowPuts(FORM_B)).toHaveLength(1)
    expect(JSON.parse(workflowPuts(FORM_B)[0][1].body)).toEqual({ policy: DEFAULT_POLICY })
  })

  it('B 的規則還沒讀回來時，A 的規則不在畫面上、也不能儲存；B 回來之後顯示 B 的', async () => {
    const wrapper = await mountPage()
    const resolvers = []
    server.deferred[FORM_B] = { resolvers }

    wrapper.vm.activeTab = 'fields'
    await flushPromises()
    chooseForm(formSelects(wrapper)[1], FORM_B)
    await flushPromises()

    expect(wrapper.vm.selectedFormId).toBe(FORM_B)
    expect(wrapper.vm.policyForm).toEqual(DEFAULT_POLICY)
    expect(wrapper.vm.policyLoaded).toBe(false)
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '儲存通用規則')
    expect(saveButton.attributes('disabled')).toBeDefined()

    await wrapper.vm.savePolicy()
    expect(ElMessage.error).toHaveBeenCalledWith('這張表單的通用規則還沒有成功載入，請重新選擇表單樣板後再儲存')
    expect(workflowPuts(FORM_A)).toHaveLength(0)
    expect(workflowPuts(FORM_B)).toHaveLength(0)

    const policyB = { maxApprovalLevel: 3, allowDelegate: false, overdueDays: 4, overdueAction: 'autoReject' }
    resolvers.forEach((resolve) => resolve(json({ steps: [], policy: policyB })))
    await flushPromises()
    expect(wrapper.vm.policyForm).toEqual(policyB)
    expect(wrapper.vm.policyLoaded).toBe(true)
  })

  it('在「通用流程規則」分頁的選單換表單，只讀一次規則（不重複讀）', async () => {
    const wrapper = await mountPage()
    server.workflows[FORM_B] = { steps: [], policy: { overdueDays: 6 } }

    chooseForm(formSelects(wrapper)[0], FORM_B)
    await flushPromises()

    expect(workflowGets(FORM_B)).toHaveLength(1)
    expect(wrapper.vm.policyForm).toEqual({ ...DEFAULT_POLICY, overdueDays: 6 })
    expect(wrapper.vm.policyLoaded).toBe(true)
  })

  it('程式直接換掉 selectedFormId（不是選單）也會讀新表單的規則', async () => {
    const wrapper = await mountPage()
    server.workflows[FORM_B] = { steps: [], policy: { overdueDays: 7 } }

    wrapper.vm.selectedFormId = FORM_B
    await flushPromises()

    expect(workflowGets(FORM_B)).toHaveLength(1)
    expect(wrapper.vm.policyForm).toEqual({ ...DEFAULT_POLICY, overdueDays: 7 })
  })

  it('從表單列表開「設定關卡」不會多讀一次規則', async () => {
    const wrapper = await mountPage()
    server.workflows[FORM_B] = { steps: [], policy: { overdueDays: 8 } }

    await wrapper.vm.openWorkflowDialog({ _id: FORM_B })
    await flushPromises()

    expect(workflowGets(FORM_B)).toHaveLength(1)
    expect(wrapper.vm.policyForm).toEqual({ ...DEFAULT_POLICY, overdueDays: 8 })
    expect(wrapper.vm.policyLoaded).toBe(true)
  })

  it('畫面上的規則不是目前這張表單的，就算 policyLoaded 為真也不儲存', async () => {
    const wrapper = await mountPage()
    // 模擬任何沒有重新讀規則就換掉表單的情況
    wrapper.vm.policyLoaded = true
    wrapper.vm.selectedFormId = FORM_B
    await wrapper.vm.savePolicy()

    expect(workflowPuts(FORM_A)).toHaveLength(0)
    expect(workflowPuts(FORM_B)).toHaveLength(0)
    expect(ElMessage.error).toHaveBeenCalledWith('這張表單的通用規則還沒有成功載入，請重新選擇表單樣板後再儲存')
    expect(warnSpy.mock.calls.map((call) => call.join(' ')).filter((text) => text.includes('[Vue warn]'))).toEqual([])
  })
})

describe('補齊預設值報告的文字依 warning.type 分開', () => {
  const TAG = (n) => ({
    type: 'tag_without_holder',
    form: `表單${n}`,
    formId: `t${n}`,
    step: 2,
    tag: `標籤${n}`,
    message: `「表單${n}」第 2 關需要有「標籤${n}」標籤的在職員工，目前沒有任何人持有，員工送出申請時會被擋下。請到員工管理為負責的人加上此標籤。`,
  })
  const INACTIVE = {
    type: 'inactive_template',
    form: '支援申請',
    formId: 'f9',
    message: '「支援申請」目前是停用狀態，員工看不到也無法申請，請到「編輯」重新啟用。',
  }
  const EMPTY = {
    type: 'empty_workflow',
    form: '獎金申請',
    formId: 'f10',
    message: '「獎金申請」目前沒有任何簽核關卡，員工無法送出申請，請到「設定關卡」補上。',
  }

  async function restoreWith(warnings) {
    restoreBody = { ...restoreBody, warnings }
    const wrapper = await mountPage()
    await wrapper.vm.restoreDefaults()
    await flushPromises()
    const report = wrapper.find('[data-test="restore-report"]')
    expect(report.exists()).toBe(true)
    return { wrapper, report, title: wrapper.vm.restoreReport.title, lead: report.find('[data-test="restore-report-lead"]') }
  }

  it('三個關卡找不到人、一張表單停用：標題分開計數，不說成「4 個關卡找不到人」，說明用中性的句子', async () => {
    const { report, title, lead } = await restoreWith([TAG(1), INACTIVE, TAG(2), TAG(3)])

    expect(title).toBe('補齊預設值完成，但有 4 項需要處理（3 個關卡找不到可簽核的人、1 張表單已停用）')
    expect(title).not.toContain('有 4 個關卡')
    expect(report.text()).toContain('3 個關卡找不到可簽核的人')
    expect(report.text()).toContain('1 張表單已停用')
    // 混合時不叫管理員去加標籤
    expect(lead.text()).toBe('下列項目需要處理（員工看不到這張表單，或送出申請時會被擋下），請依各項說明處理：')
    expect(lead.text()).not.toContain('員工管理')
    expect(lead.text()).not.toContain('標籤')
    // 每一項仍然顯示伺服器給的處理方式
    expect(report.text()).toContain('「支援申請」目前是停用狀態，員工看不到也無法申請，請到「編輯」重新啟用。')
    expect(report.findAll('.restore-report-list li')).toHaveLength(4)
  })

  it('三種都有：三種各自計數', async () => {
    const { title } = await restoreWith([TAG(1), TAG(2), INACTIVE, EMPTY])
    expect(title).toBe('補齊預設值完成，但有 4 項需要處理（2 個關卡找不到可簽核的人、1 張表單已停用、1 張表單沒有任何關卡）')
  })

  it('只有表單停用：標題與說明都不提「關卡」或簽核標籤', async () => {
    const { title, lead } = await restoreWith([INACTIVE])
    expect(title).toBe('補齊預設值完成，但有 1 項需要處理（1 張表單已停用）')
    expect(title).not.toContain('關卡')
    expect(lead.text()).toBe('下列表單目前是停用狀態，員工看不到也無法申請；需要使用的話，請到「編輯」重新啟用：')
    expect(lead.text()).not.toContain('標籤')
    expect(lead.text()).not.toContain('員工管理')
  })

  it('只有沒有任何關卡的表單：說明叫管理員去設定關卡', async () => {
    const { title, lead } = await restoreWith([EMPTY])
    expect(title).toBe('補齊預設值完成，但有 1 項需要處理（1 張表單沒有任何關卡）')
    expect(lead.text()).toBe('下列表單目前沒有任何簽核關卡，員工無法送出申請，請到「設定關卡」補上：')
  })

  it('只有關卡找不到人：維持原本的文字', async () => {
    const { title, lead } = await restoreWith([TAG(1), TAG(2)])
    expect(title).toBe('補齊預設值完成，但有 2 個關卡目前找不到可簽核的人')
    expect(lead.text()).toContain('請到「員工管理」為負責的人加上對應的簽核標籤')
  })

  it('舊版伺服器的警告沒有 type 但有 tag：當成關卡找不到人；其他不認得的類型算「其他問題」', async () => {
    const legacy = { ...TAG(1) }
    delete legacy.type
    const { title } = await restoreWith([legacy, { type: 'something_new', message: '新的提醒' }])
    expect(title).toBe('補齊預設值完成，但有 2 項需要處理（1 個關卡找不到可簽核的人、1 項其他問題）')
  })

  it('沒有警告：維持成功的文字', async () => {
    const { wrapper, report, title } = await restoreWith([])
    expect(title).toBe('補齊預設值完成，預設表單需要的簽核標籤都有人持有')
    expect(report.text()).toContain('所有預設表單需要的簽核標籤都已有在職員工持有')
    expect(wrapper.vm.restoreReport.warnings).toEqual([])
  })
})
