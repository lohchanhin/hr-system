import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { jest } from '@jest/globals'

const selectMock = jest.fn()
const mockEmployee = {
  findOne: jest.fn(),
  findById: jest.fn(() => ({ select: selectMock }))
}

const blacklistToken = jest.fn()
const isTokenBlacklisted = jest.fn().mockResolvedValue(false)

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  blacklistToken,
  isTokenBlacklisted
}))

let app
let authRoutes

beforeAll(async () => {
  process.env.JWT_SECRET = 'secret'
  authRoutes = (await import('../src/routes/authRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api', authRoutes)
})

afterEach(() => {
  mockEmployee.findById.mockReset()
  selectMock.mockReset()
  blacklistToken.mockReset()
})

function makeToken(role = 'employee') {
  return jwt.sign({ id: 'emp1', role }, 'secret', { expiresIn: '1h' })
}

describe('change password API', () => {
  it('updates password when old password matches and strength is valid', async () => {
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(true),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })

    const token = makeToken('employee')
    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'OldPass123', newPassword: 'NewPass123' })

    expect(res.status).toBe(200)
    expect(employeeDoc.setPassword).toHaveBeenCalledWith('NewPass123')
    expect(employeeDoc.save).toHaveBeenCalled()
    expect(blacklistToken).toHaveBeenCalledWith(token)
  })

  it('rejects request when old password is incorrect', async () => {
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(false),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })

    const token = makeToken('employee')
    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'WrongPass', newPassword: 'NewPass123' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('舊密碼不正確')
    expect(employeeDoc.setPassword).not.toHaveBeenCalled()
  })

  it('rejects weak passwords', async () => {
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(true),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })

    const token = makeToken('employee')
    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'OldPass123', newPassword: 'short' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('密碼長度需至少 8 碼')
    expect(employeeDoc.setPassword).not.toHaveBeenCalled()
  })
})
