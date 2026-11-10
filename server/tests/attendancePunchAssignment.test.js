// 一筆打卡只算給一個班（A1）：工時、出勤天數、部門報表不會把同一組打卡算給兩個班表。
// 原本時段內找不到打卡時，依日期比對的備援不檢查打卡是不是這一班的，缺勤那天會拿到隔天大夜班前一晚的簽到，
// 同一組打卡被算成兩天出勤（日薪 2000 的人變成 4000）。
// 時間都是真實的 UTC，tw('2026-10-12 23:55') 是台灣時間。
import { describe, it, expect } from '@jest/globals'
import { groupPunchesByEmployee, matchSchedulesPunches } from '../src/services/attendancePunchService.js'
import { calculateWorkHours } from '../src/services/workHoursCalculationService.js'
import { calculateLateEarlyCount } from '../src/services/attendanceDeductionService.js'
import { __testUtils as reportUtils } from '../src/services/reportMetricsService.js'

const tw = (text) => new Date(`${text.replace(' ', 'T')}:00+08:00`)
const day = (key) => new Date(`${key}T00:00:00.000Z`)

const BIG_NIGHT = { _id: 'bigNight', code: '大', name: '大夜', semanticType: 'work', startTime: '00:00', endTime: '08:00', breakDuration: 0 }
const BIG_NIGHT_FLAGGED = { ...BIG_NIGHT, _id: 'bigNightFlagged', code: '大F', crossDay: true }
const DAY = { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 }
const EVENING = { _id: 'evening', code: '小', name: '小夜', semanticType: 'work', startTime: '16:00', endTime: '00:00', crossDay: true, breakDuration: 0 }
const NIGHT12 = { _id: 'night12', code: '夜', name: '夜班', semanticType: 'work', startTime: '20:00', endTime: '08:00', crossDay: true, breakDuration: 60 }
const REST = { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
const SETTING = {
  shifts: [BIG_NIGHT, BIG_NIGHT_FLAGGED, DAY, EVENING, NIGHT12, REST],
  abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
  actionBuffers: {
    clockIn: { earlyMinutes: 60, lateMinutes: 240 },
    clockOut: { earlyMinutes: 240, lateMinutes: 120 },
  },
}
const EMPLOYEE = 'nurse1'

const schedule = (key, shiftId) => ({ _id: `sched-${key}`, employee: EMPLOYEE, date: day(key), shiftId })
const punch = (action, text, source) => ({ employee: EMPLOYEE, action, timestamp: tw(text), ...(source ? { source } : {}) })

function workHoursOf(schedules, records, month = '2026-10-01') {
  return calculateWorkHours(EMPLOYEE, month, {
    employee: { _id: EMPLOYEE },
    attendanceSetting: SETTING,
    schedules,
    attendanceRecords: records,
  })
}

// 每天的 [日期, 是否出勤, 簽到(台灣時間), 簽退(台灣時間), 工時]
function dailyOf(result) {
  const local = (iso) => (iso ? new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ') : null)
  return result.dailyDetails.map((item) => [item.date, item.hasAttendance, local(item.clockInTime), local(item.clockOutTime), item.workedHours])
}

describe('工時：一組打卡只算給一個班', () => {
  it('大夜 00:00-08:00：10/12 缺勤、10/13 上班（10/12 23:55 指紋簽到、10/13 08:04 線上簽退），只有 10/13 算出勤', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'bigNight'), schedule('2026-10-13', 'bigNight')],
      [punch('clockIn', '2026-10-12 23:55', 'import'), punch('clockOut', '2026-10-13 08:04', 'online')],
    )

    expect(result.workDays).toBe(1)
    expect(result.actualWorkHours).toBe(8.15)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', false, null, null, 0],
      ['2026-10-13', true, '10-12 23:55', '10-13 08:04', 8.15],
    ])
    expect(result.dailyDetails[1]).toEqual(expect.objectContaining({ clockInSource: 'import', clockOutSource: 'online' }))
  })

  it('大夜勾了跨日也一樣（原本會再看前一天的簽到）', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'bigNightFlagged'), schedule('2026-10-13', 'bigNightFlagged')],
      [punch('clockIn', '2026-10-12 23:55', 'import'), punch('clockOut', '2026-10-13 08:04', 'online')],
    )

    expect(result.workDays).toBe(1)
    expect(dailyOf(result).map((row) => row.slice(0, 2))).toEqual([['2026-10-12', false], ['2026-10-13', true]])
  })

  it('連續大夜：每一班各自拿自己的打卡', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'bigNight'), schedule('2026-10-13', 'bigNight'), schedule('2026-10-14', 'bigNight')],
      [
        punch('clockIn', '2026-10-11 23:50', 'online'), punch('clockOut', '2026-10-12 08:02', 'import'),
        punch('clockIn', '2026-10-12 23:55', 'import'), punch('clockOut', '2026-10-13 08:04', 'online'),
        punch('clockIn', '2026-10-13 23:58'), punch('clockOut', '2026-10-14 08:00'),
      ],
    )

    expect(result.workDays).toBe(3)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', true, '10-11 23:50', '10-12 08:02', 8.2],
      ['2026-10-13', true, '10-12 23:55', '10-13 08:04', 8.15],
      ['2026-10-14', true, '10-13 23:58', '10-14 08:00', 8.03],
    ])
  })

  it('日班：缺勤那天不會拿到隔天 07:55 的簽到與隔天的簽退', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'day')],
      [punch('clockIn', '2026-10-13 07:55', 'import'), punch('clockOut', '2026-10-13 17:05', 'import')],
    )

    expect(result.workDays).toBe(1)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', false, null, null, 0],
      ['2026-10-13', true, '10-13 07:55', '10-13 17:05', 8.17],
    ])
  })

  it('只打了簽到（忘了簽退）的那天不算出勤，也不會拿隔天的簽退', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'day')],
      [
        punch('clockIn', '2026-10-12 08:10', 'online'),
        punch('clockIn', '2026-10-13 07:55', 'import'), punch('clockOut', '2026-10-13 17:05', 'import'),
      ],
    )

    expect(result.workDays).toBe(1)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', false, '10-12 08:10', null, 0],
      ['2026-10-13', true, '10-13 07:55', '10-13 17:05', 8.17],
    ])
  })

  it('只打了簽退（忘了簽到）的那天不算出勤', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'day')],
      [
        punch('clockOut', '2026-10-12 17:02', 'import'),
        punch('clockIn', '2026-10-13 07:55', 'import'), punch('clockOut', '2026-10-13 17:05', 'import'),
      ],
    )

    expect(result.workDays).toBe(1)
    expect(dailyOf(result).map((row) => row.slice(0, 2))).toEqual([['2026-10-12', false], ['2026-10-13', true]])
  })

  it('小夜 16:00-00:00 過午夜才簽退照樣算；接著上大夜時兩班各算各的', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'evening'), schedule('2026-10-13', 'bigNight')],
      [
        punch('clockIn', '2026-10-12 15:55', 'online'), punch('clockOut', '2026-10-13 00:05', 'import'),
        punch('clockIn', '2026-10-13 00:03', 'import'), punch('clockOut', '2026-10-13 08:02', 'online'),
      ],
    )

    expect(result.workDays).toBe(2)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', true, '10-12 15:55', '10-13 00:05', 8.17],
      ['2026-10-13', true, '10-13 00:03', '10-13 08:02', 7.98],
    ])
  })

  it('小夜缺勤、隔天大夜照常（前一晚 23:55 簽到）：小夜那天不拿大夜的簽到', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'evening'), schedule('2026-10-13', 'bigNight')],
      [punch('clockIn', '2026-10-12 23:55', 'import'), punch('clockOut', '2026-10-13 08:04', 'online')],
    )

    expect(result.workDays).toBe(1)
    expect(dailyOf(result).map((row) => row.slice(0, 3))).toEqual([['2026-10-12', false, null], ['2026-10-13', true, '10-12 23:55']])
  })

  it('夜班 20:00-08:00（跨日）：中間缺勤的那天不拿前一班的打卡', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'night12'), schedule('2026-10-13', 'night12'), schedule('2026-10-14', 'night12')],
      [
        punch('clockIn', '2026-10-12 19:50', 'import'), punch('clockOut', '2026-10-13 08:05', 'online'),
        punch('clockIn', '2026-10-14 19:52', 'online'), punch('clockOut', '2026-10-15 08:01', 'import'),
      ],
    )

    expect(result.workDays).toBe(2)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', true, '10-12 19:50', '10-13 08:05', 11.25],
      ['2026-10-13', false, null, null, 0],
      ['2026-10-14', true, '10-14 19:52', '10-15 08:01', 11.15],
    ])
  })

  it('遲到超過簽到緩衝（12:30 才簽到）、提早超過簽退緩衝（12:30 就簽退）仍以依日期比對算得到工時', async () => {
    const late = await workHoursOf([schedule('2026-10-12', 'day')], [punch('clockIn', '2026-10-12 12:30'), punch('clockOut', '2026-10-12 17:05')])
    expect(dailyOf(late)).toEqual([['2026-10-12', true, '10-12 12:30', '10-12 17:05', 3.58]])

    const early = await workHoursOf([schedule('2026-10-12', 'day')], [punch('clockIn', '2026-10-12 07:55'), punch('clockOut', '2026-10-12 12:30')])
    expect(dailyOf(early)).toEqual([['2026-10-12', true, '10-12 07:55', '10-12 12:30', 3.58]])
  })

  it('下班超過簽退緩衝才簽退（19:30）：後面還有班表時，簽退到下一班開始前都算這一班的', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'day')],
      [
        punch('clockIn', '2026-10-12 07:55', 'import'), punch('clockOut', '2026-10-12 19:30', 'import'),
        punch('clockIn', '2026-10-13 07:58', 'import'), punch('clockOut', '2026-10-13 17:01', 'import'),
      ],
    )

    expect(dailyOf(result)).toEqual([
      ['2026-10-12', true, '10-12 07:55', '10-12 19:30', 10.58],
      ['2026-10-13', true, '10-13 07:58', '10-13 17:01', 8.05],
    ])
  })

  it('月底最後一班忘了簽退：不會拿下個月 1 號大夜班的簽退（下個月的班表不在這次計算裡）', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-31', 'day')],
      [
        punch('clockIn', '2026-10-31 08:10', 'online'),
        punch('clockIn', '2026-10-31 23:55', 'import'), punch('clockOut', '2026-11-01 08:04', 'online'),
      ],
    )

    expect(result.workDays).toBe(0)
    expect(dailyOf(result)).toEqual([['2026-10-31', false, '10-31 08:10', null, 0]])
  })

  it('月底最後一班下班超過簽退緩衝才簽退（19:30）：與月中隔天排休相同，當天的簽退照樣算', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-30', 'day'), schedule('2026-10-31', 'day')],
      [
        punch('clockIn', '2026-10-30 07:57', 'import'), punch('clockOut', '2026-10-30 17:02', 'import'),
        punch('clockIn', '2026-10-31 07:55', 'import'), punch('clockOut', '2026-10-31 19:30', 'import'),
      ],
    )

    expect(result.workDays).toBe(2)
    expect(dailyOf(result)[1]).toEqual(['2026-10-31', true, '10-31 07:55', '10-31 19:30', 10.58])
  })

  it('月底最後一班是夜班 20:00-08:00：簽退最晚到下班時間加簽退緩衝（隔天 10:00），不拿更晚的簽退（例如 11/1 日班的簽退）', async () => {
    const records = [punch('clockIn', '2026-10-31 19:55', 'import')]
    const inside = await workHoursOf([schedule('2026-10-31', 'night12')], [...records, punch('clockOut', '2026-11-01 10:00', 'import')])
    expect(dailyOf(inside)).toEqual([['2026-10-31', true, '10-31 19:55', '11-01 10:00', 13.08]])

    for (const text of ['2026-11-01 10:30', '2026-11-01 17:05']) {
      // eslint-disable-next-line no-await-in-loop
      const later = await workHoursOf([schedule('2026-10-31', 'night12')], [...records, punch('clockOut', text, 'import')])
      expect(dailyOf(later)).toEqual([['2026-10-31', false, '10-31 19:55', null, 0]])
    }
  })

  it('沒有來源欄位的舊資料照樣比對，來源標示 legacy', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'bigNight'), schedule('2026-10-13', 'bigNight')],
      [punch('clockIn', '2026-10-12 23:55'), punch('clockOut', '2026-10-13 08:04')],
    )

    expect(result.workDays).toBe(1)
    expect(result.dailyDetails[1]).toEqual(expect.objectContaining({ hasAttendance: true, clockInSource: 'legacy', clockOutSource: 'legacy' }))
  })

  it('休息日的班表照樣不算，也當作前一班簽退的界線', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'rest')],
      [punch('clockIn', '2026-10-12 07:55'), punch('clockOut', '2026-10-12 21:00'), punch('clockOut', '2026-10-13 09:00')],
    )

    expect(dailyOf(result)).toEqual([
      ['2026-10-12', true, '10-12 07:55', '10-12 21:00', 12.08],
      ['2026-10-13', false, null, null, 0],
    ])
  })

  // 2026-11 複查：依日期比對原本只看 UTC 日期，台灣 08:00 以前的簽到算成前一天
  it('日班比簽到緩衝更早到（06:50 指紋簽到、17:05 簽退）：照樣算出勤，不會整天變成缺勤', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'day')],
      [
        punch('clockIn', '2026-10-12 06:50', 'import'), punch('clockOut', '2026-10-12 17:05', 'import'),
        punch('clockIn', '2026-10-13 07:55', 'import'), punch('clockOut', '2026-10-13 17:00', 'import'),
      ],
    )

    expect(result.workDays).toBe(2)
    expect(dailyOf(result)).toEqual([
      ['2026-10-12', true, '10-12 06:50', '10-12 17:05', 9.25],
      ['2026-10-13', true, '10-13 07:55', '10-13 17:00', 8.08],
    ])
  })

  it('簽到緩衝設成提早 15 分鐘時，提早 20 分鐘（07:40）到的日班人員照樣算出勤', async () => {
    const result = await calculateWorkHours(EMPLOYEE, '2026-10-01', {
      employee: { _id: EMPLOYEE },
      attendanceSetting: { ...SETTING, actionBuffers: { clockIn: { earlyMinutes: 15, lateMinutes: 240 }, clockOut: { earlyMinutes: 240, lateMinutes: 120 } } },
      schedules: [schedule('2026-10-12', 'day')],
      attendanceRecords: [punch('clockIn', '2026-10-12 07:40', 'import'), punch('clockOut', '2026-10-12 17:00', 'import')],
    })

    expect(dailyOf(result)).toEqual([['2026-10-12', true, '10-12 07:40', '10-12 17:00', 8.33]])
  })

  it('前一天深夜的簽到不會被當成今天日班的簽到（只認班表日期當天）', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'day')],
      [punch('clockIn', '2026-10-11 23:30', 'import'), punch('clockOut', '2026-10-12 17:00', 'import')],
    )

    expect(dailyOf(result)).toEqual([['2026-10-12', false, null, null, 0]])
  })

  it('夜班 20:00-08:00 隔天排休、提早下班（03:30，不在簽退時段內）：照樣算得到工時（原本隔天 00:00 的界線落在班內，整班算成缺勤）', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'night12'), schedule('2026-10-13', 'rest'), schedule('2026-10-14', 'night12')],
      [
        punch('clockIn', '2026-10-12 19:55', 'online'), punch('clockOut', '2026-10-13 03:30', 'import'),
        punch('clockIn', '2026-10-14 19:58', 'online'), punch('clockOut', '2026-10-15 08:01', 'online'),
      ],
    )

    expect(result.workDays).toBe(2)
    expect(dailyOf(result)).toEqual([
      // 19:55 到 03:30 共 455 分鐘，扣休息 60 分鐘
      ['2026-10-12', true, '10-12 19:55', '10-13 03:30', 6.58],
      ['2026-10-13', false, null, null, 0],
      ['2026-10-14', true, '10-14 19:58', '10-15 08:01', 11.05],
    ])
  })

  it('夜班隔天排休、忘了簽退：不會拿隔天下午或再下一班的簽退', async () => {
    const result = await workHoursOf(
      [schedule('2026-10-12', 'night12'), schedule('2026-10-13', 'rest'), schedule('2026-10-14', 'night12')],
      [
        punch('clockIn', '2026-10-12 19:55', 'online'),
        punch('clockOut', '2026-10-13 15:00', 'import'),
        punch('clockIn', '2026-10-14 19:58', 'online'), punch('clockOut', '2026-10-15 08:01', 'online'),
      ],
    )

    expect(dailyOf(result).map((row) => row.slice(0, 2))).toEqual([
      ['2026-10-12', false], ['2026-10-13', false], ['2026-10-14', true],
    ])
  })
})

describe('matchSchedulesPunches', () => {
  const items = (schedules) => schedules.map((item) => {
    const shift = SETTING.shifts.find((candidate) => candidate._id === item.shiftId)
    return { key: item, scheduleDate: item.date, shift, nonWork: shift.semanticType !== 'work' }
  })

  it('時段比對到的打卡保留給那一班；時段重疊時算給時間比較接近的那一班', () => {
    // 簽到緩衝設得很大（提早 12 小時、遲到 10 小時）：10/12 日班與 10/13 大夜的簽到時段在 10/12 12:00-17:00 重疊。
    // 12:30 的簽到離日班上班時間比較近，算日班的；大夜不會因為 12:30 比較早就把它當成自己的簽到
    const wide = { clockIn: { earlyMinutes: 720, lateMinutes: 600 }, clockOut: { earlyMinutes: 240, lateMinutes: 120 } }
    const day12 = schedule('2026-10-12', 'day')
    const night13 = schedule('2026-10-13', 'bigNight')
    const lateIn = punch('clockIn', '2026-10-12 12:30')
    const nightIn = punch('clockIn', '2026-10-12 23:55')
    const result = matchSchedulesPunches({ records: [nightIn, lateIn], schedules: items([day12, night13]), actionBuffers: wide })

    expect(result.get(day12).windowClockIn).toBe(lateIn)
    expect(result.get(night13).windowClockIn).toBe(nightIn)
  })

  it('不用上班的班表不在結果裡；回傳的是原本的打卡資料', () => {
    const rest = schedule('2026-10-12', 'rest')
    const work = schedule('2026-10-13', 'day')
    const clockIn = punch('clockIn', '2026-10-13 07:59', 'online')
    const result = matchSchedulesPunches({ records: [clockIn], schedules: items([rest, work]), actionBuffers: SETTING.actionBuffers })

    expect(result.has(rest)).toBe(false)
    expect(result.get(work)).toEqual(expect.objectContaining({ clockIn, clockOut: null, windowClockIn: clockIn, windowClockOut: null }))
  })
})

describe('遲到早退扣款：缺勤那天沒有遲到早退（只看打卡時段）', () => {
  it('大夜 10/12 缺勤、10/13 23:55 簽到 08:04 簽退：沒有遲到也沒有早退', async () => {
    const result = await calculateLateEarlyCount(EMPLOYEE, '2026-10', {
      attendanceSetting: SETTING,
      schedules: [schedule('2026-10-12', 'bigNight'), schedule('2026-10-13', 'bigNight')],
      attendanceRecords: [punch('clockIn', '2026-10-12 23:55', 'import'), punch('clockOut', '2026-10-13 08:04', 'online')],
    })

    expect(result).toMatchObject({ lateCount: 0, earlyLeaveCount: 0 })
  })
})

describe('部門報表：出勤、工時不重複計算；遲到、早退列出打卡來源', () => {
  const shiftMap = new Map(SETTING.shifts.map((shift) => [shift._id, shift]))
  const employees = [{ _id: EMPLOYEE, name: '羅護理師' }]
  // 與 getDepartmentReportData 相同：依日期分組的打卡（recordMap）與依員工分組的打卡都帶
  const build = (schedules, records) => ({
    schedules,
    shiftMap,
    employees,
    recordMap: reportUtils.groupAttendanceRecords(records),
    punchesByEmployee: groupPunchesByEmployee(records),
    actionBuffers: SETTING.actionBuffers,
  })
  const absentThenWork = () => build(
    [schedule('2026-10-12', 'bigNight'), schedule('2026-10-13', 'bigNight')],
    [punch('clockIn', '2026-10-12 23:55', 'import'), punch('clockOut', '2026-10-13 08:04', 'online')],
  )

  it('出勤統計：排班 2 天、出勤 1 天、缺勤 1 天', () => {
    const result = reportUtils.buildAttendanceSummary(absentThenWork())
    expect(result.summary).toEqual({ scheduled: 2, attended: 1, absent: 1 })
  })

  it('工時統計：缺勤那天 0 小時，只有 10/13 算 8.15 小時', () => {
    const result = reportUtils.buildWorkHoursSummary(absentThenWork())
    expect(result.records.map((item) => [item.date, item.workedHours])).toEqual([['2026-10-12', 0], ['2026-10-13', 8.15]])
    expect(result.summary.totalWorkedHours).toBe(8.15)
  })

  it('遲到統計：實際打卡帶來源（指紋匯入、線上、舊資料）', () => {
    const data = build(
      [schedule('2026-10-12', 'day'), schedule('2026-10-13', 'day'), schedule('2026-10-14', 'day')],
      [punch('clockIn', '2026-10-12 08:10', 'import'), punch('clockIn', '2026-10-13 08:05', 'online'), punch('clockIn', '2026-10-14 08:20')],
    )
    const result = reportUtils.buildTardinessSummary({ ...data, lateGrace: 0 })
    expect(result.records.map((item) => [item.date, item.actualClockIn, item.clockInSource, item.minutesLate])).toEqual([
      ['2026-10-12', '08:10', 'import', 10],
      ['2026-10-13', '08:05', 'online', 5],
      ['2026-10-14', '08:20', 'legacy', 20],
    ])
  })

  it('早退統計：實際打卡帶來源', () => {
    const data = build(
      [schedule('2026-10-12', 'day')],
      [punch('clockIn', '2026-10-12 07:55', 'online'), punch('clockOut', '2026-10-12 16:30', 'import')],
    )
    const result = reportUtils.buildEarlyLeaveSummary({ ...data, earlyGrace: 0 })
    expect(result.records).toEqual([expect.objectContaining({ actualClockOut: '16:30', clockOutSource: 'import', minutesEarly: 30 })])
  })
})

// 2026-11（srvfix）：月初第一天的跨日班缺勤時，依日期比對的「再看前一天的簽到」會拿到上個月最後一天那一班的打卡——
// 上個月的班表不在這次計算裡，那一班的打卡看起來沒有人用。11/1 大夜（00:00-08:00，勾了跨日）缺勤，
// 卻用 10/31 小夜的 15:50 簽到、00:05 簽退算成出勤 8.25 小時（日薪多一天，10 月已經領過一次）。
describe('月初第一班：不會用到上個月最後一天那一班的打卡', () => {
  const eveningPunches = [punch('clockIn', '2026-10-31 15:50', 'online'), punch('clockOut', '2026-11-01 00:05', 'online')]
  const november = (schedules, records, leadingSchedules) => calculateWorkHours(EMPLOYEE, '2026-11-01', {
    employee: { _id: EMPLOYEE },
    attendanceSetting: SETTING,
    schedules,
    attendanceRecords: records,
    leadingSchedules,
  })

  it('10/31 小夜有上班、11/1 大夜（勾跨日）缺勤：11/1 不算出勤，也不顯示 10/31 的簽到', async () => {
    const result = await november([schedule('2026-11-01', 'bigNightFlagged')], eveningPunches, [schedule('2026-10-31', 'evening')])

    expect(result.workDays).toBe(0)
    expect(dailyOf(result)).toEqual([['2026-11-01', false, null, null, 0]])
  })

  it('11/1 大夜真的有來（10/31 22:40 簽到，比簽到緩衝早）：照樣算 11/1 出勤，10/31 小夜的打卡留給 10/31', async () => {
    const result = await november(
      [schedule('2026-11-01', 'bigNightFlagged')],
      [...eveningPunches, punch('clockIn', '2026-10-31 22:40', 'import'), punch('clockOut', '2026-11-01 08:03', 'import')],
      [schedule('2026-10-31', 'evening')],
    )

    expect(result.workDays).toBe(1)
    expect(dailyOf(result)).toEqual([['2026-11-01', true, '10-31 22:40', '11-01 08:03', 9.38]])
  })

  it('前一天沒有排班卻有一組完整的打卡（例如休息日來加班 09:00-18:00）：也不會被隔天缺勤的跨日班拿去', async () => {
    const overtime = [punch('clockIn', '2026-10-31 09:00', 'online'), punch('clockOut', '2026-10-31 18:00', 'online')]
    const result = await november([schedule('2026-11-01', 'bigNightFlagged')], overtime, [])

    expect(result.workDays).toBe(0)
    expect(dailyOf(result)).toEqual([['2026-11-01', false, null, null, 0]])

    // 月中也一樣：10/14 休假來加班，10/15 大夜缺勤
    const midMonth = await workHoursOf(
      [schedule('2026-10-14', 'rest'), schedule('2026-10-15', 'bigNightFlagged')],
      [punch('clockIn', '2026-10-14 09:00', 'online'), punch('clockOut', '2026-10-14 18:00', 'online')],
    )
    expect(midMonth.workDays).toBe(0)
  })

  it('部門報表的出勤、工時也一樣（帶入前一天的班表）', () => {
    const employees = [{ _id: EMPLOYEE, name: '護理師' }]
    const shiftMap = new Map(SETTING.shifts.map((shift) => [shift._id, shift]))
    const args = {
      employees,
      schedules: [schedule('2026-11-01', 'bigNightFlagged')],
      leadingSchedules: [schedule('2026-10-31', 'evening')],
      recordMap: new Map(),
      shiftMap,
      punchesByEmployee: groupPunchesByEmployee(eveningPunches),
      actionBuffers: SETTING.actionBuffers,
    }
    expect(reportUtils.buildAttendanceSummary(args).summary).toMatchObject({ scheduled: 1, attended: 0, absent: 1 })
    expect(reportUtils.buildWorkHoursSummary(args).summary).toMatchObject({ totalWorkedHours: 0 })
  })
})
