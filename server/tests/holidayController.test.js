import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

const create = jest.fn()
const find = jest.fn()
const findByIdAndUpdate = jest.fn()
const findByIdAndDelete = jest.fn()
const findOneAndUpdate = jest.fn()
const findHolidayMoves = jest.fn()

jest.unstable_mockModule('../src/models/Holiday.js', () => ({
  default: {
    create,
    find,
    findByIdAndUpdate,
    findByIdAndDelete,
    findOneAndUpdate,
  },
}))
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({
  default: { find: findHolidayMoves },
}))

let holidayRoutes

beforeAll(async () => {
  holidayRoutes = (await import('../src/routes/holidayRoutes.js')).default
})

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn()
  findHolidayMoves.mockResolvedValue([])
})

describe('holidayController', () => {
  it('imports ROC holidays for current year and upserts them', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/holidays', holidayRoutes)

    const sample = [
      {
        date: '2025-01-01',
        name: '中華民國開國紀念日',
        isHoliday: 'Y',
        holidayCategory: '放假之紀念日及節日',
      },
    ]

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => sample,
    })
    findOneAndUpdate.mockResolvedValue({ _id: 'h1', date: new Date('2025-01-01') })

    const res = await request(app).post('/api/holidays/import/roc')

    expect(res.status).toBe(200)
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { date: new Date('2025-01-01') },
      expect.objectContaining({
        name: '中華民國開國紀念日',
        type: '放假之紀念日及節日',
      }),
      expect.objectContaining({ upsert: true }),
    )
    expect(res.body.imported).toBe(1)
  })

  it('fills default name when creating holiday without name', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/holidays', holidayRoutes)

    create.mockResolvedValue({
      _id: 'new-holiday',
      name: '元旦',
      date: '2025-01-01',
      desc: '元旦',
    })

    const res = await request(app).post('/api/holidays').send({
      date: '2025/01/01',
      type: '國定假日',
      desc: '元旦',
    })

    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '元旦',
        description: '元旦',
        type: '國定假日',
      }),
    )
    expect(res.body._id).toBe('new-holiday')
  })

  it('returns the effective target date for a same-month holiday move', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/holidays', holidayRoutes)
    find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([{
        _id: 'holiday-1',
        name: '國定假日',
        type: '國定假日',
        date: new Date('2036-04-07T00:00:00.000Z'),
      }]),
    })
    findHolidayMoves.mockResolvedValue([{
      _id: 'move-1',
      enableHolidayMove: true,
      sourceDate: new Date('2036-04-07T00:00:00.000Z'),
      targetDate: new Date('2036-04-20T00:00:00.000Z'),
    }])

    const res = await request(app).get('/api/holidays/by-month?month=2036-04')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      source: 'holiday-move',
      movedFrom: '2036-04-07',
      holidayMoveId: 'move-1',
    })
    expect(new Date(res.body[0].date).toISOString()).toBe('2036-04-20T00:00:00.000Z')
  })
})
