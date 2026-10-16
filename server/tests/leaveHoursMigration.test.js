import { jest } from '@jest/globals'

// 單元測試用記憶體版的模型；真的資料庫上的冪等與混合資料集由 leaveHoursBalances.integration.test.js 驗證
const mockEmployee = { find: jest.fn(), findOne: jest.fn(), bulkWrite: jest.fn(), updateOne: jest.fn() }
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

  it('converts days x8, keeps hour-sized values, never rewrites the legacy fields, and counts without naming anyone', async () => {
    mockEmployee.find.mockReturnValue(lean([
      employee('e1', { totalDays: 14, usedDays: 2 }),
      employee('e2', { totalDays: 170, usedDays: 0 }),
      employee('e3', { totalDays: 0, usedDays: 0 }),
    ]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 3 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result).toEqual({ migrated: 3, fromDays: 2, alreadyHours: 1, repaired: 0 })
    expect(mockEmployee.find).toHaveBeenCalledWith({ annualLeave: { $type: 'object' }, 'annualLeave.totalHours': { $exists: false } })
    const [operations, options] = mockEmployee.bulkWrite.mock.calls[0]
    expect(options).toMatchObject({ timestamps: false })
    expect(operations.map(op => op.updateOne.filter)).toEqual([
      { _id: 'e1', 'annualLeave.totalHours': { $exists: false } },
      { _id: 'e2', 'annualLeave.totalHours': { $exists: false } },
      { _id: 'e3', 'annualLeave.totalHours': { $exists: false } },
    ])
    expect(operations.map(op => op.updateOne.update.$set)).toEqual([
      { 'annualLeave.totalHours': 112, 'annualLeave.usedHours': 16, 'annualLeave.unitSource': 'migrated-days' },
      { 'annualLeave.totalHours': 170, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-hours' },
      { 'annualLeave.totalHours': 0, 'annualLeave.usedHours': 0, 'annualLeave.unitSource': 'migrated-days' },
    ])
    for (const operation of operations) {
      expect(Object.keys(operation.updateOne.update.$set).some(key => /Days$/.test(key))).toBe(false)
    }
  })

  it('does nothing and writes nothing when every employee was already migrated (second run)', async () => {
    mockEmployee.find.mockReturnValue(lean([]))
    expect(await migration.migrateAnnualLeaveToHours()).toEqual({ migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0 })
    expect(mockEmployee.bulkWrite).not.toHaveBeenCalled()
  })

  it('repairs hour-sized counters that the old code topped up with DAYS: +7 hours for every deducted day of an applied request', async () => {
    mockEmployee.find.mockReturnValue(lean([
      employee('e1', { totalDays: 170, usedDays: 42, appliedApprovalRequestIds: ['r1', 'r2', 'r3'] }),
      employee('e2', { totalDays: 12, usedDays: 3, appliedApprovalRequestIds: ['r9'] }), // 天數：不修正
    ]))
    mockApprovalRequest.find.mockReturnValue(lean([
      { _id: 'r1', annual_leave: { state: 'deducted', days: 1 } },
      { _id: 'r2', annual_leave: { state: 'deducted', days: 0.5 } },
      { _id: 'r3', annual_leave: { state: 'refunded', days: 3 } }, // 已返還的不算
    ]))
    mockEmployee.bulkWrite.mockResolvedValue({ modifiedCount: 2 })

    const result = await migration.migrateAnnualLeaveToHours()

    expect(result).toEqual({ migrated: 2, fromDays: 1, alreadyHours: 1, repaired: 1 })
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1) // 只有「小時」的員工才需要查單據
    const sets = mockEmployee.bulkWrite.mock.calls[0][0].map(op => op.updateOne.update.$set)
    expect(sets[0]).toMatchObject({ 'annualLeave.totalHours': 170, 'annualLeave.usedHours': 42 + 7 * 1.5, 'annualLeave.unitSource': 'migrated-hours' })
    expect(sets[1]).toMatchObject({ 'annualLeave.totalHours': 96, 'annualLeave.usedHours': 24, 'annualLeave.unitSource': 'migrated-days' })
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
