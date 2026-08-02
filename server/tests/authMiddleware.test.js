import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { jest } from '@jest/globals'

const selectMock = jest.fn()
const findByIdMock = jest.fn(() => ({ select: selectMock }))
const isTokenBlacklisted = jest.fn().mockResolvedValue(false)

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: { findById: findByIdMock },
}))
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  isTokenBlacklisted,
}))

process.env.JWT_SECRET = 'secret'
const { authenticate } = await import('../src/middleware/auth.js')

const app = express()
app.get('/protected', authenticate, (req, res) => res.json({ user: req.user }))

function makeToken(overrides = {}) {
  return jwt.sign(
    { id: 'employee-1', sub: 'employee-1', role: 'employee', ver: 2, ...overrides },
    'secret',
    { expiresIn: '1h', issuer: 'hr-system', audience: 'hr-system-api' }
  )
}

beforeEach(() => {
  findByIdMock.mockReset()
  selectMock.mockReset()
  isTokenBlacklisted.mockReset().mockResolvedValue(false)
  findByIdMock.mockReturnValue({ select: selectMock })
  selectMock.mockResolvedValue({
    role: 'employee',
    status: '正職員工',
    accountEnabled: true,
    authVersion: 2,
  })
})

test('accepts a token only when the current account state matches', async () => {
  const response = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${makeToken()}`)

  expect(response.status).toBe(200)
  expect(response.body.user).toMatchObject({
    id: 'employee-1',
    role: 'employee',
    ver: 2,
  })
  expect(selectMock).toHaveBeenCalledWith('role status accountEnabled authVersion')
})

test.each([
  ['changed role', { role: 'supervisor', status: '正職員工', accountEnabled: true, authVersion: 2 }],
  ['changed session version', { role: 'employee', status: '正職員工', accountEnabled: true, authVersion: 3 }],
  ['disabled account', { role: 'employee', status: '正職員工', accountEnabled: false, authVersion: 2 }],
  ['terminated employee', { role: 'employee', status: '離職員工', accountEnabled: true, authVersion: 2 }],
])('rejects a token for a %s', async (_label, employee) => {
  selectMock.mockResolvedValue(employee)

  const response = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${makeToken()}`)

  expect(response.status).toBe(401)
})
