import { describe, it, expect } from 'vitest'
import { buildMonthDays, buildHolidayMap } from '../scheduleCalendar.js'

describe('buildMonthDays', () => {
  it('generates one entry per day of the month with the correct weekday label', () => {
    const days = buildMonthDays('2026-02', {}) // Feb 2026, 28 days, not a leap year
    expect(days).toHaveLength(28)
    expect(days[0]).toEqual({ date: 1, label: '1(日)', holiday: undefined })
    expect(days[27].date).toBe(28)
  })

  it('handles a leap-year February correctly', () => {
    const days = buildMonthDays('2028-02', {})
    expect(days).toHaveLength(29)
  })

  it('handles 31-day and 30-day months correctly', () => {
    expect(buildMonthDays('2026-01', {})).toHaveLength(31)
    expect(buildMonthDays('2026-04', {})).toHaveLength(30)
  })

  it('annotates a day with its holiday and includes the emoji + name in the label', () => {
    const holidayMap = { '2026-01-01': { name: '元旦' } }
    const days = buildMonthDays('2026-01', holidayMap)
    expect(days[0].holiday).toEqual({ name: '元旦' })
    expect(days[0].label).toBe('1(四) 🎊元旦')
  })

  it('defaults to an empty holiday map when none is given', () => {
    const days = buildMonthDays('2026-03')
    expect(days.every(d => d.holiday === undefined)).toBe(true)
  })

  it('只標示算假日的紀錄：國定假日有標示，補班日 / 工作日 / 例假日紀錄不標示', () => {
    const holidayMap = {
      '2026-06-19': { type: '國定假日', name: '端午節' },
      '2026-06-13': { type: '補班日', name: '補班' },
      '2026-06-14': { type: '工作日', name: '' },
      '2026-06-20': { type: '例假日', name: '週休' },
      '2026-06-21': { type: '公司休息日', name: '園遊會' },
    }
    const days = buildMonthDays('2026-06', holidayMap)
    expect(days[18].label).toBe('19(五) 🎊端午節')
    expect(days[18].holiday).toEqual({ type: '國定假日', name: '端午節' })
    for (const date of [13, 14, 20, 21]) {
      expect(days[date - 1].holiday).toBeUndefined()
      expect(days[date - 1].label).not.toContain('🎊')
    }
    expect(days[12].label).toBe('13(六)')
  })
})

describe('buildHolidayMap', () => {
  it('以 YYYY-MM-DD 為鍵，日期取 ISO 字串的日期部分而不受時區影響', () => {
    const map = buildHolidayMap([{ date: '2026-06-19T00:00:00.000Z', type: '國定假日', name: '端午節' }])
    expect(Object.keys(map)).toEqual(['2026-06-19'])
  })

  it('同一天有多筆紀錄時，不讓補班日蓋掉國定假日', () => {
    const holiday = { date: '2026-06-19', type: '國定假日', name: '端午節' }
    const makeup = { date: '2026-06-19', type: '補班日', name: '補班' }
    expect(buildHolidayMap([holiday, makeup])['2026-06-19']).toBe(holiday)
    expect(buildHolidayMap([makeup, holiday])['2026-06-19']).toBe(holiday)
  })

  it('忽略沒有日期或無法解析的紀錄，並容許非陣列輸入', () => {
    expect(buildHolidayMap([{ name: '無日期' }, null, { date: 'not-a-date' }])).toEqual({})
    expect(buildHolidayMap(undefined)).toEqual({})
  })
})
