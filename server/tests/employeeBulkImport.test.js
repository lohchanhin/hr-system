import request from 'supertest'
import express from 'express'
import ExcelJS from 'exceljs'
import { jest } from '@jest/globals'

const mockEmployeeModel = {
  find: jest.fn(),
  create: jest.fn()
}

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: mockEmployeeModel
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

beforeEach(() => {
  Object.values(mockEmployeeModel).forEach(fn => fn.mockReset())
})

describe('POST /api/employees/bulk-import', () => {
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
    expect(response.body.successCount).toBe(0)
    expect(response.body.failureCount).toBe(1)
    expect(response.body.errors[0]).toMatch(/缺少姓名/)
    expect(mockEmployeeModel.create).not.toHaveBeenCalled()
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

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(1)
    expect(response.body.failureCount).toBe(2)
    expect(response.body.errors).toHaveLength(2)
    expect(response.body.errors[0]).toMatch(/Email 重複/)
    expect(response.body.errors[1]).toMatch(/Email 已存在/)
    expect(mockEmployeeModel.create).toHaveBeenCalledTimes(1)
  })
})
