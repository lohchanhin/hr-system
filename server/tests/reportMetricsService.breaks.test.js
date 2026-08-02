import { describe, it, expect } from '@jest/globals'
import { __testUtils } from '../src/services/reportMetricsService.js'

const {
  getShiftBreakMinutes,
  buildAttendanceSummary,
  buildEarlyLeaveSummary,
  buildWorkHoursSummary,
} = __testUtils

describe('報表休息時段計算', () => {
  it('優先使用 breakWindows 計算分鐘數', () => {
    const minutes = getShiftBreakMinutes(
      {
        breakWindows: [
          { start: '12:00', end: '12:45' },
          { start: '18:00', end: '18:15' },
        ],
        breakDuration: 0,
        breakMinutes: 0,
      },
      '2024-01-02T00:00:00.000Z'
    )

    expect(minutes).toBe(60)
  })

  it('以 breakDuration 為預設休息時長', () => {
    const minutes = getShiftBreakMinutes({ breakDuration: 30 })
    expect(minutes).toBe(30)
  })

  it('在工時計算時扣除休息分鐘數', () => {
    const shift = {
      _id: 'shift-1',
      startTime: '09:00',
      endTime: '18:00',
      breakDuration: 60,
    }
    const schedules = [
      { employee: 'emp1', date: '2024-01-05T00:00:00.000Z', shiftId: 'shift-1' },
    ]
    const recordMap = new Map([
      [
        'emp1::2024-01-05',
        {
          clockIns: [new Date('2024-01-05T09:00:00.000Z')],
          clockOuts: [new Date('2024-01-05T18:00:00.000Z')],
        },
      ],
    ])
    const shiftMap = new Map([['shift-1', shift]])
    const employees = [{ _id: 'emp1', name: '王小明' }]

    const result = buildWorkHoursSummary({ schedules, recordMap, shiftMap, employees })

    expect(result.summary.totalScheduledHours).toBe(8)
    expect(result.summary.totalWorkedHours).toBe(8)
    expect(result.records[0]).toEqual(
      expect.objectContaining({ scheduledHours: 8, workedHours: 8, differenceHours: 0 })
    )
  })

  it('不把休息日或例假日計入應出勤與工時', () => {
    const schedules = [
      { employee: 'emp1', date: '2024-01-06T00:00:00.000Z', shiftId: 'rest' },
      { employee: 'emp1', date: '2024-01-07T00:00:00.000Z', shiftId: 'regular-rest' },
    ]
    const shiftMap = new Map([
      ['rest', { _id: 'rest', code: 'REST', name: '休', startTime: '00:00', endTime: '00:00' }],
      ['regular-rest', { _id: 'regular-rest', code: 'REG', name: '例', startTime: '00:00', endTime: '00:00' }],
    ])
    const employees = [{ _id: 'emp1', name: '測試員工' }]
    const recordMap = new Map()

    const attendance = buildAttendanceSummary({ employees, schedules, recordMap, shiftMap })
    const workHours = buildWorkHoursSummary({ employees, schedules, recordMap, shiftMap })

    expect(attendance).toEqual({ records: [], summary: { scheduled: 0, attended: 0, absent: 0 } })
    expect(workHours.records).toEqual([])
    expect(workHours.summary).toEqual({
      totalScheduledHours: 0,
      totalWorkedHours: 0,
      differenceHours: 0,
    })
  })

  it('以次日退卡判斷跨日班早退分鐘', () => {
    const schedules = [
      { employee: 'emp1', date: '2024-01-05T00:00:00.000Z', shiftId: 'night' },
    ]
    const shiftMap = new Map([
      ['night', { _id: 'night', code: 'N', name: '夜班', startTime: '22:00', endTime: '06:00', crossDay: true }],
    ])
    const employees = [{ _id: 'emp1', name: '測試員工' }]
    const recordMap = new Map([
      ['emp1::2024-01-05', { clockIns: [new Date('2024-01-05T22:00:00.000Z')], clockOuts: [] }],
      ['emp1::2024-01-06', { clockIns: [], clockOuts: [new Date('2024-01-06T05:50:00.000Z')] }],
    ])

    const result = buildEarlyLeaveSummary({
      employees,
      schedules,
      recordMap,
      shiftMap,
      earlyGrace: 0,
    })

    expect(result.summary).toEqual({
      totalEarlyLeaveCount: 1,
      totalEarlyMinutes: 10,
      averageEarlyMinutes: 10,
    })
    expect(result.records[0]).toEqual(expect.objectContaining({ minutesEarly: 10 }))
  })
})
