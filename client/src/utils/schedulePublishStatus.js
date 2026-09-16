// Pure publish/finalize status logic extracted from Schedule.vue so it can be
// unit-tested directly. These functions must stay side-effect-free: Schedule.vue
// passes in the reactive values it already tracks (rawSchedules list, publish
// snapshot, isPublishing/isFinalizing flags) instead of these functions reading
// refs directly.

const STATUS_LABELS = {
  draft: '尚未發布',
  pending: '待員工確認',
  ready: '可完成發布',
  disputed: '需處理異議',
  finalized: '已完成發布',
}

/**
 * Derives the publish/response status of a month's schedules purely from the
 * raw ShiftSchedule rows, without relying on a server-computed snapshot.
 * Used as the fallback when no publish snapshot is available yet.
 */
export function buildPublishSummaryFromRawSchedules(rawSchedules) {
  const result = {
    status: 'draft',
    pendingEmployees: [],
    disputedEmployees: [],
    publishedAt: null,
    hasSchedules: false,
    totalEmployees: 0,
    allEmployeesConfirmed: false,
  }

  const list = Array.isArray(rawSchedules) ? rawSchedules : []
  if (!list.length) return result

  result.hasSchedules = true
  const employeeMap = new Map()
  let latestPublishedAt = null
  let hasPublished = false
  let hasDisputed = false
  let hasFinalized = false

  list.forEach(item => {
    if (!item) return
    const state = item.state || 'draft'
    const response = item.employeeResponse || 'pending'
    const employee = item.employee || {}
    const rawId = employee?._id ?? employee?.id ?? item.employee
    const id = rawId ? String(rawId) : ''
    const name = employee?.name || item.employeeName || id

    if (state !== 'draft') hasPublished = true
    if (state === 'changes_requested' || response === 'disputed') hasDisputed = true
    if (state === 'finalized') hasFinalized = true

    if (item?.publishedAt) {
      const published = new Date(item.publishedAt)
      if (!Number.isNaN(published.getTime())) {
        if (!latestPublishedAt || latestPublishedAt < published) {
          latestPublishedAt = published
        }
      }
    }

    if (!id) return
    if (!employeeMap.has(id)) {
      employeeMap.set(id, {
        id,
        name: name || id,
        pendingCount: 0,
        disputedCount: 0,
        latestNote: '',
        latestResponseAt: null,
        disputes: [],
      })
    }

    const entry = employeeMap.get(id)
    if (state === 'pending_confirmation' && response === 'pending') {
      entry.pendingCount += 1
    }
    if (response === 'disputed' || state === 'changes_requested') {
      entry.disputedCount += 1
      if (item?.responseNote) {
        entry.latestNote = item.responseNote
      }
      entry.disputes.push({
        date: item.date,
        note: item.responseNote || '',
        responseAt: item.responseAt,
      })
    }
    if (item?.responseAt) {
      const responded = new Date(item.responseAt)
      if (!Number.isNaN(responded.getTime())) {
        if (!entry.latestResponseAt || entry.latestResponseAt < responded) {
          entry.latestResponseAt = responded
        }
      }
    }
  })

  const pendingEmployees = []
  const disputedEmployees = []

  employeeMap.forEach(entry => {
    if (entry.pendingCount > 0) {
      pendingEmployees.push({
        id: entry.id,
        name: entry.name,
        pendingCount: entry.pendingCount,
      })
    }
    if (entry.disputedCount > 0) {
      disputedEmployees.push({
        id: entry.id,
        name: entry.name,
        disputedCount: entry.disputedCount,
        latestNote: entry.latestNote,
        latestResponseAt: entry.latestResponseAt
          ? entry.latestResponseAt.toISOString()
          : null,
        disputes: entry.disputes,
      })
    }
  })

  result.pendingEmployees = pendingEmployees
  result.disputedEmployees = disputedEmployees
  result.totalEmployees = employeeMap.size
  result.publishedAt = latestPublishedAt ? latestPublishedAt.toISOString() : null

  if (hasFinalized) {
    result.status = 'finalized'
  } else if (hasDisputed) {
    result.status = 'disputed'
  } else if (hasPublished) {
    result.status = pendingEmployees.length ? 'pending' : 'ready'
  } else {
    result.status = 'draft'
  }

  result.allEmployeesConfirmed =
    result.status === 'ready' &&
    pendingEmployees.length === 0 &&
    disputedEmployees.length === 0

  return result
}

/**
 * Merges a server-provided publish snapshot over the raw-schedule-derived
 * fallback summary, field by field, falling back to the derived value for
 * any field the snapshot omits or sends with the wrong type.
 */
export function resolvePublishSummary(rawSchedules, publishSnapshot) {
  const fallbackSummary = buildPublishSummaryFromRawSchedules(rawSchedules)

  if (!publishSnapshot) return fallbackSummary

  const snapshot = publishSnapshot
  const status =
    typeof snapshot.status === 'string' && snapshot.status
      ? snapshot.status
      : fallbackSummary.status
  const pendingEmployees = Array.isArray(snapshot.pendingEmployees)
    ? snapshot.pendingEmployees
    : fallbackSummary.pendingEmployees
  const disputedEmployees = Array.isArray(snapshot.disputedEmployees)
    ? snapshot.disputedEmployees
    : fallbackSummary.disputedEmployees
  const hasSchedules =
    typeof snapshot.hasSchedules === 'boolean'
      ? snapshot.hasSchedules
      : fallbackSummary.hasSchedules
  const totalEmployees = Number.isFinite(snapshot.totalEmployees)
    ? snapshot.totalEmployees
    : fallbackSummary.totalEmployees
  const allEmployeesConfirmed =
    typeof snapshot.allEmployeesConfirmed === 'boolean'
      ? snapshot.allEmployeesConfirmed
      : fallbackSummary.allEmployeesConfirmed

  return {
    status,
    pendingEmployees,
    disputedEmployees,
    publishedAt: snapshot.publishedAt || fallbackSummary.publishedAt || null,
    hasSchedules,
    totalEmployees,
    allEmployeesConfirmed,
  }
}

export function getPublishStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.draft
}

export function getPendingCount(summary) {
  return (summary?.pendingEmployees || []).reduce(
    (total, emp) => total + (Number(emp?.pendingCount) || 0),
    0
  )
}

export function getDisputedCount(summary) {
  return (summary?.disputedEmployees || []).reduce(
    (total, emp) => total + (Number(emp?.disputedCount) || 0),
    0
  )
}

export function getPublishStepIndex(summary) {
  const status = summary?.status
  if (status === 'pending') return 1
  if (status === 'disputed') return 2
  if (status === 'ready' || status === 'finalized') return 3
  return 0
}

export function getStepStatuses(summary) {
  const status = summary?.status
  const hasPending = getPendingCount(summary) > 0
  const hasDisputed = getDisputedCount(summary) > 0
  return {
    draft: status === 'draft' ? 'process' : 'finish',
    pending:
      status === 'draft'
        ? 'wait'
        : hasPending || status === 'pending'
          ? 'process'
          : 'finish',
    disputed:
      hasDisputed
        ? 'error'
        : status === 'draft' || status === 'pending'
          ? 'wait'
          : 'finish',
    finalized:
      status === 'finalized'
        ? 'success'
        : status === 'ready'
          ? 'process'
          : 'wait',
  }
}

export function getPendingStepDescription(summary) {
  if (!summary?.hasSchedules) return '尚未發送確認'
  const pendingCount = getPendingCount(summary)
  if (pendingCount > 0) {
    return `${pendingCount} 筆待回覆`
  }
  return '員工已完成回覆'
}

export function getDisputeStepDescription(summary) {
  if (!summary?.hasSchedules) return '尚未進入異議流程'
  const disputedCount = getDisputedCount(summary)
  if (disputedCount > 0) {
    return `${disputedCount} 筆異議待處理`
  }
  return '無異議紀錄'
}

export function getFinalStepDescription(summary) {
  if (summary?.status === 'finalized') return '班表已鎖定'
  if (summary?.status === 'ready') return '可執行最終發布'
  return '等待完成發布'
}

export function getPublishProgress(summary) {
  if (summary?.status === 'finalized') return 100
  const total = summary?.totalEmployees
  if (!total || total <= 0) {
    return summary?.status === 'draft' ? 0 : 20
  }
  const responded = Math.max(
    total - (summary?.pendingEmployees?.length || 0),
    0
  )
  const percentage = Math.round((responded / total) * 100)
  return Math.min(Math.max(percentage, 0), 100)
}

export function isPublishDisabled(summary, isPublishing) {
  return Boolean(
    isPublishing ||
    !summary?.hasSchedules ||
    summary?.status === 'finalized'
  )
}

export function isFinalizeDisabled(summary, isFinalizing) {
  return Boolean(isFinalizing || summary?.status !== 'ready')
}

export function getPublishDisabledReason(summary, isPublishing) {
  if (!isPublishDisabled(summary, isPublishing)) return ''
  if (isPublishing) return '系統正在送出中，請稍候。'
  if (!summary?.hasSchedules) return '目前範圍沒有可發布班表，請先確認本月是否已完成排班。'
  if (summary?.status === 'finalized') return '本月班表已完成發布並鎖定。'
  return '目前不符合發送條件。'
}

export function getFinalizeDisabledReason(summary, isFinalizing) {
  if (!isFinalizeDisabled(summary, isFinalizing)) return ''
  if (isFinalizing) return '系統正在完成發布，請稍候。'
  if (!summary?.hasSchedules) return '尚未發送待確認，請先執行「發送待確認」。'
  if (summary?.status === 'finalized') return '班表已完成發布。'
  if (summary?.status === 'pending') return '仍有員工尚未回覆，請先完成確認。'
  if (summary?.status === 'disputed') return '仍有員工提出異議，請先處理異議。'
  return '尚未達到完成發布條件。'
}
