import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'
import { createFakeEmployeeModel, oid } from './helpers/approvalTestKit.js'

// 簽核人解析：用記憶體內的假 Employee 模型驗證各類型 × 範圍 × 可簽核資格 × 申請人排除
const DEPT_A = oid(9001)
const DEPT_B = oid(9002)
const SUB_1 = oid(9101)
const SUB_2 = oid(9102)

const APPLICANT = oid(1)
const SUPERVISOR = oid(2)
const HR_A = oid(3) // 人資，部門 A
const HR_B = oid(4) // 人資，部門 B
const HR_LEFT = oid(5) // 人資，離職
const HR_DISABLED = oid(6) // 人資，帳號停用
const HR_LEAVE = oid(7) // 人資，留職停薪
const MANAGER_X = oid(8) // 主管（可被指定）
const NOT_MANAGER = oid(10)
const OUTSIDER = oid(11)

let employees
let mockEmployeeModel
const mockSubDepartmentModel = { find: jest.fn() }

let resolveApprovers
let resolveApproversDetailed

function seedEmployees() {
  return [
    { _id: APPLICANT, name: '申請人', role: 'employee', department: DEPT_A, organization: 'org-1', supervisor: SUPERVISOR, subDepartment: SUB_1, signTags: [] },
    { _id: SUPERVISOR, name: '主管', role: 'supervisor', department: DEPT_A, organization: 'org-1', signRole: 'R003', signLevel: 'U002', signTags: [] },
    { _id: HR_A, name: '人資A', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資'], signRole: 'R007', signLevel: 'U001', subDepartment: SUB_1 },
    { _id: HR_B, name: '人資B', role: 'employee', department: DEPT_B, organization: 'org-2', signTags: ['人資 ', '財務覆核'], signRole: 'R007', subDepartment: SUB_2 },
    { _id: HR_LEFT, name: '離職人資', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資'], status: '離職員工', signRole: 'R007', signLevel: 'U002' },
    { _id: HR_DISABLED, name: '停用人資', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資'], accountEnabled: false },
    { _id: HR_LEAVE, name: '留停人資', role: 'employee', department: DEPT_A, organization: 'org-1', signTags: ['人資'], status: '留職停薪' },
    { _id: MANAGER_X, name: '指定主管', role: 'supervisor', department: DEPT_B, organization: 'org-2', signTags: [] },
    { _id: NOT_MANAGER, name: '一般員工', role: 'employee', department: DEPT_B, organization: 'org-2', signTags: [] },
    { _id: OUTSIDER, name: '無部門人員', role: 'employee', signTags: ['人資'] },
  ]
}

beforeAll(async () => {
  employees = seedEmployees()
  mockEmployeeModel = createFakeEmployeeModel(employees)
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartmentModel }))
  const module = await import('../src/controllers/approvalRequestController.js')
  resolveApprovers = module.resolveApprovers
  resolveApproversDetailed = module.resolveApproversDetailed
})

beforeEach(() => {
  mockEmployeeModel.rows.splice(0, mockEmployeeModel.rows.length, ...seedEmployees())
  mockEmployeeModel.find.mockClear()
  mockSubDepartmentModel.find.mockReset()
})

const applicant = () => mockEmployeeModel.rows.find(row => row._id === APPLICANT)
const ids = (list) => list.map(String).sort()

describe('resolveApprovers - manager type', () => {
  it('returns the applicant supervisor when the special value is used', async () => {
    const result = await resolveApprovers({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }, applicant())
    expect(ids(result)).toEqual([SUPERVISOR])
  })

  it('treats an empty value like the applicant supervisor', async () => {
    expect(ids(await resolveApprovers({ approver_type: 'manager' }, applicant()))).toEqual([SUPERVISOR])
  })

  it('returns a specified supervisor only when that employee is a supervisor', async () => {
    expect(ids(await resolveApprovers({ approver_type: 'manager', approver_value: MANAGER_X }, applicant()))).toEqual([MANAGER_X])
    expect(await resolveApprovers({ approver_type: 'manager', approver_value: NOT_MANAGER }, applicant())).toEqual([])
    expect(await resolveApprovers({ approver_type: 'manager', approver_value: 'not-an-object-id' }, applicant())).toEqual([])
  })

  it('reports why nobody was found when the applicant has no supervisor', async () => {
    const noSupervisor = { ...applicant(), supervisor: null }
    const result = await resolveApproversDetailed({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }, noSupervisor)
    expect(result).toEqual({ ids: [], reason: 'no-supervisor' })
  })

  it.each([
    ['離職員工', { status: '離職員工' }],
    ['留職停薪', { status: '留職停薪' }],
    ['帳號停用', { accountEnabled: false }],
  ])('drops a supervisor who is %s', async (_label, patch) => {
    Object.assign(mockEmployeeModel.rows.find(row => row._id === SUPERVISOR), patch)
    const result = await resolveApproversDetailed({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }, applicant())
    expect(result).toEqual({ ids: [], reason: 'supervisor-inactive' })
  })

  it('drops a supervisor reference that no longer exists', async () => {
    const dangling = { ...applicant(), supervisor: oid(999) }
    const result = await resolveApproversDetailed({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }, dangling)
    expect(result.ids).toEqual([])
  })

  it('never makes the applicant the approver of their own request (supervisor set to self)', async () => {
    const selfSupervised = { ...applicant(), supervisor: APPLICANT }
    const result = await resolveApproversDetailed({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }, selfSupervised)
    expect(result).toEqual({ ids: [], reason: 'only-applicant' })
  })
})

describe('resolveApprovers - user type', () => {
  it('keeps only existing, eligible employees', async () => {
    const result = await resolveApprovers(
      { approver_type: 'user', approver_value: [SUPERVISOR, HR_LEFT, HR_DISABLED, oid(12345), 'junk'] },
      applicant(),
    )
    expect(ids(result)).toEqual([SUPERVISOR])
  })

  it('accepts a single id and removes the applicant', async () => {
    expect(ids(await resolveApprovers({ approver_type: 'user', approver_value: SUPERVISOR }, applicant()))).toEqual([SUPERVISOR])
    const only = await resolveApproversDetailed({ approver_type: 'user', approver_value: [APPLICANT] }, applicant())
    expect(only).toEqual({ ids: [], reason: 'only-applicant' })
  })

  it('explains an unusable configuration', async () => {
    expect(await resolveApproversDetailed({ approver_type: 'user', approver_value: [] }, applicant()))
      .toEqual({ ids: [], reason: 'invalid-config' })
    expect(await resolveApproversDetailed({ approver_type: 'user', approver_value: [HR_LEFT] }, applicant()))
      .toEqual({ ids: [], reason: 'user-unavailable' })
  })
})

describe('resolveApprovers - tag type', () => {
  it('matches the tag after normalisation and skips ineligible holders and the applicant', async () => {
    const result = await resolveApprovers({ approver_type: 'tag', approver_value: '人資' }, applicant())
    // 人資B 的標籤是 '人資 '（結尾空白，尚未被遷移成正規化格式）
    expect(ids(result)).toEqual([HR_A, HR_B, OUTSIDER].sort())
  })

  it('treats full-width and padded tag values in the workflow as the same tag', async () => {
    mockEmployeeModel.rows.find(row => row._id === HR_A).signTags = ['ＨＲ  組']
    const result = await resolveApprovers({ approver_type: 'tag', approver_value: ' HR 組 ' }, applicant())
    expect(ids(result)).toEqual([HR_A])
  })

  it('compares tags case-sensitively', async () => {
    mockEmployeeModel.rows.find(row => row._id === HR_A).signTags = ['HR']
    expect(await resolveApprovers({ approver_type: 'tag', approver_value: 'hr' }, applicant())).toEqual([])
    expect(ids(await resolveApprovers({ approver_type: 'tag', approver_value: 'HR' }, applicant()))).toEqual([HR_A])
  })

  it('removes the applicant when the applicant holds the tag', async () => {
    mockEmployeeModel.rows.find(row => row._id === APPLICANT).signTags = ['人資']
    const result = await resolveApprovers({ approver_type: 'tag', approver_value: '人資' }, applicant())
    expect(result).not.toContain(APPLICANT)
    expect(result.length).toBeGreaterThan(0)
  })

  it('reports only-applicant when the applicant is the sole holder', async () => {
    const nobody = await resolveApproversDetailed({ approver_type: 'tag', approver_value: '唯一標籤' }, applicant())
    expect(nobody).toEqual({ ids: [], reason: '' })
    mockEmployeeModel.rows.find(row => row._id === APPLICANT).signTags = ['唯一標籤']
    const sole = await resolveApproversDetailed({ approver_type: 'tag', approver_value: '唯一標籤' }, applicant())
    expect(sole).toEqual({ ids: [], reason: 'only-applicant' })
  })

  it('returns nobody for an empty tag', async () => {
    expect(await resolveApproversDetailed({ approver_type: 'tag', approver_value: '  ' }, applicant()))
      .toEqual({ ids: [], reason: 'invalid-config' })
  })
})

describe('resolveApprovers - scope', () => {
  it('limits to the applicant department with dept scope', async () => {
    const result = await resolveApprovers({ approver_type: 'tag', approver_value: '人資', scope_type: 'dept' }, applicant())
    expect(ids(result)).toEqual([HR_A])
  })

  it('limits to the applicant organization with org scope', async () => {
    const result = await resolveApprovers({ approver_type: 'tag', approver_value: '人資', scope_type: 'org' }, applicant())
    expect(ids(result)).toEqual([HR_A])
  })

  it('does not widen to the whole company when the applicant has no department or organization', async () => {
    const lonely = { _id: oid(50), name: '無部門', role: 'employee' }
    const dept = await resolveApproversDetailed({ approver_type: 'tag', approver_value: '人資', scope_type: 'dept' }, lonely)
    const org = await resolveApproversDetailed({ approver_type: 'tag', approver_value: '人資', scope_type: 'org' }, lonely)
    const role = await resolveApproversDetailed({ approver_type: 'role', approver_value: 'supervisor', scope_type: 'dept' }, lonely)
    expect(dept).toEqual({ ids: [], reason: 'applicant-department-missing' })
    expect(org).toEqual({ ids: [], reason: 'applicant-organization-missing' })
    expect(role).toEqual({ ids: [], reason: 'applicant-department-missing' })
  })

  it('treats the legacy group scope like none instead of widening or narrowing', async () => {
    const withGroup = await resolveApprovers({ approver_type: 'tag', approver_value: '人資', scope_type: 'group' }, applicant())
    const withNone = await resolveApprovers({ approver_type: 'tag', approver_value: '人資', scope_type: 'none' }, applicant())
    expect(ids(withGroup)).toEqual(ids(withNone))
  })
})

describe('resolveApprovers - role type', () => {
  it('matches a system role', async () => {
    const result = await resolveApprovers({ approver_type: 'role', approver_value: 'supervisor' }, applicant())
    expect(ids(result)).toEqual([SUPERVISOR, MANAGER_X].sort())
  })

  it('matches a sign role code (R001-R007) through Employee.signRole', async () => {
    const result = await resolveApprovers({ approver_type: 'role', approver_value: 'R003' }, applicant())
    expect(ids(result)).toEqual([SUPERVISOR])
  })

  it('skips ineligible employees that carry the sign role', async () => {
    const result = await resolveApprovers({ approver_type: 'role', approver_value: 'R007' }, applicant())
    expect(ids(result)).toEqual([HR_A, HR_B].sort())
  })

  it('applies the scope to role steps', async () => {
    const result = await resolveApprovers({ approver_type: 'role', approver_value: 'R007', scope_type: 'dept' }, applicant())
    expect(ids(result)).toEqual([HR_A])
  })

  it('rejects an unknown role value', async () => {
    expect(await resolveApproversDetailed({ approver_type: 'role', approver_value: 'hr' }, applicant()))
      .toEqual({ ids: [], reason: 'invalid-config' })
    expect(await resolveApproversDetailed({ approver_type: 'role', approver_value: '' }, applicant()))
      .toEqual({ ids: [], reason: 'invalid-config' })
  })
})

describe('resolveApprovers - level type', () => {
  it('matches a sign level code (U001-U005) through Employee.signLevel', async () => {
    expect(ids(await resolveApprovers({ approver_type: 'level', approver_value: 'U002' }, applicant()))).toEqual([SUPERVISOR])
  })

  it('skips ineligible employees at that level', async () => {
    // 離職的人資也是 U002，但不能是簽核人
    const result = await resolveApprovers({ approver_type: 'level', approver_value: 'U002' }, applicant())
    expect(result).not.toContain(HR_LEFT)
  })

  it('rejects a value that is not a level code', async () => {
    expect(await resolveApproversDetailed({ approver_type: 'level', approver_value: 'L2' }, applicant()))
      .toEqual({ ids: [], reason: 'invalid-config' })
  })
})

describe('resolveApprovers - department / org types', () => {
  it('returns the eligible members of the department, without the applicant', async () => {
    const result = await resolveApprovers({ approver_type: 'department', approver_value: DEPT_A }, applicant())
    expect(ids(result)).toEqual([SUPERVISOR, HR_A].sort())
  })

  it('defaults to the applicant department and explains a missing one', async () => {
    expect(ids(await resolveApprovers({ approver_type: 'department' }, applicant()))).toEqual([SUPERVISOR, HR_A].sort())
    expect(await resolveApproversDetailed({ approver_type: 'department' }, { _id: oid(60) }))
      .toEqual({ ids: [], reason: 'applicant-department-missing' })
  })

  it('returns the eligible members of the organization', async () => {
    const result = await resolveApprovers({ approver_type: 'org', approver_value: 'org-2' }, applicant())
    expect(ids(result)).toEqual([HR_B, MANAGER_X, NOT_MANAGER].sort())
  })

  it('defaults to the applicant organization and explains a missing one', async () => {
    expect(ids(await resolveApprovers({ approver_type: 'org' }, applicant()))).toEqual([SUPERVISOR, HR_A].sort())
    expect(await resolveApproversDetailed({ approver_type: 'org' }, { _id: oid(61) }))
      .toEqual({ ids: [], reason: 'applicant-organization-missing' })
  })
})

describe('resolveApprovers - group type', () => {
  it('returns eligible employees within the selected sub-departments', async () => {
    mockSubDepartmentModel.find.mockResolvedValue([{ _id: SUB_1 }])
    const result = await resolveApprovers({ approver_type: 'group', approver_value: [SUB_1] }, applicant())

    expect(mockSubDepartmentModel.find).toHaveBeenCalledWith({ _id: { $in: [SUB_1] } }, { _id: 1 })
    expect(ids(result)).toEqual([HR_A]) // 申請人本人（同為 SUB_1）被排除
  })

  it('applies the scope and returns nobody for unknown sub-departments', async () => {
    mockSubDepartmentModel.find.mockResolvedValue([{ _id: SUB_2 }])
    const scoped = await resolveApprovers({ approver_type: 'group', approver_value: [SUB_2], scope_type: 'dept' }, applicant())
    expect(scoped).toEqual([]) // SUB_2 的人在部門 B，申請人在部門 A

    mockSubDepartmentModel.find.mockResolvedValue([])
    expect(await resolveApprovers({ approver_type: 'group', approver_value: [SUB_1] }, applicant())).toEqual([])
    expect(await resolveApprovers({ approver_type: 'group', approver_value: ['junk'] }, applicant())).toEqual([])
  })
})

describe('resolveApprovers - unsupported type', () => {
  it('resolves to nobody', async () => {
    expect(await resolveApprovers({ approver_type: 'delegate', approver_value: 'x' }, applicant())).toEqual([])
  })
})
