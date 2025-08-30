import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

// 先取得真正的 Employee 模型供密碼驗證使用
const { default: RealEmployee } = await import('../src/models/Employee.js')

// 模擬資料庫查詢，login 路由中將會呼叫 findOne().select('+passwordHash')
const selectMock = jest.fn()
const mockEmployee = {
  findOne: jest.fn(() => ({ select: selectMock }))
}

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))

let app
let authRoutes

beforeAll(async () => {
  process.env.JWT_SECRET = 'secret'
  authRoutes = (await import('../src/routes/authRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api', authRoutes)
})

beforeEach(() => {
  selectMock.mockReset()
  mockEmployee.findOne.mockReset()
})

describe('Auth Integration', () => {
  it('建立員工並成功登入', async () => {
    // 建立包含密碼的員工物件
    const employee = new RealEmployee({ name: 'Tester', username: 'tester', password: 'pass123', role: 'employee' })
    // 設定查詢回傳
    selectMock.mockResolvedValue(employee)
    mockEmployee.findOne.mockReturnValue({ select: selectMock })

    const res = await request(app).post('/api/login').send({ username: 'tester', password: 'pass123' })

    expect(mockEmployee.findOne).toHaveBeenCalledWith({ username: 'tester' })
    expect(selectMock).toHaveBeenCalledWith('+passwordHash')
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ username: 'tester' })
    expect(res.body.user.employeeId).toBe(String(employee._id))
    expect(res.body.token).toBeDefined()
  })
})
