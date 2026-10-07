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

  it('rejects duplicate shift codes without saving', async () => {
    const setting = buildSetting({
      shifts: [{ _id: 'shift-1', name: '白班', code: 'D1', startTime: '08:00', endTime: '17:00' }],
    })
    findOne.mockResolvedValue(setting)

    const res = await request(app)
      .post('/api/shifts')
      .send({ name: '另一個班別', code: ' ｄ１ ', startTime: '09:00', endTime: '18:00' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SHIFT_IDENTIFIER_CONFLICT')
    expect(res.body.error).toContain('白班')
    expect(setting.save).not.toHaveBeenCalled()
    expect(setting.shifts).toHaveLength(1)
  })

  it('rejects duplicate shift names on update but ignores the edited shift itself', async () => {
    const editable = {
      _id: 'shift-1',
      name: '早班',
      code: 'D',
      startTime: '08:00',
      endTime: '17:00',
      toObject() { return { ...this } },
    }
    const existing = { _id: 'shift-2', name: '夜班', code: 'N', startTime: '16:00', endTime: '00:00' }
    const setting = buildSetting({ shifts: [editable, existing] })
    findOne.mockResolvedValue(setting)

    const res = await request(app).put('/api/shifts/shift-1').send({ name: ' 夜班 ' })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('班別名稱')
    expect(res.body.error).toContain('夜班')
    expect(setting.save).not.toHaveBeenCalled()
  })

  describe('semantic type of shifts without working time', () => {
    const post = (body) => request(app).post('/api/shifts').send(body)

    it('corrects an explicit work type on a 00:00-00:00 day-off shift to the inferred type', async () => {
      const cases = [
        ['休', '休假', 'rest_day'],
        ['例', '例假', 'regular_rest'],
        ['國', '國定假日', 'holiday'],
        ['病', '病假', 'leave'],
        ['公傷', '公傷假', 'leave'],
        ['婚', '婚假', 'leave'],
        ['生', '生理假', 'leave'],
        ['檢', '產檢假', 'leave'],
        ['陪', '陪產檢假', 'leave'],
        ['產', '分娩假', 'leave'],
        ['家', '家庭照顧假', 'leave'],
      ]
      for (const [code, name, expected] of cases) {
        const setting = buildSetting()
        findOne.mockResolvedValue(setting)
        const res = await post({ code, name, startTime: '00:00', endTime: '00:00', breakDuration: 0, semanticType: 'work' })
        expect(res.status).toBe(201)
        expect(setting.shifts[0].semanticType).toBe(expected)
      }
    })

    it('infers the type when none is sent and never stores work for a shift without working time', async () => {
      const setting = buildSetting()
      findOne.mockResolvedValue(setting)
      const res = await post({ code: '特殊', name: '特殊安排', startTime: '00:00', endTime: '00:00', semanticType: 'work' })

      expect(res.status).toBe(201)
      expect(setting.shifts[0].semanticType).toBe('leave')
      expect(res.body.semanticType).toBe('leave')
    })

    it('keeps an explicit valid non-work type', async () => {
      const setting = buildSetting()
      findOne.mockResolvedValue(setting)
      const res = await post({ code: 'X1', name: '特殊國定假', startTime: '00:00', endTime: '00:00', semanticType: 'holiday' })

      expect(res.status).toBe(201)
      expect(setting.shifts[0].semanticType).toBe('holiday')
    })

    it('keeps work for shifts that have working time, including cross-day and 24 hour shifts', async () => {
      const bodies = [
        { code: '日', name: '日班', startTime: '08:00', endTime: '17:00', breakDuration: 60, semanticType: 'work' },
        { code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', crossDay: true },
        { code: '休D', name: '休息日出勤日班', startTime: '08:00', endTime: '17:00' },
        { code: 'FULL', name: '24小時班', startTime: '00:00', endTime: '00:00', crossDay: true, semanticType: 'work' },
      ]
      for (const body of bodies) {
        const setting = buildSetting()
        findOne.mockResolvedValue(setting)
        const res = await post(body)
        expect(res.status).toBe(201)
        expect(setting.shifts[0].semanticType).toBe('work')
      }
    })

    it('corrects a stored work shift when an update leaves it without working time', async () => {
      const shift = {
        _id: 'shift-1',
        name: '特別假',
        code: 'SP',
        semanticType: 'work',
        startTime: '08:00',
        endTime: '17:00',
        toObject() { return { ...this } },
      }
      const setting = buildSetting({ shifts: [shift] })
      findOne.mockResolvedValue(setting)

      const res = await request(app).put('/api/shifts/shift-1').send({ startTime: '00:00', endTime: '00:00', breakDuration: 0 })

      expect(res.status).toBe(200)
      expect(setting.save).toHaveBeenCalledTimes(1)
      expect(shift.semanticType).toBe('leave')
    })

    it('lets an update switch a day-off shift to an explicit different non-work type', async () => {
      const shift = {
        _id: 'shift-1',
        name: '休假',
        code: '休',
        semanticType: 'rest_day',
        startTime: '00:00',
        endTime: '00:00',
        toObject() { return { ...this } },
      }
      const setting = buildSetting({ shifts: [shift] })
      findOne.mockResolvedValue(setting)

      const res = await request(app).put('/api/shifts/shift-1').send({ semanticType: 'leave' })

      expect(res.status).toBe(200)
      expect(shift.semanticType).toBe('leave')
    })
  })
})
