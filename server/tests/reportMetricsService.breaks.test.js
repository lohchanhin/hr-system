import { describe, it, expect } from '@jest/globals'
import { __testUtils } from '../src/services/reportMetricsService.js'

const { getShiftBreakMinutes, buildWorkHoursSummary } = __testUtils

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
})
