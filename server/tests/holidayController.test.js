import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

const create = jest.fn()
const find = jest.fn()
const findByIdAndUpdate = jest.fn()
const findByIdAndDelete = jest.fn()
const findOneAndUpdate = jest.fn()
const deleteMany = jest.fn()
const findHolidayMoves = jest.fn()

jest.unstable_mockModule('../src/models/Holiday.js', () => ({
  default: {
    create,
    find,
    findByIdAndUpdate,
    findByIdAndDelete,
    findOneAndUpdate,
    deleteMany,
  },
}))
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({
  default: { find: findHolidayMoves },
}))

let holidayRoutes
let purgeLegacyRocWeekendHolidays

beforeAll(async () => {
  holidayRoutes = (await import('../src/routes/holidayRoutes.js')).default
  ;({ purgeLegacyRocWeekendHolidays } = await import('../src/controllers/holidayController.js'))
})

// 寫入路由只有管理員可用，所以測試要模擬已登入的使用者；role 為 null 表示沒有登入資訊
function buildApp(role = 'admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (role) req.user = { id: 'tester', role }
    next()
  })
  app.use('/api/holidays', holidayRoutes)
  app.use('/api/holidays-public', holidayRoutes)
  return app
}

beforeEach(() => {
  jest.resetAllMocks()
  global.fetch = jest.fn()
  findHolidayMoves.mockResolvedValue([])
  deleteMany.mockResolvedValue({ deletedCount: 0 })
})

describe('holidayController', () => {
  it('imports ROC holidays for current year and upserts them', async () => {
    const app = buildApp()

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
    const app = buildApp()

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
    const app = buildApp()
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

  it('stores only ROC entries that have a description and cleans up legacy weekend entries', async () => {
    const app = buildApp()
    // 遠端資料把每個週末都標成 isHoliday，只有真正的國定假日才有 description
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { date: '20250101', week: '三', isHoliday: true, description: '開國紀念日' },
        { date: '20250104', week: '六', isHoliday: true, description: '' },
        { date: '20250105', week: '日', isHoliday: true, description: '' },
        { date: '20250106', week: '一', isHoliday: false, description: '' },
        { date: '20250128', week: '二', isHoliday: true, description: '春節' },
      ],
    })
    findOneAndUpdate.mockImplementation(async (_filter, doc) => ({ _id: 'h', ...doc }))
    deleteMany.mockResolvedValue({ deletedCount: 2 })

    const res = await request(app).post('/api/holidays/import/roc?year=2025')

    expect(res.status).toBe(200)
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(findOneAndUpdate.mock.calls.map(([filter]) => filter.date.toISOString().slice(0, 10)))
      .toEqual(['2025-01-01', '2025-01-28'])
    expect(findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      name: '開國紀念日',
      description: '開國紀念日',
      source: 'roc-calendar',
    })
    // 只清掉舊版匯入（roc-calendar）留下、沒有名稱的週末，且只限該年度
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(deleteMany.mock.calls[0][0]).toMatchObject({
      source: 'roc-calendar',
      date: {
        $gte: new Date('2025-01-01T00:00:00.000Z'),
        $lt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })
    expect(res.body).toMatchObject({ success: true, year: 2025, imported: 2, removedWeekendEntries: 2 })
  })

  it('does not touch stored holidays when the remote calendar cannot be loaded', async () => {
    const app = buildApp()
    global.fetch.mockResolvedValue({ ok: false, status: 503 })

    const res = await request(app).post('/api/holidays/import/roc?year=2025')

    expect(res.status).toBe(500)
    expect(deleteMany).not.toHaveBeenCalled()
    expect(findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('rejects remote data that is not a list without deleting anything', async () => {
    const app = buildApp()
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'not found' }) })

    const res = await request(app).post('/api/holidays/import/roc?year=2025')

    expect(res.status).toBe(500)
    expect(deleteMany).not.toHaveBeenCalled()
  })
})

describe('purgeLegacyRocWeekendHolidays', () => {
  it('only targets nameless entries that the ROC import created, across all years when no year is given', async () => {
    deleteMany.mockResolvedValue({ deletedCount: 7 })

    const removed = await purgeLegacyRocWeekendHolidays()

    expect(removed).toBe(7)
    const [filter] = deleteMany.mock.calls[0]
    expect(filter.source).toBe('roc-calendar')
    expect(filter.date).toBeUndefined()
    expect(filter.$or).toEqual([
      { description: { $exists: false } },
      { description: null },
      { description: { $regex: expect.any(RegExp) } },
    ])
    // 空字串與只有空白都算沒有名稱；有名稱的不算
    const blank = filter.$or[2].description.$regex
    expect(blank.test('')).toBe(true)
    expect(blank.test('  ')).toBe(true)
    expect(blank.test('春節')).toBe(false)
  })

  it('limits the clean-up to one year when a year is given', async () => {
    deleteMany.mockResolvedValue({ deletedCount: 0 })

    await purgeLegacyRocWeekendHolidays({ year: 2026 })

    expect(deleteMany.mock.calls[0][0].date).toEqual({
      $gte: new Date('2026-01-01T00:00:00.000Z'),
      $lt: new Date('2027-01-01T00:00:00.000Z'),
    })
  })
})

describe('holiday write access', () => {
  it.each(['employee', 'supervisor'])('rejects %s on every write route, under both mounts', async (role) => {
    const app = buildApp(role)
    const responses = []
    for (const base of ['/api/holidays', '/api/holidays-public']) {
      responses.push(
        await request(app).post(base).send({ date: '2025-01-01', desc: '元旦' }),
        await request(app).put(`${base}/h1`).send({ date: '2025-01-01', desc: '元旦' }),
        await request(app).delete(`${base}/h1`),
        await request(app).post(`${base}/import/roc?year=2025`),
      )
    }

    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(403))
    expect(create).not.toHaveBeenCalled()
    expect(findByIdAndUpdate).not.toHaveBeenCalled()
    expect(findByIdAndDelete).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects write requests that carry no authenticated user', async () => {
    const app = buildApp(null)

    const res = await request(app).post('/api/holidays-public').send({ date: '2025-01-01', desc: '元旦' })

    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  it('lets an administrator create, update and delete holidays through the public mount too', async () => {
    const app = buildApp('admin')
    create.mockResolvedValue({ _id: 'h1' })
    findByIdAndUpdate.mockResolvedValue({ _id: 'h1', name: '元旦' })
    findByIdAndDelete.mockResolvedValue({ _id: 'h1' })

    const created = await request(app).post('/api/holidays-public').send({ date: '2025-01-01', desc: '元旦' })
    const updated = await request(app).put('/api/holidays-public/h1').send({ date: '2025-01-01', desc: '元旦' })
    const deleted = await request(app).delete('/api/holidays-public/h1')

    expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 200])
  })

  it.each(['employee', 'supervisor', 'admin'])('keeps by-month and list reads open to %s', async (role) => {
    const app = buildApp(role)
    find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([{
        _id: 'holiday-1',
        name: '開國紀念日',
        type: '國定假日',
        date: new Date('2025-01-01T00:00:00.000Z'),
      }]),
    })

    const byMonth = await request(app).get('/api/holidays-public/by-month?month=2025-01')
    const list = await request(app).get('/api/holidays-public')

    expect(byMonth.status).toBe(200)
    expect(byMonth.body).toHaveLength(1)
    expect(list.status).toBe(200)
  })
})
