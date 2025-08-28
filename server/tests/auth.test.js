import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import Employee from '../src/models/Employee.js'

const mockBlacklistedToken = { create: jest.fn(), findOne: jest.fn() }

jest.unstable_mockModule('../src/models/BlacklistedToken.js', () => ({ default: mockBlacklistedToken }))

let app
let authRoutes
let isTokenBlacklisted
let findOneSpy
let fakeEmployee
let empId

beforeAll(async () => {
  process.env.JWT_SECRET = 'secret'
  authRoutes = (await import('../src/routes/authRoutes.js')).default
  ;({ isTokenBlacklisted } = await import('../src/utils/tokenBlacklist.js'))
  app = express()
  app.use(express.json())
  app.use('/api', authRoutes)
})

beforeEach(() => {
  fakeEmployee = new Employee({ role: 'employee', username: 'john' })
  fakeEmployee.password = 'pass'
  empId = fakeEmployee._id.toString()
  findOneSpy = jest.spyOn(Employee, 'findOne')
  mockBlacklistedToken.create.mockReset()
  mockBlacklistedToken.findOne.mockReset()
})

afterEach(() => {
  findOneSpy.mockRestore()
})

describe('Auth API', () => {
  it('logs in with valid credentials', async () => {
    findOneSpy.mockResolvedValue(fakeEmployee)
    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('tok')
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBe('tok')
    expect(res.body.user).toEqual({ id: empId, role: 'employee', username: 'john' })
    expect(signSpy).toHaveBeenCalledWith(
      { id: fakeEmployee._id, role: 'employee' },
      'secret',
      { expiresIn: '1h' }
    )
    signSpy.mockRestore();
  });

  it('fails with invalid credentials', async () => {
    findOneSpy.mockResolvedValue(fakeEmployee)
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('invalidates token on logout', async () => {
    mockBlacklistedToken.create.mockResolvedValue();
    mockBlacklistedToken.findOne.mockResolvedValue({ token: 'tok', expiresAt: new Date(Date.now() + 1000) });
    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    const result = await isTokenBlacklisted('tok')
    expect(result).toBe(true)
  })
});
