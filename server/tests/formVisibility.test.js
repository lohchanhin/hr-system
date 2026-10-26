import { jest } from '@jest/globals'

// R2「設定部門表單顯示」：部門設定的「使用簽核表單」（Department.allowedFormIds，可複選）。
// 一般員工、主管只看得到、只能送出自己部門開放的表單；沒有勾選 = 全部；沒有部門 = 全部；管理員一律全部（表單設計不受影響）。
const FORM_LEAVE = '000000000000000000000f01'
const FORM_OVERTIME = '000000000000000000000f02'
const DEPT_NURSING = '0000000000000000000d0001'
const DEPT_OFFICE = '0000000000000000000d0002'
const NURSE = '0000000000000000000e0001'
const CLERK = '0000000000000000000e0002'
const FLOATER = '0000000000000000000e0003'
const ADMIN = '0000000000000000000e0009'

const mockFormTemplate = { find: jest.fn(), findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn() }
const mockApprovalRequest = { countDocuments: jest.fn() }

function query(value) {
  const q = { select: jest.fn(() => q), lean: jest.fn(async () => value), then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) }
  return q
}

let employees = {}
let departments = {}
const mockEmployee = { findById: jest.fn((id) => query(employees[String(id)] || null)), find: jest.fn(async () => []) }
const mockDepartment = { findById: jest.fn((id) => query(departments[String(id)] || null)) }

let controller
let service

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
  controller = await import('../src/controllers/approvalTemplateController.js')
  service = await import('../src/services/formVisibilityService.js')
})

beforeEach(() => {
  jest.clearAllMocks()
  employees = {
    [NURSE]: { _id: NURSE, department: DEPT_NURSING },
    [CLERK]: { _id: CLERK, department: DEPT_OFFICE },
    [FLOATER]: { _id: FLOATER, department: null },
    [ADMIN]: { _id: ADMIN, department: DEPT_NURSING },
  }
  departments = {
    // 護理部只開放請假單（資料庫存的是 ObjectId，這裡用字串與物件兩種寫法都要認得）
    [DEPT_NURSING]: { _id: DEPT_NURSING, allowedFormIds: [{ _id: FORM_LEAVE }] },
    // 行政部沒有勾選：全部都可以用
    [DEPT_OFFICE]: { _id: DEPT_OFFICE, allowedFormIds: [] },
  }
  mockFormTemplate.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ _id: FORM_LEAVE }]) })
  mockFormTemplate.findById.mockImplementation(async (id) => ({ _id: id, name: id === FORM_LEAVE ? '請假' : '加班申請' }))
  mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
  mockApprovalWorkflow.findOne.mockResolvedValue({ _id: 'wf', steps: [] })
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() }
}

const as = (id, role = 'employee') => ({ id, role })

describe('formVisibilityService', () => {
  it('limits an employee to the forms the department chose, and leaves everybody else unrestricted', async () => {
    expect(await service.getFormVisibilityForUser(as(NURSE))).toEqual({ restricted: true, allowedIds: [FORM_LEAVE], departmentId: DEPT_NURSING })
    expect(await service.getFormVisibilityForUser(as(CLERK, 'supervisor'))).toMatchObject({ restricted: false, allowedIds: null })
    expect(await service.getFormVisibilityForUser(as(FLOATER))).toMatchObject({ restricted: false, allowedIds: null })
    expect(await service.getFormVisibilityForUser(as(ADMIN, 'admin'))).toMatchObject({ restricted: false })
    expect(await service.getFormVisibilityForUser(as('not-an-id'))).toMatchObject({ restricted: false })
  })

  it('treats a missing department document like no selection', async () => {
    employees[NURSE].department = '0000000000000000000d0099'
    expect(await service.getFormVisibilityForUser(as(NURSE))).toMatchObject({ restricted: false })
  })

  it('uses the department already on an employee document instead of reading the employee again', async () => {
    const visibility = await service.getFormVisibilityForUser(as(NURSE), { _id: NURSE, department: DEPT_OFFICE })
    expect(visibility.restricted).toBe(false)
    expect(mockEmployee.findById).not.toHaveBeenCalled()
  })

  it('cleans the stored selection (duplicates, garbage)', () => {
    expect(service.normalizeAllowedFormIds([FORM_LEAVE, FORM_LEAVE, 'junk', null, { _id: FORM_OVERTIME }])).toEqual([FORM_LEAVE, FORM_OVERTIME])
    expect(service.normalizeAllowedFormIds(undefined)).toEqual([])
    expect(service.isFormAllowed({ restricted: true, allowedIds: [FORM_LEAVE] }, FORM_OVERTIME)).toBe(false)
    expect(service.isFormAllowed({ restricted: false, allowedIds: null }, FORM_OVERTIME)).toBe(true)
  })
})

describe('listFormTemplates', () => {
  it('lists only the department forms to a nurse and tells the apply page the list is filtered', async () => {
    const res = makeRes()
    await controller.listFormTemplates({ query: { is_active: 'true' }, user: as(NURSE) }, res)

    expect(mockFormTemplate.find).toHaveBeenCalledWith({ is_active: { $ne: false }, _id: { $in: [FORM_LEAVE] } })
    expect(res.set).toHaveBeenCalledWith('X-Form-Visibility', 'department')
  })

  it('lists every active form to an employee of a department without a selection, or without a department', async () => {
    for (const id of [CLERK, FLOATER]) {
      mockFormTemplate.find.mockClear()
      const res = makeRes()
      await controller.listFormTemplates({ query: {}, user: as(id, 'supervisor') }, res)
      expect(mockFormTemplate.find).toHaveBeenCalledWith({ is_active: { $ne: false } })
      expect(res.set).toHaveBeenCalledWith('X-Form-Visibility', 'all')
    }
  })

  it('lists every form to an admin, whatever the department chose (the designer is unchanged)', async () => {
    const res = makeRes()
    await controller.listFormTemplates({ query: {}, user: as(ADMIN, 'admin') }, res)

    expect(mockFormTemplate.find).toHaveBeenCalledWith({})
    expect(mockDepartment.findById).not.toHaveBeenCalled()
    expect(res.set).not.toHaveBeenCalled()
  })
})

describe('getFormTemplate / listFields', () => {
  it('answers 403 in Chinese for a form the department did not allow', async () => {
    const template = makeRes()
    await controller.getFormTemplate({ params: { id: FORM_OVERTIME }, user: as(NURSE) }, template)
    expect(template.status).toHaveBeenCalledWith(403)
    expect(template.json).toHaveBeenCalledWith({
      error: '您所屬的部門未開放使用【加班申請】，請改選其他表單；如需使用請洽管理員',
      code: 'FORM_NOT_ALLOWED',
    })

    const fields = makeRes()
    await controller.listFields({ params: { formId: FORM_OVERTIME }, user: as(NURSE), query: {} }, fields)
    expect(fields.status).toHaveBeenCalledWith(403)
    expect(mockFormField.find).not.toHaveBeenCalled()
  })

  it('serves an allowed form, any form to an unrestricted employee, and any form to an admin', async () => {
    const allowed = makeRes()
    await controller.listFields({ params: { formId: FORM_LEAVE }, user: as(NURSE), query: {} }, allowed)
    expect(allowed.status).not.toHaveBeenCalled()

    const clerk = makeRes()
    await controller.getFormTemplate({ params: { id: FORM_OVERTIME }, user: as(CLERK) }, clerk)
    expect(clerk.status).not.toHaveBeenCalled()

    const admin = makeRes()
    await controller.getFormTemplate({ params: { id: FORM_OVERTIME }, user: as(ADMIN, 'admin') }, admin)
    expect(admin.status).not.toHaveBeenCalled()
  })

  it('still answers 404 for an unknown template before checking the department', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()
    await controller.getFormTemplate({ params: { id: FORM_OVERTIME }, user: as(NURSE) }, res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockDepartment.findById).not.toHaveBeenCalled()
  })
})
