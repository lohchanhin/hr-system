import { jest } from '@jest/globals'

// 單元測試用記憶體版的模型；真的資料庫上的冪等與混合資料集由 leaveHoursBalances.integration.test.js 驗證
const mockEmployee = { find: jest.fn(), findOne: jest.fn(), bulkWrite: jest.fn(), updateOne: jest.fn(), exists: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockFormTemplate = { find: jest.fn(), updateOne: jest.fn() }
const mockFormField = { find: jest.fn(), create: jest.fn(), updateMany: jest.fn() }
const mockResetLeaveFieldCache = jest.fn()

let migration
let hoursUtils

const lean = (rows) => ({ select: () => ({ lean: async () => rows }), lean: async () => rows, sort: () => ({ lean: async () => rows }) })

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ resetLeaveFieldCache: mockResetLeaveFieldCache }))
  migration = await import('../src/services/leaveHoursMigration.js')
  hoursUtils = await import('../src/utils/annualLeaveHours.js')
})

beforeEach(() => {
  for (const mock of [mockEmployee, mockApprovalRequest, mockFormTemplate, mockFormField]) {
    Object.values(mock).forEach(fn => fn.mockReset())
  }
  mockResetLeaveFieldCache.mockReset()
})

describe('interpretLegacyAnnualLeave (the unit rule shared by the migration and the read fallback)', () => {
  const read = (total, used) => {
    const result = hoursUtils.interpretLegacyAnnualLeave(total, used)
    return [result.totalHours, result.usedHours, result.unitSource]
  }

  it('treats values up to 40 as days and multiplies by 8', () => {
    expect(read(0, 0)).toEqual([0, 0, 'migrated-days'])
    expect(read(3, 0)).toEqual([24, 0, 'migrated-days'])
    expect(read(14, 2.5)).toEqual([112, 20, 'migrated-days'])
    expect(read(30, 30)).toEqual([240, 240, 'migrated-days'])
    expect(read(40, 40)).toEqual([320, 320, 'migrated-days'])
    expect(read(24, 8)).toEqual([192, 64, 'migrated-days'])
  })

  it('treats a pair with any value above 40 as hours already (the customer typed 170 and 219)', () => {
    expect(read(170, 0)).toEqual([170, 0, 'migrated-hours'])
    expect(read(219, 2)).toEqual([219, 2, 'migrated-hours'])
    expect(read(41, 0)).toEqual([41, 0, 'migrated-hours'])
    expect(read(10, 41)).toEqual([10, 41, 'migrated-hours'])
  })

  it('tolerates missing, text and negative values', () => {
    expect(read(undefined, undefined)).toEqual([0, 0, 'migrated-days'])
    expect(read('12', '3')).toEqual([96, 24, 'migrated-days'])
    expect(read(-5, 'x')).toEqual([0, 0, 'migrated-days'])
  })

  // 整份資料的慣例是小時填在天數欄位：24、32、40 這種小數字也是小時（不再逐人猜成 3、4、5 天）
  it('with the hours convention of the whole data set, small numbers (24, 32, 40) are hours as well; people without data stay as they are', () => {
    const readAs = (total, used) => {
      const result = hoursUtils.interpretLegacyAnnualLeave(total, used, { hoursConvention: true })
      return [result.totalHours, result.usedHours, result.unitSource]
    }
    expect(readAs(24, 0)).toEqual([24, 0, 'migrated-hours'])
    expect(readAs(32, 8)).toEqual([32, 8, 'migrated-hours'])
    expect(readAs(40, 40)).toEqual([40, 40, 'migrated-hours'])
    expect(readAs(0, 3)).toEqual([0, 3, 'migrated-hours'])
    expect(readAs(170, 0)).toEqual([170, 0, 'migrated-hours'])
    expect(readAs(0, 0)).toEqual([0, 0, 'migrated-days']) // 沒有資料，沒有東西要確認
    expect(readAs(undefined, undefined)).toEqual([0, 0, 'migrated-days'])
  })

  it('decides the convention per data set: one number above 40 anywhere is enough, 24/32/40 alone are days', () => {
    const { usesHoursInDaysColumn, exceedsLegacyDaysMax } = hoursUtils
    expect(exceedsLegacyDaysMax(40, 40)).toBe(false)
    expect(exceedsLegacyDaysMax(0, 40.5)).toBe(true)
    expect(usesHoursInDaysColumn([{ totalDays: 24, usedDays: 0 }, { totalDays: 32, usedDays: 8 }, { totalDays: 40, usedDays: 1 }])).toBe(false)
    expect(usesHoursInDaysColumn([{ totalDays: 24 }, { totalDays: 170, usedDays: 8 }, { totalDays: 32 }])).toBe(true)
    expect(usesHoursInDaysColumn([{ totalDays: 10, usedDays: 41 }])).toBe(true)
    expect(usesHoursInDaysColumn([])).toBe(false)
    expect(usesHoursInDaysColumn(undefined)).toBe(false)
    expect(usesHoursInDaysColumn([null, {}])).toBe(false)
  })
})

describe('readAnnualLeaveHours', () => {
  const { readAnnualLeaveHours } = { readAnnualLeaveHours: (...args) => hoursUtils.readAnnualLeaveHours(...args) }

  it('uses the hours fields when they exist (a missing usedHours counts as 0)', () => {
    expect(readAnnualLeaveHours({ totalHours: 80, usedHours: 12.5, totalDays: 99, usedDays: 99 }))
      .toMatchObject({ totalHours: 80, usedHours: 12.5, remainingHours: 67.5, legacy: false, configured: true })
    expect(readAnnualLeaveHours({ totalHours: 80 })).toMatchObject({ usedHours: 0, remainingHours: 80, legacy: false })
  })

  it('reads a not-yet-migrated document exactly like the migration would write it', () => {
    expect(readAnnualLeaveHours({ totalDays: 14, usedDays: 3 }))
      .toMatchObject({ totalHours: 112, usedHours: 24, remainingHours: 88, legacy: true, unitSource: 'migrated-days' })
    expect(readAnnualLeaveHours({ totalDays: 170, usedDays: 8 }))
      .toMatchObject({ totalHours: 170, usedHours: 8, remainingHours: 162, legacy: true, unitSource: 'migrated-hours' })
  })

  it('reports an unconfigured employee and tolerates a missing object', () => {
    expect(readAnnualLeaveHours({ totalHours: 0, usedHours: 0 }).configured).toBe(false)
    expect(readAnnualLeaveHours({ totalDays: 0, usedDays: 0 }).configured).toBe(false)
    expect(readAnnualLeaveHours(undefined)).toMatchObject({ totalHours: 0, usedHours: 0, remainingHours: 0, configured: false })
  })

  it('can go negative when the total was lowered below what is already used (the display decides what to show)', () => {
    expect(readAnnualLeaveHours({ totalHours: 8, usedHours: 16 }).remainingHours).toBe(-8)
  })
})

describe('migrateAnnualLeaveToHours', () => {
  const employee = (id, annualLeave) => ({ _id: id, annualLeave })
  const setsOf = () => mockEmployee.bulkWrite.mock.calls[0][0].map(op => op.updateOne.update.$set)

  it('a data set where nobody is above 40: days x8, never rewrites the legacy fields, and counts without naming anyone', async () => {
    mockEmployee.find.mockReturnValue(lean([
      employee('e1', { totalDays: 14, usedDays: 2 }),
      employee('e2', { totalDays: 24, usedDays: 0 }),
      employee('e3', { totalDays: 0, usedDays: 0 }),
    ]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 3 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result).toEqual({ migrated: 3, fromDays: 3, alreadyHours: 0, repaired: 0, flagged: 0 })
    expect(mockEmployee.find).toHaveBeenCalledWith({ annualLeave: { $type: 'object' }, 'annualLeave.totalHours': { $exists: false } })
    const [operations, options] = mockEmployee.bulkWrite.mock.calls[0]
    expect(options).toMatchObject({ timestamps: false })
    expect(operations.map(op => op.updateOne.filter)).toEqual([
      { _id: 'e1', 'annualLeave.totalHours': { $exists: false } },
      { _id: 'e2', 'annualLeave.totalHours': { $exists: false } },
      { _id: 'e3', 'annualLeave.totalHours': { $exists: false } },
    ])
    expect(setsOf()).toEqual([
      { 'annualLeave.totalHours': 112, 'annualLeave.usedHours': 16, 'annualLeave.unitSource': 'migrated-days' },
      { 'annualLeave.totalHours': 192, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-days' },
      { 'annualLeave.totalHours': 0, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-days' },
    ])
    for (const operation of operations) {
      expect(Object.keys(operation.updateOne.update.$set).some(key => /Days$/.test(key))).toBe(false)
    }
  })

  // V16：bulkWrite 的 timestamps 選項不管更新，要在每一個 updateOne 上關掉才不會動到 updatedAt
  it('turns timestamps off on every single update operation (the bulkWrite option alone does not stop updatedAt)', async () => {
    mockEmployee.find.mockReturnValue(lean([employee('e1', { totalDays: 14, usedDays: 2 }), employee('e2', { totalDays: 170, usedDays: 0 })]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 2 })

    await migration.migrateAnnualLeaveToHours()

    const operations = mockEmployee.bulkWrite.mock.calls[0][0]
    expect(operations).toHaveLength(2)
    for (const operation of operations) expect(operation.updateOne.timestamps).toBe(false)
  })

  // V5：單位以整份資料判斷。24（3 天）、32、40 在一份有 170、219 的資料裡也是小時
  it('decides the unit for the whole data set: one number above 40 makes every unmigrated employee hours (24, 32, 40 are not 3, 4, 5 days)', async () => {
    mockEmployee.find.mockReturnValue(lean([
      employee('a', { totalDays: 14, usedDays: 2 }),
      employee('b', { totalDays: 170, usedDays: 0 }),
      employee('c', { totalDays: 24, usedDays: 0 }),
      employee('d', { totalDays: 32, usedDays: 8 }),
      employee('e', { totalDays: 40, usedDays: 0 }),
      employee('f', { totalDays: 0, usedDays: 0 }),
      employee('g', { totalDays: 219, usedDays: 2 }),
    ]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 7 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result).toEqual({ migrated: 7, fromDays: 1, alreadyHours: 6, repaired: 0, flagged: 0 })
    expect(setsOf()).toEqual([
      { 'annualLeave.totalHours': 14, 'annualLeave.usedHours': 2, 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalHours': 170, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalHours': 24, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalHours': 32, 'annualLeave.usedHours': 8, 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalHours': 40, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalHours': 0, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-days' }, // 沒有資料，不需要確認
      { 'annualLeave.totalHours': 219, 'annualLeave.usedHours': 2, 'annualLeave.unitSource': 'migrated-hours' },
    ])
    // 待搬移的人裡已經有證據，搬移本身不必再查資料庫；只有最後的標記步驟查一次
    expect(mockEmployee.exists).toHaveBeenCalledTimes(1)
  })

  it('follows the convention that is already visible in the migrated employees (a straggler with small numbers is hours too)', async () => {
    mockEmployee.find.mockReturnValue(lean([employee('late', { totalDays: 24, usedDays: 0 })]))
    mockEmployee.exists.mockResolvedValue({ _id: 'someone-with-170' })
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 1 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result).toMatchObject({ migrated: 1, fromDays: 0, alreadyHours: 1 })
    expect(setsOf()).toEqual([{ 'annualLeave.totalHours': 24, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-hours' }])
    const evidence = mockEmployee.exists.mock.calls[0][0]
    expect(evidence.$or).toEqual(expect.arrayContaining([
      { 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalDays': { $gt: 40 } },
      { 'annualLeave.usedDays': { $gt: 40 } },
    ]))
  })

  it('does nothing and writes nothing when every employee was already migrated (second run)', async () => {
    mockEmployee.find.mockReturnValue(lean([]))
    expect(await migration.migrateAnnualLeaveToHours()).toEqual({ migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0, flagged: 0 })
    expect(mockEmployee.bulkWrite).not.toHaveBeenCalled()
  })

  it('repairs hour-sized counters that the old code topped up with DAYS: +7 hours for every deducted day of an applied request', async () => {
    mockEmployee.find.mockReturnValue(lean([
      employee('e1', { totalDays: 170, usedDays: 42, appliedApprovalRequestIds: ['r1', 'r2', 'r3'] }),
      employee('e2', { totalDays: 12, usedDays: 3, appliedApprovalRequestIds: ['r9'] }), // 整份資料是小時慣例：和 e1 一樣修正
    ]))
    const requests = {
      r1: { _id: 'r1', annual_leave: { state: 'deducted', days: 1 } },
      r2: { _id: 'r2', annual_leave: { state: 'deducted', days: 0.5 } },
      r3: { _id: 'r3', annual_leave: { state: 'refunded', days: 3 } }, // 已返還的不算
      r9: { _id: 'r9', annual_leave: { state: 'deducted', days: 2 } },
    }
    mockApprovalRequest.find.mockImplementation((filter) => lean(filter._id.$in.map(id => requests[id])))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 2 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result).toEqual({ migrated: 2, fromDays: 0, alreadyHours: 2, repaired: 2, flagged: 0 })
    const sets = setsOf()
    expect(sets[0]).toMatchObject({ 'annualLeave.totalHours': 170, 'annualLeave.usedHours': 42 + 7 * 1.5, 'annualLeave.unitSource': 'migrated-hours' })
    expect(sets[1]).toMatchObject({ 'annualLeave.totalHours': 12, 'annualLeave.usedHours': 3 + 7 * 2, 'annualLeave.unitSource': 'migrated-hours' })
  })

  it('does not look up requests for days-x8 employees (nothing to repair there)', async () => {
    mockEmployee.find.mockReturnValue(lean([employee('e2', { totalDays: 12, usedDays: 3, appliedApprovalRequestIds: ['r9'] })]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 1 })

    await migration.migrateAnnualLeaveToHours()

    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
    expect(setsOf()[0]).toMatchObject({ 'annualLeave.totalHours': 96, 'annualLeave.usedHours': 24, 'annualLeave.unitSource': 'migrated-days' })
  })

  it('migrates without the repair when the requests cannot be read', async () => {
    mockEmployee.find.mockReturnValue(lean([employee('e1', { totalDays: 170, usedDays: 42, appliedApprovalRequestIds: ['bad'] })]))
    mockApprovalRequest.find.mockReturnValue({ select: () => ({ lean: async () => { throw new Error('cast') } }) })
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 1 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result.repaired).toBe(0)
    expect(mockEmployee.bulkWrite.mock.calls[0][0][0].updateOne.update.$set['annualLeave.usedHours']).toBe(42)
  })
})

// V5：用舊規則（逐人判斷）搬過的資料：不自動改數字，只把可能猜錯的標成待確認；冪等
describe('flagGuessedAnnualLeaveUnits (data that the earlier per-person rule already migrated)', () => {
  const migrated = (id, annualLeave) => ({ _id: id, annualLeave: { unitSource: 'migrated-days', ...annualLeave } })

  it('does nothing when no employee shows the hours convention (a pure days data set is left alone)', async () => {
    mockEmployee.exists.mockResolvedValue(null)

    expect(await migration.flagGuessedAnnualLeaveUnits()).toBe(0)
    expect(mockEmployee.find).not.toHaveBeenCalled()
    expect(mockEmployee.bulkWrite).not.toHaveBeenCalled()
  })

  it('flags only the days-x8 employees whose total is still the frozen days x 8, changes only the unit source and never the numbers or updatedAt', async () => {
    mockEmployee.exists.mockResolvedValue({ _id: 'e170' })
    mockEmployee.find.mockReturnValue(lean([
      migrated('g1', { totalDays: 24, usedDays: 0, totalHours: 192, usedHours: 0 }), // 24 被當成 3 天 x 8
      migrated('g2', { totalDays: 14, usedDays: 2, totalHours: 112, usedHours: 24 }), // 之後核准特休又用了 8 小時：總時數沒變，照樣標記
      migrated('edited', { totalDays: 14, usedDays: 2, totalHours: 120, usedHours: 16 }), // 人資改過總時數（不應該還是 migrated-days，保險起見也不標）
      migrated('empty', { totalDays: 0, usedDays: 0, totalHours: 0, usedHours: 0 }), // 沒有資料
      migrated('big', { totalDays: 170, usedDays: 0, totalHours: 170, usedHours: 0 }), // 不是乘 8 猜出來的
    ]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 2 })
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    expect(await migration.flagGuessedAnnualLeaveUnits()).toBe(2)

    const [operations, options] = mockEmployee.bulkWrite.mock.calls[0]
    expect(options).toMatchObject({ timestamps: false })
    expect(operations.map(op => op.updateOne.filter)).toEqual([
      { _id: 'g1', 'annualLeave.unitSource': 'migrated-days', 'annualLeave.totalHours': 192 },
      { _id: 'g2', 'annualLeave.unitSource': 'migrated-days', 'annualLeave.totalHours': 112 },
    ])
    for (const operation of operations) {
      expect(operation.updateOne.update).toEqual({ $set: { 'annualLeave.unitSource': 'migrated-hours' } })
      expect(operation.updateOne.timestamps).toBe(false)
    }
    // 只記錄筆數，不記錄員工資料
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe('Flagged 2 employees for annual leave unit confirmation (this data has hour-sized values in the days column)')
    log.mockRestore()
  })

  it('only looks at migrated-days employees that have hours (the filter is part of the query)', async () => {
    mockEmployee.exists.mockResolvedValue({ _id: 'e170' })
    mockEmployee.find.mockReturnValue(lean([]))

    expect(await migration.flagGuessedAnnualLeaveUnits()).toBe(0)
    expect(mockEmployee.find).toHaveBeenCalledWith({ 'annualLeave.unitSource': 'migrated-days', 'annualLeave.totalHours': { $exists: true } })
    expect(mockEmployee.bulkWrite).not.toHaveBeenCalled()
  })

  it('is run at the end of the startup migration, also when nothing needed migrating, and its failure never fails the migration', async () => {
    mockEmployee.find.mockReturnValueOnce(lean([])) // 沒有待搬移的員工
    mockEmployee.exists.mockResolvedValue({ _id: 'e170' })
    mockEmployee.find.mockReturnValueOnce(lean([migrated('g1', { totalDays: 24, usedDays: 0, totalHours: 192, usedHours: 0 })]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 1 })
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    expect(await migration.migrateAnnualLeaveToHours()).toEqual({ migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0, flagged: 1 })
    log.mockRestore()

    mockEmployee.bulkWrite.mockReset()
    mockEmployee.find.mockReset()
    mockEmployee.find.mockReturnValueOnce(lean([]))
    mockEmployee.exists.mockRejectedValue(Object.assign(new Error('down'), { name: 'MongoNetworkError' }))
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await migration.migrateAnnualLeaveToHours()).toEqual({ migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0, flagged: 0 })
    expect(error).toHaveBeenCalledWith('Failed to flag annual leave units for confirmation', 'MongoNetworkError')
    error.mockRestore()
  })
})

describe('previewAnnualLeaveMigration and buildAnnualLeaveUnitReport (maintenance script: --dry-run and --report)', () => {
  it('previews with the same whole-data-set rule and reports how many earlier guesses would be flagged', async () => {
    const employee = (id, annualLeave) => ({ _id: id, annualLeave })
    mockEmployee.find
      .mockReturnValueOnce(lean([employee('a', { totalDays: 14 }), employee('b', { totalDays: 170 }), employee('c', { totalDays: 0 })]))
      .mockReturnValueOnce(lean([{ _id: 'g', annualLeave: { unitSource: 'migrated-days', totalDays: 24, usedDays: 0, totalHours: 192 } }]))
    mockEmployee.exists.mockResolvedValue({ _id: 'x' })

    expect(await migration.previewAnnualLeaveMigration()).toEqual({ pending: 3, fromDays: 1, alreadyHours: 2, hoursConvention: true, toFlag: 1 })
    expect(mockEmployee.bulkWrite).not.toHaveBeenCalled()
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('lists employeeId, name, the frozen day values, the current hours and the unit source so HR can eyeball them', async () => {
    mockEmployee.exists.mockResolvedValue({ _id: 'x' })
    mockEmployee.find.mockReturnValue(lean([
      { employeeId: 'E010', name: '乙', annualLeave: { totalDays: 24, usedDays: 0, totalHours: 192, usedHours: 0, unitSource: 'migrated-days' } },
      { employeeId: 'E002', name: '甲', annualLeave: { totalDays: 170, usedDays: 8, totalHours: 170, usedHours: 8, unitSource: 'migrated-hours' } },
      { employeeId: 'E003', name: '丙', annualLeave: { totalDays: 14, usedDays: 0, totalHours: 120, usedHours: 0, unitSource: 'migrated-days' } },
      { employeeId: 'E004', name: '丁', annualLeave: { totalDays: 14, usedDays: 0, totalHours: 112, usedHours: 0, unitSource: 'entered' } }, // 人資確認過：不列
      { employeeId: 'E005', name: '戊', annualLeave: { totalDays: 0, usedDays: 0, totalHours: 0, usedHours: 0, unitSource: 'migrated-days' } }, // 沒有資料：不列
      { employeeId: 'E006', name: '己', annualLeave: { totalDays: 5, usedDays: 1 } }, // 還沒搬移
    ]))

    const report = await migration.buildAnnualLeaveUnitReport()

    expect(report.hoursConvention).toBe(true)
    expect(report.rows).toEqual([
      { employeeId: 'E002', name: '甲', totalDays: 170, usedDays: 8, totalHours: 170, usedHours: 8, unitSource: 'migrated-hours', reading: 'as hours' },
      { employeeId: 'E003', name: '丙', totalDays: 14, usedDays: 0, totalHours: 120, usedHours: 0, unitSource: 'migrated-days', reading: 'edited' },
      { employeeId: 'E006', name: '己', totalDays: 5, usedDays: 1, totalHours: null, usedHours: null, unitSource: 'not-migrated', reading: 'not-migrated' },
      { employeeId: 'E010', name: '乙', totalDays: 24, usedDays: 0, totalHours: 192, usedHours: 0, unitSource: 'migrated-days', reading: 'days x8' },
    ])
  })
})

describe('ensureAnnualLeaveHours (one employee, used by deduct / refund / quota when a document is still legacy)', () => {
  it('converts a legacy employee once and reports whether it did', async () => {
    mockEmployee.findOne.mockReturnValue(lean([]))
    mockEmployee.findOne.mockReturnValueOnce({ select: () => ({ lean: async () => ({ _id: 'e1', annualLeave: { totalDays: 5, usedDays: 1 } }) }) })
    mockEmployee.updateOne.mockResolvedValue({ modifiedCount: 1 })

    expect(await migration.ensureAnnualLeaveHours('e1')).toBe(true)
    expect(mockEmployee.updateOne).toHaveBeenCalledWith(
      { _id: 'e1', 'annualLeave.totalHours': { $exists: false } },
      { $set: { 'annualLeave.totalHours': 40, 'annualLeave.usedHours': 8, 'annualLeave.unitSource': 'migrated-days' } },
      { timestamps: false },
    )
  })

  it('does nothing for an employee that is already on hours', async () => {
    mockEmployee.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) })
    expect(await migration.ensureAnnualLeaveHours('e1')).toBe(false)
    expect(await migration.ensureAnnualLeaveHours('')).toBe(false)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })
})

describe('migrateLeaveFormsToHours', () => {
  const form = (id, name, extra = {}) => ({ _id: id, name, semanticType: 'leave', ...extra })
  const field = (id, label, order, extra = {}) => ({ _id: id, label, order, ...extra })

  it('adds a required 時數 field in the slot of the active 天數 field, deactivates 天數 and marks the form', async () => {
    mockFormTemplate.find.mockReturnValue(lean([form('f1', '休假/事假/公假申請單')]))
    mockFormField.find.mockReturnValue(lean([
      field('t', '假別類別 (C12)', 1), field('s', '日期(起)', 2), field('e', '日期(迄)', 3), field('d', '天數', 4, { required: true }),
    ]))

    const result = await migration.migrateLeaveFormsToHours()

    expect(result).toEqual({ forms: 1, added: 1, deactivated: 1 })
    expect(mockFormField.create).toHaveBeenCalledWith(expect.objectContaining({
      form: 'f1', label: '時數', type_1: 'number', required: true, order: 4, is_active: true,
    }))
    expect(mockFormField.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['d'] }, is_active: { $ne: false } },
      { $set: { is_active: false } },
    )
    expect(mockFormTemplate.updateOne).toHaveBeenCalledWith(
      { _id: 'f1', leave_hours_migrated: { $ne: true } },
      { $set: { leave_hours_migrated: true } },
      { timestamps: false },
    )
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
    // 先補欄位、再停用天數、最後才寫標記（中途失敗再執行會從停下的地方繼續）
    const order = [mockFormField.create, mockFormField.updateMany, mockFormTemplate.updateOne].map(fn => fn.mock.invocationCallOrder[0])
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('puts the new field right after the end field when the form has no 天數 field', async () => {
    mockFormTemplate.find.mockReturnValue(lean([form('f1', '請假')]))
    mockFormField.find.mockReturnValue(lean([
      field('t', '假別', 1), field('s', '開始時間', 2), field('e', '結束時間', 3), field('r', '事由', 4),
    ]))

    const result = await migration.migrateLeaveFormsToHours()

    expect(result).toEqual({ forms: 1, added: 1, deactivated: 0 })
    expect(mockFormField.create).toHaveBeenCalledWith(expect.objectContaining({ order: 3.5 }))
    expect(mockFormField.updateMany).not.toHaveBeenCalled()
  })

  it('does not add a second hours field when the form already has one (active or not) but still deactivates 天數', async () => {
    mockFormTemplate.find.mockReturnValue(lean([form('f1', '請假')]))
    mockFormField.find.mockReturnValue(lean([
      field('s', '開始時間', 2), field('e', '結束時間', 3), field('h', '請假時數', 4, { is_active: false }), field('d', '天數', 5),
    ]))

    const result = await migration.migrateLeaveFormsToHours()

    expect(result).toEqual({ forms: 1, added: 0, deactivated: 1 })
    expect(mockFormField.create).not.toHaveBeenCalled()
  })

  it('only looks at leave forms that were not migrated yet (a deleted hours field is never re-added)', async () => {
    mockFormTemplate.find.mockReturnValue(lean([form('g1', '加班申請', { semanticType: 'overtime' }), form('g2', '總務申請', { semanticType: 'general' })]))

    expect(await migration.migrateLeaveFormsToHours()).toEqual({ forms: 0, added: 0, deactivated: 0 })
    expect(mockFormTemplate.find).toHaveBeenCalledWith({ leave_hours_migrated: { $ne: true } }, expect.anything())
    expect(mockFormField.create).not.toHaveBeenCalled()
    expect(mockFormTemplate.updateOne).not.toHaveBeenCalled()
  })
})
