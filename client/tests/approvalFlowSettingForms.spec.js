import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import ApprovalFlowSetting from '../src/components/backComponents/ApprovalFlowSetting.vue'

// 簽核流程設定（2026/11 重整）：表單清單與摘要、進入一張表單的設定、請假表單系統欄位的保護、
// 欄位排序與新增的排序值、慢回來的欄位回應、停用 / 啟用、分類已刪除的表單

vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../src/api'

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

const LEAVE = 'f-leave'
const OVERTIME = 'f-ot'
const OLD = 'f-old'
const EMPLOYEES = [
  { id: 'e1', name: '王主管', username: 'boss', role: 'supervisor', signTags: ['人資'], department: { id: 'd1', name: '護理部' }, organization: 'o1' },
  { id: 'e2', name: '李員工', username: 'lee', role: 'employee', signTags: [], department: { id: 'd1', name: '護理部' }, organization: 'o1' },
]

let forms
let workflows
let fieldsByForm
let fieldResponders
let writeResponse

const leaveFields = () => [
  { _id: 'type', label: '假別', type_1: 'select', required: true, order: 0, options: ['特休假', '病假'] },
  { _id: 'start', label: '開始時間', type_1: 'datetime', required: true, order: 1 },
  { _id: 'end', label: '結束時間', type_1: 'datetime', required: true, order: 2 },
  { _id: 'hours', label: '時數', type_1: 'number', required: false, order: 3 },
  { _id: 'reason', label: '事由', type_1: 'textarea', required: false, order: 7 },
]

function installApi() {
  apiFetch.mockImplementation((url, options) => {
    const method = options?.method || 'GET'
    if (method !== 'GET') return Promise.resolve(writeResponse(url, options))
    const workflowMatch = /^\/api\/approvals\/forms\/([^/]+)\/workflow$/.exec(url)
    if (workflowMatch) {
      const workflow = workflows[workflowMatch[1]]
      return Promise.resolve(workflow ? json(workflow) : json({ error: '這張表單還沒有簽核流程' }, 404))
    }
    const fieldsMatch = /^\/api\/approvals\/forms\/([^/]+)\/fields$/.exec(url)
    if (fieldsMatch) {
      const responder = fieldResponders[fieldsMatch[1]]
      if (responder) return responder()
      return Promise.resolve(json(JSON.parse(JSON.stringify(fieldsByForm[fieldsMatch[1]] || []))))
    }
    switch (url) {
      case '/api/approvals/forms': return Promise.resolve(json(forms))
      case '/api/employees/options': return Promise.resolve(json(EMPLOYEES))
      case '/api/employees/sign-tags': return Promise.resolve(json({ tags: [{ name: '人資', count: 1, requiredByWorkflows: 1 }] }))
      case '/api/departments': return Promise.resolve(json([{ _id: 'd1', name: '護理部' }]))
      case '/api/other-control-settings': return Promise.resolve(json({ customFields: [] }))
      case '/api/other-control-settings/item-settings': return Promise.resolve(json({}))
      case '/api/other-control-settings/form-categories': return Promise.resolve(json([{ id: 'c1', name: '人事類', code: '人事' }]))
      case '/api/approvals/top-level-approvers': return Promise.resolve(json({ ids: [], approvers: [], admins: [], maxCount: 50 }))
      default: return Promise.resolve(json([]))
    }
  })
}

const writes = () => apiFetch.mock.calls
  .filter(([, options]) => options?.method && options.method !== 'GET')
  .map(([url, options]) => ({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined }))

beforeEach(() => {
  forms = [
    { _id: OVERTIME, name: '加班申請', category: '人事', is_active: true, semanticType: 'overtime', description: '申請加班時數' },
    { _id: OLD, name: '舊表單', category: '已經不存在的分類', is_active: false, semanticType: 'general' },
    { _id: LEAVE, name: '請假', category: '人事', is_active: true, semanticType: 'leave' },
  ]
  workflows = {
    [LEAVE]: { steps: [
      { step_order: 2, approver_type: 'tag', approver_value: '人資', scope_type: 'none' },
      { step_order: 1, approver_type: 'manager_chain', approver_value: { stopAtTag: '一般假單決行', maxLevels: 5 } },
      { step_order: 3, approver_type: 'user', approver_value: ['e1'], condition: { kind: 'leave_hours_gte', value: 56 } },
    ] },
    [OVERTIME]: { steps: [{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }] },
    // 舊表單沒有流程文件 → 404
  }
  fieldsByForm = { [LEAVE]: leaveFields(), [OVERTIME]: [{ _id: 'o1', label: '加班原因', type_1: 'text', order: 0 }], [OLD]: [] }
  fieldResponders = {}
  writeResponse = () => json({ ok: true })
  apiFetch.mockReset()
  installApi()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
  vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function mountPage() {
  const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

const listRows = (wrapper) => wrapper.findAll('[data-test="form-table"] .el-table__body tr')

describe('表單清單', () => {
  it('列出每張表單的分類、狀態、關卡摘要與欄位數；啟用中的在前、依名稱排序，不跟著最後修改時間跳動', async () => {
    const wrapper = await mountPage()
    const rows = listRows(wrapper).map((row) => row.text())

    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('加班申請')
    expect(rows[0]).toContain('人事類')
    expect(rows[0]).toContain('啟用')
    expect(rows[0]).toContain('1 關：直屬主管')
    expect(rows[0]).toContain('1 個')
    // 關卡依 step_order 排好；主管鏈帶停止標籤、有條件的關卡帶條件、指定員工帶姓名
    expect(rows[1]).toContain('請假')
    expect(rows[1]).toContain('3 關：主管鏈（到「一般假單決行」） → 人資 → 王主管（滿 56 小時）')
    expect(rows[1]).toContain('5 個')
    expect(rows[2]).toContain('舊表單')
    expect(rows[2]).toContain('停用')
    expect(rows[2]).toContain('尚未設定關卡（員工無法送出）')
    expect(rows[2]).toContain('0 個')
    // 上方的統計
    expect(wrapper.vm.forms).toHaveLength(3)
    expect(wrapper.vm.activeFormCount).toBe(2)
  })

  it('可以用名稱搜尋；找不到時說明，不是空白', async () => {
    const wrapper = await mountPage()
    wrapper.vm.formKeyword = '請假'
    await flushPromises()
    expect(listRows(wrapper).map((row) => row.find('.form-name').text())).toEqual(['請假'])

    wrapper.vm.formKeyword = '沒有這張'
    await flushPromises()
    expect(wrapper.find('[data-test="form-list-empty"]').text()).toBe('找不到符合的表單')
  })

  it('按「設定關卡」「設定欄位」進入那張表單的設定，「返回表單清單」回到清單', async () => {
    const wrapper = await mountPage()
    await listRows(wrapper)[1].find('[data-test="form-open-steps"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.selectedFormId).toBe(LEAVE)
    expect(wrapper.find('[data-test="form-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="editor-form-name"]').text()).toBe('請假')
    expect(wrapper.findAll('[data-test="step-card"]')).toHaveLength(3)
    expect(wrapper.vm.activeTab).toBe('approvalLevels')

    await wrapper.find('[data-test="back-to-list"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.selectedFormId).toBe('')

    await listRows(wrapper)[0].find('[data-test="form-open-fields"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.selectedFormId).toBe(OVERTIME)
    expect(wrapper.vm.activeTab).toBe('fields')
    expect(wrapper.vm.fields.map((field) => field.label)).toEqual(['加班原因'])
  })

  it('停用前先確認並說明後果，只送 is_active；啟用不用確認', async () => {
    const wrapper = await mountPage()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await wrapper.vm.toggleFormActive(forms[0])
    expect(writes()).toEqual([])
    expect(ElMessageBox.confirm.mock.calls[0][0]).toContain('停用後員工不會再看到「加班申請」')

    await wrapper.vm.toggleFormActive(forms[0])
    expect(writes()).toEqual([{ url: `/api/approvals/forms/${OVERTIME}`, method: 'PUT', body: { is_active: false } }])
    expect(ElMessage.success).toHaveBeenLastCalledWith('已停用表單')

    ElMessageBox.confirm.mockClear()
    await wrapper.vm.toggleFormActive(forms[1])
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(writes()[1]).toEqual({ url: `/api/approvals/forms/${OLD}`, method: 'PUT', body: { is_active: true } })
  })

  it('儲存關卡後清單的摘要跟著更新，不用重新整理', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: OVERTIME })
    await flushPromises()
    wrapper.vm.addStep()
    const added = wrapper.vm.workflowSteps[1]
    added.approver_type = 'tag'
    wrapper.vm.handleApproverTypeChange(added)
    added.approver_value = '人資'
    await wrapper.vm.saveWorkflow()
    await flushPromises()
    await wrapper.vm.closeEditor()
    await flushPromises()

    expect(listRows(wrapper)[0].text()).toContain('2 關：直屬主管 → 人資')
  })

  it('分類已經不在分類清單裡的表單：編輯時看得到原本的分類（標明不在清單裡），不會顯示成空白或被悄悄換掉', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openFormDialog('edit', forms[1])
    await flushPromises()

    expect(wrapper.vm.formDialog.category).toBe('已經不存在的分類')
    expect(wrapper.vm.formCategoryOptions).toEqual([
      expect.objectContaining({ value: '人事', label: '人事類' }),
      { value: '已經不存在的分類', label: '已經不存在的分類（不在分類清單裡）' },
    ])
    await wrapper.vm.saveFormTemplate()
    expect(writes()[0].body.category).toBe('已經不存在的分類')
  })

  it('新增表單連按兩下只送一次；新增後直接進入新表單的欄位設定', async () => {
    writeResponse = (url, options) => {
      const created = { _id: 'f-new', ...JSON.parse(options.body) }
      forms = [...forms, created]
      fieldsByForm['f-new'] = []
      return json(created, 201)
    }
    const wrapper = await mountPage()
    wrapper.vm.openFormDialog()
    wrapper.vm.formDialog.name = '用印申請'
    const first = wrapper.vm.saveFormTemplate()
    const second = wrapper.vm.saveFormTemplate()
    await Promise.all([first, second])
    await flushPromises()

    expect(writes().filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(wrapper.vm.selectedFormId).toBe('f-new')
    expect(wrapper.vm.activeTab).toBe('fields')
    expect(wrapper.find('[data-test="editor-form-name"]').text()).toBe('用印申請')
  })
})

describe('流程試算', () => {
  it('試算選的表單被刪除後清掉選擇，不留下一串編號', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openTrialFor(forms[0])
    await flushPromises()
    expect(wrapper.vm.trial.formId).toBe(OVERTIME)

    writeResponse = () => {
      forms = forms.filter((form) => form._id !== OVERTIME)
      return json({ success: true, deleted: true })
    }
    await wrapper.vm.removeForm(forms[0])
    await flushPromises()

    expect(wrapper.vm.forms.map((form) => form._id)).not.toContain(OVERTIME)
    expect(wrapper.vm.trial.formId).toBe('')
  })
})

describe('欄位：請假表單的系統欄位', () => {
  async function openLeaveFields() {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: LEAVE }, 'fields')
    await flushPromises()
    return wrapper
  }

  it('標示假別、開始時間、結束時間、時數是系統欄位；一般欄位與非請假表單的欄位不標示', async () => {
    const wrapper = await openLeaveFields()
    const tags = wrapper.findAll('[data-test="field-system-tag"]')
    expect(tags.map((tag) => tag.text())).toEqual(['系統欄位', '系統欄位', '系統欄位', '系統欄位'])
    // 滑到標籤上看得到它的用途與限制
    expect(tags.map((tag) => tag.attributes('title').split('：')[0])).toEqual(['假別', '開始時間', '結束時間', '請假時數'])
    expect(tags[1].attributes('title')).toContain('請假單用這個欄位計算請假期間')
    const taggedRows = wrapper.findAll('[data-test="field-table"] .el-table__body tr')
      .filter((row) => row.find('[data-test="field-system-tag"]').exists())
      .map((row) => row.text())
    expect(taggedRows.map((text) => text.includes('事由'))).toEqual([false, false, false, false])

    await wrapper.vm.closeEditor()
    await wrapper.vm.openFormEditor({ _id: OVERTIME }, 'fields')
    await flushPromises()
    expect(wrapper.findAll('[data-test="field-system-tag"]')).toHaveLength(0)
  })

  it('不能刪除、停用系統欄位，也不能取消假別與起訖時間的必填：說明原因，不送出請求', async () => {
    const wrapper = await openLeaveFields()
    const start = wrapper.vm.fields.find((field) => field._id === 'start')
    ElMessageBox.confirm.mockClear()

    await wrapper.vm.removeField(start)
    await wrapper.vm.setFieldActive(start, false)
    await wrapper.vm.setFieldRequired(start, false)

    expect(writes()).toEqual([])
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledTimes(3)
    expect(ElMessage.error.mock.calls[0][0]).toContain('「開始時間」是請假單的系統欄位，不能刪除：請假單用這個欄位計算請假期間')
    expect(ElMessage.error.mock.calls[1][0]).toContain('不能停用')
    expect(ElMessage.error.mock.calls[2][0]).toContain('不能取消必填')
    expect(start.required).toBe(true)

    // 時數可以改成選填（沒填時依起訖時間推算）；一般欄位照常
    const hours = wrapper.vm.fields.find((field) => field._id === 'hours')
    await wrapper.vm.setFieldRequired(hours, true)
    const reason = wrapper.vm.fields.find((field) => field._id === 'reason')
    await wrapper.vm.removeField(reason)
    expect(writes().map((call) => `${call.method} ${call.url}`)).toEqual([
      `PUT /api/approvals/forms/${LEAVE}/fields/hours`,
      `DELETE /api/approvals/forms/${LEAVE}/fields/reason`,
    ])
  })

  it('編輯系統欄位：改成系統認不得的名稱或型別時擋下；改成同樣認得的名稱（開始日期）可以', async () => {
    const wrapper = await openLeaveFields()
    const start = wrapper.vm.fields.find((field) => field._id === 'start')

    wrapper.vm.openFieldDialog('edit', start)
    await flushPromises()
    expect(wrapper.vm.fieldDialogSystemRole.name).toBe('開始時間')
    wrapper.vm.fieldDialog.label = '請假從哪天'
    await wrapper.vm.saveField()
    expect(writes()).toEqual([])
    expect(ElMessage.error.mock.calls.at(-1)[0]).toContain('不能改成這個名稱')

    wrapper.vm.fieldDialog.label = '開始時間'
    wrapper.vm.fieldDialog.type_1 = 'text'
    await wrapper.vm.saveField()
    expect(writes()).toEqual([])
    expect(ElMessage.error.mock.calls.at(-1)[0]).toContain('不能改成這個型別')

    wrapper.vm.fieldDialog.type_1 = 'date'
    wrapper.vm.fieldDialog.label = '開始日期'
    await wrapper.vm.saveField()
    expect(writes()).toHaveLength(1)
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: `/api/approvals/forms/${LEAVE}/fields/start`, body: { label: '開始日期', type_1: 'date', required: true } })
  })

  it('同一個用途另有啟用中的欄位時（把「假別」換成連結字典的「假別類別 (C12)」）可以停用舊的', async () => {
    fieldsByForm[LEAVE] = [
      ...leaveFields(),
      { _id: 'type2', label: '假別類別 (C12)', type_1: 'select', required: true, order: 8, dictionaryKey: 'C12', optionsSource: 'dictionary', options: ['特休假'] },
    ]
    const wrapper = await openLeaveFields()
    const oldType = wrapper.vm.fields.find((field) => field._id === 'type')

    await wrapper.vm.setFieldActive(oldType, false)

    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(writes()).toEqual([{ method: 'PUT', url: `/api/approvals/forms/${LEAVE}/fields/type`, body: { is_active: false } }])
  })
})

describe('欄位：排序與載入', () => {
  it('新欄位排在最後：排序值用目前最大值加一（排序值不連續時不會撞號插到中間）', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: LEAVE }, 'fields')
    await flushPromises()

    wrapper.vm.openFieldDialog()
    wrapper.vm.fieldDialog.label = '代理人'
    await wrapper.vm.saveField()

    // 現有欄位的排序值是 0、1、2、3、7：新欄位是 8，不是欄位數 5
    expect(writes()[0]).toMatchObject({ method: 'POST', body: { label: '代理人', order: 8 } })
  })

  it('上移 / 下移只儲存排序值有變的欄位；上一次還在儲存時不接受下一次', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: LEAVE }, 'fields')
    await flushPromises()

    const first = wrapper.vm.moveField(1, -1)
    const second = wrapper.vm.moveField(1, -1)
    await Promise.all([first, second])

    // 開始時間、假別對調（0 ↔ 1），最後一個欄位的排序值 7 順便收成 4；沒變的 2、3 不送
    expect(writes().map((call) => [call.url.split('/').pop(), call.body])).toEqual([
      ['start', { order: 0 }],
      ['type', { order: 1 }],
      ['reason', { order: 4 }],
    ])
    expect(wrapper.vm.fields.map((field) => field._id)).toEqual(['start', 'type', 'end', 'hours', 'reason'])
  })

  it('換到另一張表單後，上一張表單慢回來的欄位不會顯示在這一張底下', async () => {
    const wrapper = await mountPage()
    let releaseLeave
    fieldResponders[LEAVE] = () => new Promise((resolve) => { releaseLeave = () => resolve(json(leaveFields())) })

    const openLeave = wrapper.vm.openFormEditor({ _id: LEAVE }, 'fields')
    await flushPromises()
    await wrapper.vm.closeEditor()
    await wrapper.vm.openFormEditor({ _id: OVERTIME }, 'fields')
    await flushPromises()
    expect(wrapper.vm.fields.map((field) => field.label)).toEqual(['加班原因'])

    releaseLeave()
    await openLeave
    await flushPromises()
    expect(wrapper.vm.selectedFormId).toBe(OVERTIME)
    expect(wrapper.vm.fields.map((field) => field.label)).toEqual(['加班原因'])
  })
})

describe('離開這一頁前', () => {
  it('關卡有尚未儲存的變更時，換頁前先問；留下來就不換頁，離開元件後不再攔截', async () => {
    const Blank = { template: '<div />' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: Blank }, { path: '/other', component: Blank }, { path: '/third', component: Blank }],
    })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(ApprovalFlowSetting, { global: { plugins: [ElementPlus, router] } })
    await flushPromises()

    // 沒有變更：直接換頁，不詢問
    ElMessageBox.confirm.mockClear()
    await router.push('/other')
    expect(router.currentRoute.value.path).toBe('/other')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()

    await wrapper.vm.openFormEditor({ _id: OVERTIME })
    await flushPromises()
    wrapper.vm.addStep()
    await flushPromises()

    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await router.push('/third')
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/other')
    expect(wrapper.vm.workflowSteps).toHaveLength(2)

    // 選擇放棄變更：換頁
    await router.push('/third')
    expect(router.currentRoute.value.path).toBe('/third')

    // 元件卸載後不再攔截其他頁面的換頁
    wrapper.unmount()
    ElMessageBox.confirm.mockClear()
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })
})

describe('簽核關卡：不適用的設定不顯示', () => {
  it('「全部都要簽／任一人簽即可」只在一關可能有多位簽核人時出現', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: LEAVE })
    await flushPromises()
    const cards = wrapper.findAll('[data-test="step-card"]')

    // 第 1 關主管鏈：沒有；第 2 關標籤：有；第 3 關只選了一位員工：沒有
    expect(cards.map((card) => card.find('[data-test="step-all-must"]').exists())).toEqual([false, true, false])

    wrapper.vm.workflowSteps[2].approver_value = ['e1', 'e2']
    await flushPromises()
    expect(wrapper.findAll('[data-test="step-card"]')[2].find('[data-test="step-all-must"]').exists()).toBe(true)
  })

  it('儲存關卡連按兩下只送一次', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openFormEditor({ _id: OVERTIME })
    await flushPromises()
    wrapper.vm.workflowSteps[0].name = '直屬主管'

    const first = wrapper.vm.saveWorkflow()
    const second = wrapper.vm.saveWorkflow()
    await Promise.all([first, second])

    expect(writes().filter((call) => call.url === `/api/approvals/forms/${OVERTIME}/workflow`)).toHaveLength(1)
  })
})
