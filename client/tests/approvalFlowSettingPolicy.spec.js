import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// 用真正的 Element Plus 與伺服器格式的 JSON 驗證：
// 1. 表單的流程規則（略過重複的簽核人）跟著正在設定的那張表單
// 2. 補齊預設值報告的文字依 warning.type 分開計算

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

const FORM_A = 'f64b7f0f0f0f0f0f0f0f0a001'
const FORM_B = 'f64b7f0f0f0f0f0f0f0f0a002'
// 伺服器上仍存著的舊通用規則（畫面不再顯示，也不會被改掉）
const POLICY_A = { maxApprovalLevel: 9, allowDelegate: true, overdueDays: 9, overdueAction: 'autoPass' }

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

async function mountPage() {
  const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

// 2026/11 畫面重整：頁面上方的「表單樣板」選單，以及「尚未啟用（僅記錄設定）」的通用規則
// （最大簽核關卡數、代理簽核、逾時提醒、逾時處理方式；伺服器只儲存、沒有任何功能讀取）都拿掉了。
// 表單改從清單點進去設定；每張表單只剩會生效的「略過重複的簽核人」。
// 這一組測試原本用那四個欄位保護的事情，改用它驗證：規則跟著正在設定的表單、沒讀到規則不能儲存、
// 儲存只送這一個欄位（所以不顯示的舊設定原封不動）、不會寫到別張表單
describe('表單的流程規則跟著正在設定的那張表單', () => {
  it('不預選表單：畫面是表單清單，沒有表單樣板選單，也不再顯示沒有功能的通用規則', async () => {
    const wrapper = await mountPage()
    expect(formSelects(wrapper)).toHaveLength(0)
    expect(wrapper.vm.selectedFormId).toBe('')
    expect(wrapper.find('[data-test="form-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="form-editor"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="policy-not-effective"]').exists()).toBe(false)
    const text = wrapper.text()
    for (const removed of ['最大簽核關卡數', '是否允許代理簽核', '逾時提醒', '逾時處理方式', '儲存通用規則', '尚未啟用']) {
      expect(text, removed).not.toContain(removed)
    }
    // 清單的摘要：每張表單各讀一次流程
    expect(workflowGets(FORM_A)).toHaveLength(1)
    expect(workflowGets(FORM_B)).toHaveLength(1)
    const rows = wrapper.findAll('[data-test="form-table"] .el-table__body tr').map((row) => row.text())
    expect(rows.find((row) => row.includes('請假'))).toContain('1 關：直屬主管')
    expect(rows.find((row) => row.includes('加班申請'))).toContain('尚未設定關卡')
  })

  it('開過 A 再從清單開 B 的欄位：顯示的是 B 的規則，切換開關只寫到 B，而且只送這一個欄位', async () => {
    server.workflows[FORM_A].policy = { ...POLICY_A, skipRepeatedApprovers: true }
    const wrapper = await mountPage()

    await wrapper.vm.openFormEditor({ _id: FORM_A })
    await flushPromises()
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)
    expect(wrapper.vm.policyLoaded).toBe(true)

    await wrapper.vm.closeEditor()
    await flushPromises()
    expect(wrapper.vm.selectedFormId).toBe('')
    expect(wrapper.find('[data-test="form-list"]').exists()).toBe(true)

    await wrapper.vm.openFormEditor({ _id: FORM_B }, 'fields')
    await flushPromises()
    expect(wrapper.vm.selectedFormId).toBe(FORM_B)
    expect(wrapper.vm.activeTab).toBe('fields')
    // B 還沒有流程文件：規則是預設值，不是 A 的
    expect(wrapper.vm.skipRepeatedApprovers).toBe(false)
    expect(wrapper.vm.policyLoaded).toBe(true)

    wrapper.vm.skipRepeatedApprovers = true
    await wrapper.vm.saveSkipRepeated()
    await flushPromises()

    expect(workflowPuts(FORM_A)).toHaveLength(0)
    expect(workflowPuts(FORM_B)).toHaveLength(1)
    // 只送這一個欄位：最大簽核關卡數等不再顯示的設定不會被改掉
    expect(JSON.parse(workflowPuts(FORM_B)[0][1].body)).toEqual({ policy: { skipRepeatedApprovers: true } })
  })

  it('B 的規則還沒讀回來時，A 的規則不在畫面上、也不能儲存；B 回來之後顯示 B 的', async () => {
    server.workflows[FORM_A].policy = { ...POLICY_A, skipRepeatedApprovers: true }
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: FORM_A })
    await flushPromises()
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)

    const resolvers = []
    server.deferred[FORM_B] = { resolvers }
    wrapper.vm.selectedFormId = FORM_B
    await flushPromises()

    expect(wrapper.vm.skipRepeatedApprovers).toBe(false)
    expect(wrapper.vm.policyLoaded).toBe(false)
    // A 的關卡也不留在 B 底下
    expect(wrapper.vm.workflowSteps).toEqual([])
    expect(wrapper.vm.workflowLoaded).toBe(false)

    wrapper.vm.skipRepeatedApprovers = true
    await wrapper.vm.saveSkipRepeated()
    expect(ElMessage.error).toHaveBeenCalledWith('這張表單的流程規則還沒有成功載入，請回到表單清單重新開啟後再試')
    expect(wrapper.vm.skipRepeatedApprovers).toBe(false)
    expect(workflowPuts(FORM_A)).toHaveLength(0)
    expect(workflowPuts(FORM_B)).toHaveLength(0)

    resolvers.forEach((resolve) => resolve(json({ steps: [], policy: { skipRepeatedApprovers: true } })))
    await flushPromises()
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)
    expect(wrapper.vm.policyLoaded).toBe(true)
  })

  it('程式直接換掉 selectedFormId 也會讀新表單的規則', async () => {
    server.workflows[FORM_B] = { steps: [], policy: { skipRepeatedApprovers: true } }
    const wrapper = await mountPage()
    const before = workflowGets(FORM_B).length

    wrapper.vm.selectedFormId = FORM_B
    await flushPromises()

    expect(workflowGets(FORM_B)).toHaveLength(before + 1)
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)
  })

  it('從表單清單開「設定關卡」只讀一次流程（關卡與規則一起讀，不重複讀）', async () => {
    server.workflows[FORM_B] = { steps: [], policy: { skipRepeatedApprovers: true } }
    const wrapper = await mountPage()
    const before = workflowGets(FORM_B).length

    await wrapper.vm.openWorkflowDialog({ _id: FORM_B })
    await flushPromises()

    expect(workflowGets(FORM_B)).toHaveLength(before + 1)
    expect(wrapper.vm.skipRepeatedApprovers).toBe(true)
    expect(wrapper.vm.policyLoaded).toBe(true)
  })

  it('畫面上的規則不是目前這張表單的，就算 policyLoaded 為真也不儲存', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: FORM_A })
    await flushPromises()
    // 模擬任何沒有重新讀規則就換掉表單的情況
    wrapper.vm.policyLoaded = true
    wrapper.vm.selectedFormId = FORM_B
    wrapper.vm.skipRepeatedApprovers = true
    await wrapper.vm.saveSkipRepeated()

    expect(workflowPuts(FORM_A)).toHaveLength(0)
    expect(workflowPuts(FORM_B)).toHaveLength(0)
    expect(ElMessage.error).toHaveBeenCalledWith('這張表單的流程規則還沒有成功載入，請回到表單清單重新開啟後再試')
    expect(warnSpy.mock.calls.map((call) => call.join(' ')).filter((text) => text.includes('[Vue warn]'))).toEqual([])
  })

  it('關卡有尚未儲存的變更時，回到清單前先問；不放棄就留在原本的表單', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: FORM_A })
    await flushPromises()
    ElMessageBox.confirm.mockClear()

    // 沒有變更：直接回到清單
    await wrapper.vm.closeEditor()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(wrapper.vm.selectedFormId).toBe('')

    await wrapper.vm.openFormEditor({ _id: FORM_A })
    await flushPromises()
    wrapper.vm.addStep()
    await flushPromises()
    expect(wrapper.vm.stepsDirty).toBe(true)
    expect(wrapper.find('[data-test="steps-dirty"]').exists()).toBe(true)

    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await wrapper.vm.closeEditor()
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(ElMessageBox.confirm.mock.calls[0][0]).toContain('尚未儲存的變更')
    expect(wrapper.vm.selectedFormId).toBe(FORM_A)
    expect(wrapper.vm.workflowSteps).toHaveLength(2)

    await wrapper.vm.closeEditor()
    expect(wrapper.vm.selectedFormId).toBe('')
    expect(workflowPuts(FORM_A)).toHaveLength(0)
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
