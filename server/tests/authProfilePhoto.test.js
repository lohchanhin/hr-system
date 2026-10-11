import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { jest } from '@jest/globals'

// 登入回應與 /api/profile 要帶「員工 _id」與「照片路徑」：畫面用它們去載入自己的大頭照
// （前端 FrontLayout 的右上角頭像、之後每個顯示本人的地方）。

const mockEmployee = { findOne: jest.fn(), findById: jest.fn() }

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  blacklistToken: jest.fn(),
  isTokenBlacklisted: jest.fn(() => Promise.resolve(false)),
}))

const EMPLOYEE_ID = '507f1f77bcf86cd799439011'
const PHOTO = '/upload/employees/employee_3f2b8a3e-0d3a-4a64-9a39-5a0c3a8a1f10.png'

let app

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'
  const authRoutes = (await import('../src/routes/authRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api', authRoutes)
})

beforeEach(() => {
  mockEmployee.findOne.mockReset()
  mockEmployee.findById.mockReset()
})

function tokenFor(id = EMPLOYEE_ID, role = 'employee') {
  return jwt.sign(
    { id, sub: id, role, ver: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'hr-system', audience: 'hr-system-api' },
  )
}

/** authenticate 用 findById().select()，/profile 直接 await findById()：兩種寫法都要支援 */
function findByIdResult(doc) {
  const result = Promise.resolve(doc)
  result.select = jest.fn().mockResolvedValue(doc)
  return result
}

function makeEmployee(overrides = {}) {
  return {
    _id: EMPLOYEE_ID,
    role: 'employee',
    status: '正職員工',
    accountEnabled: true,
    authVersion: 0,
    username: 'jane',
    name: 'Jane',
    employeeId: 'E001',
    photo: PHOTO,
    populate: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('profile carries the data needed to show the signed-in employee photo', () => {
  it('returns the employee id and the stored photo path from /api/profile', async () => {
    const employee = makeEmployee()
    employee.populate.mockResolvedValue(employee)
    mockEmployee.findById.mockImplementation(() => findByIdResult(employee))

    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${tokenFor()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: EMPLOYEE_ID,
      employeeId: EMPLOYEE_ID,
      employeeNumber: 'E001',
      name: 'Jane',
      photo: PHOTO,
    })
  })

  it('returns an empty photo string for an employee without a photo', async () => {
    const employee = makeEmployee({ photo: undefined })
    employee.populate.mockResolvedValue(employee)
    mockEmployee.findById.mockImplementation(() => findByIdResult(employee))

    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${tokenFor()}`)

    expect(res.status).toBe(200)
    expect(res.body.photo).toBe('')
  })

  it('returns the employee id and photo path when signing in', async () => {
    mockEmployee.findOne.mockReturnValue({
      select: () => Promise.resolve(makeEmployee({ verifyPassword: () => true })),
    })

    const res = await request(app).post('/api/login').send({ username: 'jane', password: 'pass', role: 'employee' })

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ id: EMPLOYEE_ID, employeeId: EMPLOYEE_ID, photo: PHOTO })
  })

  it('does not hand out another employee profile', async () => {
    mockEmployee.findById.mockImplementation(() => findByIdResult(makeEmployee()))

    const res = await request(app)
      .get('/api/profile?employeeId=507f1f77bcf86cd799439012')
      .set('Authorization', `Bearer ${tokenFor()}`)

    expect(res.status).toBe(403)
  })
})
