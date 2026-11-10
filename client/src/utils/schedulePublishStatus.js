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
 *
 * 狀態的判斷順序與伺服器相同（server/src/controllers/schedule/schedulePublishSummary.js）：
 *   disputed  有異議
 *   pending / ready  有已發送、還沒完成發布的班表（有人沒回覆是 pending，都確認了是 ready）
 *   finalized 只有在沒有「還沒發送的異動」時（已完成發布之後又改的格子會回到 draft）
 *   draft     其他
 * unpublishedCount：還沒發送給員工的新增或異動（state draft、needsReconfirm 不是 false）。
 * 以前只要有一筆已完成發布就算 finalized：鎖定的月份改一格之後仍顯示已完成發布，那一格送不出去。
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
    unpublishedCount: 0,
  }

  const list = Array.isArray(rawSchedules) ? rawSchedules : []
  if (!list.length) return result

  result.hasSchedules = true
  const employeeMap = new Map()
  let latestPublishedAt = null
  let publishedOpenCount = 0
  let hasDisputed = false
  let hasFinalized = false
  let unpublishedCount = 0

  list.forEach(item => {
    if (!item) return
    const state = item.state || 'draft'
    const response = item.employeeResponse || 'pending'
    const employee = item.employee || {}
    const rawId = employee?._id ?? employee?.id ?? item.employee
    const id = rawId ? String(rawId) : ''
    const name = employee?.name || item.employeeName || id

    const disputed = state === 'changes_requested' || response === 'disputed'
    if (state === 'pending_confirmation' || state === 'changes_requested') publishedOpenCount += 1
    if (disputed) hasDisputed = true
    if (state === 'finalized') hasFinalized = true
    // 伺服器只把 needsReconfirm: true 的草稿算成未發送；畫面拿到的舊資料可能沒有這個欄位，沒有時也算
    if (state === 'draft' && item.needsReconfirm !== false) unpublishedCount += 1

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
    if (disputed) {
      entry.disputedCount += 1
      if (item?.responseNote) {
        entry.latestNote = item.responseNote
      }
      entry.disputes.push({
        date: item.date,
        note: item.responseNote || '',
        responseAt: item.responseAt,
      })
    } else if (state === 'pending_confirmation' && item.needsReconfirm !== false && response !== 'confirmed') {
      // 與伺服器相同：已發送、這一輪還沒回覆（員工已確認、或這一輪沒有重送的不算）
      entry.pendingCount += 1
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

  result.unpublishedCount = unpublishedCount

  if (hasDisputed) {
    result.status = 'disputed'
  } else if (publishedOpenCount > 0) {
    result.status = pendingEmployees.length ? 'pending' : 'ready'
  } else if (hasFinalized && unpublishedCount === 0) {
    result.status = 'finalized'
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
  // 舊版伺服器沒有 unpublishedCount：用這一頁的班表推算
  const unpublishedCount = Number.isFinite(snapshot.unpublishedCount)
    ? snapshot.unpublishedCount
    : fallbackSummary.unpublishedCount

  return {
    status,
    pendingEmployees,
    disputedEmployees,
    publishedAt: snapshot.publishedAt || fallbackSummary.publishedAt || null,
    hasSchedules,
    totalEmployees,
    allEmployeesConfirmed,
    unpublishedCount,
  }
}

/**
 * 狀態列的「有 N 筆異動尚未發送」：發送過（或完成發布過）之後又新增、修改的格子。
 * 從來沒發送過的月份不顯示（整個月都還是草稿，按鈕本身就是「發送待確認」）。
 */
export function getUnpublishedNotice(summary) {
  const count = Number(summary?.unpublishedCount) || 0
  if (count <= 0) return ''
  if (summary?.status === 'draft' && !summary?.publishedAt) return ''
  return `有 ${count} 筆異動尚未發送`
}

// 發送／完成發布失敗時的中文訊息：伺服器的中文 error 優先；舊版伺服器的英文訊息與只有 code 的回應換成中文
const PUBLISH_ERROR_BY_CODE = {
  NOTHING_TO_PUBLISH: '這個範圍的班表員工都已確認，沒有新增或異動的班表需要發送；可以直接完成發布',
  NO_SCHEDULES: '這個範圍沒有可以發送的班表，請先排班',
  NO_EMPLOYEES_IN_SCOPE: '您的排班範圍內沒有員工',
  UNCONFIRMED_EMPLOYEES: '仍有員工尚未確認或提出異議，無法完成發布',
  NOTHING_TO_FINALIZE: '沒有待完成發布的班表',
}
const PUBLISH_ERROR_BY_TEXT = {
  'no schedules found': '這個範圍沒有可以發送的班表，請先排班',
  'no employees in scope': '您的排班範圍內沒有員工',
  'unconfirmed employees': '仍有員工尚未確認或提出異議，無法完成發布',
}

export function describePublishError(data, fallback = '操作失敗') {
  const text = typeof data?.error === 'string' ? data.error.trim() : ''
  if (text && /[一-鿿]/.test(text)) return text
  if (data?.code && PUBLISH_ERROR_BY_CODE[data.code]) return PUBLISH_ERROR_BY_CODE[data.code]
  if (text && PUBLISH_ERROR_BY_TEXT[text.toLowerCase()]) return PUBLISH_ERROR_BY_TEXT[text.toLowerCase()]
  return fallback
}

/** 發送成功的訊息：updated 筆發送給員工確認；keptConfirmed 是員工已確認、這次沒有重送的筆數 */
export function describePublishSuccess(payload) {
  const updated = Number(payload?.updated)
  const kept = Number(payload?.keptConfirmed)
  const head = Number.isFinite(updated) && updated > 0
    ? `已將 ${updated} 筆班表發送給員工確認`
    : '已將班表發送給員工確認'
  return Number.isFinite(kept) && kept > 0 ? `${head}；員工已確認的 ${kept} 筆沒有變動，不必重新確認` : head
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
