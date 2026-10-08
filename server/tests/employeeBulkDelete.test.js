import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import request from 'supertest'

// 真實 Express app（src/index.js）在載入時會檢查這幾個環境變數，必須在動態 import 之前設定
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  exists: jest.fn(),
  deleteMany: jest.fn(),
  updateMany: jest.fn(),
  countDocuments: jest.fn(),
  distinct: jest.fn(),
}
// 刪除前的「簽核影響」盤點會查進行中的簽核單與流程關卡；沒有資料庫連線時真實模型會一直等待，所以替換掉
const mockApprovalRequest = { find: jest.fn() }
const mockApprovalWorkflow = { find: jest.fn() }
const mockDeleteEmployeePhoto = jest.fn()
const mockIsManagedEmployeePhotoPath = jest.fn(() => true)
const mockReadEmployeePhoto = jest.fn()
const mockIsTokenBlacklisted = jest.fn()

let bulkDeleteEmployees
let previewDeleteImpact
let app

beforeAll(async () => {
  // 真實 app 的上傳中介層也會從照片儲存模組匯入其他成員，所以只覆寫本測試需要控制的函式
  const actualPhotoStorage = await import('../src/services/employeePhotoStorage.js')
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/services/employeePhotoStorage.js', () => ({
    ...actualPhotoStorage,
    deleteEmployeePhoto: mockDeleteEmployeePhoto,
    isManagedEmployeePhotoPath: mockIsManagedEmployeePhotoPath,
    readEmployeePhoto: mockReadEmployeePhoto,
  }))
  await jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
    isTokenBlacklisted: mockIsTokenBlacklisted,
    blacklistToken: jest.fn(),
  }))
  ;({ bulkDeleteEmployees, previewDeleteImpact } = await import('../src/controllers/employeeController.js'))
  ;({ app } = await import('../src/index.js'))
})

const NO_IMPACT = {
  pendingRequests: 0,
  pendingApprovers: [],
  subordinates: 0,
  workflowSteps: 0,
  lostTags: [],
  incomplete: false,
  messages: [],
}

/** find().select().limit().lean() 這種鏈式查詢的替身 */
function queryChain(rows) {
  const query = { select: jest.fn(), limit: jest.fn(), lean: jest.fn().mockResolvedValue(rows) }
  query.select.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  return query
}

const ACTOR_ID = oid(900)
const PHOTO_A = '/upload/employees/employee_a.png'
const PHOTO_B = '/upload/employees/employee_b.png'

/** 產生固定的 24 位十六進位 ObjectId 字串 */
function oid(n) {
  return `507f1f77bcf86c${n.toString(16).padStart(10, '0')}`
}

function makeDoc(n, overrides = {}) {
  return {
    _id: oid(n),
    name: `員工${n}`,
    employeeId: `E${String(n).padStart(3, '0')}`,
    role: 'employee',
    photo: undefined,
    ...overrides,
  }
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  }
}

function makeReq(ids, user = { id: ACTOR_ID, role: 'admin' }) {
  return { user, body: { ids } }
}

/** Employee.find 會被呼叫兩次：先載入文件，刪除後再查詢仍存在的 id */
function queueFinds(found, survivors = []) {
  const firstSelect = jest.fn().mockResolvedValue(found)
  const secondSelect = jest.fn().mockResolvedValue(survivors)
  mockEmployee.find
    .mockReturnValueOnce({ select: firstSelect })
    .mockReturnValueOnce({ select: secondSelect })
  return { firstSelect, secondSelect }
}

async function run(ids, user) {
  const res = makeRes()
  await bulkDeleteEmployees(makeReq(ids, user), res)
  return res
}

const responseBody = (res) => res.json.mock.calls[0][0]

beforeEach(() => {
  Object.values(mockEmployee).forEach((fn) => fn.mockReset())
  mockEmployee.exists.mockResolvedValue(null)
  mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 0 })
  mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 0 })
  mockEmployee.countDocuments.mockResolvedValue(0)
  mockEmployee.distinct.mockResolvedValue([])
  mockApprovalRequest.find.mockReset()
  mockApprovalRequest.find.mockReturnValue(queryChain([]))
  mockApprovalWorkflow.find.mockReset()
  mockApprovalWorkflow.find.mockReturnValue(queryChain([]))
  mockDeleteEmployeePhoto.mockReset()
  mockDeleteEmployeePhoto.mockResolvedValue(true)
  mockIsManagedEmployeePhotoPath.mockReset()
  mockIsManagedEmployeePhotoPath.mockReturnValue(true)
  mockIsTokenBlacklisted.mockReset()
  mockIsTokenBlacklisted.mockResolvedValue(false)
  // 控制器每次都會輸出一行 console.info，測試中靜音以免洗版
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('bulkDeleteEmployees validation', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['a string', oid(1)],
    ['a number', 5],
    ['a plain object', { ids: [oid(1)] }],
    ['an operator object', { $in: [oid(1)] }],
  ])('rejects ids that are %s', async (_label, ids) => {
    const res = await run(ids)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(responseBody(res)).toEqual({ error: expect.any(String) })
    expect(responseBody(res).error).toMatch(/[一-鿿]/)
    expect(mockEmployee.find).not.toHaveBeenCalled()
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects an empty ids array', async () => {
    const res = await run([])

    expect(res.status).toHaveBeenCalledWith(400)
    expect(responseBody(res).error).toMatch(/[一-鿿]/)
    expect(mockEmployee.find).not.toHaveBeenCalled()
  })

  it('rejects more than 200 ids but accepts exactly 200', async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => oid(i + 1))
    const rejected = await run(tooMany)

    expect(rejected.status).toHaveBeenCalledWith(400)
    expect(responseBody(rejected).error).toMatch(/200/)
    expect(mockEmployee.find).not.toHaveBeenCalled()

    queueFinds([])
    const limit = Array.from({ length: 200 }, (_, i) => oid(i + 1))
    const accepted = await run(limit)

    expect(accepted.status).not.toHaveBeenCalled()
    expect(responseBody(accepted)).toMatchObject({ requested: 200, deletedCount: 0 })
  })

  it.each([
    ['a number', 12345],
    ['null', null],
    ['a nested array', [oid(2)]],
    ['a too short string', 'abc123'],
    ['a 25 character string', `${oid(2)}0`],
    ['a non hex 24 character string', 'z'.repeat(24)],
    ['a padded string', ` ${oid(2)}`],
    ['an empty string', ''],
    ['an operator object', { $ne: null }],
    ['an operator object with a valid id', { $in: [oid(2)] }],
    ['an _id wrapper object', { _id: oid(2) }],
  ])('rejects an entry that is %s even next to a valid id', async (_label, entry) => {
    const res = await run([oid(1), entry])

    expect(res.status).toHaveBeenCalledWith(400)
    expect(responseBody(res).error).toMatch(/[一-鿿]/)
    expect(mockEmployee.find).not.toHaveBeenCalled()
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
  })

  it('never passes a NoSQL operator payload to the database', async () => {
    const res = await run([{ $ne: null }])

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockEmployee.find).not.toHaveBeenCalled()
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
  })
})

describe('bulkDeleteEmployees classification', () => {
  it('skips an administrator account and deletes nothing', async () => {
    const admin = makeDoc(1, { role: 'admin', photo: PHOTO_A })
    queueFinds([admin])

    const res = await run([oid(1)])

    expect(res.status).not.toHaveBeenCalled()
    expect(responseBody(res)).toEqual({
      requested: 1,
      deletedCount: 0,
      deleted: [],
      skipped: [{
        _id: oid(1),
        name: '員工1',
        employeeNo: 'E001',
        reason: 'admin',
        message: '管理員帳戶不可刪除',
      }],
      unassignedSubordinates: 0,
      impact: NO_IMPACT,
      warnings: [],
    })
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
    expect(mockDeleteEmployeePhoto).not.toHaveBeenCalled()
  })

  it.each(['admin', 'employee'])('skips the acting user (role %s) as self', async (role) => {
    queueFinds([makeDoc(900, { role, photo: PHOTO_A })])

    const res = await run([ACTOR_ID])

    expect(responseBody(res).skipped).toEqual([{
      _id: ACTOR_ID,
      name: '員工900',
      employeeNo: 'E900',
      reason: 'self',
      message: '不能刪除自己的帳號',
    }])
    expect(responseBody(res).deletedCount).toBe(0)
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
    expect(mockDeleteEmployeePhoto).not.toHaveBeenCalled()
  })

  it('matches the acting user id regardless of id casing or object type', async () => {
    queueFinds([makeDoc(900)])

    const res = makeRes()
    await bulkDeleteEmployees(
      { user: { id: { toString: () => ACTOR_ID.toUpperCase() }, role: 'admin' }, body: { ids: [ACTOR_ID] } },
      res
    )

    expect(responseBody(res).skipped).toEqual([expect.objectContaining({ reason: 'self' })])
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
  })

  it('reports ids that no longer exist as not_found', async () => {
    queueFinds([makeDoc(1)], [])

    const res = await run([oid(1), oid(2)])

    expect(responseBody(res).skipped).toEqual([{
      _id: oid(2),
      name: '',
      employeeNo: '',
      reason: 'not_found',
      message: '找不到該員工（可能已被刪除）',
    }])
    expect(responseBody(res).deleted).toEqual([{ _id: oid(1), name: '員工1', employeeNo: 'E001' }])
    expect(mockEmployee.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('does not call deleteMany when every id is skipped', async () => {
    queueFinds([])

    const res = await run([oid(1), oid(2)])

    expect(responseBody(res)).toMatchObject({
      requested: 2,
      deletedCount: 0,
      deleted: [],
      unassignedSubordinates: 0,
    })
    expect(responseBody(res).skipped.map((item) => item.reason)).toEqual(['not_found', 'not_found'])
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
    expect(mockEmployee.find).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates ids silently, including different casing', async () => {
    queueFinds([makeDoc(1), makeDoc(2)])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 2 })

    const res = await run([oid(1), oid(1).toUpperCase(), oid(2), oid(1)])

    expect(mockEmployee.find.mock.calls[0][0]).toEqual({ _id: { $in: [oid(1), oid(2)] } })
    expect(responseBody(res).requested).toBe(2)
    expect(responseBody(res).deletedCount).toBe(2)
    expect(responseBody(res).deleted.map((item) => item._id)).toEqual([oid(1), oid(2)])
    expect(responseBody(res).skipped).toEqual([])
  })
})

describe('bulkDeleteEmployees deletion', () => {
  it('deletes the deletable employees with a single admin-excluding deleteMany', async () => {
    const { firstSelect } = queueFinds([makeDoc(1), makeDoc(2), makeDoc(3, { role: 'supervisor' })], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 3 })
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 4 })

    const res = await run([oid(1), oid(2), oid(3)])

    expect(res.status).not.toHaveBeenCalled()
    expect(mockEmployee.find.mock.calls[0][0]).toEqual({ _id: { $in: [oid(1), oid(2), oid(3)] } })
    expect(firstSelect).toHaveBeenCalledWith('_id name employeeId role photo')

    expect(mockEmployee.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockEmployee.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [oid(1), oid(2), oid(3)] },
      role: { $ne: 'admin' },
    })

    expect(mockEmployee.updateMany).toHaveBeenCalledTimes(1)
    expect(mockEmployee.updateMany).toHaveBeenCalledWith(
      { supervisor: { $in: [oid(1), oid(2), oid(3)] } },
      { $unset: { supervisor: 1 } }
    )

    expect(responseBody(res)).toEqual({
      requested: 3,
      deletedCount: 3,
      deleted: [
        { _id: oid(1), name: '員工1', employeeNo: 'E001' },
        { _id: oid(2), name: '員工2', employeeNo: 'E002' },
        { _id: oid(3), name: '員工3', employeeNo: 'E003' },
      ],
      skipped: [],
      unassignedSubordinates: 4,
      impact: NO_IMPACT,
      warnings: [],
    })
  })

  it('only sends deletable ids to deleteMany when the selection is mixed', async () => {
    queueFinds([
      makeDoc(1),
      makeDoc(2, { role: 'admin' }),
      makeDoc(900),
    ])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })

    const res = await run([oid(1), oid(2), oid(900), oid(3)])

    expect(mockEmployee.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockEmployee.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [oid(1)] },
      role: { $ne: 'admin' },
    })
    expect(mockEmployee.find.mock.calls[1][0]).toEqual({ _id: { $in: [oid(1)] } })
    expect(responseBody(res).requested).toBe(4)
    expect(responseBody(res).deletedCount).toBe(1)
    expect(responseBody(res).skipped.map((item) => [item._id, item.reason])).toEqual([
      [oid(2), 'admin'],
      [oid(900), 'self'],
      [oid(3), 'not_found'],
    ])
  })

  it('reports zero unassigned subordinates when updateMany reports nothing', async () => {
    queueFinds([makeDoc(1)], [])
    mockEmployee.updateMany.mockResolvedValue({})

    const res = await run([oid(1)])

    expect(responseBody(res).unassignedSubordinates).toBe(0)
    expect(responseBody(res).deletedCount).toBe(1)
  })

  it('does not clear supervisors of anyone when nothing was deleted', async () => {
    queueFinds([makeDoc(1)], [makeDoc(1)])

    const res = await run([oid(1)])

    expect(responseBody(res).deletedCount).toBe(0)
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
  })

  it('does not trust deleteMany count and reports a surviving row as changed', async () => {
    queueFinds(
      [makeDoc(1, { photo: PHOTO_A }), makeDoc(2, { photo: PHOTO_B })],
      [{ _id: oid(2) }]
    )
    // deleteMany claims two deletions although one row survived (e.g. a race)
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 2 })
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 1 })

    const res = await run([oid(1), oid(2)])

    expect(mockEmployee.find.mock.calls[1][0]).toEqual({ _id: { $in: [oid(1), oid(2)] } })
    expect(responseBody(res).deletedCount).toBe(1)
    expect(responseBody(res).deleted).toEqual([{ _id: oid(1), name: '員工1', employeeNo: 'E001' }])
    expect(responseBody(res).skipped).toEqual([{
      _id: oid(2),
      name: '員工2',
      employeeNo: 'E002',
      reason: 'changed',
      message: '資料狀態已變更，未刪除',
    }])
    expect(mockEmployee.updateMany).toHaveBeenCalledWith(
      { supervisor: { $in: [oid(1)] } },
      { $unset: { supervisor: 1 } }
    )
    // 只清理真的被刪除者的照片
    expect(mockDeleteEmployeePhoto).toHaveBeenCalledTimes(1)
    expect(mockDeleteEmployeePhoto).toHaveBeenCalledWith(PHOTO_A)
  })

  it('reports an employee promoted to admin after classification as changed', async () => {
    // deleteMany 的 role != admin 條件使該筆不會被刪除，因此仍在資料庫中
    queueFinds([makeDoc(1), makeDoc(2)], [{ _id: oid(2) }])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })

    const res = await run([oid(1), oid(2)])

    expect(mockEmployee.deleteMany.mock.calls[0][0].role).toEqual({ $ne: 'admin' })
    expect(responseBody(res).deletedCount).toBe(1)
    expect(responseBody(res).skipped).toEqual([expect.objectContaining({ _id: oid(2), reason: 'changed' })])
  })

  it('reports every row as changed when none of them was actually deleted', async () => {
    queueFinds([makeDoc(1), makeDoc(2)], [{ _id: oid(1) }, { _id: oid(2) }])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 0 })

    const res = await run([oid(1), oid(2)])

    expect(responseBody(res).deletedCount).toBe(0)
    expect(responseBody(res).deleted).toEqual([])
    expect(responseBody(res).skipped.map((item) => item.reason)).toEqual(['changed', 'changed'])
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
  })
})

describe('bulkDeleteEmployees photo cleanup', () => {
  it('cleans up photos of deleted employees only', async () => {
    queueFinds([
      makeDoc(1, { photo: PHOTO_A }),
      makeDoc(2),
      makeDoc(3, { role: 'admin', photo: PHOTO_B }),
    ])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 2 })

    const res = await run([oid(1), oid(2), oid(3)])

    expect(responseBody(res).deletedCount).toBe(2)
    // 被刪員工 1 有照片 → 清理；員工 2 沒照片、管理員 3 被略過 → 不清理
    expect(mockEmployee.exists).toHaveBeenCalledTimes(1)
    expect(mockEmployee.exists).toHaveBeenCalledWith({ photo: PHOTO_A, _id: { $ne: oid(1) } })
    expect(mockDeleteEmployeePhoto).toHaveBeenCalledTimes(1)
    expect(mockDeleteEmployeePhoto).toHaveBeenCalledWith(PHOTO_A)
  })

  it('keeps a photo that another employee still references', async () => {
    queueFinds([makeDoc(1, { photo: PHOTO_A })])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })
    mockEmployee.exists.mockResolvedValue({ _id: oid(50) })

    const res = await run([oid(1)])

    expect(responseBody(res).deletedCount).toBe(1)
    expect(mockDeleteEmployeePhoto).not.toHaveBeenCalled()
  })

  it('does not clean up photos for skipped employees', async () => {
    queueFinds(
      [makeDoc(1, { photo: PHOTO_A }), makeDoc(2, { photo: PHOTO_B, role: 'admin' })],
      [{ _id: oid(1) }]
    )
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 0 })

    const res = await run([oid(1), oid(2)])

    expect(responseBody(res).deletedCount).toBe(0)
    expect(mockEmployee.exists).not.toHaveBeenCalled()
    expect(mockDeleteEmployeePhoto).not.toHaveBeenCalled()
  })

  it('does not fail the request when removing a photo file fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    queueFinds([
      makeDoc(1, { photo: PHOTO_A }),
      makeDoc(2, { photo: PHOTO_B }),
    ])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 2 })
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 1 })
    mockDeleteEmployeePhoto.mockRejectedValueOnce(new Error('EPERM: cannot unlink'))

    const res = await run([oid(1), oid(2)])

    expect(res.status).not.toHaveBeenCalled()
    expect(responseBody(res)).toMatchObject({
      requested: 2,
      deletedCount: 2,
      unassignedSubordinates: 1,
    })
    // 第一筆失敗後，第二筆仍會嘗試清理
    expect(mockDeleteEmployeePhoto).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('員工')
  })

  it('does not fail the request when the photo reference lookup fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    queueFinds([makeDoc(1, { photo: PHOTO_A })])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })
    mockEmployee.exists.mockRejectedValue(new Error('db down'))

    const res = await run([oid(1)])

    expect(res.status).not.toHaveBeenCalled()
    expect(responseBody(res).deletedCount).toBe(1)
  })
})

describe('bulkDeleteEmployees errors and logging', () => {
  const GENERIC_ERROR = '批量刪除失敗，請重新整理員工列表確認結果後再試'

  it('returns a generic 500 (no driver details) when deleteMany fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    queueFinds([makeDoc(1)])
    mockEmployee.deleteMany.mockRejectedValue(new Error('delete exploded mongodb://secret-host:27017'))

    const res = await run([oid(1)])

    expect(res.status).toHaveBeenCalledWith(500)
    expect(responseBody(res)).toEqual({ error: GENERIC_ERROR })
    expect(JSON.stringify(responseBody(res))).not.toContain('exploded')
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
  })

  it('returns a generic 500 when loading the employees fails, before anything is deleted', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockEmployee.find.mockReturnValueOnce({
      select: jest.fn().mockRejectedValue(new Error('find exploded')),
    })

    const res = await run([oid(1)])

    expect(res.status).toHaveBeenCalledWith(500)
    expect(responseBody(res)).toEqual({ error: GENERIC_ERROR })
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
  })

  it('still answers 200 with the deleted list when verifying the deletion fails afterwards', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockEmployee.find
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue([makeDoc(1, { photo: PHOTO_A }), makeDoc(2)]) })
      .mockReturnValueOnce({ select: jest.fn().mockRejectedValue(new Error('verify exploded')) })
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 2 })
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 3 })

    const res = await run([oid(1), oid(2)])

    expect(res.status).not.toHaveBeenCalled()
    const body = responseBody(res)
    expect(body.deletedCount).toBe(2)
    expect(body.deleted.map((item) => item._id)).toEqual([oid(1), oid(2)])
    expect(body.unassignedSubordinates).toBe(3)
    expect(body.warnings).toEqual(['無法確認刪除結果，請重新整理員工列表檢查'])
    expect(errorSpy).toHaveBeenCalled()
    // 善後照常進行
    expect(mockEmployee.updateMany).toHaveBeenCalledTimes(1)
    expect(mockIsManagedEmployeePhotoPath).toHaveBeenCalled()
  })

  it('still answers 200 and warns when clearing the supervisor references fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    queueFinds([makeDoc(1, { photo: PHOTO_A })], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })
    mockEmployee.updateMany.mockRejectedValue(new Error('update exploded'))

    const res = await run([oid(1)])

    expect(res.status).not.toHaveBeenCalled()
    const body = responseBody(res)
    expect(body.deletedCount).toBe(1)
    expect(body.unassignedSubordinates).toBe(0)
    expect(body.warnings).toEqual(['部分員工的直屬主管設定未能清除，請檢查原本隸屬已刪除主管的員工'])
    // 照片清理仍會執行
    expect(mockEmployee.exists).toHaveBeenCalled()
  })

  it('heals dangling supervisors on a retry where every id is already gone (not_found)', async () => {
    queueFinds([])
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 4 })

    const res = await run([oid(1), oid(2)])

    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
    expect(mockEmployee.updateMany).toHaveBeenCalledWith(
      { supervisor: { $in: [oid(1), oid(2)] } },
      { $unset: { supervisor: 1 } }
    )
    expect(responseBody(res)).toMatchObject({ deletedCount: 0, unassignedSubordinates: 4 })
  })

  it('warns when deleteMany removed fewer rows than are reported as deleted (concurrent delete)', async () => {
    queueFinds([makeDoc(1), makeDoc(2)], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })

    const res = await run([oid(1), oid(2)])

    expect(responseBody(res).deletedCount).toBe(2)
    expect(responseBody(res).warnings).toEqual(['部分員工在這次操作前已被刪除，實際刪除的人數可能少於清單'])
  })

  it('logs one info line with the actor and counts but no personal data', async () => {
    const infoSpy = console.info
    queueFinds([makeDoc(1, { name: '機密姓名', employeeId: 'SECRET-NO' }), makeDoc(2, { role: 'admin' })])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })

    await run([oid(1), oid(2)])

    expect(infoSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(infoSpy.mock.calls[0])
    expect(logged).toContain(ACTOR_ID)
    expect(infoSpy.mock.calls[0][1]).toMatchObject({ requested: 2, deleted: 1, deletedIds: [oid(1)] })
    expect(logged).not.toContain('機密姓名')
    expect(logged).not.toContain('SECRET-NO')
  })
})

describe('POST /api/employees/bulk-delete through the real app', () => {
  const buildAuthHeader = (role, id) => {
    const token = jwt.sign({ id, role, ver: 0 }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: 'hr-system',
      audience: 'hr-system-api',
    })
    return `Bearer ${token}`
  }

  const setUsers = (users) => {
    mockEmployee.findById.mockImplementation((id) => Promise.resolve(users[String(id)] ?? null))
  }

  const activeUser = (role) => ({
    role,
    status: '正職員工',
    accountEnabled: true,
    authVersion: 0,
  })

  it('rejects a non-admin with 403 and lets an admin reach the handler', async () => {
    const supervisorId = oid(901)
    setUsers({ [ACTOR_ID]: activeUser('admin'), [supervisorId]: activeUser('supervisor') })

    const forbidden = await request(app)
      .post('/api/employees/bulk-delete')
      .set('Authorization', buildAuthHeader('supervisor', supervisorId))
      .send({ ids: [oid(1)] })

    expect(forbidden.status).toBe(403)
    expect(mockEmployee.find).not.toHaveBeenCalled()
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()

    queueFinds([makeDoc(1, { photo: PHOTO_A }), makeDoc(900, { role: 'admin' })], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 2 })

    const allowed = await request(app)
      .post('/api/employees/bulk-delete')
      .set('Authorization', buildAuthHeader('admin', ACTOR_ID))
      .send({ ids: [oid(1), oid(900)] })

    expect(allowed.status).toBe(200)
    expect(allowed.body).toEqual({
      requested: 2,
      deletedCount: 1,
      deleted: [{ _id: oid(1), name: '員工1', employeeNo: 'E001' }],
      skipped: [{
        _id: oid(900),
        name: '員工900',
        employeeNo: 'E900',
        reason: 'self',
        message: '不能刪除自己的帳號',
      }],
      unassignedSubordinates: 2,
      impact: NO_IMPACT,
      warnings: [],
    })
    expect(mockEmployee.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [oid(1)] },
      role: { $ne: 'admin' },
    })
    expect(mockDeleteEmployeePhoto).toHaveBeenCalledWith(PHOTO_A)
  })

  it('rejects a JSON operator-injection body with 400 before touching the database', async () => {
    setUsers({ [ACTOR_ID]: activeUser('admin') })

    const res = await request(app)
      .post('/api/employees/bulk-delete')
      .set('Authorization', buildAuthHeader('admin', ACTOR_ID))
      .send({ ids: [{ $ne: null }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/[一-鿿]/)
    expect(mockEmployee.find).not.toHaveBeenCalled()
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/employees/bulk-delete')
      .send({ ids: [oid(1)] })

    expect(res.status).toBe(401)
    expect(mockEmployee.find).not.toHaveBeenCalled()
  })
})

describe('bulkDeleteEmployees approval impact', () => {
  const pendingFor = (...approverIds) => ({
    steps: [{ approvers: approverIds.map((id) => ({ approver: id, decision: 'pending' })) }],
  })

  it('looks at pending approvals before deleting and returns the impact without blocking', async () => {
    queueFinds([makeDoc(1, { name: '王主管' }), makeDoc(2)], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 2 })
    mockEmployee.updateMany.mockResolvedValue({ modifiedCount: 3 })
    mockEmployee.countDocuments.mockResolvedValue(3)
    mockApprovalRequest.find.mockReturnValue(queryChain([pendingFor(oid(1)), pendingFor(oid(1), oid(2)), pendingFor(oid(777))]))

    const res = await run([oid(1), oid(2)])

    expect(res.status).not.toHaveBeenCalled()
    const body = responseBody(res)
    expect(body.deletedCount).toBe(2)
    expect(body.impact.pendingRequests).toBe(2)
    expect(body.impact.pendingApprovers).toEqual([
      { _id: oid(1), name: '王主管', employeeNo: 'E001', requests: 2 },
      { _id: oid(2), name: '員工2', employeeNo: 'E002', requests: 1 },
    ])
    expect(body.impact.subordinates).toBe(3)
    expect(body.impact.messages[0]).toContain('2 筆進行中的簽核單')
    // 盤點必須在刪除之前，刪除後就查不到誰在等誰了
    expect(mockApprovalRequest.find.mock.invocationCallOrder[0]).toBeLessThan(
      mockEmployee.deleteMany.mock.invocationCallOrder[0]
    )
    // 影響只是提醒，不放進 warnings（那是給「刪除後善後失敗」用的）
    expect(body.warnings).toEqual([])
  })

  it('only counts employees that will really be deleted (not admins or the actor)', async () => {
    queueFinds([makeDoc(1), makeDoc(2, { role: 'admin' }), makeDoc(900)], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })

    await run([oid(1), oid(2), oid(900)])

    const approverFilter = mockApprovalRequest.find.mock.calls[0][0].steps.$elemMatch.approvers.$elemMatch.approver
    expect(approverFilter).toEqual({ $in: [oid(1)] })
  })

  it('does not look anything up when every id is skipped', async () => {
    queueFinds([makeDoc(1, { role: 'admin' })])

    const res = await run([oid(1)])

    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
    expect(responseBody(res).impact).toEqual(NO_IMPACT)
  })

  it('still deletes when the impact lookup fails, and says the numbers may be incomplete', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    queueFinds([makeDoc(1)], [])
    mockEmployee.deleteMany.mockResolvedValue({ deletedCount: 1 })
    mockApprovalRequest.find.mockImplementation(() => {
      throw new Error('mongodb://secret-host:27017 exploded')
    })

    const res = await run([oid(1)])

    expect(res.status).not.toHaveBeenCalled()
    const body = responseBody(res)
    expect(body.deletedCount).toBe(1)
    expect(body.impact.incomplete).toBe(true)
    expect(body.impact.messages.at(-1)).toContain('無法確認')
    expect(mockEmployee.deleteMany).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-host')
  })
})

describe('previewDeleteImpact (direct)', () => {
  it('does not delete anything and treats found admins and the actor as not deletable', async () => {
    const select = jest.fn().mockResolvedValue([
      makeDoc(1, { role: 'admin' }),
      makeDoc(2),
      makeDoc(900),
    ])
    mockEmployee.find.mockReturnValue({ select })
    mockApprovalRequest.find.mockReturnValue(queryChain([{ steps: [{ approvers: [{ approver: oid(2), decision: 'pending' }] }] }]))
    const res = makeRes()

    await previewDeleteImpact(makeReq([oid(1), oid(2), oid(900)]), res)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].impact.pendingRequests).toBe(1)
    expect(mockEmployee.deleteMany).not.toHaveBeenCalled()
    expect(mockEmployee.updateMany).not.toHaveBeenCalled()
  })
})
