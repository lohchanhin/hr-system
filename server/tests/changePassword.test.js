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
  return jwt.sign(
    { id: 'emp1', sub: 'emp1', role, ver: 0 },
    'secret',
    { expiresIn: '1h', issuer: 'hr-system', audience: 'hr-system-api' }
  )
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

  // 舊資料的其他欄位不符合現在的格式（例如性別存成中文）時，整份驗證會失敗：只驗證這次改到的欄位
  it('saves with validateModifiedOnly so employees with legacy field values can still change their password', async () => {
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(true),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })

    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${makeToken('employee')}`)
      .send({ oldPassword: 'OldPass123', newPassword: 'NewPass123' })

    expect(res.status).toBe(200)
    expect(employeeDoc.save).toHaveBeenCalledWith({ validateModifiedOnly: true })
  })

  // 以前存檔失敗（驗證錯誤、資料庫錯誤）會變成未處理的 rejection：請求沒有回應，整個服務直接結束
  it('answers 500 instead of leaving the request hanging when saving fails', async () => {
    const validationError = Object.assign(new Error('Employee validation failed: gender'), { name: 'ValidationError' })
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(true),
      setPassword: jest.fn(),
      save: jest.fn().mockRejectedValue(validationError),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${makeToken('employee')}`)
      .send({ oldPassword: 'OldPass123', newPassword: 'NewPass123' })
    consoleError.mockRestore()

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '變更密碼失敗，請稍後再試' })
    expect(blacklistToken).not.toHaveBeenCalled()
  })

  it('answers 500 when the employee lookup fails', async () => {
    const activeDoc = { role: 'employee' }
    selectMock
      .mockResolvedValueOnce(activeDoc) // authenticate
      .mockRejectedValueOnce(Object.assign(new Error('connection lost'), { name: 'MongoNetworkError' }))
    mockEmployee.findById.mockReturnValue({ select: selectMock })
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${makeToken('employee')}`)
      .send({ oldPassword: 'OldPass123', newPassword: 'NewPass123' })
    consoleError.mockRestore()

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '變更密碼失敗，請稍後再試' })
  })

  // 密碼存檔時登入版本已經加一（舊 token 全部失效），黑名單寫入失敗不該讓使用者以為密碼沒改成功
  it('still reports success when blacklisting the current token fails after the password was saved', async () => {
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(true),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })
    blacklistToken.mockRejectedValue(new Error('write failed'))
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${makeToken('employee')}`)
      .send({ oldPassword: 'OldPass123', newPassword: 'NewPass123' })
    consoleError.mockRestore()

    expect(res.status).toBe(200)
    expect(employeeDoc.save).toHaveBeenCalled()
  })

  it('rejects a new password that is the same as the old one', async () => {
    const employeeDoc = {
      verifyPassword: jest.fn().mockReturnValue(true),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })

    const res = await request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${makeToken('employee')}`)
      .send({ oldPassword: 'SamePass123', newPassword: 'SamePass123' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('新密碼不可與舊密碼相同')
    expect(employeeDoc.setPassword).not.toHaveBeenCalled()
    expect(employeeDoc.save).not.toHaveBeenCalled()
  })

  // 拿到別人沒登出的畫面或 token 的人，以前可以用這支 API 一直猜舊密碼（只受全站每分鐘 60 次寫入的上限）
  it('locks further attempts for that account after 10 wrong old passwords, without counting other failures or other accounts', async () => {
    const tokenOf = (id) => jwt.sign(
      { id, sub: id, role: 'employee', ver: 0 },
      'secret',
      { expiresIn: '1h', issuer: 'hr-system', audience: 'hr-system-api' }
    )
    const victimToken = tokenOf('emp-guessed')
    const otherToken = tokenOf('emp-other')
    const employeeDoc = {
      verifyPassword: jest.fn((plain) => plain === 'RightPass123'),
      setPassword: jest.fn(),
      save: jest.fn().mockResolvedValue(),
      role: 'employee'
    }
    selectMock.mockResolvedValue(employeeDoc)
    mockEmployee.findById.mockReturnValue({ select: selectMock })
    const attempt = (token, body) => request(app)
      .post('/api/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send(body)

    // 新密碼格式不符不算在猜密碼的次數裡
    for (let i = 0; i < 12; i += 1) {
      const weak = await attempt(victimToken, { oldPassword: 'RightPass123', newPassword: 'short' })
      expect(weak.status).toBe(400)
    }

    const statuses = []
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await attempt(victimToken, { oldPassword: `Guess${i}`, newPassword: 'NewPass123' })).status)
    }
    expect(statuses).toEqual(Array(10).fill(400))

    // 第 11 次起即使猜對也不放行
    const locked = await attempt(victimToken, { oldPassword: 'RightPass123', newPassword: 'NewPass123' })
    expect(locked.status).toBe(429)
    expect(locked.body.error).toBe('舊密碼錯誤次數過多，請稍後再試')
    expect(employeeDoc.setPassword).not.toHaveBeenCalled()

    // 另一個帳號不受影響
    const other = await attempt(otherToken, { oldPassword: 'RightPass123', newPassword: 'NewPass123' })
    expect(other.status).toBe(200)
  })
})
