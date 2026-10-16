import { jest } from '@jest/globals'

// 其他控制設定的存取層換成記憶體版，不需要資料庫
let storedSettings = {}
const mockGetSettings = jest.fn(async () => JSON.parse(JSON.stringify(storedSettings)))
const mockUpdateSettings = jest.fn(async (mutator) => {
  const current = JSON.parse(JSON.stringify(storedSettings))
  await mutator(current)
  storedSettings = current
  return current
})

let service
let config

beforeAll(async () => {
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  }))
  service = await import('../src/services/leavePolicyService.js')
  config = await import('../src/config/leavePolicyConfig.js')
})

beforeEach(() => {
  storedSettings = {}
  mockGetSettings.mockClear()
  mockUpdateSettings.mockClear()
  service.resetLeavePolicyCache()
})

const typeOf = (policy, key) => policy.types.find(item => item.key === key)

describe('default leave policy (Taiwan statutory limits in hours)', () => {
  it('ships the statutory quotas as hours (1 day = 8 hours)', () => {
    const policy = service.normalizeLeavePolicy(null)
    expect(policy.maxHoursPerDay).toBe(8)
    expect(policy.minUnitHours).toBe(0.5)
    expect(typeOf(policy, 'personal')).toMatchObject({ name: '事假', quotaHours: 112, period: 'year', enforcement: 'warn' })
    expect(typeOf(policy, 'family_care')).toMatchObject({ quotaHours: 56, countsAgainst: { key: 'personal', exemptHours: 0 } })
    expect(typeOf(policy, 'sick')).toMatchObject({ quotaHours: 240 })
    expect(typeOf(policy, 'menstrual')).toMatchObject({ quotaHours: 96, countsAgainst: { key: 'sick', exemptHours: 24 } })
    expect(typeOf(policy, 'marriage')).toMatchObject({ quotaHours: 64, period: 'event' })
    expect(typeOf(policy, 'maternity')).toMatchObject({ quotaHours: 448, period: 'event' })
    expect(typeOf(policy, 'official')).toMatchObject({ quotaHours: null, period: 'none', enforcement: 'none' })
  })

  it('takes 特休 and 補休 from the employee record and blocks 特休 by default while every other quota only warns', () => {
    const policy = service.normalizeLeavePolicy(null)
    expect(typeOf(policy, 'annual')).toMatchObject({ source: 'employee_annual', enforcement: 'block', name: '特休' })
    expect(typeOf(policy, 'comp')).toMatchObject({ source: 'employee_comp', enforcement: 'none' })
    const blocking = policy.types.filter(item => item.enforcement === 'block').map(item => item.key)
    expect(blocking).toEqual(['annual'])
  })

  it('uses the same 特休 spellings as the deduction code', () => {
    const annual = typeOf(service.normalizeLeavePolicy(null), 'annual')
    expect([annual.name, ...annual.aliases].sort()).toEqual([...config.ANNUAL_LEAVE_TYPE_ALIASES].sort())
  })
})

describe('matchLeaveType', () => {
  const match = (names) => service.matchLeaveType(names, service.normalizeLeavePolicy(null).types)?.key ?? null

  it('matches names, aliases and spellings with brackets or spaces', () => {
    expect(match(['事假'])).toBe('personal')
    expect(match(['請事假'])).toBe('personal')
    expect(match(['特休'])).toBe('annual')
    expect(match(['特休假'])).toBe('annual')
    expect(match(['特別休假'])).toBe('annual')
    expect(match(['喪假（6日）'])).toBe('bereavement')
    expect(match([' 病 假 '])).toBe('sick')
    expect(match(['生理假'])).toBe('menstrual')
    expect(match(['陪產檢及陪產假'])).toBe('paternity')
    expect(match(['產假'])).toBe('maternity')
  })

  it('only knows 特休 by its exact names (it is deducted from the employee record), never by a name that merely contains it', () => {
    expect(match(['特休假（上午）'])).toBeNull()
    expect(match(['特休保留'])).toBeNull()
    expect(match(['特休', '特休假（上午）'])).toBe('annual')
  })

  it('prefers the longest contained alias so 公傷病假 is not mistaken for 病假', () => {
    expect(match(['公傷病假'])).toBe('work_injury')
    expect(match(['公傷假'])).toBe('work_injury')
    expect(match(['病假'])).toBe('sick')
  })

  it('tries every name given (a dictionary code plus its label) and returns null when nothing matches', () => {
    expect(match(['LV-07', '事假'])).toBe('personal')
    expect(match(['某自訂假別'])).toBeNull()
    expect(match([])).toBeNull()
  })

  it('skips disabled types', () => {
    const policy = service.normalizeLeavePolicy({ types: [{ key: 'personal', enabled: false }] })
    expect(service.matchLeaveType(['事假'], policy.types)).toBeNull()
  })
})

describe('normalizeLeavePolicy (merge stored settings over the defaults by key)', () => {
  it('lets a stored override win while builtin types the admin never touched keep their defaults', () => {
    const policy = service.normalizeLeavePolicy({
      maxHoursPerDay: 12,
      types: [{ key: 'personal', quotaHours: 80, enforcement: 'block' }],
    })
    expect(policy.maxHoursPerDay).toBe(12)
    expect(typeOf(policy, 'personal')).toMatchObject({ quotaHours: 80, enforcement: 'block', name: '事假' })
    expect(typeOf(policy, 'sick').quotaHours).toBe(240)
    expect(policy.types.length).toBe(config.DEFAULT_LEAVE_POLICY.types.length)
  })

  it('keeps custom types after the builtin ones and ignores damaged data instead of breaking', () => {
    const policy = service.normalizeLeavePolicy({
      maxHoursPerDay: 99,
      minUnitHours: 0.3,
      types: [
        { key: 'custom_study', name: '進修假', quotaHours: 16, period: 'year' },
        { key: 'personal', quotaHours: -5, enforcement: 'explode' },
        { key: 'BAD KEY', name: 'x' },
        'garbage',
        null,
      ],
    })
    expect(policy.maxHoursPerDay).toBe(8)
    expect(policy.minUnitHours).toBe(0.5)
    expect(typeOf(policy, 'personal')).toMatchObject({ quotaHours: 112, enforcement: 'warn' })
    expect(policy.types[policy.types.length - 1]).toMatchObject({ key: 'custom_study', name: '進修假', quotaHours: 16, builtin: false })
    expect(policy.types.some(item => item.key === 'BAD KEY')).toBe(false)
  })

  it('never lets the stored data rename 特休 or change where its quota comes from', () => {
    const policy = service.normalizeLeavePolicy({ types: [{ key: 'annual', name: '年假', aliases: ['x'], source: 'policy', builtin: false }] })
    expect(typeOf(policy, 'annual')).toMatchObject({ name: '特休', source: 'employee_annual', builtin: true })
    expect(typeOf(policy, 'annual').aliases).toEqual(['特休假', '特別休假'])
  })

  // 特休超過剩餘時數一律擋下（送出時不看這個設定），所以設定值也不能是 warn / none
  it('keeps the over-quota handling of 特休 at block whatever was stored, and leaves the other types as stored', () => {
    const policy = service.normalizeLeavePolicy({
      types: [{ key: 'annual', enforcement: 'warn' }, { key: 'personal', enforcement: 'block' }, { key: 'sick', enforcement: 'none' }],
    })
    expect(typeOf(policy, 'annual').enforcement).toBe('block')
    expect(typeOf(service.normalizeLeavePolicy({ types: [{ key: 'annual', enforcement: 'none' }] }), 'annual').enforcement).toBe('block')
    expect(typeOf(policy, 'personal').enforcement).toBe('block')
    expect(typeOf(policy, 'sick').enforcement).toBe('none')
  })

  it('drops a countsAgainst that points at a missing type or at itself', () => {
    const policy = service.normalizeLeavePolicy({
      types: [
        { key: 'family_care', countsAgainst: { key: 'nothing', exemptHours: 0 } },
        { key: 'sick', countsAgainst: { key: 'sick', exemptHours: 0 } },
      ],
    })
    expect(typeOf(policy, 'family_care').countsAgainst).toBeNull()
    expect(typeOf(policy, 'sick').countsAgainst).toBeNull()
  })
})

describe('validateLeavePolicyInput', () => {
  const problem = (input) => {
    try {
      service.validateLeavePolicyInput(input)
      return null
    } catch (error) {
      expect(error.name).toBe('LeavePolicyValidationError')
      expect(error.status).toBe(400)
      return error.message
    }
  }

  it('accepts a partial update and fills the rest with the defaults', () => {
    const policy = service.validateLeavePolicyInput({
      maxHoursPerDay: 12,
      minUnitHours: 1,
      types: [{ key: 'personal', quotaHours: 96, enforcement: 'block' }],
    })
    expect(policy.maxHoursPerDay).toBe(12)
    expect(policy.minUnitHours).toBe(1)
    expect(typeOf(policy, 'personal')).toMatchObject({ quotaHours: 96, enforcement: 'block', name: '事假' })
    expect(typeOf(policy, 'sick').quotaHours).toBe(240)
  })

  it('saves 特休 as block even when it is submitted as warn or none (the switch does not apply to 特休)', () => {
    const policy = service.validateLeavePolicyInput({ types: [{ key: 'annual', enforcement: 'warn' }, { key: 'personal', enforcement: 'warn' }] })
    expect(typeOf(policy, 'annual').enforcement).toBe('block')
    expect(typeOf(service.validateLeavePolicyInput({ types: [{ key: 'annual', enforcement: 'none' }] }), 'annual').enforcement).toBe('block')
    expect(typeOf(policy, 'personal').enforcement).toBe('warn')
  })

  it('rejects bad global settings with Chinese messages', () => {
    expect(problem(null)).toBe('請提供假別規則內容')
    expect(problem({ maxHoursPerDay: 0 })).toBe('每日最多可請時數必須介於 1 至 24 小時')
    expect(problem({ maxHoursPerDay: 30 })).toBe('每日最多可請時數必須介於 1 至 24 小時')
    expect(problem({ minUnitHours: 0.3 })).toBe('請假最小單位只能是 0.25、0.5、1 小時')
    expect(problem({ types: 'x' })).toBe('假別清單格式不正確')
  })

  it('rejects invalid type settings', () => {
    expect(problem({ types: [{ key: 'personal', quotaHours: -1 }] })).toContain('額度必須是 0 至 10000 小時')
    expect(problem({ types: [{ key: 'personal', quotaHours: 'abc' }] })).toContain('額度必須是')
    expect(problem({ types: [{ key: 'personal', enforcement: 'maybe' }] })).toContain('超額處理不正確')
    expect(problem({ types: [{ key: 'personal', display: 'sometimes' }] })).toContain('顯示方式不正確')
    expect(problem({ types: [{ key: 'personal', period: 'forever' }] })).toContain('計算期間不正確')
    expect(problem({ types: [{ key: 'personal', name: '  ' }] })).toContain('假別名稱不可空白')
    expect(problem({ types: [{ key: 'personal', name: 'x'.repeat(31) }] })).toContain('不可超過 30 個字')
    expect(problem({ types: [{ key: 'personal', aliases: new Array(11).fill('a').map((a, i) => a + i) }] })).toContain('別名最多 10 個')
    expect(problem({ types: [{ key: 'annual', enabled: false }] })).toBe('特休不能停用')
    expect(problem({ types: [{ key: 'personal' }, { key: 'personal' }] })).toBe('假別代號重複：personal')
    expect(problem({ types: [{ key: 'Bad Key', name: 'x' }] })).toContain('自訂假別的代號格式不正確')
    expect(problem({ types: [{ key: 'custom_x' }] })).toBe('自訂假別需要名稱')
    expect(problem({ types: new Array(41).fill(0).map((_, i) => ({ key: `custom_${i}x`, name: `假${i}` })) })).toBe('假別最多 40 種')
  })

  it('rejects duplicated names or aliases between types', () => {
    expect(problem({ types: [{ key: 'custom_a', name: '事假' }] })).toBe('假別名稱或別名重複：「事假」與「事假」')
    expect(problem({ types: [{ key: 'personal', aliases: ['病假'] }] })).toContain('假別名稱或別名重複')
    expect(problem({ types: [{ key: 'custom_a', name: '進修假', aliases: ['特休'] }] })).toContain('假別名稱或別名重複')
  })

  it('rejects countsAgainst that points nowhere, at itself, or in a circle', () => {
    expect(problem({ types: [{ key: 'personal', countsAgainst: { key: 'nothing', exemptHours: 0 } }] })).toContain('併入計算的假別不存在')
    expect(problem({ types: [{ key: 'personal', countsAgainst: { key: 'personal', exemptHours: 0 } }] })).toContain('不能併入自己')
    expect(problem({ types: [{ key: 'personal', countsAgainst: { key: 'family_care', exemptHours: 0 } }] })).toContain('形成循環')
    expect(problem({ types: [{ key: 'sick', countsAgainst: { key: 'menstrual', exemptHours: 0 } }] })).toContain('形成循環')
    expect(problem({ types: [{ key: 'family_care', countsAgainst: { key: 'personal', exemptHours: -1 } }] })).toContain('免計時數必須是')
  })

  it('adds custom types after the builtin ones', () => {
    const policy = service.validateLeavePolicyInput({
      types: [{ key: 'custom_study', name: '進修假', aliases: ['進修'], quotaHours: 24, enforcement: 'block', display: 'always', period: 'year' }],
    })
    expect(policy.types[policy.types.length - 1]).toMatchObject({ key: 'custom_study', name: '進修假', quotaHours: 24, builtin: false, source: 'policy' })
  })
})

describe('getLeavePolicy / saveLeavePolicy', () => {
  it('reads the defaults when nothing was ever saved and caches the result for a while', async () => {
    const first = await service.getLeavePolicy()
    expect(typeOf(first, 'personal').quotaHours).toBe(112)
    await service.getLeavePolicy()
    expect(mockGetSettings).toHaveBeenCalledTimes(1)
    await service.getLeavePolicy({ fresh: true })
    expect(mockGetSettings).toHaveBeenCalledTimes(2)
  })

  it('falls back to the defaults when the settings cannot be read', async () => {
    mockGetSettings.mockRejectedValueOnce(new Error('db down'))
    const policy = await service.getLeavePolicy()
    expect(typeOf(policy, 'sick').quotaHours).toBe(240)
  })

  it('saves into the leavePolicy block, clears the cache and returns the effective policy', async () => {
    await service.getLeavePolicy()
    const saved = await service.saveLeavePolicy({ types: [{ key: 'personal', quotaHours: 80 }] })
    expect(typeOf(saved, 'personal').quotaHours).toBe(80)
    expect(storedSettings.leavePolicy.types.find(item => item.key === 'personal').quotaHours).toBe(80)
    const reread = await service.getLeavePolicy()
    expect(typeOf(reread, 'personal').quotaHours).toBe(80)
  })

  it('does not write anything when the input is invalid', async () => {
    await expect(service.saveLeavePolicy({ maxHoursPerDay: 0 })).rejects.toThrow('每日最多可請時數')
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })
})
