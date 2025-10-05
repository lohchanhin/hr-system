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

async function createWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('員工資料')
  worksheet.addRow(['員工編號', '姓名', 'Email', '系統權限'])
  rows.forEach(data => worksheet.addRow(data))
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
      ['E0001', '王小明', 'user1@example.com', 'employee'],
      ['E0002', '陳美麗', 'user2@example.com', 'supervisor']
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
      .field('mappings', JSON.stringify({
        employeeNo: '員工編號',
        name: '姓名',
        email: 'Email',
        role: '系統權限'
      }))
      .field('options', JSON.stringify({ defaultRole: 'employee', resetPassword: 'Temp1234!' }))

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
      role: 'employee',
      password: 'Temp1234!'
    })
  })

  it('欄位缺漏時回傳錯誤並不建立資料', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      ['E0003', '', 'user3@example.com', 'employee']
    ])

    mockEmployeeModel.find.mockResolvedValue([])

    const response = await request(application)
      .post('/api/employees/bulk-import')
      .attach('file', buffer, { filename: 'import.xlsx' })
      .field('mappings', JSON.stringify({
        employeeNo: '員工編號',
        name: '姓名',
        email: 'Email',
        role: '系統權限'
      }))

    expect(response.status).toBe(400)
    expect(response.body.successCount).toBe(0)
    expect(response.body.failureCount).toBe(1)
    expect(response.body.errors[0]).toMatch(/缺少姓名/)
    expect(mockEmployeeModel.create).not.toHaveBeenCalled()
  })

  it('偵測檔案內重複 Email 與既有 Email', async () => {
    const application = await setupApp()
    const buffer = await createWorkbookBuffer([
      ['E0004', '張一', 'dup@example.com', 'employee'],
      ['E0005', '張二', 'dup@example.com', 'employee'],
      ['E0006', '張三', 'taken@example.com', 'employee']
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
      .field('mappings', JSON.stringify({
        employeeNo: '員工編號',
        name: '姓名',
        email: 'Email',
        role: '系統權限'
      }))

    expect(response.status).toBe(200)
    expect(response.body.successCount).toBe(1)
    expect(response.body.failureCount).toBe(2)
    expect(response.body.errors).toHaveLength(2)
    expect(response.body.errors[0]).toMatch(/Email 重複/)
    expect(response.body.errors[1]).toMatch(/Email 已存在/)
    expect(mockEmployeeModel.create).toHaveBeenCalledTimes(1)
  })
})
