import { jest } from '@jest/globals'

// 部門「使用簽核表單」（Department.allowedFormIds）勾選的表單之後被刪除或停用時（審查 F1）：
// - 真的刪除表單：從每個部門的勾選拿掉（清空的部門 = 全部表單）；讀取時已刪除的 id 不算（全部都被刪除 = 全部表單）。
// - 部門設定儲存時，已刪除的表單直接拿掉，不再回 400「使用簽核表單包含不存在的表單」（格式不對仍是 400）。
// - 停用（包含「刪除」已有申請單的表單時改為停用）：勾選不動；勾選的表單全部不能用的部門視同沒有勾選，不會一張表單都看不到。
const FORM_LEAVE = '000000000000000000000f01'
const FORM_OVERTIME = '000000000000000000000f02'
const FORM_GONE = '000000000000000000000f0d'
const DEPT_NURSING = '0000000000000000000d0001'
const DEPT_WARD = '0000000000000000000d0002'
const DEPT_OFFICE = '0000000000000000000d0003'
const NURSE = '0000000000000000000e0001'
const WARD_NURSE = '0000000000000000000e0002'
const ADMIN = '0000000000000000000e0009'

let forms = {}
let departments = {}
let employees = {}

const ids = (list) => (Array.isArray(list) ? list : []).map(item => String(item?._id ?? item))

function query(value) {
  const q = {
    select: jest.fn(() => q),
    lean: jest.fn(async () => value),
    sort: jest.fn(async () => value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  }
  return q
}

function formMatches(form, filter = {}) {
  if (filter._id?.$in && !filter._id.$in.map(String).includes(form._id)) return false
  if (filter.is_active?.$ne === false && form.is_active === false) return false
  if (filter.is_active === false && form.is_active !== false) return false
  return true
}

const mockFormTemplate = {
  find: jest.fn((filter) => query(Object.values(forms).filter(form => formMatches(form, filter)).map(form => ({ ...form })))),
  findById: jest.fn(async (id) => (forms[String(id)] ? { ...forms[String(id)] } : null)),
  findByIdAndUpdate: jest.fn(async (id, update) => {
    const form = forms[String(id)]
    if (form) Object.assign(form, update.$set || {})
    return form ? { ...form } : null
  }),
  deleteOne: jest.fn(async ({ _id }) => {
    delete forms[String(_id)]
    return { deletedCount: 1 }
  }),
}
const mockFormField = { find: jest.fn(() => query([])), deleteMany: jest.fn(async () => ({})) }
const mockApprovalWorkflow = { findOne: jest.fn(async () => ({ _id: 'wf', steps: [] })), deleteOne: jest.fn(async () => ({})) }
const mockApprovalRequest = { countDocuments: jest.fn(async () => 0) }
const mockEmployee = { findById: jest.fn((id) => query(employees[String(id)] || null)), find: jest.fn(async () => []) }
const mockDepartment = Object.assign(
  jest.fn((data) => ({ ...data, save: jest.fn(async () => undefined) })),
  {
    findById: jest.fn((id) => query(departments[String(id)] ? { ...departments[String(id)] } : null)),
    find: jest.fn((filter = {}) => query(Object.values(departments)
      .filter(dept => !filter.allowedFormIds || ids(dept.allowedFormIds).includes(String(filter.allowedFormIds)))
      .map(dept => ({ ...dept })))),
    updateMany: jest.fn(async (filter, update) => {
      const removed = String(update.$pull.allowedFormIds)
      let modifiedCount = 0
      for (const dept of Object.values(departments)) {
        if (!ids(dept.allowedFormIds).includes(String(filter.allowedFormIds))) continue
        dept.allowedFormIds = ids(dept.allowedFormIds).filter(id => id !== removed)
        modifiedCount += 1
      }
      return { modifiedCount }
    }),
    findByIdAndUpdate: jest.fn(async (id, update) => {
      const dept = departments[String(id)]
      if (!dept) return null
      Object.assign(dept, Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)))
      return { ...dept }
    }),
  },
)

let templates
let visibility
let departmentController

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ resetLeaveFieldCache: jest.fn() }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: jest.fn().mockResolvedValue({ itemSettings: {} }),
    getDictionaryItems: jest.fn().mockResolvedValue([]),
  }))
  templates = await import('../src/controllers/approvalTemplateController.js')
  visibility = await import('../src/services/formVisibilityService.js')
  departmentController = await import('../src/controllers/departmentController.js')
})

beforeEach(() => {
  jest.clearAllMocks()
  forms = {
    [FORM_LEAVE]: { _id: FORM_LEAVE, name: '請假', is_active: true },
    [FORM_OVERTIME]: { _id: FORM_OVERTIME, name: '加班申請', is_active: true },
  }
  departments = {
    // 護理部只勾選請假單；病房勾選請假與加班；行政部沒有勾選（全部）
    [DEPT_NURSING]: { _id: DEPT_NURSING, name: '護理部', allowedFormIds: [FORM_LEAVE] },
    [DEPT_WARD]: { _id: DEPT_WARD, name: '病房', allowedFormIds: [FORM_LEAVE, FORM_OVERTIME] },
    [DEPT_OFFICE]: { _id: DEPT_OFFICE, name: '行政部', allowedFormIds: [] },
  }
  employees = {
    [NURSE]: { _id: NURSE, department: DEPT_NURSING },
    [WARD_NURSE]: { _id: WARD_NURSE, department: DEPT_WARD },
    [ADMIN]: { _id: ADMIN, department: DEPT_NURSING },
  }
  mockApprovalRequest.countDocuments.mockResolvedValue(0)
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() }
}

const as = (id, role = 'employee') => ({ id, role })
const visibilityOf = (id) => visibility.getFormVisibilityForUser(as(id))

async function listAs(id) {
  const res = makeRes()
  await templates.listFormTemplates({ query: { is_active: 'true' }, user: as(id) }, res)
  return { names: res.json.mock.calls[0][0].map(form => form.name).sort(), header: res.set.mock.calls[0]?.[1] }
}

describe('reading a department selection whose forms were deleted', () => {
  it('ignores the ids of deleted forms and keeps the rest of the selection', async () => {
    departments[DEPT_NURSING].allowedFormIds = [FORM_GONE, FORM_LEAVE]

    expect(await visibilityOf(NURSE)).toEqual({ restricted: true, allowedIds: [FORM_LEAVE], departmentId: DEPT_NURSING })
    expect(await listAs(NURSE)).toEqual({ names: ['請假'], header: 'department' })
  })

  it('shows every form when every selected form was deleted (not an empty list)', async () => {
    departments[DEPT_NURSING].allowedFormIds = [FORM_GONE]

    expect(await visibilityOf(NURSE)).toEqual({ restricted: false, allowedIds: null, departmentId: DEPT_NURSING })
    expect(await listAs(NURSE)).toEqual({ names: ['加班申請', '請假'], header: 'all' })
    const fields = makeRes()
    await templates.listFields({ params: { formId: FORM_OVERTIME }, user: as(NURSE), query: {} }, fields)
    expect(fields.status).not.toHaveBeenCalled()
  })
})

describe('a selected form that is disabled', () => {
  it('lets a department whose selected forms are all disabled see every active form, and keeps its selection', async () => {
    forms[FORM_LEAVE].is_active = false

    expect(await visibilityOf(NURSE)).toMatchObject({ restricted: false, allowedIds: null })
    expect(await listAs(NURSE)).toEqual({ names: ['加班申請'], header: 'all' })
    expect(departments[DEPT_NURSING].allowedFormIds).toEqual([FORM_LEAVE])

    // 重新啟用：又只看得到勾選的表單
    forms[FORM_LEAVE].is_active = true
    expect(await listAs(NURSE)).toEqual({ names: ['請假'], header: 'department' })
  })

  it('keeps the restriction while another selected form is still active (the disabled one stays in the list for the 已停用 message)', async () => {
    forms[FORM_OVERTIME].is_active = false

    expect(await visibilityOf(WARD_NURSE)).toEqual({ restricted: true, allowedIds: [FORM_LEAVE, FORM_OVERTIME], departmentId: DEPT_WARD })
    expect(await listAs(WARD_NURSE)).toEqual({ names: ['請假'], header: 'department' })
  })
})

describe('deleteFormTemplate and the department selections', () => {
  it('pulls a deleted form out of every department selection; an emptied selection means every form again', async () => {
    const res = makeRes()
    await templates.deleteFormTemplate({ params: { id: FORM_LEAVE } }, res)

    expect(mockDepartment.updateMany).toHaveBeenCalledWith({ allowedFormIds: FORM_LEAVE }, { $pull: { allowedFormIds: FORM_LEAVE } })
    expect(departments[DEPT_NURSING].allowedFormIds).toEqual([])
    expect(departments[DEPT_WARD].allowedFormIds).toEqual([FORM_OVERTIME])
    expect(departments[DEPT_OFFICE].allowedFormIds).toEqual([])
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      deleted: true,
      deactivated: false,
      departmentsUpdated: 2,
      departmentsUsingAllForms: 1,
      message: '已刪除表單樣板；已從 2 個部門的「使用簽核表單」拿掉這張表單，其中 1 個部門因此沒有勾選可用的表單，改為看得到全部表單',
    })

    expect(await listAs(NURSE)).toEqual({ names: ['加班申請'], header: 'all' })
    expect(await listAs(WARD_NURSE)).toEqual({ names: ['加班申請'], header: 'department' })
  })

  it('deletes the form first, so a failing department update only leaves an id that reads as deleted', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockDepartment.updateMany.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5'), { name: 'MongoNetworkError' }))
    const res = makeRes()

    await templates.deleteFormTemplate({ params: { id: FORM_LEAVE } }, res)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, deleted: true, departmentsUpdated: 0, message: '已刪除表單樣板' }))
    expect(forms[FORM_LEAVE]).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('[approval-template] remove form from departments failed: MongoNetworkError')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('ECONNREFUSED')
    // 還留在護理部的 id 讀取時不算：護理部看得到全部表單，而不是一張都沒有
    expect(departments[DEPT_NURSING].allowedFormIds).toEqual([FORM_LEAVE])
    expect(await listAs(NURSE)).toEqual({ names: ['加班申請'], header: 'all' })
    errorSpy.mockRestore()
  })

  it('does not touch the departments when none of them chose the form', async () => {
    forms[FORM_GONE] = { _id: FORM_GONE, name: '出差申請', is_active: true }
    const res = makeRes()

    await templates.deleteFormTemplate({ params: { id: FORM_GONE } }, res)

    expect(mockDepartment.updateMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, departmentsUpdated: 0, departmentsUsingAllForms: 0, message: '已刪除表單樣板' }))
  })

  it('keeps the selection when the form is deactivated instead (it has requests) and tells the admin which departments now see every form', async () => {
    mockApprovalRequest.countDocuments.mockImplementation(async (filter) => (filter.status === 'pending' ? 1 : 3))
    const res = makeRes()

    await templates.deleteFormTemplate({ params: { id: FORM_LEAVE } }, res)

    expect(mockDepartment.updateMany).not.toHaveBeenCalled()
    expect(departments[DEPT_NURSING].allowedFormIds).toEqual([FORM_LEAVE])
    const body = res.json.mock.calls[0][0]
    expect(body).toMatchObject({ deleted: false, deactivated: true, requestCount: 3, pendingCount: 1, departmentsUsingAllForms: 1 })
    expect(body.message).toContain('已改為停用而沒有刪除')
    expect(body.message).toContain('另外有 1 個部門勾選的表單都已停用或刪除，這些部門的員工改為看得到全部啟用中的表單')

    // 護理部（只勾選請假單）看得到全部啟用中的表單；病房還有加班單可用，維持只看勾選的
    expect(await listAs(NURSE)).toEqual({ names: ['加班申請'], header: 'all' })
    expect(await listAs(WARD_NURSE)).toEqual({ names: ['加班申請'], header: 'department' })
  })

  it('says nothing extra when the deactivated form leaves every department with a usable form', async () => {
    mockApprovalRequest.countDocuments.mockResolvedValue(2)
    const res = makeRes()

    await templates.deleteFormTemplate({ params: { id: FORM_OVERTIME } }, res)

    const body = res.json.mock.calls[0][0]
    expect(body).toMatchObject({ deactivated: true, departmentsUsingAllForms: 0 })
    expect(body.message).not.toContain('部門')
  })
})

describe('saving a department selection that contains deleted forms', () => {
  async function save(allowedFormIds) {
    const res = makeRes()
    await departmentController.updateDepartment({ params: { id: DEPT_NURSING }, body: { name: '護理部', allowedFormIds } }, res)
    return res
  }

  it('drops the deleted forms instead of refusing to save (an all-deleted selection becomes every form)', async () => {
    const kept = await save([FORM_GONE, FORM_OVERTIME.toUpperCase(), { _id: FORM_LEAVE }])
    expect(kept.status).not.toHaveBeenCalled()
    expect(kept.json.mock.calls[0][0].allowedFormIds).toEqual([FORM_OVERTIME, FORM_LEAVE])

    const emptied = await save([FORM_GONE])
    expect(emptied.status).not.toHaveBeenCalled()
    expect(departments[DEPT_NURSING].allowedFormIds).toEqual([])
  })

  it('still refuses a malformed selection with a Chinese 400', async () => {
    for (const bad of [['junk'], 'all', [FORM_LEAVE, { $ne: null }]]) {
      const res = await save(bad)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: '使用簽核表單格式不正確' })
    }
    expect(departments[DEPT_NURSING].allowedFormIds).toEqual([FORM_LEAVE])
  })

  it('drops deleted forms on create too', async () => {
    const res = makeRes()
    await departmentController.createDepartment({ body: { name: '新單位', organization: 'org1', allowedFormIds: [FORM_GONE, FORM_LEAVE] } }, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(mockDepartment).toHaveBeenCalledWith(expect.objectContaining({ allowedFormIds: [FORM_LEAVE] }))
  })
})
