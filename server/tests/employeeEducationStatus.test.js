import { buildEmployeeDoc, buildEmployeePatch } from '../src/controllers/employeeController.js'

describe('學歷狀態轉換', () => {
  it('建立文件時保留允許的畢業狀態', () => {
    const doc = buildEmployeeDoc({ graduationStatus: '畢業' })
    expect(doc.education.status).toBe('畢業')
  })

  it('建立文件時過濾不合法的狀態值', () => {
    const doc = buildEmployeeDoc({ graduationStatus: '其他' })
    expect(doc.education.status).toBeUndefined()
  })

  it('部份更新時寫入合法狀態', () => {
    const { $set, $unset } = buildEmployeePatch({ graduationStatus: '肄業' })
    expect($set['education.status']).toBe('肄業')
    expect($unset).toEqual({})
  })

  it('部份更新時清空狀態會執行 unset', () => {
    const { $set, $unset } = buildEmployeePatch({ graduationStatus: '' })
    expect($set['education.status']).toBeUndefined()
    expect($unset['education.status']).toBe(1)
  })

  it('部份更新時忽略不合法的狀態值', () => {
    const { $set, $unset } = buildEmployeePatch({ graduationStatus: '其他' })
    expect($set['education.status']).toBeUndefined()
    expect($unset).toEqual({})
  })
})
