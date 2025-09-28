import { buildEmployeeDoc, buildEmployeePatch } from '../src/controllers/employeeController.js'

describe('簽核設定代碼持久化', () => {
  it('建立文件時保留簽核代碼與權限職等', () => {
    const doc = buildEmployeeDoc({
      signRole: 'R002',
      signLevel: 'U003',
      permissionGrade: 'L2'
    })
    expect(doc.signRole).toBe('R002')
    expect(doc.signLevel).toBe('U003')
    expect(doc.permissionGrade).toBe('L2')
  })

  it('部份更新時寫入簽核代碼與權限職等', () => {
    const { $set } = buildEmployeePatch({
      signRole: 'R006',
      signLevel: 'U001',
      permissionGrade: 'L4'
    })
    expect($set.signRole).toBe('R006')
    expect($set.signLevel).toBe('U001')
    expect($set.permissionGrade).toBe('L4')
  })

  it('部份更新允許清空簽核代碼', () => {
    const { $set } = buildEmployeePatch({ signRole: '', signLevel: '', permissionGrade: '' })
    expect($set.signRole).toBe('')
    expect($set.signLevel).toBe('')
    expect($set.permissionGrade).toBe('')
  })
})
