import { buildEmployeeDoc, buildEmployeePatch } from '../src/controllers/employeeController.js'

describe('薪資項目金額', () => {
  it('建立文件時會保留薪資項目與金額', () => {
    const doc = buildEmployeeDoc({
      salaryItems: ['transport', 'night'],
      salaryItemAmounts: { transport: 1500, night: '2000', extra: 999 }
    })
    expect(doc.salaryItems).toEqual(['transport', 'night'])
    expect(doc.salaryItemAmounts).toEqual({ transport: 1500, night: 2000 })
  })

  it('部份更新時同步薪資項目金額', () => {
    const { $set } = buildEmployeePatch(
      {
        salaryItems: ['bonus'],
        salaryItemAmounts: { bonus: '3000' }
      },
      { salaryItems: ['transport'] }
    )
    expect($set.salaryItems).toEqual(['bonus'])
    expect($set.salaryItemAmounts).toEqual({ bonus: 3000 })
  })

  it('更新金額時沿用既有薪資項目', () => {
    const { $set } = buildEmployeePatch(
      { salaryItemAmounts: { night: 1200 } },
      { salaryItems: ['night', 'transport'] }
    )
    expect($set.salaryItemAmounts).toEqual({ night: 1200, transport: 0 })
  })
})
