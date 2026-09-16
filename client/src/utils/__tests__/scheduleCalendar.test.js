import { describe, it, expect } from 'vitest'
import { buildMonthDays } from '../scheduleCalendar.js'

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
})
