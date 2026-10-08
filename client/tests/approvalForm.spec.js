import { describe, it, expect } from 'vitest'
import {
  buildInitialFormData,
  describeUnresolvedStep,
  describeWorkflowApprovers,
  findLeaveFormId,
  findMissingRequiredField,
  initialFieldValue,
  isActiveField,
  isActiveForm,
  isLeaveForm,
  isPayrollConnectedForm,
  isSingleCheckbox,
  prefillFormData,
  readResolvedApprovers,
} from '../src/utils/approvalForm'
import { PAGE_SIZE, pagedListUrl, readListPayload } from '../src/utils/approvalList'

describe('approvalForm 初始值與必填檢核', () => {
  const fields = [
    { _id: 'n', label: '金額', type_1: 'number', required: true },
    { _id: 't', label: '事由', type_1: 'text', required: true },
    { _id: 'single', label: '是否跨日', type_1: 'checkbox', required: true },
    { _id: 'group', label: '類別', type_1: 'checkbox', required: true, options: ['甲', '乙'] },
    { _id: 'f', label: '證明', type_1: 'file', required: true },
  ]

  it('數字欄位不預設 0；單一勾選為 false；複選為空陣列', () => {
    expect(initialFieldValue(fields[0])).toBeNull()
    expect(initialFieldValue(fields[1])).toBe('')
    expect(initialFieldValue(fields[2])).toBe(false)
    expect(initialFieldValue(fields[3])).toEqual([])
    expect(buildInitialFormData(fields)).toEqual({ n: null, t: '', single: false, group: [], f: '' })
  })

  it('沒有選項的 checkbox 是單一勾選，有選項才是群組', () => {
    expect(isSingleCheckbox({ type_1: 'checkbox' })).toBe(true)
    expect(isSingleCheckbox({ type_1: 'checkbox', options: [] })).toBe(true)
    expect(isSingleCheckbox({ type_1: 'checkbox', options: ['a'] })).toBe(false)
    expect(isSingleCheckbox({ type_1: 'text' })).toBe(false)
  })

  it('必填的數字沒填（null）會擋下來，填 0 算已填', () => {
    const data = buildInitialFormData(fields)
    expect(findMissingRequiredField(fields, data, {})?._id).toBe('n')
    const filled = { ...data, n: 0, t: '病假', group: ['甲'] }
    expect(findMissingRequiredField(fields, filled, { f: [{ name: 'a.pdf' }] })).toBeNull()
  })

  it('必填的複選群組至少要選一項；單一勾選未勾選視為回答「否」，不擋', () => {
    const data = { n: 1, t: 'x', single: false, group: [], f: '' }
    expect(findMissingRequiredField(fields, data, { f: [{ name: 'a.pdf' }] })?._id).toBe('group')
    expect(findMissingRequiredField(fields, { ...data, group: ['乙'] }, { f: [{ name: 'a.pdf' }] })).toBeNull()
  })

  it('必填的附件要有檔案，重新送出時保留原附件也算', () => {
    const data = { n: 1, t: 'x', single: false, group: ['甲'], f: '' }
    expect(findMissingRequiredField(fields, data, {})?._id).toBe('f')
    expect(findMissingRequiredField(fields, data, { f: [] })?._id).toBe('f')
    expect(findMissingRequiredField(fields, data, {}, { f: true })).toBeNull()
  })

  it('停用的欄位與表單不檢核、不顯示', () => {
    expect(isActiveField({ is_active: false })).toBe(false)
    expect(isActiveField({})).toBe(true)
    expect(isActiveForm({ is_active: false })).toBe(false)
    expect(isActiveForm({ name: 'x' })).toBe(true)
    expect(findMissingRequiredField([{ _id: 'x', label: 'x', type_1: 'text', required: true, is_active: false }], {}, {})).toBeNull()
  })

  it('prefillFormData 把既有資料轉成可編輯的值', () => {
    const data = prefillFormData(fields, { n: '3', t: '原因', single: true, group: '甲', f: [{ name: 'a.pdf' }] })
    expect(data).toEqual({ n: 3, t: '原因', single: true, group: ['甲'], f: '' })
    // 缺漏的欄位補初始值；舊資料的 [] 對應單一勾選時視為 false
    expect(prefillFormData(fields, { single: [] })).toEqual({ n: null, t: '', single: false, group: [], f: '' })
  })

  // 伺服器（sanitizeCheckbox）把沒有選項的單一勾選存成陣列：否 = [false]、是 = [true]
  it('單一勾選照伺服器實際存的 [false] / [true] 帶回：否還是否，是還是是', () => {
    const single = [{ _id: 'cross', label: '是否跨日', type_1: 'checkbox' }]
    expect(prefillFormData(single, { cross: [false] })).toEqual({ cross: false })
    expect(prefillFormData(single, { cross: [true] })).toEqual({ cross: true })
    expect(prefillFormData(single, { cross: ['true'] })).toEqual({ cross: true })
    expect(prefillFormData(single, { cross: ['false'] })).toEqual({ cross: false })
    expect(prefillFormData(single, { cross: [false, true] })).toEqual({ cross: true })
    // 舊資料或其他寫法
    expect(prefillFormData(single, { cross: false })).toEqual({ cross: false })
    expect(prefillFormData(single, { cross: true })).toEqual({ cross: true })
    expect(prefillFormData(single, { cross: 'true' })).toEqual({ cross: true })
    expect(prefillFormData(single, { cross: 'false' })).toEqual({ cross: false })
    // 複選群組仍然照原樣帶回選到的項目
    expect(prefillFormData(fields, { group: ['甲', '乙'] }).group).toEqual(['甲', '乙'])
  })

  it('退簽後原樣重新送出：單一勾選的答案來回一趟不會變（否 → 否、是 → 是）', () => {
    const single = [{ _id: 'cross', label: '是否跨日', type_1: 'checkbox' }, { _id: 't', label: '事由', type_1: 'text' }]
    // 模擬伺服器：收到布林存成陣列，再原樣讀回
    const storeOnServer = (formData) => Object.fromEntries(
      Object.entries(formData).map(([key, value]) => [key, key === 'cross' ? [value] : value]),
    )
    for (const answer of [false, true]) {
      let stored = storeOnServer({ cross: answer, t: '原因' })
      for (let round = 0; round < 3; round += 1) {
        const editable = prefillFormData(single, stored)
        expect(editable.cross).toBe(answer)
        stored = storeOnServer(editable)
      }
      expect(stored.cross).toEqual([answer])
    }
  })
})

describe('approvalForm 表單種類（改名後仍認得請假 / 加班 / 獎金）', () => {
  it('請假單：固定代號或表單性質優先，名稱「請假」只是舊資料的備援', () => {
    expect(isLeaveForm({ name: '請假單', default_key: 'leave', semanticType: 'leave' })).toBe(true)
    expect(isLeaveForm({ name: '員工休假申請', semanticType: 'leave' })).toBe(true)
    expect(isLeaveForm({ name: '請假' })).toBe(true)
    expect(isLeaveForm({ name: '請假', semanticType: 'general' })).toBe(true)
    expect(isLeaveForm({ name: '請假', semanticType: 'business_trip' })).toBe(false)
    expect(isLeaveForm({ name: '加班申請', semanticType: 'overtime', default_key: 'overtime' })).toBe(false)
    expect(isLeaveForm({ name: '特休保留', semanticType: 'general', default_key: 'leave_carryover' })).toBe(false)
    expect(isLeaveForm(null)).toBe(false)
  })

  it('連接薪資標籤：請假 / 加班用表單性質，請假 / 加班 / 獎金用固定代號，名稱只是備援', () => {
    expect(isPayrollConnectedForm({ name: '請假單', semanticType: 'leave', default_key: 'leave' })).toBe(true)
    expect(isPayrollConnectedForm({ name: '員工加班單', semanticType: 'overtime' })).toBe(true)
    expect(isPayrollConnectedForm({ name: '年終獎金', semanticType: 'general', default_key: 'bonus' })).toBe(true)
    // 沒有分類的舊資料才看名稱
    expect(isPayrollConnectedForm({ name: '請假' })).toBe(true)
    expect(isPayrollConnectedForm({ name: '加班申請', semanticType: 'general' })).toBe(true)
    expect(isPayrollConnectedForm({ name: '獎金申請' })).toBe(true)
    // 其他表單不顯示
    expect(isPayrollConnectedForm({ name: '在職證明', semanticType: 'general', default_key: 'employment_certificate' })).toBe(false)
    expect(isPayrollConnectedForm({ name: '支援申請', semanticType: 'general' })).toBe(false)
    expect(isPayrollConnectedForm({ name: '請假', semanticType: 'business_trip' })).toBe(false)
    expect(isPayrollConnectedForm(undefined)).toBe(false)
  })

  it('快速請假：default_key 為 leave 的啟用表單優先，其次表單性質，最後才是名稱「請假」', () => {
    const forms = [
      { _id: 'a', name: '休假申請單', semanticType: 'leave' },
      { _id: 'b', name: '請假單（新）', semanticType: 'leave', default_key: 'leave' },
      { _id: 'c', name: '請假' },
    ]
    expect(findLeaveFormId(forms)).toBe('b')
    expect(findLeaveFormId(forms.slice(0, 1).concat(forms.slice(2)))).toBe('a')
    expect(findLeaveFormId([forms[2], { _id: 'd', name: '支援申請' }])).toBe('c')
    expect(findLeaveFormId([{ _id: 'd', name: '支援申請' }])).toBe('')
    // 停用的預設請假單不能當快速請假的目標
    expect(findLeaveFormId([{ ...forms[1], is_active: false }, forms[0]])).toBe('a')
    expect(findLeaveFormId(undefined)).toBe('')
  })
})

describe('approvalForm 簽核流程預覽文字', () => {
  const lookups = {
    user: id => ({ u1: '王小明', u2: '李大華' })[id],
    department: id => ({ d1: '護理部' })[id],
    org: id => ({ o1: '總院' })[id],
    signRole: code => ({ R003: '審核' })[code],
    signLevel: code => ({ U002: 'L2（部門主管或組長）' })[code],
  }

  it('主管 / 標籤 / 員工 / 角色 / 層級 / 部門 / 機構都顯示中文，不顯示內部代碼', () => {
    expect(describeWorkflowApprovers({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }, lookups)).toBe('申請者的主管')
    expect(describeWorkflowApprovers({ approver_type: 'manager' }, lookups)).toBe('申請者的主管')
    expect(describeWorkflowApprovers({ approver_type: 'manager', approver_value: 'u1' }, lookups)).toBe('指定主管：王小明')
    expect(describeWorkflowApprovers({ approver_type: 'tag', approver_value: '人資' }, lookups)).toBe('標籤：人資')
    expect(describeWorkflowApprovers({ approver_type: 'user', approver_value: ['u1', 'u2'] }, lookups)).toBe('王小明、李大華')
    expect(describeWorkflowApprovers({ approver_type: 'role', approver_value: 'R003' }, lookups)).toBe('角色：審核')
    expect(describeWorkflowApprovers({ approver_type: 'role', approver_value: 'supervisor' }, lookups)).toBe('角色：主管')
    expect(describeWorkflowApprovers({ approver_type: 'level', approver_value: 'U002' }, lookups)).toBe('層級：L2（部門主管或組長）')
    expect(describeWorkflowApprovers({ approver_type: 'department', approver_value: 'd1' }, lookups)).toBe('部門：護理部')
    expect(describeWorkflowApprovers({ approver_type: 'org', approver_value: 'o1' }, lookups)).toBe('機構：總院')
  })

  it('找不到名稱時不外洩資料庫編號或代碼', () => {
    const text = describeWorkflowApprovers({ approver_type: 'department', approver_value: '6ac7a337af7d10f1e5fc2475' }, lookups)
    expect(text).toBe('部門：指定部門')
    expect(describeWorkflowApprovers({ approver_type: 'user', approver_value: ['zzz'] }, lookups)).toBe('指定員工')
    expect(describeWorkflowApprovers({ approver_type: 'group', approver_value: ['65f000000000000000000001'] }, lookups)).toBe('群組成員')
  })

  it('部門 / 機構 / 標籤沒有指定值時說明清楚', () => {
    expect(describeWorkflowApprovers({ approver_type: 'department' }, lookups)).toBe('申請者所屬部門')
    expect(describeWorkflowApprovers({ approver_type: 'org' }, lookups)).toBe('申請者所屬機構')
    expect(describeWorkflowApprovers({ approver_type: 'tag' }, lookups)).toBe('標籤（尚未指定）')
  })

  it('範圍限制會註明', () => {
    expect(describeWorkflowApprovers({ approver_type: 'tag', approver_value: '人資', scope_type: 'dept' }, lookups))
      .toBe('標籤：人資（限申請者同部門）')
  })

  it('伺服器若回傳解析結果就能判斷這關有沒有人；沒有資訊時回傳 null', () => {
    expect(readResolvedApprovers({ approver_type: 'tag' })).toBeNull()
    expect(readResolvedApprovers({ resolved_approvers: [] })).toEqual({ count: 0, names: [] })
    expect(readResolvedApprovers({ resolved_approvers: [{ name: '甲' }, '乙'] })).toEqual({ count: 2, names: ['甲', '乙'] })
    expect(readResolvedApprovers({ eligible_count: 0 })).toEqual({ count: 0, names: [] })
    expect(readResolvedApprovers({ eligible_count: 3 })).toEqual({ count: 3, names: [] })
  })

  it('讀伺服器的 resolved_count / unresolved_reason：這兩個欄位優先，找不到人時帶原因', () => {
    expect(readResolvedApprovers({ resolved_count: 2, unresolved_reason: null })).toEqual({ count: 2, names: [] })
    expect(readResolvedApprovers({ resolved_count: 0, unresolved_reason: '申請人尚未設定直屬主管' }))
      .toEqual({ count: 0, names: [], reason: '申請人尚未設定直屬主管' })
    expect(readResolvedApprovers({ resolved_count: 0, unresolved_reason: null })).toEqual({ count: 0, names: [] })
    // 兩種欄位同時存在時以 resolved_count 為準
    expect(readResolvedApprovers({ resolved_count: 0, eligible_count: 5 })).toEqual({ count: 0, names: [] })
    expect(readResolvedApprovers({ resolved_count: 1, resolved_approvers: [] })).toEqual({ count: 1, names: [] })
    // 只有原因代表找不到人；空白原因與沒有資訊一樣不提醒
    expect(readResolvedApprovers({ unresolved_reason: '指定的員工已離職、停用或不存在' }))
      .toEqual({ count: 0, names: [], reason: '指定的員工已離職、停用或不存在' })
    expect(readResolvedApprovers({ unresolved_reason: '  ' })).toBeNull()
    expect(readResolvedApprovers({ resolved_count: null })).toBeNull()
  })

  it('必簽的關卡找不到人時先在申請頁提醒並附上原因；不是必簽或找得到人就不提醒', () => {
    const base = '此關目前找不到可簽核的人員'
    expect(describeUnresolvedStep({ resolved_count: 0, unresolved_reason: '申請人尚未設定直屬主管', is_required: true }))
      .toBe(`${base}：申請人尚未設定直屬主管，送出申請會失敗，請聯絡管理員設定`)
    expect(describeUnresolvedStep({ resolved_count: 0 })).toBe(`${base}，送出申請會失敗，請聯絡管理員設定`)
    expect(describeUnresolvedStep({ resolved_count: 0, unresolved_reason: '原因', is_required: false })).toBe('')
    expect(describeUnresolvedStep({ resolved_count: 3 })).toBe('')
    expect(describeUnresolvedStep({ approver_type: 'tag' })).toBe('')
  })
})

describe('approvalList 分頁回應', () => {
  it('純陣列與 { items, total } 兩種回應都接受', () => {
    expect(readListPayload([1, 2])).toEqual({ items: [1, 2], total: 2, page: 1, paged: false })
    expect(readListPayload({ items: [1], total: 41, page: 3, limit: 20 })).toEqual({ items: [1], total: 41, page: 3, paged: true })
    expect(readListPayload({ items: [1] }, 2)).toEqual({ items: [1], total: 1, page: 2, paged: true })
    expect(readListPayload(null)).toEqual({ items: [], total: 0, page: 1, paged: false })
  })

  it('清單網址帶上 page 與 limit', () => {
    expect(pagedListUrl('/api/approvals/inbox', 2)).toBe(`/api/approvals/inbox?page=2&limit=${PAGE_SIZE}`)
  })
})
