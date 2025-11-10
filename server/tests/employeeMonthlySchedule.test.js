import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const mockShiftSchedule = { find: jest.fn() }
const mockEmployee = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }

const authenticateMock = jest.fn((req, res, next) => next())
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: authenticateMock,
  authorizeRoles: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    return next()
  }
}))

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))

let app
let scheduleRoutes

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = { id: 'emp1', role: 'employee' }
    next()
  })
  app.use('/api/schedules', scheduleRoutes)
})

beforeEach(() => {
  mockShiftSchedule.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockAttendanceSetting.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue({ shifts: [] })
  })
  authenticateMock.mockReset()
})

describe('Employee monthly schedules', () => {
  it('defaults employee param to req.user.id when missing', async () => {
    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    })
    const res = await request(app).get('/api/schedules/monthly?month=2023-01')
    expect(res.status).toBe(200)
    expect(mockShiftSchedule.find).toHaveBeenCalled()
    expect(mockShiftSchedule.find.mock.calls[0][0].employee).toBe('emp1')
  })
})
