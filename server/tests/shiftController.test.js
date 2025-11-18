import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const findOne = jest.fn()
const create = jest.fn()

jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({
  default: {
    findOne,
    create,
  },
}))

let app
let shiftRoutes

function buildSetting(overrides = {}) {
  const shifts = overrides.shifts || []
  shifts.id = (id) => shifts.find((item) => String(item._id) === String(id))
  return {
    _id: 'setting-1',
    shifts,
    save: jest.fn().mockResolvedValue(null),
    ...overrides,
  }
}

beforeAll(async () => {
  shiftRoutes = (await import('../src/routes/shiftRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/shifts', (req, _res, next) => {
    req.user = { role: 'admin' }
    next()
  })
  app.use('/api/shifts', shiftRoutes)
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('shiftController', () => {
  it('creates shift with validated break info', async () => {
    const setting = buildSetting()
    findOne.mockResolvedValue(setting)

    const res = await request(app)
      .post('/api/shifts')
      .send({
        name: '白班',
        code: 'D1',
        startTime: '09:00',
        endTime: '18:00',
        breakDuration: 45,
        breakWindows: [{ start: '12:30', end: '13:15', label: '午休' }],
      })

    expect(res.status).toBe(201)
    expect(setting.save).toHaveBeenCalledTimes(1)
    expect(setting.shifts[0]).toEqual(
      expect.objectContaining({
        name: '白班',
        code: 'D1',
        breakDuration: 45,
      })
    )
    expect(setting.shifts[0].breakWindows).toEqual(
      expect.arrayContaining([expect.objectContaining({ start: '12:30', end: '13:15' })])
    )
  })

  it('rejects invalid time fields on update', async () => {
    const shift = {
      _id: 'shift-1',
      name: '原班別',
      code: 'A1',
      startTime: '08:00',
      endTime: '17:00',
      toObject() {
        return { ...this }
      },
    }
    const setting = buildSetting({ shifts: [shift] })
    findOne.mockResolvedValue(setting)

    const res = await request(app).put('/api/shifts/shift-1').send({ startTime: '99:00' })

    expect(res.status).toBe(400)
    expect(setting.save).not.toHaveBeenCalled()
    expect(res.body.error).toContain('格式不正確')
  })
})
