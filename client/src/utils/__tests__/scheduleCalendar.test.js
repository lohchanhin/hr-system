import { describe, it, expect } from 'vitest'
import { buildMonthDays, buildHolidayMap } from '../scheduleCalendar.js'

describe('buildMonthDays', () => {
  it('generates one entry per day of the month with the correct weekday label', () => {
    const days = buildMonthDays('2026-02', {}) // Feb 2026, 28 days, not a leap year
    expect(days).toHaveLength(28)
    // 刻意更新（行事曆分類）：每天多了 infos（灰字資訊）與 displayKind
    expect(days[0]).toEqual({ date: 1, label: '1(日)', holiday: undefined, infos: [], displayKind: '' })
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
    // 刻意更新（行事曆分類）：每天的值變成 { holiday, infos }
    const holiday = { date: '2026-06-19', type: '國定假日', name: '端午節' }
    const makeup = { date: '2026-06-19', type: '補班日', name: '補班' }
    expect(buildHolidayMap([holiday, makeup])['2026-06-19'].holiday).toBe(holiday)
    expect(buildHolidayMap([makeup, holiday])['2026-06-19'].holiday).toBe(holiday)
  })

  it('忽略沒有日期或無法解析的紀錄，並容許非陣列輸入', () => {
    expect(buildHolidayMap([{ name: '無日期' }, null, { date: 'not-a-date' }])).toEqual({})
    expect(buildHolidayMap(undefined)).toEqual({})
  })

  it('新版標頭資料：國定假日放 holiday，公務機關補假放 infos；國定假日優先於指定應放假日', () => {
    const peace = { date: '2026-02-28', kind: 'statutory', displayKind: 'holiday', label: '和平紀念日', name: '和平紀念日' }
    const gov = { date: '2026-02-27', kind: 'gov_makeup_off', displayKind: 'gov_info', label: '公務機關補假', name: '補假', compensatesDate: '2026-02-28' }
    const election = { date: '2026-02-28', kind: 'designated', displayKind: 'designated', label: '選舉', name: '選舉' }
    const map = buildHolidayMap([election, peace, gov])
    expect(map['2026-02-28']).toEqual({ holiday: peace, infos: [] })
    expect(map['2026-02-27']).toEqual({ holiday: null, infos: [gov] })
  })
})

describe('buildMonthDays with the holiday-calendar headers (公務機關補假只是資訊)', () => {
  // GET /api/holiday-calendar/headers?month=2026-02 的內容（節錄）
  const FEBRUARY = [
    { date: '2026-02-15', kind: 'statutory', displayKind: 'holiday', label: '小年夜', name: '小年夜' },
    { date: '2026-02-20', kind: 'gov_makeup_off', displayKind: 'gov_info', label: '公務機關補假', name: '補假', compensatesDate: '2026-02-15' },
    { date: '2026-02-27', kind: 'gov_makeup_off', displayKind: 'gov_info', label: '公務機關補假', name: '補假', compensatesDate: '2026-02-28' },
    { date: '2026-02-28', kind: 'statutory', displayKind: 'holiday', label: '和平紀念日', name: '和平紀念日' }
  ]

  it('2026 年 2 月：20 日只顯示灰字「公務機關補假」（沒有 🎊），28 日顯示 🎊和平紀念日', () => {
    const days = buildMonthDays('2026-02', buildHolidayMap(FEBRUARY))
    expect(days[19]).toEqual({ date: 20, label: '20(五)', holiday: undefined, infos: ['公務機關補假'], displayKind: 'gov_info' })
    expect(days[27]).toMatchObject({ date: 28, label: '28(六) 🎊和平紀念日', infos: [], displayKind: 'holiday' })
    expect(days[14].label).toBe('15(日) 🎊小年夜')
    expect(days.filter((day) => day.label.includes('🎊'))).toHaveLength(2)
  })

  it('指定應放假日標 📌；已調移、公司休息日、調整放假都放灰字', () => {
    const map = buildHolidayMap([
      { date: '2026-11-28', kind: 'designated', displayKind: 'designated', label: '地方公職人員選舉', name: '地方公職人員選舉' },
      { date: '2026-11-13', kind: 'company_off', displayKind: 'company_off', label: '尾牙', name: '尾牙' },
      { date: '2026-11-10', kind: 'statutory', displayKind: 'moved_away', label: '已調移至 11/12', name: '國慶日', movedTo: '2026-11-12' },
      { date: '2026-11-12', kind: 'statutory', displayKind: 'holiday', label: '國慶日', name: '國慶日', movedFrom: '2026-11-10' },
      { date: '2026-11-20', kind: 'gov_bridge_off', displayKind: 'gov_info', label: '公務機關調整放假', name: '調整放假' }
    ])
    const days = buildMonthDays('2026-11', map)
    expect(days[27]).toMatchObject({ label: '28(六) 📌地方公職人員選舉', displayKind: 'designated' })
    expect(days[12]).toMatchObject({ label: '13(五)', infos: ['尾牙'], displayKind: 'company_off' })
    expect(days[9]).toMatchObject({ label: '10(二)', infos: ['已調移至 11/12'], displayKind: 'moved_away' })
    expect(days[11]).toMatchObject({ label: '12(四) 🎊國慶日', displayKind: 'holiday' })
    expect(days[19]).toMatchObject({ label: '20(五)', infos: ['公務機關調整放假'] })
  })

  it('舊版 by-month 資料：有 kind 的公務機關補假顯示灰字，沒有 kind 的補班日不顯示', () => {
    const map = buildHolidayMap([
      { date: '2026-02-20T00:00:00.000Z', type: '公務機關補假', name: '補假', kind: 'gov_makeup_off', displayKind: 'gov_info' },
      { date: '2026-02-21T00:00:00.000Z', type: '補班日', name: '補班' },
      { date: '2026-02-23T00:00:00.000Z', type: '國定假日', name: '補假' }
    ])
    const days = buildMonthDays('2026-02', map)
    expect(days[19]).toMatchObject({ label: '20(五)', infos: ['公務機關補假'] })
    expect(days[20]).toMatchObject({ label: '21(六)', infos: [] })
    expect(days[22]).toMatchObject({ label: '23(一)', infos: [] })
  })
})
