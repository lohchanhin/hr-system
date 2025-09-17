import { describe, it, expect } from '@jest/globals'
import { collectExpiringLicenses } from '../src/utils/licenseReminder.js'

describe('collectExpiringLicenses', () => {
  it('returns licenses that will expire within the given window', () => {
    const employees = [
      {
        _id: { toString: () => 'emp1' },
        name: '王小明',
        licenses: [
          { name: '照護證照', number: 'A123', endDate: '2025-06-20' },
          { name: '英文證照', number: 'B456', endDate: '2025-09-01' }
        ]
      },
      {
        _id: { toString: () => 'emp2' },
        name: '林小華',
        licenses: [
          { name: '醫事證照', number: 'C789', endDate: '2025-06-22' },
          { name: '過期證照', number: 'C000', endDate: '2024-01-01' }
        ]
      }
    ]

    const list = collectExpiringLicenses(employees, { daysAhead: 100, referenceDate: '2025-05-31' })
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ employeeId: 'emp1', licenseName: '照護證照', daysRemaining: 20 })
    expect(list[1]).toMatchObject({ employeeId: 'emp2', licenseName: '醫事證照', daysRemaining: 22 })
    expect(list[2]).toMatchObject({ employeeId: 'emp1', licenseName: '英文證照' })
  })

  it('ignores invalid dates and out-of-range data', () => {
    const employees = [
      {
        id: 'emp3',
        name: '測試',
        licenses: [
          { name: 'bad', endDate: 'invalid' },
          { name: '太晚', endDate: '2030-01-01' }
        ]
      }
    ]
    const list = collectExpiringLicenses(employees, { daysAhead: 30, referenceDate: '2025-01-01' })
    expect(list).toHaveLength(0)
  })

  it('throws when referenceDate is invalid', () => {
    expect(() => collectExpiringLicenses([], { referenceDate: 'not-a-date' })).toThrow(TypeError)
  })
})
