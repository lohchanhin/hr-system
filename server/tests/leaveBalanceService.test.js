import { jest } from '@jest/globals'

const mockEmployee = { findById: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()
const mockGetSettings = jest.fn()

let balanceService
let policyService

// 每張假單表單 -> 該表單底下的單據（ApprovalRequest.find 依 form 條件回傳）
let requestsByForm = {}
let lastFindFilters = []

function employeeDoc(annualLeave = {}, extra = {}) {
  return { _id: 'emp1', name: '小美', employeeId: 'A001', annualLeave, ...extra }
}

// 預設的請假表單（文字假別 + 開始／結束時間 + 時數）與客戶的表單（字典假別 + 日期起迄 + 天數，已停用天數換成時數）
const defaultFormInfo = {
  formId: 'form-default', isActive: true,
  typeId: 'd-type', startId: 'd-start', endId: 'd-end', daysId: undefined, hoursId: 'd-hours',
  typeIds: ['d-type'], startIds: ['d-start'], endIds: ['d-end'], daysIds: [], hoursIds: ['d-hours'],
  typeOptions: [],
}
const customerFormInfo = {
  formId: 'form-customer', isActive: true,
  typeId: 'c-type', startId: 'c-start', endId: 'c-end', daysId: 'c-days-old', hoursId: 'c-hours',
  typeIds: ['c-type'], startIds: ['c-start'], endIds: ['c-end'], daysIds: ['c-days-old'], hoursIds: ['c-hours'],
  typeOptions: [{ value: '事假', label: '事假' }, { value: '病假', label: '病假' }, { value: '特休假', label: '特休假' }, { value: '進修假', label: '進修假' }],
}

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: mockGetSettings }))
  balanceService = await import('../src/services/leaveBalanceService.js')
  policyService = await import('../src/services/leavePolicyService.js')
})

beforeEach(() => {
  requestsByForm = {}
  lastFindFilters = []
  mockEmployee.findById.mockReset()
  mockApprovalRequest.find.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockGetSettings.mockReset()
  mockGetSettings.mockResolvedValue({})
  policyService.resetLeavePolicyCache()
  mockEmployee.findById.mockImplementation(() => ({ select: () => ({ lean: async () => currentEmployee }) }))
  mockApprovalRequest.find.mockImplementation((filter) => {
    lastFindFilters.push(filter)
    const rows = (requestsByForm[filter.form] || []).filter(row => filter.status.$in.includes(row.status))
    return { select: () => ({ lean: async () => rows }) }
  })
  mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo, customerFormInfo])
  currentEmployee = employeeDoc({ totalHours: 80, usedHours: 16, year: 2026 })
})

let currentEmployee

const request = (id, status, formData, createdAt = '2026-02-01T00:00:00.000Z') => ({ _id: id, status, createdAt, form_data: formData })
const itemOf = (balances, key) => balances.items.find(item => item.key === key)

describe('buildLeaveBalances: usage per leave type from the requests of every leave form', () => {
  it('adds up approved and pending hours per type, from the hours field, the old 天數 field and the dates', async () => {
    requestsByForm['form-default'] = [
      request('r1', 'approved', { 'd-type': '事假', 'd-start': '2026-03-02T01:00:00.000Z', 'd-end': '2026-03-02T05:00:00.000Z', 'd-hours': 4 }),
      request('r2', 'pending', { 'd-type': '事假', 'd-start': '2026-04-01', 'd-end': '2026-04-01', 'd-hours': 2.5 }),
    ]
    requestsByForm['form-customer'] = [
      // 客戶的表單：舊的天數欄位（停用後的舊單據）2 天 = 16 小時
      request('r3', 'approved', { 'c-type': '事假', 'c-start': '2026-05-04', 'c-end': '2026-05-05', 'c-days-old': 2 }),
      // 日期推算：3 天
      request('r4', 'approved', { 'c-type': '病假', 'c-start': '2026-06-01', 'c-end': '2026-06-03' }),
    ]

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'personal')).toMatchObject({
      quotaHours: 112, usedHours: 20, pendingHours: 2.5, remainingHours: 92, availableHours: 89.5,
      quotaDays: 14, usedDays: 2.5, status: 'ok', enforcement: 'warn',
    })
    expect(itemOf(balances, 'sick')).toMatchObject({ quotaHours: 240, usedHours: 24, remainingHours: 216, pendingHours: 0 })
    expect(balances).toMatchObject({ year: 2026, range: { start: '2026-01-01', end: '2026-12-31' }, maxHoursPerDay: 8, dayHours: 8 })
    expect(balances.employee).toEqual({ _id: 'emp1', name: '小美', employeeId: 'A001' })
  })

  it('queries only approved and pending requests of this employee, form by form (inactive forms included)', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo, { ...customerFormInfo, isActive: false }])
    await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })
    expect(lastFindFilters).toEqual([
      { form: 'form-default', applicant_employee: 'emp1', status: { $in: ['approved', 'pending'] } },
      { form: 'form-customer', applicant_employee: 'emp1', status: { $in: ['approved', 'pending'] } },
    ])
  })

  it('ignores rejected, returned and canceled requests even if they come back from the query', async () => {
    requestsByForm['form-default'] = []
    mockApprovalRequest.find.mockImplementation(() => ({
      select: () => ({
        lean: async () => ['rejected', 'returned', 'canceled', 'approved'].map((status, index) => request(`r${index}`, status, {
          'd-type': '事假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 8,
        })),
      }),
    }))
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'personal')).toMatchObject({ usedHours: 8, pendingHours: 0 })
  })

  it('reads the answers of requests whose fields were replaced (old field ids) per request', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...defaultFormInfo,
      typeId: 'n-type', typeIds: ['n-type', 'o-type'],
      startIds: ['n-start', 'o-start'], endIds: ['n-end', 'o-end'], hoursIds: ['n-hours', 'o-hours'],
    }])
    requestsByForm['form-default'] = [
      request('old', 'approved', { 'o-type': '病假', 'o-start': '2026-03-02', 'o-end': '2026-03-02', 'o-hours': 3 }),
      request('new', 'approved', { 'n-type': '病假', 'n-start': '2026-03-09', 'n-end': '2026-03-09', 'n-hours': 5 }),
    ]

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'sick').usedHours).toBe(8)
  })

  it('splits a leave that crosses the new year: each year only gets its own days', async () => {
    requestsByForm['form-default'] = [
      request('r1', 'approved', { 'd-type': '事假', 'd-start': '2026-12-30', 'd-end': '2027-01-02', 'd-hours': 16 }),
    ]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const in2026 = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })
    const in2027 = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2027 })

    expect(itemOf(in2026, 'personal').usedHours).toBe(8)
    expect(itemOf(in2027, 'personal').usedHours).toBe(8)
  })

  it('files an undated legacy request under the year it was created in, with the 8 hour default', async () => {
    requestsByForm['form-default'] = [
      request('r1', 'approved', { 'd-type': '事假' }, '2026-07-01T00:00:00.000Z'),
      request('r2', 'approved', { 'd-type': '事假' }, '2025-07-01T00:00:00.000Z'),
    ]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'personal').usedHours).toBe(8)
  })

  it('leaves the request being looked at out (the balance shown is the one before it)', async () => {
    requestsByForm['form-default'] = [
      request('this', 'pending', { 'd-type': '事假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 8 }),
      request('other', 'pending', { 'd-type': '事假', 'd-start': '2026-03-09', 'd-end': '2026-03-09', 'd-hours': 4 }),
    ]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026, excludeRequestId: 'this' })

    expect(itemOf(balances, 'personal').pendingHours).toBe(4)
  })

  it('returns null for an employee that does not exist', async () => {
    currentEmployee = null
    expect(await balanceService.buildLeaveBalances({ employeeId: 'nobody', year: 2026 })).toBeNull()
  })
})

describe('buildLeaveBalances: types that count against another type', () => {
  it('counts all of 家庭照顧假 against 事假, and only the hours of 生理假 beyond 3 days against 病假', async () => {
    requestsByForm['form-default'] = [
      request('p', 'approved', { 'd-type': '事假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 36 }),
      request('f', 'approved', { 'd-type': '家庭照顧假', 'd-start': '2026-03-09', 'd-end': '2026-03-09', 'd-hours': 8 }),
      request('s', 'approved', { 'd-type': '病假', 'd-start': '2026-04-01', 'd-end': '2026-04-01', 'd-hours': 8 }),
      request('m1', 'approved', { 'd-type': '生理假', 'd-start': '2026-05-04', 'd-end': '2026-05-04', 'd-hours': 32 }),
    ]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    // 事假 36 自己 + 8 家庭照顧假
    expect(itemOf(balances, 'personal')).toMatchObject({ usedHours: 44, remainingHours: 68, includes: [{ key: 'family_care', name: '家庭照顧假', hours: 8 }] })
    expect(itemOf(balances, 'family_care')).toMatchObject({ usedHours: 8, remainingHours: 48 })
    // 病假 8 自己 + (32 - 24) 生理假
    expect(itemOf(balances, 'sick')).toMatchObject({ usedHours: 16, includes: [{ key: 'menstrual', name: '生理假', hours: 8 }] })
    expect(itemOf(balances, 'menstrual')).toMatchObject({ usedHours: 32, remainingHours: 64 })
  })

  it('does not add anything from 生理假 inside the free 3 days', async () => {
    requestsByForm['form-default'] = [request('m', 'approved', { 'd-type': '生理假', 'd-start': '2026-05-04', 'd-end': '2026-05-04', 'd-hours': 16 })]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'sick')).toMatchObject({ usedHours: 0, includes: [] })
  })
})

describe('buildLeaveBalances: 特休, 補休 and 積假 come from the employee record', () => {
  it('shows the stored annual leave counter in hours with pending requests on top, and echoes the year and expiry', async () => {
    currentEmployee = employeeDoc({ totalHours: 120, usedHours: 40, year: 2026, expiryDate: '2026-12-31T00:00:00.000Z' })
    requestsByForm['form-default'] = [
      request('a', 'pending', { 'd-type': '特休假', 'd-start': '2026-08-03', 'd-end': '2026-08-03', 'd-hours': 8 }),
      request('b', 'approved', { 'd-type': '特休假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 8 }), // 已核准的已在計數裡，不重複加
    ]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'annual')).toMatchObject({
      source: 'employee', quotaHours: 120, usedHours: 40, pendingHours: 8, remainingHours: 80, availableHours: 72,
      quotaDays: 15, remainingDays: 10, annualYear: 2026, status: 'ok', enforcement: 'block',
    })
    expect(itemOf(balances, 'annual').expiryDate).toBe('2026-12-31T00:00:00.000Z')
  })

  it('reads a not-yet-migrated employee (days) as hours the same way the migration will write it', async () => {
    currentEmployee = employeeDoc({ totalDays: 14, usedDays: 2 })
    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })
    expect(itemOf(balances, 'annual')).toMatchObject({ quotaHours: 112, usedHours: 16, remainingHours: 96 })

    currentEmployee = employeeDoc({ totalDays: 170, usedDays: 10 })
    const hourSized = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })
    expect(itemOf(hourSized, 'annual')).toMatchObject({ quotaHours: 170, usedHours: 10, remainingHours: 160 })
  })

  it('marks an employee without any 特休 setup as unconfigured and an exhausted or over-used one as low / over', async () => {
    currentEmployee = employeeDoc({ totalHours: 0, usedHours: 0 })
    expect(itemOf(await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 }), 'annual'))
      .toMatchObject({ status: 'unconfigured', note: '尚未設定特休時數，請洽人資' })

    currentEmployee = employeeDoc({ totalHours: 80, usedHours: 76 })
    expect(itemOf(await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 }), 'annual').status).toBe('low')

    currentEmployee = employeeDoc({ totalHours: 16, usedHours: 24 })
    expect(itemOf(await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 }), 'annual')).toMatchObject({ status: 'over', remainingHours: -8 })
  })

  it('shows 補休 as a manual balance only when the employee holds some or has used it, and 積假 (days x8) as a manual row', async () => {
    currentEmployee = employeeDoc({ totalHours: 80, usedHours: 0, compensatoryHours: 6, accumulatedLeave: 2 })
    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'comp')).toMatchObject({ source: 'employee-manual', quotaHours: 6, remainingHours: 6, status: 'manual', note: expect.stringContaining('人資') })
    expect(itemOf(balances, 'accumulated')).toMatchObject({ name: '積假', quotaHours: 16, remainingHours: 16, source: 'employee-manual', status: 'manual' })

    currentEmployee = employeeDoc({ totalHours: 80, usedHours: 0 })
    const none = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })
    expect(itemOf(none, 'comp')).toBeUndefined()
    expect(itemOf(none, 'accumulated')).toBeUndefined()
  })

  it('collectEmployeeHeldBalances is the single place where manually kept balances are collected', () => {
    expect(balanceService.collectEmployeeHeldBalances({ annualLeave: { accumulatedLeave: 1.5 } }))
      .toEqual([{ key: 'accumulated', name: '積假', hours: 12, note: expect.any(String) }])
    expect(balanceService.collectEmployeeHeldBalances({ annualLeave: {} })).toEqual([])
    expect(balanceService.collectEmployeeHeldBalances(undefined)).toEqual([])
  })
})

describe('buildLeaveBalances: per-event types, uncapped types, visibility and unmatched types', () => {
  it('shows per-event types (婚假…) only once used, with the per-request ceiling and no remaining', async () => {
    requestsByForm['form-default'] = [request('m', 'approved', { 'd-type': '婚假', 'd-start': '2026-03-02', 'd-end': '2026-03-10', 'd-hours': 64 })]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'marriage')).toMatchObject({ period: 'event', quotaHours: 64, usedHours: 64, remainingHours: null, availableHours: null })
    expect(itemOf(balances, 'maternity')).toBeUndefined() // 沒用過也不在字典裡：不列
  })

  it('lists uncapped types once used (公假) with no quota and an unlimited status', async () => {
    requestsByForm['form-default'] = [request('o', 'approved', { 'd-type': '公假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 8 })]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'official')).toMatchObject({ quotaHours: null, remainingHours: null, usedHours: 8, status: 'unlimited' })
  })

  it('lists a type the employee can pick in the dictionary even if unused, and a type no rule matches as a quota-less row', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...customerFormInfo,
      typeOptions: [{ value: '婚假', label: '婚假' }, { value: '進修假', label: '進修假' }],
    }])
    requestsByForm['form-customer'] = [request('x', 'approved', { 'c-type': '進修假', 'c-start': '2026-03-02', 'c-end': '2026-03-02', 'c-hours': 6 })]

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'marriage')).toMatchObject({ usedHours: 0, quotaHours: 64 }) // 字典裡有
    expect(balances.items.find(item => item.name === '進修假')).toMatchObject({ key: 'dict:進修假', quotaHours: null, usedHours: 6, status: 'unlimited', enforcement: 'none' })
  })

  it('reports used hours of a type that is neither a rule nor in the dictionary under unmatched', async () => {
    requestsByForm['form-default'] = [request('x', 'pending', { 'd-type': '神祕假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 3 })]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(balances.unmatched).toEqual([{ name: '神祕假', usedHours: 0, pendingHours: 3 }])
  })

  it('always shows the statutory year types (事假、病假、家庭照顧假、生理假) and 特休, even with no usage', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])
    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })
    expect(balances.items.map(item => item.key)).toEqual(['annual', 'personal', 'family_care', 'sick', 'menstrual'])
  })

  it('uses the admin settings: a hidden type is never shown and a changed quota wins', async () => {
    mockGetSettings.mockResolvedValue({ leavePolicy: { types: [{ key: 'menstrual', display: 'hidden' }, { key: 'personal', quotaHours: 80 }] } })
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])

    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 })

    expect(itemOf(balances, 'menstrual')).toBeUndefined()
    expect(itemOf(balances, 'personal')).toMatchObject({ quotaHours: 80, remainingHours: 80 })
  })

  it('calls a type "low" near the end of its quota and "over" past it', async () => {
    requestsByForm['form-default'] = [
      request('a', 'approved', { 'd-type': '事假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 8 }),
    ]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])
    mockGetSettings.mockResolvedValue({ leavePolicy: { types: [{ key: 'personal', quotaHours: 12 }] } })
    expect(itemOf(await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 }), 'personal').status).toBe('low')

    mockGetSettings.mockResolvedValue({ leavePolicy: { types: [{ key: 'personal', quotaHours: 6 }] } })
    policyService.resetLeavePolicyCache()
    expect(itemOf(await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026 }), 'personal')).toMatchObject({ status: 'over', remainingHours: -2 })
  })
})

describe('evaluateLeaveRequestAgainstBalance', () => {
  const policy = () => policyService.normalizeLeavePolicy(null)
  const compose = (byKey, employee = employeeDoc({ totalHours: 80, usedHours: 0 })) => balanceService.composeLeaveBalanceItems({
    policy: policy(),
    usage: { byKey: new Map(Object.entries(byKey)), unmatched: new Map(), dictionaryNames: [] },
    employee,
  }).items
  const find = (items, key) => items.find(item => item.key === key)

  it('compares the request with the hours still available (quota - used - pending) and explains the excess in Chinese', () => {
    const items = compose({ personal: { approved: 44, pending: 0 } })
    const verdict = balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'personal'), 80)
    expect(verdict).toMatchObject({ exceeded: true, shortByHours: 12, enforcement: 'warn', typeKey: 'personal' })
    expect(verdict.message).toBe('事假今年額度 112 小時，已使用 44 小時，可請 68 小時，本次申請 80 小時，將超出 12 小時')

    expect(balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'personal'), 68).exceeded).toBe(false)
  })

  it('counts hours still waiting for approval as taken', () => {
    const items = compose({ personal: { approved: 40, pending: 40 } })
    const verdict = balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'personal'), 40)
    expect(verdict.exceeded).toBe(true)
    expect(verdict.message).toContain('簽核中 40 小時')
  })

  it('compares 特休 with the remaining hours of the employee record', () => {
    const items = compose({}, employeeDoc({ totalHours: 40, usedHours: 24 }))
    expect(balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'annual'), 16).exceeded).toBe(false)
    const over = balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'annual'), 24)
    expect(over).toMatchObject({ exceeded: true, shortByHours: 8, enforcement: 'block' })
  })

  it('compares per-event types with the per-request ceiling', () => {
    const items = compose({ marriage: { approved: 64, pending: 0 } })
    expect(balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'marriage'), 64).exceeded).toBe(false)
    const verdict = balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'marriage'), 72)
    expect(verdict).toMatchObject({ exceeded: true, shortByHours: 8 })
    expect(verdict.message).toBe('婚假每次最多 64 小時，本次申請 72 小時，超出 8 小時')
  })

  it('also checks the type it counts against: 家庭照顧假 may be within its own quota yet use up 事假', () => {
    const items = compose({ personal: { approved: 108, pending: 0 }, family_care: { approved: 0, pending: 0 } })
    const matched = policy().types.find(item => item.key === 'family_care')
    const verdict = balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'family_care'), 8, find(items, 'personal'), matched.countsAgainst)
    expect(verdict.exceeded).toBe(true)
    expect(verdict.message).toContain('家庭照顧假會併入事假計算')
    expect(verdict.message).toContain('本次併入 8 小時，將超出 4 小時')
  })

  it('only counts the part of 生理假 beyond the free 24 hours against 病假', () => {
    const items = compose({ sick: { approved: 238, pending: 0 }, menstrual: { approved: 0, pending: 0 } })
    const matched = policy().types.find(item => item.key === 'menstrual')
    const inside = balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'menstrual'), 8, find(items, 'sick'), matched.countsAgainst)
    expect(inside.exceeded).toBe(false)
  })

  it('never reports an excess for types that are not checked, manual balances or an unconfigured 特休', () => {
    const items = compose({}, employeeDoc({ totalHours: 0, usedHours: 0, compensatoryHours: 4 }))
    expect(balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'annual'), 100).exceeded).toBe(false)
    expect(balanceService.evaluateLeaveRequestAgainstBalance(find(items, 'comp'), 100).exceeded).toBe(false)
    expect(balanceService.evaluateLeaveRequestAgainstBalance(undefined, 100).exceeded).toBe(false)
    expect(balanceService.evaluateLeaveRequestAgainstBalance({ key: 'official', enforcement: 'none' }, 100).exceeded).toBe(false)
  })
})

describe('describeRequestFocus', () => {
  it('describes the effect of one request on its type: the balance before, after, and whether it is exceeded', async () => {
    requestsByForm['form-default'] = [request('a', 'approved', { 'd-type': '事假', 'd-start': '2026-03-02', 'd-end': '2026-03-02', 'd-hours': 100 })]
    mockGetAllLeaveFieldInfos.mockResolvedValue([defaultFormInfo])
    const policy = await policyService.getLeavePolicy()
    const balances = await balanceService.buildLeaveBalances({ employeeId: 'emp1', year: 2026, policy })

    const focus = balanceService.describeRequestFocus({ balances, policy, names: ['事假'], requestedHours: 16 })

    expect(focus).toMatchObject({ typeKey: 'personal', typeName: '事假', requestedHours: 16, remainingBefore: 12, remainingAfter: -4, exceeded: true, enforcement: 'warn' })
    expect(balanceService.describeRequestFocus({ balances, policy, names: ['神祕假'], requestedHours: 4 }))
      .toMatchObject({ typeKey: null, typeName: '神祕假', exceeded: false })
  })
})
