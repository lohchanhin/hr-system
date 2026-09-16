import { describe, it, expect } from 'vitest'
import {
  buildPublishSummaryFromRawSchedules,
  resolvePublishSummary,
  getPublishStatusLabel,
  getPendingCount,
  getDisputedCount,
  getPublishStepIndex,
  getStepStatuses,
  getPendingStepDescription,
  getDisputeStepDescription,
  getFinalStepDescription,
  getPublishProgress,
  isPublishDisabled,
  isFinalizeDisabled,
  getPublishDisabledReason,
  getFinalizeDisabledReason,
} from '../schedulePublishStatus.js'

function scheduleRow(overrides = {}) {
  return {
    employee: { _id: 'e1', name: 'Alice' },
    state: 'draft',
    employeeResponse: 'pending',
    date: '2026-09-01',
    ...overrides,
  }
}

describe('buildPublishSummaryFromRawSchedules', () => {
  it('returns the empty draft summary when there are no schedules', () => {
    expect(buildPublishSummaryFromRawSchedules([])).toEqual({
      status: 'draft',
      pendingEmployees: [],
      disputedEmployees: [],
      publishedAt: null,
      hasSchedules: false,
      totalEmployees: 0,
      allEmployeesConfirmed: false,
    })
    expect(buildPublishSummaryFromRawSchedules(null)).toEqual(
      buildPublishSummaryFromRawSchedules([])
    )
  })

  it('reports draft status while every row is still in draft state', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow(), scheduleRow({ employee: { _id: 'e2', name: 'Bob' } }),
    ])
    expect(summary.status).toBe('draft')
    expect(summary.hasSchedules).toBe(true)
    expect(summary.totalEmployees).toBe(2)
  })

  it('reports "ready" once published with no pending or disputed responses left', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({ state: 'pending_confirmation', employeeResponse: 'confirmed' }),
    ])
    expect(summary.status).toBe('ready')
    expect(summary.allEmployeesConfirmed).toBe(true)
  })

  it('reports "pending" and lists the pending employee with their pending count', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({ state: 'pending_confirmation', employeeResponse: 'pending' }),
      scheduleRow({ state: 'pending_confirmation', employeeResponse: 'pending' }),
    ])
    expect(summary.status).toBe('pending')
    expect(summary.pendingEmployees).toEqual([
      { id: 'e1', name: 'Alice', pendingCount: 2 },
    ])
    expect(summary.allEmployeesConfirmed).toBe(false)
  })

  it('reports "disputed" and records the dispute note/date when an employee disputes', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({
        state: 'changes_requested',
        employeeResponse: 'disputed',
        date: '2026-09-05',
        responseNote: '這天我請假了',
        responseAt: '2026-09-04T10:00:00.000Z',
      }),
    ])
    expect(summary.status).toBe('disputed')
    expect(summary.disputedEmployees).toEqual([{
      id: 'e1',
      name: 'Alice',
      disputedCount: 1,
      latestNote: '這天我請假了',
      latestResponseAt: '2026-09-04T10:00:00.000Z',
      disputes: [{ date: '2026-09-05', note: '這天我請假了', responseAt: '2026-09-04T10:00:00.000Z' }],
    }])
  })

  it('prioritizes finalized over disputed/pending status when any row is finalized', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({ state: 'finalized', employeeResponse: 'confirmed' }),
      scheduleRow({ state: 'changes_requested', employeeResponse: 'disputed', employee: { _id: 'e2' } }),
    ])
    expect(summary.status).toBe('finalized')
  })

  it('tracks the latest publishedAt across all rows', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({ publishedAt: '2026-09-01T00:00:00.000Z' }),
      scheduleRow({ publishedAt: '2026-09-03T00:00:00.000Z', employee: { _id: 'e2' } }),
      scheduleRow({ publishedAt: '2026-09-02T00:00:00.000Z', employee: { _id: 'e3' } }),
    ])
    expect(summary.publishedAt).toBe('2026-09-03T00:00:00.000Z')
  })

  it('ignores an invalid publishedAt/responseAt instead of crashing on toISOString()', () => {
    // Regression guard: a malformed date string used to be let through by a
    // `Number.isNaN(dateObject)` check that can never be true for a Date
    // instance (it needs `.getTime()`), so an Invalid Date could reach
    // `.toISOString()` and throw, breaking the whole publish-status computed.
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({
        publishedAt: 'not-a-real-date',
        responseAt: 'also-not-a-date',
        employeeResponse: 'disputed',
        state: 'changes_requested',
      }),
    ])
    expect(summary.publishedAt).toBeNull()
    expect(summary.disputedEmployees[0].latestResponseAt).toBeNull()
  })

  it('skips rows with no resolvable employee id when building the per-employee map', () => {
    const summary = buildPublishSummaryFromRawSchedules([
      scheduleRow({ employee: null }),
    ])
    expect(summary.totalEmployees).toBe(0)
    // The row still counts toward hasPublished/hasSchedules even without an id.
    expect(summary.hasSchedules).toBe(true)
  })
})

describe('resolvePublishSummary', () => {
  const rawSchedules = [scheduleRow({ state: 'pending_confirmation', employeeResponse: 'pending' })]

  it('falls back entirely to the raw-schedule-derived summary when there is no snapshot', () => {
    expect(resolvePublishSummary(rawSchedules, null)).toEqual(
      buildPublishSummaryFromRawSchedules(rawSchedules)
    )
  })

  it('prefers snapshot fields over the fallback when they are present and well-typed', () => {
    const result = resolvePublishSummary(rawSchedules, {
      status: 'finalized',
      pendingEmployees: [],
      disputedEmployees: [],
      hasSchedules: true,
      totalEmployees: 5,
      allEmployeesConfirmed: true,
      publishedAt: '2026-09-10T00:00:00.000Z',
    })
    expect(result).toEqual({
      status: 'finalized',
      pendingEmployees: [],
      disputedEmployees: [],
      publishedAt: '2026-09-10T00:00:00.000Z',
      hasSchedules: true,
      totalEmployees: 5,
      allEmployeesConfirmed: true,
    })
  })

  it('falls back field-by-field when the snapshot sends the wrong type for a field', () => {
    const fallback = buildPublishSummaryFromRawSchedules(rawSchedules)
    const result = resolvePublishSummary(rawSchedules, {
      status: 123, // wrong type -> fallback
      pendingEmployees: 'not-an-array', // wrong type -> fallback
      totalEmployees: 'five', // not finite -> fallback
    })
    expect(result.status).toBe(fallback.status)
    expect(result.pendingEmployees).toEqual(fallback.pendingEmployees)
    expect(result.totalEmployees).toBe(fallback.totalEmployees)
  })
})

describe('publish status label / counts / step derivations', () => {
  it('maps every known status to its Chinese label, defaulting to draft for unknown values', () => {
    expect(getPublishStatusLabel('draft')).toBe('尚未發布')
    expect(getPublishStatusLabel('pending')).toBe('待員工確認')
    expect(getPublishStatusLabel('ready')).toBe('可完成發布')
    expect(getPublishStatusLabel('disputed')).toBe('需處理異議')
    expect(getPublishStatusLabel('finalized')).toBe('已完成發布')
    expect(getPublishStatusLabel('unknown')).toBe('尚未發布')
  })

  it('sums pendingCount/disputedCount across all listed employees', () => {
    const summary = { pendingEmployees: [{ pendingCount: 2 }, { pendingCount: 3 }], disputedEmployees: [{ disputedCount: 1 }] }
    expect(getPendingCount(summary)).toBe(5)
    expect(getDisputedCount(summary)).toBe(1)
  })

  it.each([
    ['draft', 0], ['pending', 1], ['disputed', 2], ['ready', 3], ['finalized', 3], ['unknown', 0],
  ])('maps status %s to step index %i', (status, expected) => {
    expect(getPublishStepIndex({ status })).toBe(expected)
  })

  it('marks the disputed step as an error state whenever any dispute exists, even after finalization', () => {
    const summary = { status: 'finalized', disputedEmployees: [{ disputedCount: 1 }], pendingEmployees: [] }
    expect(getStepStatuses(summary).disputed).toBe('error')
  })

  it('describes the pending/dispute/final steps based on counts and status', () => {
    const noSchedules = { hasSchedules: false, pendingEmployees: [], disputedEmployees: [], status: 'draft' }
    expect(getPendingStepDescription(noSchedules)).toBe('尚未發送確認')
    expect(getDisputeStepDescription(noSchedules)).toBe('尚未進入異議流程')
    expect(getFinalStepDescription(noSchedules)).toBe('等待完成發布')

    const withPending = { hasSchedules: true, pendingEmployees: [{ pendingCount: 3 }], disputedEmployees: [], status: 'pending' }
    expect(getPendingStepDescription(withPending)).toBe('3 筆待回覆')

    const ready = { hasSchedules: true, pendingEmployees: [], disputedEmployees: [], status: 'ready' }
    expect(getPendingStepDescription(ready)).toBe('員工已完成回覆')
    expect(getFinalStepDescription(ready)).toBe('可執行最終發布')

    const finalized = { status: 'finalized' }
    expect(getFinalStepDescription(finalized)).toBe('班表已鎖定')
  })

  it('computes publish progress from responded/total employees, clamped to [0,100]', () => {
    expect(getPublishProgress({ status: 'finalized' })).toBe(100)
    expect(getPublishProgress({ status: 'draft', totalEmployees: 0 })).toBe(0)
    expect(getPublishProgress({ status: 'pending', totalEmployees: 0 })).toBe(20)
    expect(getPublishProgress({ status: 'pending', totalEmployees: 4, pendingEmployees: [{}, {}] })).toBe(50)
    expect(getPublishProgress({ status: 'ready', totalEmployees: 4, pendingEmployees: [] })).toBe(100)
  })
})

describe('publish/finalize button gating', () => {
  it('disables publish while a request is in flight, with no schedules, or once finalized', () => {
    expect(isPublishDisabled({ hasSchedules: true, status: 'draft' }, true)).toBe(true)
    expect(isPublishDisabled({ hasSchedules: false, status: 'draft' }, false)).toBe(true)
    expect(isPublishDisabled({ hasSchedules: true, status: 'finalized' }, false)).toBe(true)
    expect(isPublishDisabled({ hasSchedules: true, status: 'draft' }, false)).toBe(false)
  })

  it('only enables finalize once status is exactly "ready" and not already finalizing', () => {
    expect(isFinalizeDisabled({ status: 'ready' }, true)).toBe(true)
    expect(isFinalizeDisabled({ status: 'pending' }, false)).toBe(true)
    expect(isFinalizeDisabled({ status: 'ready' }, false)).toBe(false)
  })

  it('gives a specific reason for each publish-disabled cause, in priority order', () => {
    expect(getPublishDisabledReason({ hasSchedules: true, status: 'draft' }, true))
      .toBe('系統正在送出中，請稍候。')
    expect(getPublishDisabledReason({ hasSchedules: false, status: 'draft' }, false))
      .toBe('目前範圍沒有可發布班表，請先確認本月是否已完成排班。')
    expect(getPublishDisabledReason({ hasSchedules: true, status: 'finalized' }, false))
      .toBe('本月班表已完成發布並鎖定。')
    expect(getPublishDisabledReason({ hasSchedules: true, status: 'draft' }, false)).toBe('')
  })

  it('gives a specific reason for each finalize-disabled cause, in priority order', () => {
    expect(getFinalizeDisabledReason({ status: 'ready', hasSchedules: true }, true))
      .toBe('系統正在完成發布，請稍候。')
    expect(getFinalizeDisabledReason({ status: 'draft', hasSchedules: false }, false))
      .toBe('尚未發送待確認，請先執行「發送待確認」。')
    expect(getFinalizeDisabledReason({ status: 'finalized', hasSchedules: true }, false))
      .toBe('班表已完成發布。')
    expect(getFinalizeDisabledReason({ status: 'pending', hasSchedules: true }, false))
      .toBe('仍有員工尚未回覆，請先完成確認。')
    expect(getFinalizeDisabledReason({ status: 'disputed', hasSchedules: true }, false))
      .toBe('仍有員工提出異議，請先處理異議。')
    expect(getFinalizeDisabledReason({ status: 'ready', hasSchedules: true }, false)).toBe('')
  })
})
