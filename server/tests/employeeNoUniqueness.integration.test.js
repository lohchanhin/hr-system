// 員工編號唯一（services/employeeNoUniqueness.js）：啟動時先算重複的編號（只記筆數），沒有重複才建唯一索引，有重複不建也不擋啟動。
// 建好之後兩個請求同時用同一個編號新增員工，後到的回中文 400 DUPLICATE_EMPLOYEE（以前是資料庫 E11000 原文）。
// 需要 APPROVAL_ENGINE_TEST_MONGODB_URI（見 helpers/realAppKit.js）。
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

jest.setTimeout(60000)

const kit = createRealAppKit('employee_no_unique')

kit.describe('員工編號唯一索引（啟動時檢查）', () => {
  let service

  beforeAll(async () => {
    await kit.start()
    service = await import('../src/services/employeeNoUniqueness.js')
    await kit.addPerson('admin', { role: 'admin' })
  })
  afterAll(kit.stop)

  const raw = () => kit.models.Employee.collection
  const hasUniqueIndex = async () => (await raw().indexes()).some(index => index.name === service.EMPLOYEE_NO_UNIQUE_INDEX_NAME)

  it('counts duplicates and does not create the index while there are any (never throws, changes no data)', async () => {
    await raw().insertMany([
      { name: '舊甲', employeeId: 'DUP-1', email: 'old-a@example.test', username: 'old-a' },
      { name: '舊乙', employeeId: 'DUP-1', email: 'old-b@example.test', username: 'old-b' },
      { name: '舊丙', employeeId: 'DUP-1', email: 'old-c@example.test', username: 'old-c' },
      { name: '空白甲', employeeId: '', email: 'blank-a@example.test', username: 'blank-a' },
      { name: '空白乙', employeeId: '', email: 'blank-b@example.test', username: 'blank-b' },
      { name: '沒有編號', email: 'none@example.test', username: 'none' },
    ])
    const result = await service.ensureEmployeeNoUniqueIndex()
    expect(result).toEqual({ status: 'duplicates', duplicates: { values: 1, employees: 3 } })
    expect(service.describeEmployeeNoUniqueness(result)).toContain('1 numbers, 3 employees')
    expect(await hasUniqueIndex()).toBe(false)
    expect(await raw().countDocuments({ employeeId: 'DUP-1' })).toBe(3)
  })

  it('creates the index once the duplicates are fixed; blank and missing numbers stay allowed; running again is a no-op', async () => {
    await raw().updateOne({ username: 'old-b' }, { $set: { employeeId: 'DUP-2' } })
    await raw().updateOne({ username: 'old-c' }, { $set: { employeeId: 'DUP-3' } })
    expect((await service.ensureEmployeeNoUniqueIndex()).status).toBe('created')
    expect(await hasUniqueIndex()).toBe(true)
    expect((await service.ensureEmployeeNoUniqueIndex()).status).toBe('exists')
    // 空白或沒有編號的員工不受限制
    await raw().insertOne({ name: '空白丙', employeeId: '', email: 'blank-c@example.test', username: 'blank-c' })
    await expect(raw().insertOne({ name: '重複', employeeId: 'DUP-1', email: 'x@example.test', username: 'x' })).rejects.toMatchObject({ code: 11000 })
  })

  it('a duplicate that slips past the API check answers in Chinese', async () => {
    const { createEmployee } = await import('../src/controllers/employeeController.js')
    const realCountDocuments = kit.models.Employee.countDocuments
    // 模擬兩個請求同時送出：API 的重複檢查都還沒看到對方
    kit.models.Employee.countDocuments = async () => 0
    const json = jest.fn()
    const res = { status: jest.fn(() => res), json }
    try {
      await createEmployee({
        body: { name: '同時新增', email: 'race@example.test', employeeNo: 'DUP-1', username: 'race', password: 'Passw0rd!x' },
        user: { id: String(kit.people.admin._id), role: 'admin' },
      }, res)
    } finally {
      kit.models.Employee.countDocuments = realCountDocuments
    }
    expect(res.status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({ error: '員工編號已被其他員工使用，請改用別的員工編號', code: 'DUPLICATE_EMPLOYEE', field: 'employeeId' })
  })
})
