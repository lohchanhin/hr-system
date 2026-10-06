import request from 'supertest'
import express from 'express'
import ExcelJS from 'exceljs'
import { jest } from '@jest/globals'

const mockEmployeeModel = function (doc) {
  Object.assign(this, doc)
}
mockEmployeeModel.find = jest.fn()
mockEmployeeModel.insertMany = jest.fn()
mockEmployeeModel.updateOne = jest.fn()
mockEmployeeModel.deleteMany = jest.fn()
mockEmployeeModel.startSession = jest.fn()
mockEmployeeModel.prototype.validate = jest.fn()
mockEmployeeModel.prototype.toObject = function () {
  return { ...this }
}

const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn()
}

const mockOrganizationModel = {
  find: jest.fn()
}

const mockDepartmentModel = {
  find: jest.fn()
}

const mockSubDepartmentModel = {
  find: jest.fn()
}

function mockFindWithData(model, data) {
  model.find.mockImplementation(() => ({
    lean: jest.fn().mockResolvedValue(data)
  }))
}

function setupEmployeeFind({ referenceData = [], emailData = [], existingByNo = [] } = {}) {
  mockEmployeeModel.find.mockImplementation((query, projection) => {
    if (query && query.email) {
      return Promise.resolve(emailData)
    }
    if (query && query.employeeId) {
      return Promise.resolve(existingByNo)
    }
    return {
      lean: jest.fn().mockResolvedValue(referenceData)
    }
  })
}

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: mockEmployeeModel
}))

jest.unstable_mockModule('../src/models/Organization.js', () => ({
  default: mockOrganizationModel
}))

jest.unstable_mockModule('../src/models/Department.js', () => ({
  default: mockDepartmentModel
}))

jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({
  default: mockSubDepartmentModel
}))

let app

async function setupApp() {
  if (app) return app
  const employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default
  const instance = express()
  instance.use('/api/employees', employeeRoutes)
  app = instance
  return app
}

const EN_HEADERS = [
  'employeeId',
  'name',
  'gender',
  'idNumber',
  'birthDate',
  'birthPlace',
  'bloodType',
  'languages',
  'disabilityLevel',
  'identityCategory',
  'maritalStatus',
  'dependents',
  'email',
  'mobile',
  'landline',
  'householdAddress',
  'contactAddress',
  'lineId',
  'organization',
  'department',
  'subDepartment',
  'supervisor',
  'title',
  'practiceTitle',
  'status',
  'probationDays',
  'partTime',
  'needClockIn',
  'education_level',
  'education_school',
  'education_major',
  'education_status',
  'education_graduationYear',
  'militaryService_type',
  'militaryService_branch',
  'militaryService_rank',
  'militaryService_dischargeYear',
  'emergency1_name',
  'emergency1_relation',
  'emergency1_phone1',
  'emergency1_phone2',
  'emergency2_name',
  'emergency2_relation',
  'emergency2_phone1',
  'emergency2_phone2',
  'hireDate',
  'startDate',
  'resignationDate',
  'dismissalDate',
  'rehireStartDate',
  'rehireEndDate',
  'appointment_remark',
  'salaryType',
  'salaryAmount',
  'laborPensionSelf',
  'employeeAdvance',
  'salaryAccountA_bank',
  'salaryAccountA_acct',
  'salaryAccountB_bank',
  'salaryAccountB_acct',
  'salaryItems',
  'annualLeave_totalDays',
  'annualLeave_usedDays',
  'annualLeave_accumulatedLeave',
  'annualLeave_expiryDate',
  'annualLeave_compensatoryHours',
  'laborInsuredSalary',
  'pensionInsuredSalary',
  'healthInsuredSalary',
  'dependentCount'
]

const ZH_HEADERS = [
  '員工編號',
  '姓名',
  '性別 (M=男, F=女, O=其他)',
  '身分證號',
  '生日 (yyyy-mm-dd)',
  '出生地',
  '血型 (A/B/O/AB/HR)',
  '語言 (多個以逗號分隔)',
  '失能等級',
  '身分類別 (多個以逗號分隔)',
  '婚姻狀況 (已婚/未婚/離婚/喪偶)',
  '扶養人數',
  '電子郵件 (必填唯一)',
  '手機號碼',
  '市話',
  '戶籍地址',
  '聯絡地址',
  'Line 帳號',
  '所屬機構',
  '部門 ID',
  '子部門 ID',
  '主管員工 ID',
  '職稱',
  '執業職稱',
  '人員狀態 (正職員工/試用期/離職/留職停薪)',
  '試用期天數',
  '是否兼職 (TRUE/FALSE)',
  '是否需打卡 (TRUE/FALSE)',
  '學歷程度',
  '畢業學校',
  '主修科目',
  '學歷狀態 (畢業/肄業)',
  '畢業年份',
  '役別類型 (志願役/義務役)',
  '軍種',
  '軍階',
  '退伍年份',
  '緊急聯絡人1 姓名',
  '緊急聯絡人1 關係',
  '緊急聯絡人1 電話1',
  '緊急聯絡人1 電話2',
  '緊急聯絡人2 姓名',
  '緊急聯絡人2 關係',
  '緊急聯絡人2 電話1',
  '緊急聯絡人2 電話2',
  '到職日期 (yyyy-mm-dd)',
  '起聘日期 (yyyy-mm-dd)',
  '離職日期 (yyyy-mm-dd)',
  '解聘日期 (yyyy-mm-dd)',
  '再任起聘 (yyyy-mm-dd)',
  '再任解聘 (yyyy-mm-dd)',
  '任職備註',
  '薪資類型 (月薪/日薪/時薪)',
  '薪資金額',
  '自提勞退 (%)',
  '員工墊付金額',
  '薪資帳戶A 銀行代號',
  '薪資帳戶A 帳號',
  '薪資帳戶B 銀行代號',
  '薪資帳戶B 帳號',
  '其他薪資項目 (多個逗號分隔)',
  '年度特休總天數',
  '已使用天數',
  '積假',
  '請假期限',
  '補休時數',
  '勞保投保薪資',
  '勞退投保薪資',
  '健保投保薪資',
  '眷口數'
]

async function createWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('員工資料')
  worksheet.addRow(EN_HEADERS)
  worksheet.addRow(ZH_HEADERS)
  rows.forEach((data) => {
    const row = EN_HEADERS.map((header) => (data[header] !== undefined ? data[header] : ''))
    worksheet.addRow(row)
  })
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

const NEW_COLUMN_HEADERS = [
  'annualLeave_totalDays',
  'annualLeave_usedDays',
  'annualLeave_accumulatedLeave',
  'annualLeave_expiryDate',
  'annualLeave_compensatoryHours',
  'laborInsuredSalary',
  'pensionInsuredSalary',
  'healthInsuredSalary',
  'dependentCount'
]

// 仿客戶實際交付的檔案：後加的 9 個欄位第 1 列沒有英文欄位名（空白或「115/8/31為截點」這類備註），
// 只有第 2 列有中文說明。blankRowsBefore 可在資料列前插入空白列。
async function createClientStyleWorkbookBuffer(rows, { blankRowsBetween = 0 } = {}) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('員工資料')
  const headerRow = EN_HEADERS.map(header => (NEW_COLUMN_HEADERS.includes(header) ? '' : header))
  headerRow[EN_HEADERS.indexOf('annualLeave_totalDays')] = '115/8/31為截點'
  worksheet.addRow(headerRow)
  worksheet.addRow(ZH_HEADERS)
  rows.forEach((data, index) => {
    if (index > 0) {
      for (let i = 0; i < blankRowsBetween; i += 1) worksheet.addRow([])
    }
    worksheet.addRow(EN_HEADERS.map(header => (data[header] !== undefined ? data[header] : '')))
  })
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  if (text.includes(',') || text.includes('\n')) {
    return `"${text}"`
  }
  return text
}

function createCsvBuffer(rows) {
  const csvLines = []
  csvLines.push(EN_HEADERS.map(escapeCsvValue).join(','))
  csvLines.push(ZH_HEADERS.map(escapeCsvValue).join(','))
  rows.forEach((data) => {
    const values = EN_HEADERS.map((header) => escapeCsvValue(data[header] ?? ''))
    csvLines.push(values.join(','))
  })
  const csvContent = csvLines.join('\n')
  return Buffer.from(csvContent, 'utf8')
}

beforeEach(() => {
  mockEmployeeModel.find.mockReset()
  mockEmployeeModel.insertMany.mockReset()
  mockEmployeeModel.updateOne.mockReset()
  mockEmployeeModel.updateOne.mockResolvedValue({ acknowledged: true })
  mockEmployeeModel.deleteMany.mockReset()
  mockEmployeeModel.startSession.mockReset()
  mockEmployeeModel.prototype.validate.mockReset()
  Object.values(mockSession).forEach(fn => fn.mockReset())
  mockEmployeeModel.startSession.mockResolvedValue(mockSession)
  mockSession.startTransaction.mockResolvedValue()
  mockSession.commitTransaction.mockResolvedValue()
  mockSession.abortTransaction.mockResolvedValue()
  mockSession.endSession.mockResolvedValue()
  setupEmployeeFind()
  mockOrganizationModel.find.mockReset()
  mockDepartmentModel.find.mockReset()
  mockSubDepartmentModel.find.mockReset()
  mockFindWithData(mockOrganizationModel, [])
  mockFindWithData(mockDepartmentModel, [])
  mockFindWithData(mockSubDepartmentModel, [])
  mockEmployeeModel.prototype.validate.mockImplementation(async function () {})
  mockEmployeeModel.insertMany.mockImplementation(async (docs) => docs.map(doc => ({ ...doc })))
  mockEmployeeModel.deleteMany.mockResolvedValue()
})

describe('POST /api/employees/bulk-import', () => {
  it('可由官方 CSV 範本匯入並產出預覽資料', async () => {
    const application = await setupApp()
    const buffer = createCsvBuffer([
      {
        employeeId: 'E0101',
        name: '林宥辰',
        email: 'csv_user@example.com',
        idNumber: 'Z123456789',
        department: 'RD',
        status: '正職員工',
        partTime: 'FALSE',
        needClockIn: 'TRUE',
        languages: '中文,英文'
      }
    ])

    mockFindWithData(mockDepartmentModel, [
      { _id: 'RD', code: 'RD', name: '研發部', organization: 'ORG001' }
    ])
    setupEmployeeFind({ emailData: [] })
    mockEmployeeModel.insertMany.mockImplementation(async (docs) => docs.map(doc => ({
      _id: `${doc.employeeNo}-id`,
      employeeId: doc.employeeNo,
      name: doc.name,
      department: doc.department,
      role: doc.role,
      email: doc.email,
      username: doc.username
    })))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.csv', contentType: 'text/csv' })

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(1)
    expect(response.body.failureCount).toBe(0)
    expect(response.body.preview).toEqual([
      {
        action: 'created',
        employeeNo: 'E0101',
        name: '林宥辰',
        department: 'RD',
        role: 'employee',
        email: 'csv_user@example.com',
        username: 'E0101',
        initialPassword: 'Z123456789'
      }
    ])
    expect(response.body.errors).toEqual([])
    expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(1)
    expect(mockEmployeeModel.startSession).toHaveBeenCalledTimes(1)
    expect(mockSession.startTransaction).toHaveBeenCalledTimes(1)
    expect(mockSession.commitTransaction).toHaveBeenCalledTimes(1)
    expect(mockSession.abortTransaction).not.toHaveBeenCalled()
  })

  it('成功匯入資料並回傳預覽與統計', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0001',
        name: '王小明',
        gender: 'm',
        idNumber: 'A123456789',
        email: 'user1@example.com',
        mobile: '0912345678',
        languages: '中文,英文',
        identityCategory: '原住民,身障',
        status: '試用期',
        partTime: 'FALSE',
        needClockIn: 'TRUE',
        education_level: '大學',
        education_status: '畢業',
        education_graduationYear: '2012',
        militaryService_type: '志願役',
        militaryService_dischargeYear: '2010',
        emergency1_name: '李媽媽',
        emergency1_relation: '母子',
        emergency1_phone1: '021234567',
        hireDate: '2024-01-01',
        salaryType: '月薪',
        salaryAmount: '50000',
        salaryItems: '績效獎金,交通補助'
      },
      {
        employeeId: 'E0002',
        name: '陳美麗',
        gender: 'F',
        idNumber: 'B223456789',
        email: 'user2@example.com',
        status: '正職員工',
        partTime: 'TRUE',
        needClockIn: 'FALSE',
        languages: '英文',
        hireDate: '2023-05-20'
      }
    ])

    setupEmployeeFind({ emailData: [] })
    mockEmployeeModel.insertMany.mockImplementation(async (docs) => docs.map(doc => ({
      _id: `${doc.employeeNo}-id`,
      employeeId: doc.employeeNo,
      name: doc.name,
      department: doc.department,
      role: doc.role,
      email: doc.email,
      username: doc.username,
      appointment: doc.appointment,
      identityCategory: doc.identityCategory,
      languages: doc.languages,
      salaryItems: doc.salaryItems
    })))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })
      .field('options', JSON.stringify({ defaultRole: 'supervisor' }))

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(2)
    expect(response.body.failureCount).toBe(0)
    expect(Array.isArray(response.body.preview)).toBe(true)
    expect(response.body.preview).toHaveLength(2)
    expect(response.body.errors).toEqual([])
    expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(1)

    const createdDoc = mockEmployeeModel.insertMany.mock.calls[0][0][0]
    expect(createdDoc).toMatchObject({
      employeeNo: 'E0001',
      name: '王小明',
      email: 'user1@example.com',
      role: 'supervisor',
      password: 'A123456789',
      employmentStatus: '試用期員工',
      salaryType: '月薪',
      salaryAmount: 50000
    })
    expect(createdDoc.username).toBe('E0001')
    expect(createdDoc.languages).toEqual(['中文', '英文'])
    expect(createdDoc.identityCategory).toEqual(['原住民', '身障'])
    expect(createdDoc.emergencyContacts[0]).toMatchObject({
      name: '李媽媽',
      relation: '母子',
      phone1: '021234567'
    })
    expect(createdDoc.salaryItems).toEqual(['績效獎金', '交通補助'])
    expect(createdDoc.appointment.hireDate).toBeInstanceOf(Date)
    expect(createdDoc.appointment.hireDate.toISOString()).toContain('2024-01-01')
    expect(response.body.credentialRule).toMatchObject({
      username: expect.stringContaining('帳號優先使用員工編號'),
      password: expect.stringContaining('身分證號')
    })
    expect(response.body.preview[0]).toMatchObject({
      username: 'E0001',
      initialPassword: 'A123456789'
    })
  })

  it('可匯入特休/補休與勞健保投保薪資等薪資計算新增欄位', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0010',
        name: '許少欣',
        idNumber: 'D123456789',
        email: 'e0010@example.com',
        annualLeave_totalDays: '14',
        annualLeave_usedDays: '3',
        annualLeave_accumulatedLeave: '2.5',
        annualLeave_expiryDate: '2026-12-31',
        annualLeave_compensatoryHours: '8',
        laborInsuredSalary: '45800',
        pensionInsuredSalary: '45800',
        healthInsuredSalary: '45800',
        dependentCount: '2'
      }
    ])

    setupEmployeeFind({ emailData: [] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })
      .field('options', JSON.stringify({ defaultRole: 'employee' }))

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(1)
    expect(response.body.errors).toEqual([])

    const createdDoc = mockEmployeeModel.insertMany.mock.calls[0][0][0]
    expect(createdDoc.annualLeave).toMatchObject({
      totalDays: 14,
      usedDays: 3,
      accumulatedLeave: 2.5,
      compensatoryHours: 8
    })
    expect(createdDoc.annualLeave.expiryDate).toBeInstanceOf(Date)
    expect(createdDoc.annualLeave.expiryDate.toISOString()).toContain('2026-12-31')
    expect(createdDoc.laborInsuredSalary).toBe(45800)
    expect(createdDoc.pensionInsuredSalary).toBe(45800)
    expect(createdDoc.healthInsuredSalary).toBe(45800)
    expect(createdDoc.dependentCount).toBe(2)
  })

  describe('客戶實際檔案格式（民國年日期、中文說明列、更新既有員工）', () => {
    async function postImport(buffer, options = {}) {
      const application = await setupApp()
      return request(application)
        .post('/api/employees/bulk-import')
        .attach('file', buffer, { filename: 'import.xlsx' })
        .field('options', JSON.stringify(options))
    }

    it('第 1 列沒有英文欄位名時，改用第 2 列的中文說明讀取特休與投保薪資欄位', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        {
          employeeId: 'E0201',
          name: '許少欣',
          idNumber: 'D123456789',
          email: 'e0201@example.com',
          annualLeave_totalDays: 170,
          annualLeave_usedDays: 8,
          annualLeave_compensatoryHours: 2.5,
          laborInsuredSalary: 45800,
          pensionInsuredSalary: 45800,
          healthInsuredSalary: '45,800',
          dependentCount: 2
        }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      const createdDoc = mockEmployeeModel.insertMany.mock.calls[0][0][0]
      expect(createdDoc.annualLeave).toMatchObject({ totalDays: 170, usedDays: 8, compensatoryHours: 2.5 })
      expect(createdDoc.laborInsuredSalary).toBe(45800)
      expect(createdDoc.pensionInsuredSalary).toBe(45800)
      expect(createdDoc.healthInsuredSalary).toBe(45800)
      expect(createdDoc.dependentCount).toBe(2)
    })

    it('民國年日期（091/12/01）轉成正確的西元日期', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        {
          employeeId: 'E0202',
          name: '黃麗娥',
          idNumber: 'D223456789',
          email: 'e0202@example.com',
          birthDate: '060/10/01',
          hireDate: '091/12/01',
          annualLeave_expiryDate: '116/12/09'
        }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      const createdDoc = mockEmployeeModel.insertMany.mock.calls[0][0][0]
      expect(createdDoc.birthday.toISOString().slice(0, 10)).toBe('1971-10-01')
      expect(createdDoc.appointment.hireDate.toISOString().slice(0, 10)).toBe('2002-12-01')
      expect(createdDoc.annualLeave.expiryDate.toISOString().slice(0, 10)).toBe('2027-12-09')
    })

    it('投保薪資欄位出現「已勞退」這類文字時略過並回報提醒；積假「3國」取數字 3', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        {
          employeeId: 'E0203',
          name: '陳麗君',
          idNumber: 'D323456789',
          email: 'e0203@example.com',
          laborInsuredSalary: '已勞退',
          healthInsuredSalary: '投65歲',
          annualLeave_accumulatedLeave: '3國'
        }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      const createdDoc = mockEmployeeModel.insertMany.mock.calls[0][0][0]
      expect(createdDoc.laborInsuredSalary).toBe(0)
      expect(createdDoc.healthInsuredSalary).toBe(0)
      expect(createdDoc.annualLeave.accumulatedLeave).toBe(3)
      expect(response.body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('勞保投保薪資」的值「已勞退」不是數字'),
        expect.stringContaining('健保投保薪資」的值「投65歲」不是數字'),
        expect.stringContaining('積假」的值「3國」已取數字 3')
      ]))
    })

    it('自提勞退填 0.06（6%）時，依勞退投保薪資換算成每月金額', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        {
          employeeId: 'E0204',
          name: '蕭雅內',
          idNumber: 'D423456789',
          email: 'e0204@example.com',
          laborPensionSelf: 0.06,
          pensionInsuredSalary: 45800
        },
        {
          employeeId: 'E0205',
          name: '童元龍',
          idNumber: 'D523456789',
          email: 'e0205@example.com',
          laborPensionSelf: 0.06
        }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
      expect(docs[0].laborPensionSelf).toBe(2748)
      expect(docs[1].laborPensionSelf).toBe(0)
      expect(response.body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('換算為每月 2748 元'),
        expect.stringContaining('沒有可換算的投保薪資或薪資金額')
      ]))
    })

    it('檔案中間有空白列時，後面的資料不會被漏掉', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'E0206', name: '甲', idNumber: 'D623456789', email: 'e0206@example.com' },
        { employeeId: 'E0207', name: '乙', idNumber: 'D723456789', email: 'e0207@example.com' }
      ], { blankRowsBetween: 2 })
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      expect(response.body.successCount).toBe(2)
      expect(mockEmployeeModel.insertMany.mock.calls[0][0].map(doc => doc.employeeNo)).toEqual(['E0206', 'E0207'])
    })

    it('同一份檔案內的主管可被指定，且被指定為主管者自動成為 supervisor；主管欄填自己則不設定', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'S100', name: '主管甲', idNumber: 'D823456789', email: 's100@example.com', supervisor: 'S100' },
        { employeeId: 'E0208', name: '員工乙', idNumber: 'D923456789', email: 'e0208@example.com', supervisor: 'S100' },
        { employeeId: 'E0209', name: '員工丙', idNumber: 'E023456789', email: 'e0209@example.com', supervisor: 'S100' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      const [boss, staffB, staffC] = mockEmployeeModel.insertMany.mock.calls[0][0]
      expect(boss.role).toBe('supervisor')
      expect(boss.supervisor).toBeUndefined()
      expect(staffB.role).toBe('employee')
      expect(String(staffB.supervisor)).toBe(String(boss._id))
      expect(String(staffC.supervisor)).toBe(String(boss._id))
      expect(response.body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('第 3 列的主管員工 ID 與本人相同')
      ]))
    })

    it('只有一個人的單位，主管欄填自己的帳號也會成為 supervisor（但不設定直屬主管）', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'G0001', name: '單人單位', idNumber: 'E523456780', email: 'g0001@example.com', supervisor: 'G0001' },
        { employeeId: 'E0220', name: '一般員工', idNumber: 'E623456780', email: 'e0220@example.com' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer)

      expect(response.status).toBe(200)
      const [solo, plain] = mockEmployeeModel.insertMany.mock.calls[0][0]
      expect(solo.role).toBe('supervisor')
      expect(solo.supervisor).toBeUndefined()
      expect(plain.role).toBe('employee')
    })

    it('明確指定預設權限時，不會自動把被指定的主管升為 supervisor', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'S101', name: '主管甲', idNumber: 'E123456780', email: 's101@example.com' },
        { employeeId: 'E0210', name: '員工乙', idNumber: 'E223456780', email: 'e0210@example.com', supervisor: 'S101' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await postImport(buffer, { defaultRole: 'admin' })

      expect(response.status).toBe(200)
      const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
      expect(docs.map(doc => doc.role)).toEqual(['admin', 'admin'])
    })

    it('未勾選「更新既有員工」時，員工編號或 Email 已存在會停止匯入並提示', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'E0301', name: '舊員工', idNumber: 'E323456780', email: 'old@example.com' }
      ])
      setupEmployeeFind({
        emailData: [{ _id: 'id-old', email: 'old@example.com', employeeId: 'E0301' }],
        existingByNo: [{ _id: 'id-old', employeeId: 'E0301', email: 'old@example.com' }]
      })

      const response = await postImport(buffer)

      expect(response.status).toBe(400)
      expect(response.body.errors[0]).toMatch(/更新已存在的員工資料/)
      expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
      expect(mockEmployeeModel.updateOne).not.toHaveBeenCalled()
    })

    it('勾選「更新既有員工」：已存在的更新、不存在的新增，空白儲存格不會洗掉原有資料', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        {
          employeeId: 'E0301',
          name: '舊員工',
          idNumber: 'E323456780',
          email: 'old@example.com',
          hireDate: '100/04/20',
          salaryAmount: 36300,
          laborInsuredSalary: 36300,
          annualLeave_totalDays: 120,
          annualLeave_compensatoryHours: 4,
          dependentCount: 1
        },
        { employeeId: 'E0302', name: '新員工', idNumber: 'E423456780', email: 'new@example.com' }
      ])
      setupEmployeeFind({
        emailData: [{ _id: 'id-old', email: 'old@example.com', employeeId: 'E0301' }],
        existingByNo: [{ _id: 'id-old', employeeId: 'E0301', email: 'old@example.com' }]
      })

      const response = await postImport(buffer, { updateExisting: true })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ successCount: 2, createdCount: 1, updatedCount: 1 })
      expect(response.body.preview.map(item => item.action)).toEqual(['created', 'updated'])

      expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(1)
      expect(mockEmployeeModel.insertMany.mock.calls[0][0].map(doc => doc.employeeNo)).toEqual(['E0302'])

      expect(mockEmployeeModel.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update, updateOptions] = mockEmployeeModel.updateOne.mock.calls[0]
      expect(filter).toEqual({ _id: 'id-old' })
      expect(update.$set).toMatchObject({
        name: '舊員工',
        idNumber: 'E323456780',
        salaryAmount: 36300,
        laborInsuredSalary: 36300,
        dependentCount: 1,
        'annualLeave.totalDays': 120,
        'annualLeave.compensatoryHours': 4
      })
      expect(update.$set['appointment.hireDate'].toISOString().slice(0, 10)).toBe('2011-04-20')
      // 帳號、權限、Email、密碼不會被更新
      ;['role', 'username', 'email', 'password', 'employeeId'].forEach(key => {
        expect(update.$set).not.toHaveProperty(key)
      })
      // 檔案中沒填的欄位不會出現在更新內容裡（不會把原有資料清掉）
      ;['salaryType', 'title', 'department', 'supervisor', 'annualLeave.usedDays'].forEach(key => {
        expect(update.$set).not.toHaveProperty(key)
      })
      expect(updateOptions).toEqual({ session: mockSession })
      expect(mockSession.commitTransaction).toHaveBeenCalledTimes(1)
    })

    it('更新模式下 Email 已被另一位員工使用時，停止匯入', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'E0301', name: '舊員工', idNumber: 'E323456780', email: 'other@example.com' }
      ])
      setupEmployeeFind({
        emailData: [{ _id: 'id-other', email: 'other@example.com', employeeId: 'E0999' }],
        existingByNo: [{ _id: 'id-old', employeeId: 'E0301', email: 'old@example.com' }]
      })

      const response = await postImport(buffer, { updateExisting: true })

      expect(response.status).toBe(400)
      expect(response.body.errors[0]).toMatch(/Email 已被另一位員工使用/)
      expect(mockEmployeeModel.updateOne).not.toHaveBeenCalled()
    })

    it('更新失敗時回報失敗列並中止（交易回滾）', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'E0301', name: '舊員工', idNumber: 'E323456780', email: 'old@example.com', salaryAmount: 1 }
      ])
      setupEmployeeFind({
        emailData: [{ _id: 'id-old', email: 'old@example.com', employeeId: 'E0301' }],
        existingByNo: [{ _id: 'id-old', employeeId: 'E0301', email: 'old@example.com' }]
      })
      mockEmployeeModel.updateOne.mockRejectedValueOnce(new Error('write failed'))

      const response = await postImport(buffer, { updateExisting: true })

      expect(response.status).toBe(400)
      expect(response.body.rowNumber).toBe(3)
      expect(response.body.errors[0]).toMatch(/第 3 列：write failed/)
      expect(mockSession.abortTransaction).toHaveBeenCalledTimes(1)
      expect(mockSession.commitTransaction).not.toHaveBeenCalled()
    })
  })

  it('欄位缺漏時回傳錯誤並不建立資料', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0003',
        email: 'user3@example.com',
        idNumber: 'C123456789'
      }
    ])

    setupEmployeeFind({ emailData: [] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(3)
    expect(response.body.errors[0]).toMatch(/缺少姓名/)
    expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
    expect(mockEmployeeModel.startSession).not.toHaveBeenCalled()
  })

  it('缺少身分證號會回報錯誤並阻擋匯入', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0901',
        name: '缺少證號',
        email: 'no-id@example.com'
      }
    ])

    setupEmployeeFind({ emailData: [] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.errors[0]).toMatch(/缺少身分證號/)
    expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
  })

  it('偵測檔案內重複 Email 與既有 Email', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0004',
        name: '張一',
        email: 'dup@example.com',
        idNumber: 'D123456789'
      },
      {
        employeeId: 'E0005',
        name: '張二',
        email: 'dup@example.com',
        idNumber: 'E123456789'
      },
      {
        employeeId: 'E0006',
        name: '張三',
        email: 'taken@example.com',
        idNumber: 'F123456789'
      }
    ])

    setupEmployeeFind({ emailData: [{ email: 'taken@example.com' }] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(4)
    // 一次回報所有有問題的列，不再只回報第一列
    expect(response.body.errors).toHaveLength(2)
    expect(response.body.errors[0]).toMatch(/第 4 列：Email 重複/)
    expect(response.body.errors[1]).toMatch(/第 5 列：Email 已存在/)
    expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
    expect(mockEmployeeModel.startSession).not.toHaveBeenCalled()
  })

  it('驗證失敗時不進行任何寫入', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E1000',
        name: '',
        email: '',
        idNumber: 'G123456789'
      },
      {
        employeeId: 'E1001',
        name: '正常資料',
        email: 'ok@example.com',
        idNumber: 'H123456789'
      }
    ])

    setupEmployeeFind({ emailData: [] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(3)
    expect(response.body.errors[0]).toMatch(/缺少 Email/)
    expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
    expect(mockEmployeeModel.startSession).not.toHaveBeenCalled()
  })

  it('寫入過程出錯會回滾交易並回報列號', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E2000',
        name: '第一筆',
        email: 'first@example.com',
        idNumber: 'I123456789'
      },
      {
        employeeId: 'E2001',
        name: '第二筆',
        email: 'second@example.com',
        idNumber: 'J123456789'
      }
    ])

    setupEmployeeFind({ emailData: [] })
    mockEmployeeModel.insertMany.mockImplementation(async (docs) => {
      const error = new Error('DB failed')
      error.insertedDocs = [docs[0]]
      throw error
    })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(4)
    expect(response.body.errors[0]).toMatch(/DB failed/)
    expect(mockSession.startTransaction).toHaveBeenCalledTimes(1)
    expect(mockSession.abortTransaction).toHaveBeenCalledTimes(1)
    expect(mockSession.commitTransaction).not.toHaveBeenCalled()
    expect(mockEmployeeModel.deleteMany).not.toHaveBeenCalled()
  })

  it('交易不可用時發生錯誤會執行補償刪除並提示環境不支援交易', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E2100',
        name: '第一筆',
        email: 'first@example.com',
        idNumber: 'T123456789'
      },
      {
        employeeId: 'E2101',
        name: '第二筆',
        email: 'second@example.com',
        idNumber: 'U123456789'
      }
    ])

    setupEmployeeFind({ emailData: [] })
    mockEmployeeModel.startSession.mockResolvedValue({
      ...mockSession,
      startTransaction: undefined
    })
    mockEmployeeModel.insertMany.mockImplementation(async (docs) => {
      const error = new Error('validation failed')
      error.insertedDocs = [
        { ...docs[0], _id: 'partial-id' }
      ]
      throw error
    })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(4)
    expect(response.body.message).toContain('環境不支援交易')
    expect(mockEmployeeModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['partial-id'] } })
    expect(mockSession.abortTransaction).not.toHaveBeenCalled()
  })

  describe('資料庫是單機模式（沒有複本集、不支援交易）', () => {
    const unsupportedError = () => {
      const error = new Error('Transaction numbers are only allowed on a replica set member or mongos')
      error.code = 20
      error.codeName = 'IllegalOperation'
      return error
    }

    const post = async (buffer, options) => {
      const application = await setupApp()
      const req = request(application)
        .post('/api/employees/bulk-import')
        .attach('file', buffer, { filename: 'import.xlsx' })
      return options ? req.field('options', JSON.stringify(options)) : req
    }

    it('新增員工：交易被拒絕時自動改用非交易方式寫入，匯入仍然成功並提醒', async () => {
      const buffer = await createWorkbookBuffer([
        { employeeId: 'E3000', name: '單機甲', email: 'standalone-a@example.com', idNumber: 'N123456781' },
        { employeeId: 'E3001', name: '單機乙', email: 'standalone-b@example.com', idNumber: 'N123456782' }
      ])
      setupEmployeeFind({ emailData: [] })
      mockEmployeeModel.insertMany.mockRejectedValueOnce(unsupportedError())

      const response = await post(buffer)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ successCount: 2, createdCount: 2, updatedCount: 0 })
      expect(response.body.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('不支援交易')
      ]))
      expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(2)
      expect(mockEmployeeModel.insertMany.mock.calls[0][1]).toHaveProperty('session', mockSession)
      expect(mockEmployeeModel.insertMany.mock.calls[1][1]).not.toHaveProperty('session')
      expect(mockEmployeeModel.startSession).toHaveBeenCalledTimes(1)
      expect(mockSession.commitTransaction).not.toHaveBeenCalled()
      expect(mockSession.endSession).toHaveBeenCalledTimes(1)
    })

    it('只更新既有員工：交易被拒絕時同樣改用非交易方式更新', async () => {
      const buffer = await createClientStyleWorkbookBuffer([
        { employeeId: 'E3100', name: '舊員工', idNumber: 'N223456781', email: 'old-standalone@example.com', salaryAmount: 40000 }
      ])
      setupEmployeeFind({
        emailData: [{ _id: 'id-old', email: 'old-standalone@example.com', employeeId: 'E3100' }],
        existingByNo: [{ _id: 'id-old', employeeId: 'E3100', email: 'old-standalone@example.com' }]
      })
      mockEmployeeModel.updateOne.mockRejectedValueOnce(unsupportedError())

      const response = await post(buffer, { updateExisting: true })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ createdCount: 0, updatedCount: 1 })
      expect(mockEmployeeModel.updateOne).toHaveBeenCalledTimes(2)
      expect(mockEmployeeModel.updateOne.mock.calls[0][2]).toEqual({ session: mockSession })
      expect(mockEmployeeModel.updateOne.mock.calls[1][2]).toBeUndefined()
      expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
    })

    it('改用非交易方式後若再失敗，仍會補償刪除已新增的員工並提示環境不支援交易', async () => {
      const buffer = await createWorkbookBuffer([
        { employeeId: 'E3200', name: '單機丙', email: 'standalone-c@example.com', idNumber: 'N323456781' },
        { employeeId: 'E3201', name: '單機丁', email: 'standalone-d@example.com', idNumber: 'N323456782' }
      ])
      setupEmployeeFind({ emailData: [] })
      mockEmployeeModel.insertMany
        .mockRejectedValueOnce(unsupportedError())
        .mockImplementationOnce(async docs => {
          const error = new Error('validation failed')
          error.insertedDocs = [{ ...docs[0], _id: 'partial-id' }]
          throw error
        })

      const response = await post(buffer)

      expect(response.status).toBe(400)
      expect(response.body.rowNumber).toBe(4)
      expect(response.body.message).toContain('環境不支援交易')
      expect(mockEmployeeModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['partial-id'] } })
    })

    it('其他類型的寫入錯誤不會被誤判成「不支援交易」而重試', async () => {
      const buffer = await createWorkbookBuffer([
        { employeeId: 'E3300', name: '一般錯誤', email: 'plain-error@example.com', idNumber: 'N423456781' }
      ])
      setupEmployeeFind({ emailData: [] })
      mockEmployeeModel.insertMany.mockRejectedValue(new Error('E11000 duplicate key error'))

      const response = await post(buffer)

      expect(response.status).toBe(400)
      expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(1)
      expect(mockSession.abortTransaction).toHaveBeenCalledTimes(1)
    })
  })

  it('遇到未知部門時回傳 409 並提供對應選項', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0500',
        name: '參照測試',
        email: 'unknown-ref@example.com',
        organization: '未知機構',
        department: '未知部門',
        subDepartment: '未知單位',
        idNumber: 'K123456789'
      }
    ])

    mockFindWithData(mockOrganizationModel, [
      { _id: 'org1', name: '總公司', orgCode: 'ORG-01' }
    ])
    mockFindWithData(mockDepartmentModel, [
      { _id: 'dep1', name: '研發部', code: 'RD', organization: 'org1' }
    ])
    mockFindWithData(mockSubDepartmentModel, [
      { _id: 'sub1', name: '研發一組', code: 'RD-1', department: 'dep1' }
    ])
    setupEmployeeFind({ emailData: [] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(409)
    expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
    const { missingReferences } = response.body
    expect(missingReferences).toBeTruthy()
    expect(missingReferences.organization.values[0]).toMatchObject({ value: '未知機構', rows: [3] })
    expect(missingReferences.department.values[0]).toMatchObject({ value: '未知部門', rows: [3] })
    expect(missingReferences.subDepartment.values[0]).toMatchObject({ value: '未知單位', rows: [3] })
    expect(missingReferences.department.options[0]).toMatchObject({ id: 'dep1', name: '研發部' })
    expect(missingReferences.subDepartment.options[0]).toMatchObject({ id: 'sub1', name: '研發一組' })
    expect(missingReferences.organization.options[0]).toMatchObject({ id: 'org1', name: '總公司' })
  })

  describe('「所屬機構」欄填的是部門名稱（機構與部門同一層）', () => {
    const importRows = () => createWorkbookBuffer([
      {
        employeeId: 'E0600',
        name: '同層甲',
        email: 'same-level-a@example.com',
        organization: '迦南康復之家',
        department: '迦南康復之家',
        idNumber: 'M123456780'
      },
      {
        employeeId: 'E0601',
        name: '同層乙',
        email: 'same-level-b@example.com',
        organization: '和泰護理之家',
        department: '和泰護理之家',
        idNumber: 'M123456781'
      }
    ])

    const post = async buffer => {
      const application = await setupApp()
      mockEmployeeModel.insertMany.mockImplementation(async docs => docs.map(doc => ({ ...doc })))
      return request(application)
        .post('/api/employees/bulk-import')
        .attach('file', buffer, { filename: 'import.xlsx' })
    }

    it('機構值等於某個部門名稱時，自動對應到該部門所屬的機構，不需要逐一對應', async () => {
      mockFindWithData(mockOrganizationModel, [{ _id: 'org-system', name: '迦南健康照護體系' }])
      mockFindWithData(mockDepartmentModel, [
        { _id: 'dep-kangfu', name: '迦南康復之家', organization: 'org-system' },
        { _id: 'dep-hetai', name: '和泰護理之家', organization: 'org-system' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await post(await importRows())

      expect(response.status).toBe(200)
      const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
      expect(docs.map(doc => doc.organization)).toEqual(['org-system', 'org-system'])
      expect(docs.map(doc => doc.department)).toEqual(['dep-kangfu', 'dep-hetai'])
    })

    it('真的有同名機構時，以機構為準，不會被部門的上層機構蓋掉', async () => {
      mockFindWithData(mockOrganizationModel, [
        { _id: 'org-system', name: '迦南健康照護體系' },
        { _id: 'org-own', name: '迦南康復之家' }
      ])
      mockFindWithData(mockDepartmentModel, [
        { _id: 'dep-kangfu', name: '迦南康復之家', organization: 'org-system' },
        { _id: 'dep-hetai', name: '和泰護理之家', organization: 'org-system' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await post(await importRows())

      expect(response.status).toBe(200)
      const docs = mockEmployeeModel.insertMany.mock.calls[0][0]
      expect(docs.map(doc => doc.organization)).toEqual(['org-own', 'org-system'])
    })

    it('同名部門分屬不同機構、無法判斷時，仍回傳 409 請使用者對應', async () => {
      mockFindWithData(mockOrganizationModel, [
        { _id: 'org-a', name: '甲體系' },
        { _id: 'org-b', name: '乙體系' }
      ])
      mockFindWithData(mockDepartmentModel, [
        { _id: 'dep-a', name: '迦南康復之家', organization: 'org-a' },
        { _id: 'dep-b', name: '迦南康復之家', organization: 'org-b' },
        { _id: 'dep-hetai', name: '和泰護理之家', organization: 'org-a' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await post(await importRows())

      expect(response.status).toBe(409)
      const values = response.body.missingReferences.organization.values.map(item => item.value)
      expect(values).toEqual(['迦南康復之家'])
      expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
    })

    it('機構值既不是機構也不是任何部門名稱時，維持原本的 409 流程', async () => {
      mockFindWithData(mockOrganizationModel, [{ _id: 'org-system', name: '迦南健康照護體系' }])
      mockFindWithData(mockDepartmentModel, [
        { _id: 'dep-hetai', name: '和泰護理之家', organization: 'org-system' }
      ])
      setupEmployeeFind({ emailData: [] })

      const response = await post(await importRows())

      expect(response.status).toBe(409)
      const values = response.body.missingReferences.organization.values.map(item => item.value)
      expect(values).toEqual(['迦南康復之家'])
    })
  })

  it('提供 valueMappings 與 ignore 後可完成匯入', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0501',
        name: '參照映射',
        email: 'mapped-ref@example.com',
        organization: '未知機構',
        department: '未知部門',
        subDepartment: '未知單位',
        idNumber: 'L123456789'
      }
    ])

    mockFindWithData(mockOrganizationModel, [
      { _id: 'org1', name: '總公司', orgCode: 'ORG-01' }
    ])
    mockFindWithData(mockDepartmentModel, [
      { _id: 'dep1', name: '研發部', code: 'RD', organization: 'org1' }
    ])
    mockFindWithData(mockSubDepartmentModel, [
      { _id: 'sub1', name: '研發一組', code: 'RD-1', department: 'dep1' }
    ])
    setupEmployeeFind({ emailData: [] })
    mockEmployeeModel.insertMany.mockImplementation(async (docs) => docs.map(doc => ({
      ...doc,
      _id: `${doc.employeeNo}-id`
    })))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .field('valueMappings', JSON.stringify({
        department: { '未知部門': 'dep1' },
        subDepartment: { '未知單位': 'sub1' }
      }))
      .field('ignore', JSON.stringify({ organization: ['未知機構'] }))
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(200)
    expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(1)
    const createdDoc = mockEmployeeModel.insertMany.mock.calls[0][0][0]
    expect(createdDoc.department).toBe('dep1')
    expect(createdDoc.subDepartment).toBe('sub1')
    expect(createdDoc.organization).toBeNull()
  })

  it('主管先存在系統時可依姓名或編號自動對應 supervisor', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E3001',
        name: '受聘員工A',
        email: 'staffA@example.com',
        idNumber: 'P123456789',
        supervisor: '主管甲'
      },
      {
        employeeId: 'E3002',
        name: '受聘員工B',
        email: 'staffB@example.com',
        idNumber: 'Q123456789',
        supervisor: 'S0001'
      }
    ])

    setupEmployeeFind({
      referenceData: [{ _id: 'sup-id', name: '主管甲', employeeId: 'S0001' }],
      emailData: []
    })
    mockEmployeeModel.insertMany.mockImplementation(async (docs) => docs.map(doc => ({
      ...doc,
      _id: `${doc.employeeNo}-id`
    })))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(200)
    expect(mockEmployeeModel.insertMany).toHaveBeenCalledTimes(1)
    const firstCreated = mockEmployeeModel.insertMany.mock.calls[0][0][0]
    const secondCreated = mockEmployeeModel.insertMany.mock.calls[0][0][1]
    expect(firstCreated.supervisor).toBe('sup-id')
    expect(secondCreated.supervisor).toBe('sup-id')
  })

  it('主管參照缺失時回傳 409 並提供提示', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E3003',
        name: '無主管匹配',
        email: 'nosup@example.com',
        supervisor: '不存在的主管',
        idNumber: 'R123456789'
      }
    ])

    setupEmployeeFind({ referenceData: [], emailData: [] })

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(409)
    expect(response.body.missingReferences.supervisor.values[0]).toMatchObject({ value: '不存在的主管', rows: [3] })
    expect(response.body.missingReferences.supervisor.options).toEqual([])
    expect(mockEmployeeModel.insertMany).not.toHaveBeenCalled()
  })
})
