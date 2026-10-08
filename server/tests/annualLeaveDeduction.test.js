import { jest } from '@jest/globals'

// 簽核通過後的特休扣減：預設的「請假」表單，以及表單性質為請假的自訂表單（例如客戶的「休假/事假/公假申請單」）
const mockFormTemplate = { findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn() }
const mockApprovalRequest = { findById: jest.fn() }
const mockEmployee = { findById: jest.fn() }
const mockAssertApprovalRequestCompliance = jest.fn()
const mockDeductAnnualLeave = jest.fn()
const mockGetSettings = jest.fn()
const mockGetDictionaryItems = jest.fn()

let actOnApproval
let dictionaries
let formFields

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
    assertApprovalRequestCompliance: mockAssertApprovalRequestCompliance,
    isLaborRuleValidationError: (error) => Array.isArray(error?.violations),
  }))
  await jest.unstable_mockModule('../src/services/annualLeaveService.js', () => ({
    deductAnnualLeave: mockDeductAnnualLeave,
    getAnnualLeaveBalance: jest.fn(),
  }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: mockGetDictionaryItems,
  }))
  ;({ actOnApproval } = await import('../src/controllers/approvalRequestController.js'))
})

beforeEach(() => {
  dictionaries = {
    C12: [{ name: '特休假', code: '特休假' }, { name: '病假', code: '病假' }, { name: '事假', code: '事假' }],
  }
  formFields = []
  for (const mock of [mockFormTemplate, mockFormField, mockApprovalWorkflow, mockApprovalRequest, mockEmployee]) {
    Object.values(mock).forEach((fn) => fn.mockReset())
  }
  mockAssertApprovalRequestCompliance.mockReset()
  mockAssertApprovalRequestCompliance.mockResolvedValue({ ok: true, violations: [] })
  mockDeductAnnualLeave.mockReset()
  mockDeductAnnualLeave.mockResolvedValue({})
  mockGetSettings.mockReset()
  mockGetDictionaryItems.mockReset()
  mockGetSettings.mockImplementation(async () => ({ itemSettings: { ...dictionaries } }))
  mockGetDictionaryItems.mockImplementation(async (key) => dictionaries[key] || [])
  mockFormField.find.mockImplementation(() => ({ lean: async () => formFields }))
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

function formQuery(form) {
  // 同時支援 await 與 .lean()，和 mongoose query 一樣
  return Object.assign(Promise.resolve(form), { lean: () => Promise.resolve(form) })
}

async function approveLastStep({ form, formData }) {
  const doc = {
    _id: 'req1',
    form: form._id,
    form_data: formData,
    applicant_employee: 'emp1',
    status: 'pending',
    current_step_index: 0,
    steps: [{ approvers: [{ approver: 'sup1', decision: 'pending' }], all_must_approve: true }],
    logs: [],
    save: jest.fn().mockResolvedValue(),
  }
  mockApprovalRequest.findById.mockResolvedValue(doc)
  mockFormTemplate.findById.mockImplementation(() => formQuery(form))
  const res = makeRes()

  await actOnApproval({
    params: { id: 'req1' },
    user: { id: 'sup1', role: 'supervisor' },
    body: { decision: 'approve' },
  }, res)

  return { doc, res }
}

// 客戶的表單：欄位標籤是日期(起) 日期(迄) 天數 假別類別 (C12)，表單名稱裡沒有「請假」
const CUSTOMER_FORM = { _id: 'form9', name: '休假/事假/公假申請單（人事類-出勤標準）', semanticType: 'leave', is_active: true }
function customerFields() {
  return [
    { _id: 'c-type', form: 'form9', label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'], order: 1 },
    { _id: 'c-start', form: 'form9', label: '日期(起)', type_1: 'date', order: 2 },
    { _id: 'c-end', form: 'form9', label: '日期(迄)', type_1: 'date', order: 3 },
    { _id: 'c-days', form: 'form9', label: '天數', type_1: 'number', order: 4 },
  ]
}

describe('annual leave deduction for the customer leave form', () => {
  beforeEach(() => {
    formFields = customerFields()
  })

  it('deducts the days between 日期(起) and 日期(迄) when 特休假 is selected', async () => {
    const { res } = await approveLastStep({
      form: CUSTOMER_FORM,
      formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-04' },
    })

    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(mockDeductAnnualLeave).toHaveBeenCalledTimes(1)
    expect(mockDeductAnnualLeave).toHaveBeenCalledWith('emp1', 3, 'req1')
  })

  it('uses the number filled in 天數 first (half days, and weekends in the date span are not deducted)', async () => {
    await approveLastStep({
      form: CUSTOMER_FORM,
      formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-08', 'c-days': 0.5 },
    })
    await approveLastStep({
      form: CUSTOMER_FORM,
      formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-08', 'c-days': '5' },
    })

    expect(mockDeductAnnualLeave.mock.calls.map(([, days]) => days)).toEqual([0.5, 5])
  })

  it('falls back to the dates when 天數 is blank or not a positive number', async () => {
    for (const blank of ['', 0, -1, 'abc', null]) {
      mockDeductAnnualLeave.mockClear()
      await approveLastStep({
        form: CUSTOMER_FORM,
        formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-03', 'c-days': blank },
      })
      expect(mockDeductAnnualLeave).toHaveBeenCalledWith('emp1', 2, 'req1')
    }
  })

  it('does not deduct for the other leave types of the dictionary', async () => {
    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': '病假', 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })
    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': '事假', 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })
    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': '公假', 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })

    expect(mockDeductAnnualLeave).not.toHaveBeenCalled()
  })

  it('recognises the annual leave type from a { label, value } selection and from the option label of a code', async () => {
    formFields = [
      { _id: 'c-type', form: 'form9', label: '假別', type_1: 'select', options: [{ value: 'AL', label: '特休' }, { value: 'SL', label: '病假' }], order: 1 },
      { _id: 'c-start', form: 'form9', label: '日期(起)', type_1: 'date', order: 2 },
      { _id: 'c-end', form: 'form9', label: '日期(迄)', type_1: 'date', order: 3 },
    ]

    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': { label: '特休假', value: 'x' }, 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })
    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': 'AL', 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })
    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': { value: 'AL' }, 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })
    await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-type': 'SL', 'c-start': '2026-03-02', 'c-end': '2026-03-02' } })

    expect(mockDeductAnnualLeave).toHaveBeenCalledTimes(3)
  })

  it('looks up the fields of the approved form itself (not of whichever leave form is globally picked)', async () => {
    await approveLastStep({
      form: CUSTOMER_FORM,
      formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-02' },
    })

    expect(mockFormField.find).toHaveBeenCalledWith({ form: 'form9' })
    expect(mockDeductAnnualLeave).toHaveBeenCalledWith('emp1', 1, 'req1')
  })

  it('does nothing when the form is not a leave form', async () => {
    await approveLastStep({
      form: { _id: 'form9', name: '採購申請', semanticType: 'general' },
      formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-02' },
    })

    expect(mockFormField.find).not.toHaveBeenCalled()
    expect(mockDeductAnnualLeave).not.toHaveBeenCalled()
  })

  it('does nothing (and does not fail the approval) when the form has no leave type field', async () => {
    formFields = [{ _id: 'c-start', form: 'form9', label: '日期(起)', type_1: 'date', order: 1 }]

    const { doc, res } = await approveLastStep({ form: CUSTOMER_FORM, formData: { 'c-start': '2026-03-02' } })

    expect(mockDeductAnnualLeave).not.toHaveBeenCalled()
    expect(doc.status).toBe('approved')
    expect(res.status).not.toHaveBeenCalledWith(400)
  })

  it('logs the failure on the request but keeps the approval when the deduction fails', async () => {
    mockDeductAnnualLeave.mockRejectedValue(new Error('Insufficient annual leave balance'))

    const { doc, res } = await approveLastStep({
      form: CUSTOMER_FORM,
      formData: { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-02' },
    })

    expect(doc.status).toBe('approved')
    expect(doc.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'annual_leave_error', message: expect.stringContaining('Insufficient annual leave balance') }),
    ]))
    expect(res.status).not.toHaveBeenCalledWith(400)
  })
})

describe('annual leave deduction for the default 請假 form (unchanged)', () => {
  const DEFAULT_FORM = { _id: 'form1', name: '請假', semanticType: 'leave', is_active: true }

  beforeEach(() => {
    formFields = [
      { _id: 'd-type', form: 'form1', label: '假別', type_1: 'text', order: 1 },
      { _id: 'd-start', form: 'form1', label: '開始時間', type_1: 'datetime', order: 2 },
      { _id: 'd-end', form: 'form1', label: '結束時間', type_1: 'datetime', order: 3 },
      { _id: 'd-reason', form: 'form1', label: '事由', type_1: 'textarea', order: 4 },
    ]
  })

  it('deducts for 特休 and 特休假 typed into the text field, counting days the way it always did', async () => {
    await approveLastStep({
      form: DEFAULT_FORM,
      formData: { 'd-type': '特休', 'd-start': '2026-03-02T09:00:00.000Z', 'd-end': '2026-03-04T18:00:00.000Z' },
    })
    await approveLastStep({
      form: DEFAULT_FORM,
      formData: { 'd-type': '特休假', 'd-start': '2026-03-02', 'd-end': '2026-03-02' },
    })

    // 與修改前相同的算法：ceil(天數差) + 1
    expect(mockDeductAnnualLeave.mock.calls).toEqual([
      ['emp1', 4, 'req1'],
      ['emp1', 1, 'req1'],
    ])
  })

  it('does not deduct for other leave types', async () => {
    await approveLastStep({
      form: DEFAULT_FORM,
      formData: { 'd-type': '病假', 'd-start': '2026-03-02', 'd-end': '2026-03-02' },
    })

    expect(mockDeductAnnualLeave).not.toHaveBeenCalled()
  })

  it('still recognises the form by its name when the semanticType was left as general', async () => {
    await approveLastStep({
      form: { ...DEFAULT_FORM, semanticType: 'general' },
      formData: { 'd-type': '特休', 'd-start': '2026-03-02', 'd-end': '2026-03-02' },
    })

    expect(mockDeductAnnualLeave).toHaveBeenCalledWith('emp1', 1, 'req1')
  })

  it('falls back to the legacy days value, then to 1 day, when there are no dates', async () => {
    await approveLastStep({ form: DEFAULT_FORM, formData: { 'd-type': '特休', days: 2 } })
    await approveLastStep({ form: DEFAULT_FORM, formData: { 'd-type': '特休' } })

    expect(mockDeductAnnualLeave.mock.calls.map(([, days]) => days)).toEqual([2, 1])
  })

  it('has no 天數 field, so a stray days value never replaces the dates', async () => {
    await approveLastStep({
      form: DEFAULT_FORM,
      formData: { 'd-type': '特休', 'd-start': '2026-03-02', 'd-end': '2026-03-03', days: 9 },
    })

    expect(mockDeductAnnualLeave).toHaveBeenCalledWith('emp1', 2, 'req1')
  })
})
