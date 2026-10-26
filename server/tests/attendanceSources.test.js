// 線上打卡與指紋（考勤機）匯入的打卡互補、不互相覆蓋：
// 不分來源放在一起比對，每一班簽到取最早、簽退取最晚（工時、遲到早退、報表都一樣）。
// 時間都是真實的 UTC：台灣 08:00 = 00:00Z，台灣 07:55 = 前一天 23:55Z。
import { describe, it, expect } from '@jest/globals'
import {
  ATTENDANCE_SOURCE_LABELS,
  findPunchSource,
  formatLocalTime,
  groupPunchesByEmployee,
  matchShiftPunches,
  punchMinuteKey,
  resolveAttendanceSource,
} from '../src/services/attendancePunchService.js'
import { calculateWorkHours } from '../src/services/workHoursCalculationService.js'
import { calculateLateEarlyCount } from '../src/services/attendanceDeductionService.js'
import { __testUtils as reportUtils } from '../src/services/reportMetricsService.js'

const DAY = { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 }
const NIGHT = { _id: 'night', code: '大', name: '大夜班', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true, breakDuration: 60 }
const SETTING = {
  shifts: [DAY, NIGHT],
  abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
  actionBuffers: {
    clockIn: { earlyMinutes: 60, lateMinutes: 240 },
    clockOut: { earlyMinutes: 240, lateMinutes: 120 },
  },
}
const EMPLOYEE = 'emp1'
const SCHEDULE = { _id: 'sched-1021', employee: EMPLOYEE, date: new Date('2026-10-21T00:00:00.000Z'), shiftId: 'day' }

const punch = (action, iso, source, extra = {}) => ({ employee: EMPLOYEE, action, timestamp: new Date(iso), ...(source ? { source } : {}), ...extra })
// 台灣 2026-10-21 的打卡
const onlineIn0810 = punch('clockIn', '2026-10-21T00:10:00.000Z', 'online', { punchKey: `${EMPLOYEE}:sched-1021:clockIn` })
const fingerIn0755 = punch('clockIn', '2026-10-20T23:55:00.000Z', 'import')
const fingerOut1705 = punch('clockOut', '2026-10-21T09:05:00.000Z', 'import')
const onlineOut1700 = punch('clockOut', '2026-10-21T09:00:00.000Z', 'online', { punchKey: `${EMPLOYEE}:sched-1021:clockOut` })
const onlineOut1720 = punch('clockOut', '2026-10-21T09:20:00.000Z', 'online', { punchKey: `${EMPLOYEE}:sched-1021:clockOut` })

function workHoursOf(records, schedules = [SCHEDULE]) {
  return calculateWorkHours(EMPLOYEE, '2026-10-01', {
    employee: { _id: EMPLOYEE },
    attendanceSetting: SETTING,
    schedules,
    attendanceRecords: records,
  })
}

function lateEarlyOf(records, schedules = [SCHEDULE]) {
  return calculateLateEarlyCount(EMPLOYEE, '2026-10', {
    attendanceSetting: SETTING,
    schedules,
    attendanceRecords: records,
  })
}

describe('打卡來源與比對工具', () => {
  it('沒有來源欄位的舊資料視為 legacy，只接受已知的來源', () => {
    expect(resolveAttendanceSource({ source: 'online' })).toBe('online')
    expect(resolveAttendanceSource({ source: 'import' })).toBe('import')
    expect(resolveAttendanceSource({ source: 'manual' })).toBe('manual')
    expect(resolveAttendanceSource({})).toBe('legacy')
    expect(resolveAttendanceSource({ source: 'something-else' })).toBe('legacy')
    expect(ATTENDANCE_SOURCE_LABELS).toMatchObject({ online: '線上', import: '指紋匯入' })
  })

  it('同一位員工、同一個動作、同一分鐘視為同一筆打卡（不論秒數與來源）', () => {
    const a = punchMinuteKey('emp1', 'clockIn', '2026-10-21T00:10:05.000Z')
    expect(a).toBe(punchMinuteKey({ _id: 'emp1' }, 'clockIn', new Date('2026-10-21T00:10:59.999Z')))
    expect(a).not.toBe(punchMinuteKey('emp1', 'clockIn', '2026-10-21T00:11:00.000Z'))
    expect(a).not.toBe(punchMinuteKey('emp1', 'clockOut', '2026-10-21T00:10:05.000Z'))
    expect(a).not.toBe(punchMinuteKey('emp2', 'clockIn', '2026-10-21T00:10:05.000Z'))
    expect(punchMinuteKey('emp1', 'clockIn', 'not-a-date')).toBe('')
  })

  it('一班的簽到取時段內最早、簽退取時段內最晚，線上與指紋一起看', () => {
    const result = matchShiftPunches({
      records: [onlineIn0810, fingerIn0755, onlineOut1700, fingerOut1705],
      scheduleDate: SCHEDULE.date,
      shift: DAY,
      actionBuffers: SETTING.actionBuffers,
    })
    expect(result.span.start.toISOString()).toBe('2026-10-21T00:00:00.000Z')
    expect(result.span.end.toISOString()).toBe('2026-10-21T09:00:00.000Z')
    expect(result.clockIn).toBe(fingerIn0755)
    expect(result.clockOut).toBe(fingerOut1705)
  })

  it('時段外的打卡（別天、別班）不算這一班的', () => {
    const otherDay = punch('clockIn', '2026-10-22T00:00:00.000Z', 'import')
    const tooEarlyOut = punch('clockOut', '2026-10-21T04:00:00.000Z', 'import') // 台灣 12:00，比簽退時段早
    const result = matchShiftPunches({
      records: [otherDay, tooEarlyOut, onlineIn0810],
      scheduleDate: SCHEDULE.date,
      shift: DAY,
      actionBuffers: SETTING.actionBuffers,
    })
    expect(result.clockIn).toBe(onlineIn0810)
    expect(result.clockOut).toBeNull()
  })

  it('依員工分組、只留上下班打卡並依時間排序；可查出某一筆打卡的來源；以台灣時間顯示時分', () => {
    const outing = punch('outing', '2026-10-21T03:00:00.000Z', 'online')
    const grouped = groupPunchesByEmployee([onlineIn0810, outing, fingerIn0755, { ...fingerOut1705, employee: { _id: 'emp2' } }])
    expect(grouped.get('emp1')).toEqual([fingerIn0755, onlineIn0810])
    expect(grouped.get('emp2')).toHaveLength(1)
    expect(findPunchSource([onlineIn0810, fingerIn0755], 'clockIn', '2026-10-20T23:55:00.000Z')).toBe('import')
    expect(findPunchSource([{ ...fingerIn0755, source: undefined }], 'clockIn', fingerIn0755.timestamp)).toBe('legacy')
    expect(findPunchSource([fingerIn0755], 'clockOut', fingerIn0755.timestamp)).toBeNull()
    expect(formatLocalTime(fingerIn0755.timestamp)).toBe('07:55')
    expect(formatLocalTime('2026-10-21T16:00:00.000Z')).toBe('00:00')
  })
})

describe('工時：線上打卡與指紋匯入互補', () => {
  it('線上簽到 08:10 之後匯入指紋 07:55 簽到、17:05 簽退：工時以 07:55-17:05 計算，兩筆簽到都保留', async () => {
    const result = await workHoursOf([onlineIn0810, fingerIn0755, fingerOut1705])

    expect(result.workDays).toBe(1)
    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      date: '2026-10-21',
      hasAttendance: true,
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:05:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'import',
      // 07:55-17:05 = 550 分鐘，扣休息 60 分鐘
      workedHours: 8.17,
    }))
  })

  it('線上簽到配指紋簽退', async () => {
    const result = await workHoursOf([onlineIn0810, fingerOut1705])

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      clockInTime: '2026-10-21T00:10:00.000Z',
      clockOutTime: '2026-10-21T09:05:00.000Z',
      clockInSource: 'online',
      clockOutSource: 'import',
      workedHours: 7.92,
    }))
  })

  it('指紋簽到配線上簽退；線上簽退比指紋晚時取線上的', async () => {
    const result = await workHoursOf([fingerIn0755, fingerOut1705, onlineOut1720])

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:20:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'online',
    }))
  })

  it('兩邊都打了卡時簽到取最早、簽退取最晚（不是第一筆簽退）', async () => {
    const result = await workHoursOf([onlineIn0810, onlineOut1700, fingerIn0755, fingerOut1705])

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      clockInTime: '2026-10-20T23:55:00.000Z',
      clockOutTime: '2026-10-21T09:05:00.000Z',
    }))
  })

  it('沒有來源的舊資料照樣算，與新資料一起比對', async () => {
    const legacyIn = punch('clockIn', '2026-10-20T23:58:00.000Z')
    const result = await workHoursOf([legacyIn, onlineIn0810, fingerOut1705])

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      clockInTime: '2026-10-20T23:58:00.000Z',
      clockInSource: 'legacy',
      clockOutSource: 'import',
    }))
  })

  it('跨日大夜班：指紋簽到（前一天晚上）配隔天早上的線上簽退', async () => {
    const schedule = { _id: 'sched-night', employee: EMPLOYEE, date: new Date('2026-10-21T00:00:00.000Z'), shiftId: 'night' }
    const fingerIn2150 = punch('clockIn', '2026-10-21T13:50:00.000Z', 'import') // 台灣 10/21 21:50
    const onlineOut0605 = punch('clockOut', '2026-10-21T22:05:00.000Z', 'online') // 台灣 10/22 06:05
    const result = await workHoursOf([fingerIn2150, onlineOut0605], [schedule])

    expect(result.dailyDetails[0]).toEqual(expect.objectContaining({
      hasAttendance: true,
      clockInTime: '2026-10-21T13:50:00.000Z',
      clockOutTime: '2026-10-21T22:05:00.000Z',
      clockInSource: 'import',
      clockOutSource: 'online',
      // 8 小時 15 分鐘扣休息 60 分鐘
      workedHours: 7.25,
    }))
  })
})

describe('遲到早退（薪資扣款）：線上打卡的 punchKey 不會蓋掉匯入的打卡', () => {
  it('只有線上簽到 08:10 時遲到 10 分鐘；再匯入 07:55 的指紋簽到後不算遲到', async () => {
    const onlineOnly = await lateEarlyOf([onlineIn0810, onlineOut1700])
    expect(onlineOnly.lateDetails.map((item) => item.minutesLate)).toEqual([10])

    const withFingerprint = await lateEarlyOf([onlineIn0810, onlineOut1700, fingerIn0755, fingerOut1705])
    expect(withFingerprint.lateCount).toBe(0)
    expect(withFingerprint.earlyLeaveCount).toBe(0)
  })

  it('線上簽到配指紋簽退：簽退以指紋的 17:05 判斷，不算早退', async () => {
    const result = await lateEarlyOf([onlineIn0810, fingerOut1705])

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([10])
    expect(result.earlyLeaveCount).toBe(0)
  })

  it('只有指紋 16:30 簽退、線上 17:20 簽退：取最晚的線上簽退，不算早退', async () => {
    const fingerOut1630 = punch('clockOut', '2026-10-21T08:30:00.000Z', 'import')
    const onlyFinger = await lateEarlyOf([fingerIn0755, fingerOut1630])
    expect(onlyFinger.earlyLeaveDetails.map((item) => item.minutesEarly)).toEqual([30])

    const both = await lateEarlyOf([fingerIn0755, fingerOut1630, onlineOut1720])
    expect(both.earlyLeaveCount).toBe(0)
  })
})

describe('報表：依班別時段比對，線上與指紋一起看', () => {
  const shiftMap = new Map([['day', DAY]])
  const employees = [{ _id: EMPLOYEE, name: '王小明' }]
  const schedules = [SCHEDULE]
  const build = (records) => ({
    schedules,
    shiftMap,
    employees,
    recordMap: new Map(),
    punchesByEmployee: groupPunchesByEmployee(records),
    actionBuffers: SETTING.actionBuffers,
  })

  it('遲到統計：只有線上 08:10 簽到時遲到 10 分鐘（顯示台灣時間），有 07:55 指紋簽到就不算遲到', () => {
    const late = reportUtils.buildTardinessSummary({ ...build([onlineIn0810]), lateGrace: 0 })
    expect(late.records).toEqual([expect.objectContaining({
      date: '2026-10-21',
      scheduledStart: '08:00',
      actualClockIn: '08:10',
      minutesLate: 10,
    })])

    const notLate = reportUtils.buildTardinessSummary({ ...build([onlineIn0810, fingerIn0755]), lateGrace: 0 })
    expect(notLate.records).toEqual([])
  })

  it('早退統計：取簽退時段內最晚的打卡', () => {
    const fingerOut1630 = punch('clockOut', '2026-10-21T08:30:00.000Z', 'import')
    const early = reportUtils.buildEarlyLeaveSummary({ ...build([fingerIn0755, fingerOut1630]), earlyGrace: 0 })
    expect(early.records).toEqual([expect.objectContaining({ scheduledEnd: '17:00', actualClockOut: '16:30', minutesEarly: 30 })])

    const notEarly = reportUtils.buildEarlyLeaveSummary({ ...build([fingerIn0755, fingerOut1630, onlineOut1720]), earlyGrace: 0 })
    expect(notEarly.records).toEqual([])
  })

  it('出勤與工時統計：07:55 指紋簽到（UTC 前一天）也算出勤，工時以 07:55-17:05 計算', () => {
    const attendance = reportUtils.buildAttendanceSummary(build([fingerIn0755, onlineIn0810, fingerOut1705]))
    expect(attendance.summary).toEqual({ scheduled: 1, attended: 1, absent: 0 })

    const workHours = reportUtils.buildWorkHoursSummary(build([fingerIn0755, onlineIn0810, fingerOut1705]))
    expect(workHours.records[0]).toEqual(expect.objectContaining({ workedHours: 8.17 }))
  })
})
