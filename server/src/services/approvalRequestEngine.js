// 簽核單的關卡狀態機（純函式，直接改傳進來的 doc；不存檔、不碰資料庫）。
// 控制器負責載入 / 存檔 / 重試，這裡只決定「這一步之後單子會變成什麼樣子」，方便單獨測試。
//
// 關卡規則：
// - 一關「完成」＝沒有人還在 pending。需全員同意 → 每個人都簽過；
//   任一人同意（all_must_approve === false）→ 只要有一人核可，其餘 pending 的人記為 skipped（免簽），
//   不再把沒簽的人記成「已核可」。
// - 沒有簽核人的關卡（選填關卡解析不到人）不論在第幾關都直接略過，並留下 skip 紀錄。
// - 退簽回到「前一個有簽核人的關卡」；前面都沒有人就退回申請者。
// - 重新進入某一關（退簽回來、重新送出）時，這一關先前的決議全部清掉重簽。

export const PENDING = 'pending'

function now() {
  return new Date()
}

export function hasPendingApprover(step) {
  return (step?.approvers || []).some(approver => approver.decision === PENDING)
}

/** 這一關是否已完成（可以進入下一關） */
export function isStepComplete(step) {
  if (!step) return false
  const approvers = step.approvers || []
  if (approvers.length === 0) return true
  // 任一人同意：有人核可就算完成；沒人還在 pending（例如管理員代為處理）也算完成
  if (step.all_must_approve === false && approvers.some(approver => approver.decision === 'approved')) return true
  return approvers.every(approver => approver.decision !== PENDING)
}

/** 任一人同意的關卡：已有人核可後，把其餘還沒簽的人標成 skipped（免簽） */
export function skipRemainingApprovers(step, { at = now(), comment = '同關已由他人核可' } = {}) {
  let changed = 0
  for (const approver of step.approvers || []) {
    if (approver.decision !== PENDING) continue
    approver.decision = 'skipped'
    approver.comment = comment
    approver.decided_at = at
    changed += 1
  }
  return changed
}

export function resetStepDecisions(step) {
  for (const approver of step.approvers || []) {
    approver.decision = PENDING
    approver.comment = undefined
    approver.decided_at = undefined
  }
}

/** 進入某一關：標記為目前關卡；若上一輪留有決議（退簽回來）就全部清掉重簽 */
export function enterStep(doc, index, at = now()) {
  const step = doc.steps[index]
  doc.current_step_index = index
  step.started_at = at
  step.finished_at = undefined
  if ((step.approvers || []).some(approver => approver.decision !== PENDING)) {
    resetStepDecisions(step)
  }
  return step
}

// 從 fromIndex 開始往後找第一個有簽核人的關卡；沒有簽核人的關卡略過；走完了就結案
function settleFrom(doc, fromIndex, { at, logMove }) {
  for (let index = fromIndex; index < doc.steps.length; index += 1) {
    const step = enterStep(doc, index, at)
    if ((step.approvers || []).length > 0) {
      if (logMove) doc.logs.push({ action: 'move_next', message: `進入第 ${index + 1} 關`, step_order: index + 1 })
      return {
        completed: false,
        nextApprovers: step.approvers.map(approver => approver.approver),
      }
    }
    step.finished_at = at
    doc.logs.push({ action: 'skip', message: `第 ${index + 1} 關沒有簽核人，已自動略過`, step_order: index + 1 })
    logMove = true
  }
  doc.status = 'approved'
  doc.logs.push({ action: 'finish', message: '全部完成' })
  return { completed: true, nextApprovers: [] }
}

/** 建立單子後進入第一個有簽核人的關卡（前面沒有人的選填關卡略過）；全部沒人會直接結案 */
export function startRequest(doc, at = now()) {
  doc.status = PENDING
  if (!doc.steps.length) {
    doc.status = 'approved'
    doc.logs.push({ action: 'finish', message: '全部完成' })
    return { completed: true, nextApprovers: [] }
  }
  return settleFrom(doc, 0, { at, logMove: false })
}

/**
 * 目前關卡完成後往下走。目前關卡還沒完成回傳 { completed: false, nextApprovers: [] }，
 * 沒有任何變動；完成後略過沒有簽核人的關卡，走完所有關卡就把單子設為 approved。
 */
export function advanceApprovalState(doc, at = now()) {
  const index = doc.current_step_index
  const step = doc.steps[index]
  if (!step || !isStepComplete(step)) return { completed: false, nextApprovers: [] }
  if (step.all_must_approve === false) skipRemainingApprovers(step, { at })
  step.finished_at = at
  return settleFrom(doc, index + 1, { at, logMove: true })
}

/**
 * 退簽：退回到前一個有簽核人的關卡（重簽）；前面沒有人就退回申請者（status = returned）。
 * 被退出的這一關 started_at / finished_at 清掉；它的決議（含退簽人的意見）保留到重新進入時才清除，
 * 這樣退簽人會留在「我已簽核」歷史，退簽原因也看得到。
 */
export function applyReturn(doc, index, at = now()) {
  const step = doc.steps[index]
  step.started_at = undefined
  step.finished_at = undefined

  let target = index - 1
  while (target >= 0 && (doc.steps[target].approvers || []).length === 0) target -= 1
  if (target < 0) {
    doc.status = 'returned'
    return { toApplicant: true, targetIndex: null }
  }
  resetStepDecisions(doc.steps[target])
  enterStep(doc, target, at)
  return { toApplicant: false, targetIndex: target }
}

/** 重新送出：所有關卡的決議清空，從第一個有簽核人的關卡重新開始 */
export function restartRequest(doc, at = now()) {
  doc.steps.forEach((step) => {
    resetStepDecisions(step)
    step.started_at = undefined
    step.finished_at = undefined
  })
  return startRequest(doc, at)
}

export default {
  PENDING,
  hasPendingApprover,
  isStepComplete,
  skipRemainingApprovers,
  resetStepDecisions,
  enterStep,
  startRequest,
  advanceApprovalState,
  applyReturn,
  restartRequest,
}
