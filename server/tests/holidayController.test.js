import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

const create = jest.fn()
const find = jest.fn()
const findByIdAndUpdate = jest.fn()
const findByIdAndDelete = jest.fn()
const findOneAndUpdate = jest.fn()

jest.unstable_mockModule('../src/models/Holiday.js', () => ({
  default: {
    create,
    find,
    findByIdAndUpdate,
    findByIdAndDelete,
    findOneAndUpdate,
  },
}))

let holidayRoutes

beforeAll(async () => {
  holidayRoutes = (await import('../src/routes/holidayRoutes.js')).default
})

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn()
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
})
