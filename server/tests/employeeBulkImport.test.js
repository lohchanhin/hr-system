import request from 'supertest'
import express from 'express'
import ExcelJS from 'exceljs'
import { jest } from '@jest/globals'

const mockEmployeeModel = {
  find: jest.fn(),
  create: jest.fn(),
  startSession: jest.fn()
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
  'salaryItems'
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
  '其他薪資項目 (多個逗號分隔)'
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
  Object.values(mockEmployeeModel).forEach(fn => fn.mockReset())
  Object.values(mockSession).forEach(fn => fn.mockReset())
  mockEmployeeModel.startSession.mockResolvedValue(mockSession)
  mockSession.startTransaction.mockResolvedValue()
  mockSession.commitTransaction.mockResolvedValue()
  mockSession.abortTransaction.mockResolvedValue()
  mockSession.endSession.mockResolvedValue()
  mockOrganizationModel.find.mockReset()
  mockDepartmentModel.find.mockReset()
  mockSubDepartmentModel.find.mockReset()
  mockFindWithData(mockOrganizationModel, [])
  mockFindWithData(mockDepartmentModel, [])
  mockFindWithData(mockSubDepartmentModel, [])
})

describe('POST /api/employees/bulk-import', () => {
  it('可由官方 CSV 範本匯入並產出預覽資料', async () => {
    const application = await setupApp()
    const buffer = createCsvBuffer([
      {
        employeeId: 'E0101',
        name: '林宥辰',
        email: 'csv_user@example.com',
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
    mockEmployeeModel.find.mockResolvedValue([])
    mockEmployeeModel.create.mockImplementation(async (doc) => ({
      _id: `${doc.employeeNo}-id`,
      employeeId: doc.employeeNo,
      name: doc.name,
      department: doc.department,
      role: doc.role,
      email: doc.email
    }))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.csv', contentType: 'text/csv' })

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(1)
    expect(response.body.failureCount).toBe(0)
    expect(response.body.preview).toEqual([
      {
        employeeNo: 'E0101',
        name: '林宥辰',
        department: 'RD',
        role: 'employee',
        email: 'csv_user@example.com'
      }
    ])
    expect(response.body.errors).toEqual([])
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
        email: 'user2@example.com',
        status: '正職員工',
        partTime: 'TRUE',
        needClockIn: 'FALSE',
        languages: '英文',
        hireDate: '2023-05-20'
      }
    ])

    mockEmployeeModel.find.mockResolvedValue([])
    mockEmployeeModel.create.mockImplementation(async (doc) => ({
      _id: `${doc.employeeNo}-id`,
      employeeId: doc.employeeNo,
      name: doc.name,
      department: doc.department,
      role: doc.role,
      email: doc.email
    }))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })
      .field('options', JSON.stringify({ defaultRole: 'supervisor', resetPassword: 'Temp1234!' }))

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(2)
    expect(response.body.failureCount).toBe(0)
    expect(Array.isArray(response.body.preview)).toBe(true)
    expect(response.body.preview).toHaveLength(2)
    expect(response.body.errors).toEqual([])
    expect(mockEmployeeModel.create).toHaveBeenCalledTimes(2)

    const createdDoc = mockEmployeeModel.create.mock.calls[0][0]
    expect(createdDoc).toMatchObject({
      employeeNo: 'E0001',
      name: '王小明',
      email: 'user1@example.com',
      role: 'supervisor',
      password: 'Temp1234!',
      employmentStatus: '試用期員工',
      salaryType: '月薪',
      salaryAmount: 50000
    })
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
  })

  it('欄位缺漏時回傳錯誤並不建立資料', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0003',
        email: 'user3@example.com'
      }
    ])

    mockEmployeeModel.find.mockResolvedValue([])

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(3)
    expect(response.body.errors[0]).toMatch(/缺少姓名/)
    expect(mockEmployeeModel.create).not.toHaveBeenCalled()
    expect(mockEmployeeModel.startSession).not.toHaveBeenCalled()
  })

  it('偵測檔案內重複 Email 與既有 Email', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E0004',
        name: '張一',
        email: 'dup@example.com'
      },
      {
        employeeId: 'E0005',
        name: '張二',
        email: 'dup@example.com'
      },
      {
        employeeId: 'E0006',
        name: '張三',
        email: 'taken@example.com'
      }
    ])

    mockEmployeeModel.find.mockResolvedValue([{ email: 'taken@example.com' }])
    mockEmployeeModel.create.mockImplementation(async (doc) => ({
      _id: `${doc.employeeNo}-id`,
      employeeId: doc.employeeNo,
      name: doc.name,
      department: doc.department,
      role: doc.role,
      email: doc.email
    }))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(4)
    expect(response.body.errors).toHaveLength(1)
    expect(response.body.errors[0]).toMatch(/Email 重複/)
    expect(mockEmployeeModel.create).not.toHaveBeenCalled()
    expect(mockEmployeeModel.startSession).not.toHaveBeenCalled()
  })

  it('驗證失敗時不進行任何寫入', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E1000',
        name: '',
        email: ''
      },
      {
        employeeId: 'E1001',
        name: '正常資料',
        email: 'ok@example.com'
      }
    ])

    mockEmployeeModel.find.mockResolvedValue([])

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(400)
    expect(response.body.rowNumber).toBe(3)
    expect(response.body.errors[0]).toMatch(/缺少 Email/)
    expect(mockEmployeeModel.create).not.toHaveBeenCalled()
    expect(mockEmployeeModel.startSession).not.toHaveBeenCalled()
  })

  it('寫入過程出錯會回滾交易並回報列號', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      {
        employeeId: 'E2000',
        name: '第一筆',
        email: 'first@example.com'
      },
      {
        employeeId: 'E2001',
        name: '第二筆',
        email: 'second@example.com'
      }
    ])

    mockEmployeeModel.find.mockResolvedValue([])
    mockEmployeeModel.create
      .mockImplementationOnce(async (doc) => ({
        _id: `${doc.employeeNo}-id`,
        employeeId: doc.employeeNo,
        name: doc.name,
        department: doc.department,
        role: doc.role,
        email: doc.email
      }))
      .mockImplementationOnce(async () => {
        throw new Error('DB failed')
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
        subDepartment: '未知單位'
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
    mockEmployeeModel.find.mockResolvedValue([])

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(409)
    expect(mockEmployeeModel.create).not.toHaveBeenCalled()
    const { missingReferences } = response.body
    expect(missingReferences).toBeTruthy()
    expect(missingReferences.organization.values[0]).toMatchObject({ value: '未知機構', rows: [3] })
    expect(missingReferences.department.values[0]).toMatchObject({ value: '未知部門', rows: [3] })
    expect(missingReferences.subDepartment.values[0]).toMatchObject({ value: '未知單位', rows: [3] })
    expect(missingReferences.department.options[0]).toMatchObject({ id: 'dep1', name: '研發部' })
    expect(missingReferences.subDepartment.options[0]).toMatchObject({ id: 'sub1', name: '研發一組' })
    expect(missingReferences.organization.options[0]).toMatchObject({ id: 'org1', name: '總公司' })
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
        subDepartment: '未知單位'
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
    mockEmployeeModel.find.mockResolvedValue([])
    mockEmployeeModel.create.mockImplementation(async (doc) => ({
      ...doc,
      _id: `${doc.employeeNo}-id`
    }))

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .field('valueMappings', JSON.stringify({
        department: { '未知部門': 'dep1' },
        subDepartment: { '未知單位': 'sub1' }
      }))
      .field('ignore', JSON.stringify({ organization: ['未知機構'] }))
      .attach('file', buffer, { filename: 'import.xlsx' })

    expect(response.status).toBe(200)
    expect(mockEmployeeModel.create).toHaveBeenCalledTimes(1)
    const createdDoc = mockEmployeeModel.create.mock.calls[0][0]
    expect(createdDoc.department).toBe('dep1')
    expect(createdDoc.subDepartment).toBe('sub1')
    expect(createdDoc.organization).toBeNull()
  })
})
