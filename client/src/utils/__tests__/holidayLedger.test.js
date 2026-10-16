import { describe, it, expect } from 'vitest'
import {
  LEDGER_FILTERS,
  buildLedgerQuery,
  canRecordResolution,
  countLedgerFilters,
  describeHolidayHeader,
  describeLedgerCell,
  describeResolution,
  formatMonthDay,
  ledgerRowMatchesFilter,
  weekdayLabel,
} from '../holidayLedger'

describe('date helpers', () => {
  it('formats a day key without any time-zone shift', () => {
    expect(formatMonthDay('2026-09-25')).toBe('09/25')
    expect(formatMonthDay('2026-09-25T00:00:00.000Z')).toBe('09/25')
    expect(formatMonthDay('')).toBe('')
    expect(formatMonthDay(null)).toBe('')
    expect(formatMonthDay('bad')).toBe('')
  })

  it('gives the weekday of a day key', () => {
    expect(weekdayLabel('2026-09-25')).toBe('五')
    expect(weekdayLabel('2026-09-27')).toBe('日')
    expect(weekdayLabel('')).toBe('')
  })

  it('describes the holiday column header and notes a company move', () => {
    expect(describeHolidayHeader({ name: '中秋節', date: '2026-09-25' })).toEqual({ name: '中秋節', date: '09/25（五）', note: '' })
    expect(describeHolidayHeader({ name: '中秋節', date: '2026-09-24', movedFrom: '2026-09-25' }).note).toBe('公司挪移自 09/25')
  })
})

describe('describeResolution', () => {
  it('writes one line per kind', () => {
    expect(describeResolution({ kind: 'compensatory_leave', compensatoryHours: 8 })).toBe('補休 8 小時')
    expect(describeResolution({ kind: 'paid' })).toBe('折發工資')
    expect(describeResolution({ kind: 'rested_later', restedDate: '2026-10-03' })).toBe('已另行補休 2026-10-03')
    expect(describeResolution({ kind: 'waived', note: '員工放棄' })).toBe('不補（員工放棄）')
    expect(describeResolution(null)).toBe('')
  })
})

describe('describeLedgerCell', () => {
  it('uses text for every state, never only color', () => {
    expect(describeLedgerCell({ status: 'rested_on_date', guoDate: '2026-09-25' })).toMatchObject({ text: '當日休', type: 'success' })
    const moved = describeLedgerCell({ status: 'moved', guoDate: '2026-09-20', offsetDays: -5, dateKind: 'work', holidayDate: '2026-09-25' })
    expect(moved).toMatchObject({ text: '移休 09/20', type: 'primary' })
    expect(moved.tooltip).toContain('比假日早 5 天')
    expect(moved.tooltip).toContain('假日當天有排班上班')
    expect(describeLedgerCell({ status: 'moved', guoDate: '2026-09-27', offsetDays: 2 }).tooltip).toContain('比假日晚 2 天')
    expect(describeLedgerCell({ status: 'moved', guoDate: '2026-09-25', offsetDays: 1, movedFrom: '2026-09-25', holidayDate: '2026-09-24' }).tooltip)
      .toContain('公司已將假日從 09/25 挪到 09/24')
  })

  it('tells apart the reasons for a holiday that was not taken', () => {
    const cell = (extra) => describeLedgerCell({ status: 'not_taken', needsAction: null, ...extra })
    expect(cell({ reason: 'worked', needsAction: 'resolve' })).toMatchObject({ text: '未休·上班', type: 'danger' })
    expect(cell({ reason: 'unscheduled', needsAction: 'resolve' })).toMatchObject({ text: '未休·未排班', type: 'warning' })
    expect(cell({ reason: 'shared_date', needsAction: 'resolve' }).text).toBe('未休·同日多個假日')
    expect(cell({ reason: 'on_rest_day' })).toMatchObject({ text: '適逢休息日', type: 'info' })
    expect(cell({ reason: 'on_regular_rest' }).text).toBe('適逢例假')
    expect(cell({ reason: 'on_leave' }).text).toBe('適逢請假')
    expect(cell({ reason: 'worked', needsAction: 'schedule' })).toMatchObject({ text: '尚未排國', type: 'warning' })
  })

  it('shows a recorded resolution instead of the open state and marks not-applicable holidays', () => {
    const settled = describeLedgerCell({
      status: 'not_taken',
      reason: 'worked',
      needsAction: null,
      resolution: { kind: 'compensatory_leave', compensatoryHours: 8 },
    })
    expect(settled).toMatchObject({ text: '未休·補休 8 小時', type: 'info' })
    expect(describeLedgerCell({ status: 'na', reason: 'before_hire' })).toMatchObject({ text: '—', tooltip: '到職前' })
    expect(describeLedgerCell({ status: 'na', reason: 'after_resignation' }).tooltip).toBe('離職後')
    expect(describeLedgerCell(undefined).text).toBe('')
  })
})

describe('canRecordResolution', () => {
  it('opens the form only for open items and existing records, not for "please schedule"', () => {
    expect(canRecordResolution({ status: 'not_taken', needsAction: 'resolve' })).toBe(true)
    expect(canRecordResolution({ status: 'not_taken', needsAction: null, resolution: { kind: 'paid' } })).toBe(true)
    expect(canRecordResolution({ status: 'not_taken', needsAction: 'schedule' })).toBe(false)
    expect(canRecordResolution({ status: 'not_taken', needsAction: null, reason: 'on_rest_day' })).toBe(false)
    expect(canRecordResolution({ status: 'moved' })).toBe(false)
    expect(canRecordResolution(undefined)).toBe(false)
  })
})

describe('filters', () => {
  const rows = [
    { employeeId: 'a', notTaken: 0, moved: 1, open: 0, extraGuoDates: [] },
    { employeeId: 'b', notTaken: 2, moved: 0, open: 1, extraGuoDates: [] },
    { employeeId: 'c', notTaken: 1, moved: 1, open: 0, extraGuoDates: ['2026-09-30'] },
  ]

  it('matches rows for each filter', () => {
    const ids = (filter) => rows.filter((row) => ledgerRowMatchesFilter(row, filter)).map((row) => row.employeeId)
    expect(ids('all')).toEqual(['a', 'b', 'c'])
    expect(ids('notTaken')).toEqual(['b', 'c'])
    expect(ids('moved')).toEqual(['a', 'c'])
    expect(ids('open')).toEqual(['b'])
    expect(ids('extra')).toEqual(['c'])
    expect(ledgerRowMatchesFilter(null, 'all')).toBe(false)
  })

  it('counts every filter', () => {
    expect(countLedgerFilters(rows)).toEqual({ all: 3, notTaken: 2, moved: 2, open: 1, extra: 1 })
    expect(LEDGER_FILTERS.map((filter) => filter.value)).toEqual(['all', 'notTaken', 'moved', 'open', 'extra'])
  })
})

describe('buildLedgerQuery', () => {
  it('keeps only the scope that is set', () => {
    expect(buildLedgerQuery({ month: '2026-09', department: 'd1', subDepartment: 's1', includeSelf: true }))
      .toBe('month=2026-09&department=d1&subDepartment=s1&includeSelf=true')
    expect(buildLedgerQuery({ month: '2026-09' })).toBe('month=2026-09')
    expect(buildLedgerQuery()).toBe('')
  })
})
