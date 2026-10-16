import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import request from 'supertest'

// 真實 Express app（src/index.js）在載入時會檢查這幾個環境變數，必須在動態 import 之前設定
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

const chain = (rows) => {
  const query = {
    select: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(async () => rows),
  }
  return query
}

const ACTOR = '507f1f77bcf86c0000000001'
const REPORT = '507f1f77bcf86c0000000002'
const mockEmployee = { findById: jest.fn(), find: jest.fn() }
const mockHoliday = { find: jest.fn() }
const mockHolidayMove = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockIsTokenBlacklisted = jest.fn()
const mockResolution = { find: jest.fn(), findOneAndUpdate: jest.fn(), findById: jest.fn(), deleteOne: jest.fn(), createIndexes: jest.fn() }

let app

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }))
  await jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMove }))
  await jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
  await jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
  await jest.unstable_mockModule('../src/models/HolidayRestResolution.js', () => ({
    default: mockResolution,
    HOLIDAY_RESOLUTION_KINDS: ['compensatory_leave', 'paid', 'rested_later', 'waived'],
  }))
  await jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
    loadApprovedLeaveCalendar: jest.fn(async () => new Map()),
    leaveDaysFromCalendar: jest.fn(() => new Set()),
    loadApprovedLeaveIntervals: jest.fn(async () => new Map()),
  }))
  await jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
    isTokenBlacklisted: mockIsTokenBlacklisted,
    blacklistToken: jest.fn(),
  }))
  ;({ app } = await import('../src/index.js'))
})

beforeEach(() => {
  jest.resetAllMocks()
  mockIsTokenBlacklisted.mockResolvedValue(false)
  mockHoliday.find.mockImplementation((query = {}) => chain(query.date instanceof Date
    ? [{ date: query.date, name: '中秋節', type: '國定假日' }]
    : [{ date: new Date('2026-09-25T00:00:00.000Z'), name: '中秋節', type: '國定假日' }]))
  mockHolidayMove.find.mockReturnValue(chain([]))
  mockShiftSchedule.find.mockReturnValue(chain([]))
  mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: [] }))
  mockResolution.find.mockReturnValue(chain([]))
  mockResolution.findOneAndUpdate.mockImplementation(async (filter, update) => ({
    _id: '507f1f77bcf86c0000000900', employee: filter.employee, holidayDate: filter.holidayDate, ...update.$set,
  }))
  // 登入者身分（auth 中介層用 findById().select()）與員工清單（排班權限範圍、國定假日休假紀錄用 find()）
  mockEmployee.find.mockImplementation((query = {}) => {
    const people = [
      { _id: ACTOR, employeeId: 'A001', name: '登入者', status: '正職員工' },
      { _id: REPORT, employeeId: 'A002', name: '部屬', status: '正職員工', supervisor: ACTOR },
    ]
    const rows = people.filter((person) => (
      (!query.supervisor || person.supervisor === query.supervisor)
      && (!query._id?.$in || query._id.$in.includes(person._id))
    ))
    return chain(rows)
  })
})

function authHeader(role, id = ACTOR) {
  mockEmployee.findById.mockImplementation((requested) => {
    if (requested === id) {
      return { select: jest.fn().mockResolvedValue({ _id: id, role, status: '正職員工', accountEnabled: true, authVersion: 0 }) }
    }
    // 登記處理方式時查「被處理的員工」存在與否
    return chain({ _id: requested })
  })
  const token = jwt.sign({ id, role, ver: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'hr-system',
    audience: 'hr-system-api',
  })
  return `Bearer ${token}`
}

const resolutionBody = { employee: REPORT, holidayDate: '2026-09-25', kind: 'paid' }

describe('/api/holiday-ledger mount', () => {
  it('requires authentication on every route', async () => {
    expect((await request(app).get('/api/holiday-ledger?month=2026-09')).status).toBe(401)
    expect((await request(app).get('/api/holiday-ledger/export?month=2026-09')).status).toBe(401)
    expect((await request(app).post('/api/holiday-ledger/resolutions').send(resolutionBody)).status).toBe(401)
    expect((await request(app).delete('/api/holiday-ledger/resolutions/507f1f77bcf86c0000000900')).status).toBe(401)
  })

  it('lets an employee read their own ledger but nothing else', async () => {
    const header = authHeader('employee')

    const read = await request(app).get('/api/holiday-ledger?month=2026-09').set('Authorization', header)
    expect(read.status).toBe(200)
    expect(read.body.months[0].employees.map((row) => row.employeeId)).toEqual([ACTOR])
    expect(read.body.months[0].employees[0].items[0]).toMatchObject({ holidayName: '中秋節', status: 'not_taken', reason: 'unscheduled' })

    expect((await request(app).get(`/api/holiday-ledger?month=2026-09&employee=${REPORT}`).set('Authorization', header)).status).toBe(403)
    expect((await request(app).get('/api/holiday-ledger/export?month=2026-09').set('Authorization', header)).status).toBe(403)
    expect((await request(app).post('/api/holiday-ledger/resolutions').set('Authorization', header).send(resolutionBody)).status).toBe(403)
    expect((await request(app).delete('/api/holiday-ledger/resolutions/507f1f77bcf86c0000000900').set('Authorization', header)).status).toBe(403)
    expect(mockResolution.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('lets a supervisor read direct reports, export and record how a missed holiday was settled', async () => {
    const header = authHeader('supervisor')

    const read = await request(app).get('/api/holiday-ledger?month=2026-09').set('Authorization', header)
    expect(read.status).toBe(200)
    expect(read.body.months[0].employees.map((row) => row.employeeId)).toEqual([REPORT])

    const exported = await request(app).get('/api/holiday-ledger/export?month=2026-09').set('Authorization', header)
    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toContain('spreadsheetml.sheet')

    const saved = await request(app).post('/api/holiday-ledger/resolutions').set('Authorization', header).send(resolutionBody)
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ employee: REPORT, holidayDate: '2026-09-25', kind: 'paid' })

    // 主管不能處理自己的
    const self = await request(app).post('/api/holiday-ledger/resolutions').set('Authorization', header).send({ ...resolutionBody, employee: ACTOR })
    expect(self.status).toBe(403)
  })

  it('lets an administrator do everything', async () => {
    const header = authHeader('admin')
    expect((await request(app).get('/api/holiday-ledger?month=2026-09').set('Authorization', header)).status).toBe(200)
    expect((await request(app).post('/api/holiday-ledger/resolutions').set('Authorization', header).send(resolutionBody)).status).toBe(200)
  })

  it('does not disturb the other holiday mounts', async () => {
    const header = authHeader('employee')
    // 管理員專用的假日管理仍然對員工關閉
    expect((await request(app).get('/api/holidays/by-month?month=2026-09').set('Authorization', header)).status).toBe(403)
  })
})

// start() 在測試環境不會執行；以原始碼確認啟動時會確保處理方式集合的索引，而且失敗不擋啟動
describe('startup index step for the holiday rest resolutions', () => {
  const indexSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js'),
    'utf8',
  ).replace(/\r\n/g, '\n')
  const begin = indexSource.indexOf('async function start()')
  const body = indexSource.slice(begin, indexSource.indexOf("if (process.env.NODE_ENV !== 'test')", begin))

  it('creates the indexes inside a try/catch that only logs the error name, after connecting and before the admin bootstrap', () => {
    const connect = body.indexOf('await connectDB(')
    const call = body.indexOf('await HolidayRestResolution.createIndexes()')
    const admin = body.indexOf('await ensureAdminUser()')
    expect(call).toBeGreaterThan(connect)
    expect(call).toBeLessThan(admin)
    const tryStart = body.lastIndexOf('try {', call)
    expect(body.slice(tryStart, call)).not.toContain('}')
    const catchStart = body.indexOf('} catch (indexError) {', call)
    expect(catchStart).toBeGreaterThan(call)
    const handler = body.slice(catchStart, body.indexOf('\n    }\n', catchStart))
    expect(handler).toContain("console.error('Failed to ensure holiday rest resolution indexes', indexError?.name ?? 'Error')")
    expect(handler).not.toMatch(/process\.exit|throw /)
  })

  it('imports the model and mounts the router once', () => {
    expect(indexSource).toContain("import HolidayRestResolution from './models/HolidayRestResolution.js';")
    expect(indexSource).toContain("import holidayLedgerRoutes from './routes/holidayLedgerRoutes.js';")
    expect(indexSource.match(/'\/api\/holiday-ledger'/g)).toHaveLength(1)
  })
})
