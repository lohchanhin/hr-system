import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CONSENT_REQUIRED_TEXT,
  LEDGER_CONFLICT_TEXT,
  LEDGER_FILTERS,
  buildLedgerQuery,
  buildSwapBody,
  canRecordResolution,
  canShowCompensationButton,
  canShowResolveButton,
  canShowSwapButton,
  compensationReasonText,
  countLedgerFilters,
  describeHolidayHeader,
  describeLedgerCell,
  describeResolution,
  describeResolutionAuthor,
  formatMonthDay,
  getViewerEmployeeId,
  ledgerRowMatchesFilter,
  resolveButtonLabel,
  validateSwapForm,
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
    // 新增「待排補假」（compensation）篩選，與伺服器的 status=compensation 一致
    expect(countLedgerFilters(rows)).toEqual({ all: 3, notTaken: 2, moved: 2, open: 1, extra: 1, compensation: 0 })
    expect(LEDGER_FILTERS.map((filter) => filter.value)).toEqual(['all', 'notTaken', 'moved', 'open', 'extra', 'compensation'])
  })

  it('keeps the rows with a 補假 still to be assigned for 待排補假', () => {
    const withCompensation = [...rows, { employeeId: 'd', notTaken: 1, moved: 0, open: 1, extraGuoDates: [], items: [{ needsAction: 'assign_compensation' }] }]
    expect(withCompensation.filter((row) => ledgerRowMatchesFilter(row, 'compensation')).map((row) => row.employeeId)).toEqual(['d'])
    expect(LEDGER_FILTERS.find((filter) => filter.value === 'compensation').label).toBe('待排補假')
  })
})

describe('buildLedgerQuery', () => {
  it('keeps only the scope that is set', () => {
    expect(buildLedgerQuery({ month: '2026-09', department: 'd1', subDepartment: 's1', includeSelf: true }))
      .toBe('month=2026-09&department=d1&subDepartment=s1&includeSelf=true')
    expect(buildLedgerQuery({ month: '2026-09' })).toBe('month=2026-09')
    expect(buildLedgerQuery()).toBe('')
  })

  it('adds the active filter and the search text for the export, and nothing for "all" or an empty search', () => {
    expect(buildLedgerQuery({ month: '2026-09', status: 'open' })).toBe('month=2026-09&status=open')
    expect(buildLedgerQuery({ month: '2026-09', status: 'notTaken', search: '  護理 甲 ' })).toBe('month=2026-09&status=notTaken&search=%E8%AD%B7%E7%90%86+%E7%94%B2')
    expect(buildLedgerQuery({ month: '2026-09', status: 'all', search: '   ' })).toBe('month=2026-09')
    expect(buildLedgerQuery({ month: '2026-09', search: 'N001' })).toBe('month=2026-09&search=N001')
  })

  it('uses filter names the server understands (待排補假 = compensation)', () => {
    expect(LEDGER_FILTERS.map((filter) => filter.value).filter((value) => value !== 'all')).toEqual(['notTaken', 'moved', 'open', 'extra', 'compensation'])
  })
})

describe('a stored resolution that clashes with a 國 on the roster', () => {
  const clash = {
    status: 'moved',
    guoDate: '2026-09-20',
    offsetDays: -5,
    holidayDate: '2026-09-25',
    resolutionConflict: true,
    resolution: { kind: 'paid', resolvedByName: '主管王' },
  }

  it('keeps the holiday state, switches to the warning color and says it needs a look', () => {
    const cell = describeLedgerCell(clash)
    expect(cell).toMatchObject({ text: '移休 09/20', type: 'warning' })
    expect(cell.tooltip).toContain('比假日早 5 天')
    expect(cell.tooltip).toContain(LEDGER_CONFLICT_TEXT)
    expect(describeLedgerCell({ status: 'rested_on_date', guoDate: '2026-09-25', resolutionConflict: true })).toMatchObject({ text: '當日休', type: 'warning' })
    expect(LEDGER_CONFLICT_TEXT).toBe('已登記處理但班表已有國，請確認')
    // 沒有衝突的格子不受影響
    expect(describeLedgerCell({ ...clash, resolutionConflict: false })).toMatchObject({ type: 'primary' })
  })

  it('can be opened (to review or delete the record) with its own button label', () => {
    expect(canRecordResolution(clash)).toBe(true)
    expect(canRecordResolution({ ...clash, resolutionConflict: false })).toBe(false)
    expect(resolveButtonLabel(clash)).toBe('檢視登記')
    expect(resolveButtonLabel({ status: 'not_taken', resolution: { kind: 'paid' } })).toBe('修改')
    expect(resolveButtonLabel({ status: 'not_taken', needsAction: 'resolve' })).toBe('登記處理')
    expect(resolveButtonLabel(undefined)).toBe('登記處理')
  })
})

describe('unscheduled holiday that is nothing to handle (part-time)', () => {
  it('is shown as information, while a real open one keeps its warning', () => {
    expect(describeLedgerCell({ status: 'not_taken', reason: 'unscheduled', needsAction: null })).toMatchObject({ text: '未休·未排班', type: 'info' })
    expect(describeLedgerCell({ status: 'not_taken', reason: 'unscheduled', needsAction: null }).tooltip).toContain('兼職')
    expect(describeLedgerCell({ status: 'not_taken', reason: 'unscheduled', needsAction: 'resolve' })).toMatchObject({ type: 'warning' })
    expect(canRecordResolution({ status: 'not_taken', reason: 'unscheduled', needsAction: null })).toBe(false)
  })
})

describe('describeResolutionAuthor', () => {
  it('names the last editor, and the first author when someone else changed it afterwards', () => {
    expect(describeResolutionAuthor({ resolvedByName: '主管王' })).toBe('主管王 登記')
    expect(describeResolutionAuthor({ resolvedByName: '主管王', createdByName: '主管王' })).toBe('主管王 登記')
    expect(describeResolutionAuthor({ resolvedByName: '主管王', createdByName: '人資李' })).toBe('主管王 登記（最初：人資李）')
    expect(describeResolutionAuthor({ createdByName: '人資李' })).toBe('人資李 登記')
    expect(describeResolutionAuthor({ resolvedByName: '', createdByName: '' })).toBe('')
    expect(describeResolutionAuthor(null)).toBe('')
  })
})

describe('canShowResolveButton', () => {
  const open = { status: 'not_taken', needsAction: 'resolve' }
  const row = { employeeId: 'b2' }

  it('needs the permission and an item that can be recorded', () => {
    expect(canShowResolveButton({ canResolve: true, role: 'admin', viewerId: 'x', row, item: open })).toBe(true)
    expect(canShowResolveButton({ canResolve: false, role: 'admin', viewerId: 'x', row, item: open })).toBe(false)
    expect(canShowResolveButton({ canResolve: true, role: 'admin', viewerId: 'x', row, item: { status: 'moved' } })).toBe(false)
    expect(canShowResolveButton()).toBe(false)
  })

  it("hides the button on the supervisor's own row only", () => {
    expect(canShowResolveButton({ canResolve: true, role: 'supervisor', viewerId: 'b2', row, item: open })).toBe(false)
    expect(canShowResolveButton({ canResolve: true, role: 'supervisor', viewerId: 'other', row, item: open })).toBe(true)
    // 管理員可以處理自己的；不知道登入者是誰時不亂藏
    expect(canShowResolveButton({ canResolve: true, role: 'admin', viewerId: 'b2', row, item: open })).toBe(true)
    expect(canShowResolveButton({ canResolve: true, role: 'supervisor', viewerId: '', row, item: open })).toBe(true)
  })
})

describe('getViewerEmployeeId', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the id saved at login, session first', () => {
    expect(getViewerEmployeeId()).toBe('')
    localStorage.setItem('employeeId', 'from-local')
    expect(getViewerEmployeeId()).toBe('from-local')
    sessionStorage.setItem('employeeId', 'from-session')
    expect(getViewerEmployeeId()).toBe('from-session')
  })

  it('ignores a stored "undefined" and survives blocked storage', () => {
    sessionStorage.setItem('employeeId', 'undefined')
    localStorage.setItem('employeeId', 'real')
    expect(getViewerEmployeeId()).toBe('real')

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getViewerEmployeeId()).toBe('')
  })
})

describe('補假、行事曆放假與個人調移欄位', () => {
  it('describes the new cell states with text', () => {
    expect(describeLedgerCell({ status: 'rested_on_date', implicit: true })).toMatchObject({ text: '依行事曆放假', type: 'success' })
    expect(describeLedgerCell({ status: 'compensated', compensation: { date: '2026-10-14', via: 'assigned' } })).toMatchObject({ text: '補假 10/14', type: 'success' })
    expect(describeLedgerCell({ status: 'compensated', compensation: { date: '2026-02-27', via: 'gov_makeup' } }).text).toBe('補假 02/27（公務機關補假日）')
    const waiting = describeLedgerCell({ status: 'not_taken', reason: 'on_rest_day', needsAction: 'assign_compensation', compensation: { id: 'c1', status: 'open', suggestedDate: '2026-10-12' } })
    expect(waiting).toMatchObject({ text: '待排補假', type: 'danger' })
    expect(waiting.tooltip).toContain('系統建議 10/12')
    expect(describeLedgerCell({ status: 'rested_on_date', guoDate: '2026-10-10', compensation: { date: '2026-10-14', via: 'assigned', conflict: true } }))
      .toMatchObject({ text: '補假 10/14（班表已變更，請確認）', type: 'warning' })
  })

  it('warns when the assigned 補假 date itself became a rest day, and keeps the 修改補假 button', () => {
    const item = { status: 'compensated', compensation: { date: '2026-10-14', via: 'assigned', compensationId: 'c1', conflict: true, conflictReason: 'date_not_workday' } }
    const cell = describeLedgerCell(item)
    expect(cell).toMatchObject({ text: '補假 10/14（班表已變更，請確認）', type: 'warning' })
    expect(cell.tooltip).toBe('補假日 10/14 現在是休息日／例假（不是原本要上班的日子），員工並沒有因此多休一天，請改排其他上班日')
    expect(canShowCompensationButton({ canResolve: true, row: { employeeId: 'a' }, item })).toBe(true)
  })

  it('notes a column that exists only because of a personal swap', () => {
    expect(describeHolidayHeader({ name: '教師節', date: '2026-09-28', personal: true }).note).toBe('個人調移')
  })

  it('offers 排定補假 for an open obligation or an assigned 補假, with the same scope rules as resolutions', () => {
    const row = { employeeId: 'a' }
    const waiting = { needsAction: 'assign_compensation', compensation: { id: 'c1', status: 'open' } }
    const assigned = { status: 'compensated', compensation: { via: 'assigned', compensationId: 'c1', date: '2026-10-14' } }
    expect(canShowCompensationButton({ canResolve: true, row, item: waiting })).toBe(true)
    expect(canShowCompensationButton({ canResolve: true, row, item: assigned })).toBe(true)
    expect(canShowCompensationButton({ canResolve: true, row, item: { status: 'compensated', compensation: { via: 'gov_makeup', date: '2026-02-27' } } })).toBe(false)
    expect(canShowCompensationButton({ canResolve: true, row, item: { needsAction: 'assign_compensation', compensation: null } })).toBe(false)
    expect(canShowCompensationButton({ canResolve: false, row, item: waiting })).toBe(false)
    expect(canShowCompensationButton({ canResolve: true, role: 'supervisor', viewerId: 'a', row, item: waiting })).toBe(false)
    expect(canShowSwapButton({ canResolve: true, role: 'supervisor', viewerId: 'a', row })).toBe(false)
    expect(canShowSwapButton({ canResolve: true, role: 'admin', viewerId: 'a', row })).toBe(true)
    expect(compensationReasonText({ reason: 'on_regular_rest' })).toBe('適逢例假')
    expect(compensationReasonText({ reason: 'on_rest_day' })).toBe('適逢休息日')
  })

  it('refuses a personal swap without the employee\'s own consent and builds the request body', () => {
    const form = { employee: 'a', originalDate: '2026-09-28', targetDate: '2026-10-05', consentMethod: 'signature', consentedAt: '2026-09-15', evidenceRef: ' 同意書 01 ', reason: ' 連休 ', consentNote: '' }
    expect(validateSwapForm(form)).toBe('')
    expect(validateSwapForm({ ...form, evidenceRef: '  ' })).toBe(CONSENT_REQUIRED_TEXT)
    expect(validateSwapForm({ ...form, consentedAt: '' })).toBe(CONSENT_REQUIRED_TEXT)
    expect(validateSwapForm({ ...form, targetDate: '' })).toBe('請選擇調移到的日期')
    expect(validateSwapForm({ ...form, targetDate: '2026-09-28' })).toBe('調移日不能和原國定假日相同')
    expect(buildSwapBody(form)).toEqual({
      employee: 'a',
      originalDate: '2026-09-28',
      targetDate: '2026-10-05',
      reason: '連休',
      consent: { method: 'signature', consentedAt: '2026-09-15', evidenceRef: '同意書 01', note: '' },
    })
  })
})
