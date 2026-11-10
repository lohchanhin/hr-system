// 編輯員工：把日期、數字、下拉選單清空後存檔，要真的清掉（以前回 200 但資料庫的值不動，重新開啟又跑出來）；
// 以及更新模式的批量匯入只送部分欄位時，不能把沒送的資料洗掉。
import { buildEmployeePatch } from '../src/controllers/employeeController.js'

describe('buildEmployeePatch: clearing a field in the edit form', () => {
  it('unsets dates the administrator cleared (date picker sends null, an untouched blank is an empty string)', () => {
    const { $set, $unset } = buildEmployeePatch({
      birthday: null,
      hireDate: '',
      appointDate: null,
      resignDate: null,
      dismissDate: '',
      reAppointDate: null,
      reDismissDate: null,
      annualLeave: { expiryDate: null },
    })
    expect($unset).toMatchObject({
      birthDate: 1,
      'appointment.hireDate': 1,
      'appointment.startDate': 1,
      'appointment.resignationDate': 1,
      'appointment.dismissalDate': 1,
      'appointment.rehireStartDate': 1,
      'appointment.rehireEndDate': 1,
      'annualLeave.expiryDate': 1,
    })
    expect(Object.keys($set).filter(key => /Date|appointment/.test(key))).toEqual([])
  })

  it('unsets cleared numbers and single-choice fields, and still stores real values', () => {
    const cleared = buildEmployeePatch({
      height: null, weight: '', graduationYear: '', dischargeYear: null, bloodType: '', maritalStatus: null, medicalBloodType: '',
    })
    expect(cleared.$unset).toMatchObject({
      'medicalCheck.height': 1,
      'medicalCheck.weight': 1,
      'education.graduationYear': 1,
      'militaryService.dischargeYear': 1,
      bloodType: 1,
      maritalStatus: 1,
      'medicalCheck.bloodType': 1,
    })

    const filled = buildEmployeePatch({ resignDate: '2026-11-30', height: 170, bloodType: 'A', maritalStatus: '已婚' })
    expect(filled.$set['appointment.resignationDate']).toEqual(new Date('2026-11-30'))
    expect(filled.$set['medicalCheck.height']).toBe(170)
    expect(filled.$set.bloodType).toBe('A')
    expect(filled.$set.maritalStatus).toBe('已婚')
    expect(filled.$unset).toEqual({})
  })

  it('leaves fields that were not sent, or hold something unreadable, exactly as they are', () => {
    const { $set, $unset } = buildEmployeePatch({ name: '王小明', resignDate: 'not a date', bloodType: 'Z', height: 'tall' })
    expect($unset).toEqual({})
    expect($set).toEqual({ name: '王小明' })
  })
})

describe('buildEmployeePatch: partial data (update-mode import)', () => {
  it('keeps the amounts of allowance items that stay selected when only the item list is sent', () => {
    const existing = { salaryItems: ['交通津貼', '伙食津貼'], salaryItemAmounts: { 交通津貼: 1500, 伙食津貼: 2400 } }
    const { $set } = buildEmployeePatch({ salaryItems: ['交通津貼', '職務加給'] }, existing)
    expect($set.salaryItems).toEqual(['交通津貼', '職務加給'])
    expect($set.salaryItemAmounts).toEqual({ 交通津貼: 1500, 職務加給: 0 })
    // 編輯畫面兩個都送：以送來的金額為準
    const both = buildEmployeePatch({ salaryItems: ['交通津貼'], salaryItemAmounts: { 交通津貼: 1800 } }, existing)
    expect(both.$set.salaryItemAmounts).toEqual({ 交通津貼: 1800 })
  })

  it('keeps the other fields of an emergency contact when only one of them is sent', () => {
    const existing = { emergencyContacts: [{ name: '李媽媽', relation: '母', phone1: '0911000111', phone2: '0222223333' }] }
    const { $set } = buildEmployeePatch({ emergency1: { phone1: '0922000222' } }, existing)
    expect($set.emergencyContacts).toEqual([{ name: '李媽媽', relation: '母', phone1: '0922000222', phone2: '0222223333' }])
    // 編輯畫面四個欄位都送，空字串就是清空
    const cleared = buildEmployeePatch({ emergency1: { name: '李媽媽', relation: '', phone1: '0922000222', phone2: '' } }, existing)
    expect(cleared.$set.emergencyContacts).toEqual([{ name: '李媽媽', relation: '', phone1: '0922000222', phone2: '' }])
  })
})
