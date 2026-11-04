// 線上打卡也要看明天的班表（A2）：00:00 開始的大夜班，前一晚 23:00 起就在簽到時段內（簽到緩衝提早 60 分鐘）。
// 原本只讀今天與昨天的班表，23:50 簽到會回 400「今日未設定班表，請洽管理員」，或被算到今天別的班。
// 時間都是真實的 UTC：台灣 2024-01-01 23:50 = 2024-01-01T15:50:00Z。
import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const saveMock = jest.fn()
const mockAttendanceRecord = jest.fn().mockImplementation((data = {}) => ({ ...data, save: saveMock }))
mockAttendanceRecord.find = jest.fn()
mockAttendanceRecord.exists = jest.fn()
const mockEmployee = { findById: jest.fn(), find: jest.fn() }
const mockAttendanceManagementSetting = { findOne: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/AttendanceManagementSetting.js', () => ({ default: mockAttendanceManagementSetting }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))

const { calculateWorkHours } = await import('../src/services/workHoursCalculationService.js')

const TODAY = new Date(Date.UTC(2024, 0, 1))
const TOMORROW = new Date(Date.UTC(2024, 0, 2))
const YESTERDAY = new Date(Date.UTC(2023, 11, 31))
const SHIFTS = [
  { _id: 'bigNight', code: '大', name: '大夜', semanticType: 'work', startTime: '00:00', endTime: '08:00', breakDuration: 0 },
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
  { _id: 'evening', code: '小', name: '小夜', semanticType: 'work', startTime: '16:00', endTime: '00:00', crossDay: true, breakDuration: 0 },
  { _id: 'night12', code: '夜', name: '夜班', semanticType: 'work', startTime: '20:00', endTime: '08:00', crossDay: true, breakDuration: 60 },
  { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: 'regular', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
]
const scheduleOn = (date, shiftId) => ({ _id: `sched-${shiftId}-${date.toISOString().slice(0, 10)}`, employee: 'emp1', date, shiftId })

let app
let currentUser

beforeAll(async () => {
  const attendanceRoutes = (await import('../src/routes/attendanceRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    if (currentUser) req.user = currentUser
    next()
  })
  app.use('/api/attendance', attendanceRoutes)
})

beforeEach(() => {
  mockAttendanceRecord.mockClear()
  saveMock.mockReset()
  saveMock.mockResolvedValue()
  mockAttendanceRecord.exists.mockReset()
  mockAttendanceRecord.exists.mockResolvedValue(false)
  mockShiftSchedule.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  currentUser = { id: 'emp1', role: 'employee' }
})

afterEach(() => {
  jest.restoreAllMocks()
})

// 模擬資料庫依日期查班表：只回傳查詢日期內的班表
function setupSchedules(schedules) {
  mockShiftSchedule.find.mockImplementation((query) => {
    const dates = (query?.date?.$in ?? []).map((date) => new Date(date).getTime())
    return { lean: jest.fn().mockResolvedValue(schedules.filter((item) => dates.includes(item.date.getTime()))) }
  })
  mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: SHIFTS }) })
}

const at = (iso) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso))
const post = (action) => request(app).post('/api/attendance').send({ action, employee: 'emp1' })
const savedPunch = () => mockAttendanceRecord.mock.calls.at(-1)[0]

describe('線上打卡：明天 00:00 的大夜班前一晚就能簽到', () => {
  it('今天沒有班、明天大夜：23:50 簽到成功，記在明天的大夜班；查班表時包含明天', async () => {
    at('2024-01-01T15:50:00.000Z')
    setupSchedules([scheduleOn(TOMORROW, 'bigNight')])

    const res = await post('clockIn')

    expect(res.status).toBe(201)
    expect(savedPunch()).toEqual(expect.objectContaining({
      action: 'clockIn',
      punchKey: 'emp1:sched-bigNight-2024-01-02:clockIn',
      source: 'online',
    }))
    expect(savedPunch().timestamp.toISOString()).toBe('2024-01-01T15:50:00.000Z')
    expect(mockShiftSchedule.find.mock.calls[0][0].date.$in.map((date) => date.toISOString())).toEqual([
      '2024-01-01T00:00:00.000Z', '2023-12-31T00:00:00.000Z', '2024-01-02T00:00:00.000Z',
    ])
  })

  it('今天上日班、明天大夜：23:50 簽到算明天的大夜班（不是今天已經下班的日班）', async () => {
    at('2024-01-01T15:50:00.000Z')
    setupSchedules([scheduleOn(TODAY, 'day'), scheduleOn(TOMORROW, 'bigNight')])

    const res = await post('clockIn')

    expect(res.status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-bigNight-2024-01-02:clockIn')
  })

  it('今天排休、明天大夜：23:50 簽到成功；同一時間的簽退仍以今天休假回覆', async () => {
    at('2024-01-01T15:50:00.000Z')
    setupSchedules([scheduleOn(TODAY, 'rest'), scheduleOn(TOMORROW, 'bigNight')])

    const clockIn = await post('clockIn')
    expect(clockIn.status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-bigNight-2024-01-02:clockIn')

    const clockOut = await post('clockOut')
    expect(clockOut.status).toBe(400)
    expect(clockOut.body).toEqual({ error: '今日為休息日，不需打卡', rule: 'non-work-day-attendance' })
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('今天上小夜（16:00-00:00）、明天大夜：23:50 簽退算小夜、23:55 簽到算大夜', async () => {
    setupSchedules([scheduleOn(TODAY, 'evening'), scheduleOn(TOMORROW, 'bigNight')])
    // 簽退前要有這一班的簽到
    mockAttendanceRecord.exists.mockImplementation(async (query) => Boolean(query?.$or?.[0]?.punchKey?.endsWith(':clockIn')))

    at('2024-01-01T15:50:00.000Z')
    const clockOut = await post('clockOut')
    expect(clockOut.status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-evening-2024-01-01:clockOut')

    mockAttendanceRecord.exists.mockResolvedValue(false)
    at('2024-01-01T15:55:00.000Z')
    const clockIn = await post('clockIn')
    expect(clockIn.status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-bigNight-2024-01-02:clockIn')
  })

  it('明天大夜但還沒到簽到時段（22:30）：照原本回覆今天沒有班表', async () => {
    at('2024-01-01T14:30:00.000Z')
    setupSchedules([scheduleOn(TOMORROW, 'bigNight')])

    const res = await post('clockIn')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('今日未設定班表，請洽管理員')
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('今天上日班、明天大夜：白天的簽到簽退照舊記在今天的日班', async () => {
    setupSchedules([scheduleOn(TODAY, 'day'), scheduleOn(TOMORROW, 'bigNight')])

    at('2024-01-01T00:05:00.000Z')
    expect((await post('clockIn')).status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-day-2024-01-01:clockIn')

    // 簽退前要有這一班的簽到
    mockAttendanceRecord.exists.mockImplementation(async (query) => Boolean(query?.$or?.[0]?.punchKey?.endsWith(':clockIn')))
    at('2024-01-01T09:02:00.000Z')
    expect((await post('clockOut')).status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-day-2024-01-01:clockOut')
  })

  it('今天上日班、明天大夜：日班的簽到時段結束後（20:00）簽到，照舊回覆日班的時段已結束', async () => {
    at('2024-01-01T12:00:00.000Z')
    setupSchedules([scheduleOn(TODAY, 'day'), scheduleOn(TOMORROW, 'bigNight')])

    const res = await post('clockIn')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('時段已結束')
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('昨天夜班（20:00-08:00）接今天日班：07:55 簽到算今天的日班、08:05 簽退算昨天的夜班', async () => {
    setupSchedules([scheduleOn(YESTERDAY, 'night12'), scheduleOn(TODAY, 'day')])

    at('2023-12-31T23:55:00.000Z')
    expect((await post('clockIn')).status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-day-2024-01-01:clockIn')

    mockAttendanceRecord.exists.mockImplementation(async (query) => Boolean(query?.$or?.[0]?.punchKey?.endsWith(':clockIn')))
    at('2024-01-01T00:05:00.000Z')
    expect((await post('clockOut')).status).toBe(201)
    expect(savedPunch().punchKey).toBe('emp1:sched-night12-2023-12-31:clockOut')
  })

  it('23:50 的線上簽到在工時計算裡算給明天的大夜班', async () => {
    const schedules = [scheduleOn(TODAY, 'day'), scheduleOn(TOMORROW, 'bigNight')]
    const result = await calculateWorkHours('emp1', '2024-01-01', {
      employee: { _id: 'emp1' },
      attendanceSetting: { shifts: SHIFTS },
      schedules,
      attendanceRecords: [
        { employee: 'emp1', action: 'clockIn', timestamp: new Date('2024-01-01T15:50:00.000Z'), source: 'online' },
        { employee: 'emp1', action: 'clockOut', timestamp: new Date('2024-01-02T00:03:00.000Z'), source: 'online' },
      ],
    })

    expect(result.workDays).toBe(1)
    expect(result.dailyDetails.map((item) => [item.date, item.hasAttendance, item.workedHours])).toEqual([
      ['2024-01-01', false, 0],
      ['2024-01-02', true, 8.22],
    ])
  })
})
