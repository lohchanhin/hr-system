// 新增員工（buildEmployeeDoc）與修改員工（buildEmployeePatch）寫入的欄位必須是 Employee schema 真的有的欄位：
// 以前新增時寫的是 birthplace、appointment.appointDate / reAppointDate / reDismissDate，schema 沒有這些路徑，
// 資料被 Mongoose 靜靜丟掉（畫面顯示新增成功，出生地、起聘日期、再任日期卻是空的，要再編輯一次才存得進去）。
import Employee from '../src/models/Employee.js'
import { buildEmployeeDoc, buildEmployeePatch, validateEmployeeFlags } from '../src/controllers/employeeController.js'

const FULL_BODY = {
  username: ' amy ', name: ' 王小美 ', email: 'Amy@Example.test', employeeNo: ' E001 ', role: 'employee',
  gender: 'F', idNumber: 'A223456789', birthday: '1990-05-06', birthplace: '台中市', bloodType: 'A',
  languages: ['中文'], disabilityLevel: '無', identityCategory: ['一般'], maritalStatus: '未婚', dependents: 1,
  phone: '0912345678', landline: '0422223333', householdAddress: '戶籍', contactAddress: '聯絡', lineId: 'amy',
  organization: 'org-1', title: '護理師', practiceTitle: '護理師', isPartTime: false, isClocking: true,
  employmentStatus: '試用期員工', probationDays: 90, accountEnabled: false,
  height: 160, weight: 50, medicalBloodType: 'A',
  educationLevel: '大學', schoolName: '某大學', major: '護理', graduationStatus: '畢業', graduationYear: 2012,
  serviceType: '免役', militaryBranch: '', militaryRank: '', dischargeYear: 2010,
  emergency1: { name: '王爸', relation: '父', phone1: '0911111111', phone2: '' },
  emergency2: { name: '王媽', relation: '母', phone1: '0922222222', phone2: '' },
  keywords: '夜班',
  experiences: [{ unit: '甲醫院', title: '護理師', start: '2012-07-01', end: '2015-06-30' }],
  licenses: [{ name: '護理師證書', number: 'N-1', startDate: '2012-08-01', endDate: '2030-08-01', fileList: ['/upload/a.pdf'] }],
  trainings: [{ course: 'CPR', courseNo: 'T-1', date: '2024-01-02', fileList: [], category: ['急救'], score: 90 }],
  hireDate: '2024-03-01', appointDate: '2024-03-02', resignDate: '2026-01-31', dismissDate: '2026-02-01',
  reAppointDate: '2026-03-01', reDismissDate: '2026-12-31', employmentNote: '備註',
  salaryType: '月薪', salaryAmount: 40000, laborPensionSelf: 0, employeeAdvance: 0,
  salaryAccountA: { bank: '004', acct: '001' }, salaryAccountB: { bank: '', acct: '' },
  salaryItems: ['伙食津貼'], salaryItemAmounts: { 伙食津貼: 2400 },
  laborInsuredSalary: 40100, pensionInsuredSalary: 40100, healthInsuredSalary: 40100, dependentCount: 0,
}

const iso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)

describe('新增員工寫入的欄位（buildEmployeeDoc）', () => {
  const stored = () => new Employee(buildEmployeeDoc(FULL_BODY)).toObject({ virtuals: false })

  it('stores 出生地 and every 任職日期 on create', () => {
    const doc = stored()
    expect(doc.birthPlace).toBe('台中市')
    expect(iso(doc.appointment.hireDate)).toBe('2024-03-01')
    expect(iso(doc.appointment.startDate)).toBe('2024-03-02')
    expect(iso(doc.appointment.resignationDate)).toBe('2026-01-31')
    expect(iso(doc.appointment.dismissalDate)).toBe('2026-02-01')
    expect(iso(doc.appointment.rehireStartDate)).toBe('2026-03-01')
    expect(iso(doc.appointment.rehireEndDate)).toBe('2026-12-31')
    expect(doc.appointment.remark).toBe('備註')
  })

  it('stores the same values a later edit with the same body would store', () => {
    const created = stored()
    const { $set } = buildEmployeePatch(FULL_BODY, null)
    const read = (object, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object)
    const skipped = new Set([
      'emergencyContacts', 'experiences', 'licenses', 'trainings', 'salaryItemAmounts', 'signTags',
      'languages', 'identityCategory', 'salaryItems',
    ])
    const mismatches = []
    for (const [path, value] of Object.entries($set)) {
      if (skipped.has(path)) continue
      const actual = read(created, path)
      if (iso(actual) !== iso(value)) mismatches.push(`${path}: create=${JSON.stringify(actual)} edit=${JSON.stringify(value)}`)
    }
    expect(mismatches).toEqual([])
    expect(created.name).toBe('王小美')
    expect(created.accountEnabled).toBe(false)
    expect(created.emergencyContacts.map(contact => contact.name)).toEqual(['王爸', '王媽'])
    expect(created.licenses[0].files).toEqual(['/upload/a.pdf'])
  })

  it('writes only real schema paths (create and edit)', () => {
    const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      const nested = child && typeof child === 'object' && !Array.isArray(child) && !(child instanceof Date)
        && Employee.schema.pathType(path) === 'nested'
      return nested ? flatten(child, path) : [path]
    })
    const isWritable = (path) => ['real', 'virtual'].includes(Employee.schema.pathType(path))
    expect(flatten(buildEmployeeDoc(FULL_BODY)).filter(path => !isWritable(path))).toEqual([])
    const { $set, $unset } = buildEmployeePatch({ ...FULL_BODY, birthday: '', hireDate: null }, null)
    const notReal = [...Object.keys($set), ...Object.keys($unset)].filter(path => Employee.schema.pathType(path) !== 'real')
    expect(notReal).toEqual([])
  })

  it('keeps 第二位緊急聯絡人 when only emergency2 is filled in', () => {
    const doc = new Employee(buildEmployeeDoc({
      ...FULL_BODY, emergency1: { name: '', relation: '', phone1: '', phone2: '' },
    }))
    expect(doc.validateSync()).toBeUndefined()
    const contacts = doc.toObject({ virtuals: false }).emergencyContacts
    expect(contacts).toHaveLength(2)
    expect(contacts[0]).toEqual({ name: '', relation: '', phone1: '', phone2: '' })
    expect(contacts[1].name).toBe('王媽')
  })
})

describe('緊急聯絡人：emergency1 / emergency2 與 emergencyContacts 同時送來', () => {
  const stale = [
    { name: '舊一', relation: '父', phone1: '1', phone2: '' },
    { name: '舊二', relation: '母', phone1: '2', phone2: '' },
  ]

  it('edit: the contact the form edited (emergency1 / emergency2) wins over the echoed array', () => {
    const { $set } = buildEmployeePatch({
      emergencyContacts: stale,
      emergency1: { name: '新一', relation: '兄', phone1: '9', phone2: '' },
    }, { emergencyContacts: stale })
    expect($set.emergencyContacts).toEqual([
      { name: '新一', relation: '兄', phone1: '9', phone2: '' },
      stale[1],
    ])
  })

  it('edit: an array alone still replaces the list, and emergency2 alone keeps the first contact', () => {
    expect(buildEmployeePatch({ emergencyContacts: [stale[1]] }, { emergencyContacts: stale }).$set.emergencyContacts)
      .toEqual([stale[1]])
    expect(buildEmployeePatch({ emergency2: { name: '新二' } }, { emergencyContacts: stale }).$set.emergencyContacts)
      .toEqual([stale[0], { ...stale[1], name: '新二' }])
  })

  it('create: emergency1 / emergency2 win over the array too', () => {
    const doc = buildEmployeeDoc({
      ...FULL_BODY, emergencyContacts: stale, emergency2: { name: '新二', relation: '姊', phone1: '8', phone2: '' },
      emergency1: undefined,
    })
    expect(doc.emergencyContacts).toEqual([stale[0], { name: '新二', relation: '姊', phone1: '8', phone2: '' }])
  })
})

describe('自動計算加班費（autoOvertimeCalc）與需要排班（requiresScheduling）的寫入', () => {
  it('validateEmployeeFlags：只接受布林值（與舊版表單的 true／false 字串），其他回中文錯誤', () => {
    expect(validateEmployeeFlags({})).toBeNull()
    expect(validateEmployeeFlags({ autoOvertimeCalc: true, requiresScheduling: 'false' })).toBeNull()
    expect(validateEmployeeFlags({ autoOvertimeCalc: 'yes' })).toMatch(/自動計算加班費/)
    expect(validateEmployeeFlags({ requiresScheduling: 0 })).toMatch(/需要排班/)
    expect(validateEmployeeFlags({ autoOvertimeCalc: null })).toMatch(/autoOvertimeCalc/)
  })

  it('新增：有送就照送的值；沒送用呼叫端帶入的新進員工預設值；都沒有就是資料模型的預設值', () => {
    const create = (body, options) => new Employee(buildEmployeeDoc({ ...FULL_BODY, ...body }, options)).toObject({ virtuals: false })
    expect(create({ autoOvertimeCalc: false }, { autoOvertimeCalcDefault: true }).autoOvertimeCalc).toBe(false)
    expect(create({ autoOvertimeCalc: 'true' }, { autoOvertimeCalcDefault: false }).autoOvertimeCalc).toBe(true)
    expect(create({}, { autoOvertimeCalcDefault: true }).autoOvertimeCalc).toBe(true)
    expect(create({}, { autoOvertimeCalcDefault: false }).autoOvertimeCalc).toBe(false)
    expect(create({}).autoOvertimeCalc).toBe(false)
    expect(create({}).requiresScheduling).toBe(true)
    expect(create({ requiresScheduling: false }).requiresScheduling).toBe(false)
  })

  it('修改：有送才寫，沒送不動', () => {
    expect(buildEmployeePatch({ autoOvertimeCalc: true, requiresScheduling: 'false' }).$set).toMatchObject({ autoOvertimeCalc: true, requiresScheduling: false })
    const { $set } = buildEmployeePatch({ name: '只改名字' })
    expect($set).not.toHaveProperty('autoOvertimeCalc')
    expect($set).not.toHaveProperty('requiresScheduling')
  })
})