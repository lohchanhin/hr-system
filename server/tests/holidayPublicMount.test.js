import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js'

// 真實 Express app（src/index.js）在載入時會檢查這幾個環境變數，必須在動態 import 之前設定
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

const mockEmployee = { findById: jest.fn() }
const mockHoliday = {
  find: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteMany: jest.fn(),
  exists: jest.fn(),
}
const mockHolidayMove = { find: jest.fn() }
// 行事曆提醒（/api/company-calendar/notices）：只回傳空清單
const emptyNoticeQuery = () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })
const mockCalendarNotice = { find: jest.fn(emptyNoticeQuery) }
let calendarYearMock
const mockIsTokenBlacklisted = jest.fn()

let app

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }))
  await jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMove }))
  await jest.unstable_mockModule('../src/models/CalendarNotice.js', () => ({ default: mockCalendarNotice }))
  // 新增假日會更新年度狀態（CalendarYear）；沒有替身的話 mongoose 會一直等資料庫連線
  ;({ CalendarYear: calendarYearMock } = await registerHolidayResolverModelMocks(jest))
  await jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
    isTokenBlacklisted: mockIsTokenBlacklisted,
    blacklistToken: jest.fn(),
  }))
  ;({ app } = await import('../src/index.js'))
})

beforeEach(() => {
  jest.resetAllMocks()
  global.fetch = jest.fn()
  mockIsTokenBlacklisted.mockResolvedValue(false)
  mockHolidayMove.find.mockResolvedValue([])
  mockHoliday.exists.mockResolvedValue(null)
  mockCalendarNotice.find.mockImplementation(emptyNoticeQuery)
})

function authHeader(role) {
  const id = '507f1f77bcf86c0000000001'
  mockEmployee.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: id, role, status: '在職', accountEnabled: true, authVersion: 0 }),
  })
  const token = jwt.sign({ id, role, ver: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'hr-system',
    audience: 'hr-system-api',
  })
  return `Bearer ${token}`
}

describe('/api/holidays-public mount', () => {
  it('requires authentication, reads included', async () => {
    const res = await request(app).get('/api/holidays-public/by-month?month=2026-06')

    expect(res.status).toBe(401)
  })

  it.each(['employee', 'supervisor'])('lets %s read the holiday calendar', async (role) => {
    mockHoliday.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([{
        _id: 'h1',
        name: '端午節',
        type: '國定假日',
        date: new Date('2026-06-19T00:00:00.000Z'),
      }]),
    })

    const res = await request(app)
      .get('/api/holidays-public/by-month?month=2026-06')
      .set('Authorization', authHeader(role))

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('端午節')
  })

  // 指定應放假日不適用的員工（沒有投票權）與人資備註只有管理員看得到
  it.each(['employee', 'supervisor'])('hides the designated-day exclusions and HR notes from %s', async (role) => {
    const row = {
      _id: 'd1',
      name: '地方公職人員選舉',
      kind: 'designated',
      date: new Date('2026-11-28T00:00:00.000Z'),
      excludedEmployees: ['507f1f77bcf86c0000000009'],
      note: '外籍員工無投票權',
      updatedBy: '507f1f77bcf86c0000000001',
    }
    mockHoliday.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([row]) })
    const header = authHeader(role)

    const list = await request(app).get('/api/holidays-public?year=2026&kind=designated&includeArchived=true').set('Authorization', header)
    const byMonth = await request(app).get('/api/holidays-public/by-month?month=2026-11').set('Authorization', header)

    for (const res of [list, byMonth]) {
      expect(res.status).toBe(200)
      expect(res.body[0]).toMatchObject({ name: '地方公職人員選舉', kind: 'designated' })
      expect(res.body[0]).not.toHaveProperty('excludedEmployees')
      expect(res.body[0]).not.toHaveProperty('note')
      expect(res.body[0]).not.toHaveProperty('updatedBy')
    }
    expect(mockHoliday.find.mock.calls[0][0]).toMatchObject({ archived: { $ne: true } })
  })

  it.each(['employee', 'supervisor'])('blocks %s from changing holidays through the public mount', async (role) => {
    const header = authHeader(role)
    const responses = [
      await request(app).post('/api/holidays-public').set('Authorization', header).send({ date: '2026-06-20', desc: '假' }),
      await request(app).put('/api/holidays-public/h1').set('Authorization', header).send({ date: '2026-06-20', desc: '假' }),
      await request(app).delete('/api/holidays-public/h1').set('Authorization', header),
      await request(app).post('/api/holidays-public/h1/restore').set('Authorization', header),
      await request(app).post('/api/holidays-public/import/roc?year=2026').set('Authorization', header),
      await request(app).post('/api/holidays-public/h1/confirm').set('Authorization', header),
    ]

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403])
    expect(mockHoliday.create).not.toHaveBeenCalled()
    expect(mockHoliday.findByIdAndUpdate).not.toHaveBeenCalled()
    expect(mockHoliday.findByIdAndDelete).not.toHaveBeenCalled()
    expect(mockHoliday.deleteMany).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('lets an administrator write through the public mount', async () => {
    mockHoliday.create.mockResolvedValue({ _id: 'h2' })

    const res = await request(app)
      .post('/api/holidays-public')
      .set('Authorization', authHeader('admin'))
      .send({ date: '2026-06-20', type: '國定假日', desc: '補假' })

    expect(res.status).toBe(201)
    expect(mockHoliday.create).toHaveBeenCalledTimes(1)
    // 「補假」不再是國定假日：存成公務機關補假（只對行政人員生效）
    expect(mockHoliday.create.mock.calls[0][0]).toMatchObject({ kind: 'gov_makeup_off', origin: 'manual' })
    // 第一次新增這個年度的資料：建立年度草稿
    expect(calendarYearMock.updateOne).toHaveBeenCalledWith(
      { year: 2026 },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ state: 'draft' }) }),
      { upsert: true },
    )
  })

  it('keeps the admin-only /api/holidays mount closed to employees, reads included', async () => {
    const res = await request(app)
      .get('/api/holidays/by-month?month=2026-06')
      .set('Authorization', authHeader('employee'))

    expect(res.status).toBe(403)
  })
})

describe('/api/company-calendar mount', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/company-calendar/notices')

    expect(res.status).toBe(401)
  })

  it.each(['employee', 'supervisor'])('is closed to %s', async (role) => {
    const header = authHeader(role)
    const responses = [
      await request(app).get('/api/company-calendar/years').set('Authorization', header),
      await request(app).post('/api/company-calendar/years/2026/approve').set('Authorization', header),
      await request(app).post('/api/company-calendar/check-updates').set('Authorization', header),
    ]

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('lets an administrator read the notices', async () => {
    const res = await request(app).get('/api/company-calendar/notices').set('Authorization', authHeader('admin'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ notices: [] })
  })
})
