// 簽核申請單明細共用：狀態文字、附件下載、欄位內容與簽核紀錄整理成可讀文字
// （簽核頁的「申請單明細」與排班頁引用的 ApprovalDetailContent 共用）

import { apiFetch } from '../api'
import { readApiError } from './approvalErrors'
import { formatFormValue, formatTaipeiDateTime, isBlankValue } from './approvalDisplay'

const STATUS_TEXT = {
  pending: '待簽核',
  approved: '已核可',
  rejected: '已否決',
  returned: '已退簽',
  canceled: '已撤回',
  skipped: '已由其他人處理',
}

export function getStatusText(status) {
  return STATUS_TEXT[status] || status || '-'
}

export function getStatusTagType(status) {
  const typeMap = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    returned: 'info',
    canceled: 'info',
    skipped: 'info',
  }
  return typeMap[status] || 'info'
}

/* -------------------- 附件 -------------------- */

export function attachmentItems(value) {
  const values = Array.isArray(value) ? value : [value]
  return values.filter(item => (
    item &&
    typeof item === 'object' &&
    typeof (item.url || item.path) === 'string'
  ))
}

export function attachmentFilename(attachment) {
  const storedPath = String(attachment?.url || attachment?.path || '').split('?')[0]
  return storedPath.split('/').filter(Boolean).pop() || ''
}

export function attachmentDisplayName(attachment) {
  const name = String(attachment?.name || attachmentFilename(attachment) || '附件')
  return name.split(/[\\/]/).pop()
}

/** 以 <a download> 下載附件（保留原檔名）；失敗時丟出中文訊息的錯誤 */
export async function downloadApprovalAttachment(requestId, attachment) {
  const filename = attachmentFilename(attachment)
  if (!requestId || !filename) return false
  const response = await apiFetch(
    `/api/approvals/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(filename)}`
  )
  if (!response.ok) throw await readApiError(response)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = attachmentDisplayName(attachment)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  return true
}

/* -------------------- 填寫內容 -------------------- */

/**
 * 明細要顯示的欄位：目前表單的欄位（含已停用但有填寫的），
 * 另外 form_data 裡有、但欄位已被刪除的資料也列出來，避免簽核人看不到申請人填的內容。
 */
export function detailFields(doc) {
  const formData = doc?.form_data && typeof doc.form_data === 'object' ? doc.form_data : {}
  const fields = Array.isArray(doc?.form?.fields) ? doc.form.fields : []
  const known = new Set(fields.map(field => String(field._id)))
  const shown = fields.filter(field => field.is_active !== false || !isBlankValue(formData[field._id]))
  const orphans = Object.keys(formData)
    .filter(key => !known.has(key) && !isBlankValue(formData[key]))
    .map(key => ({ _id: key, label: '（已移除的欄位）', type_1: 'text', orphan: true }))
  return [...shown, ...orphans]
}

export function formatDetailValue(field, value, ctx) {
  return formatFormValue(field, value, ctx)
}

/* -------------------- 簽核紀錄 -------------------- */

const ACTION_LABELS = {
  create: '送出申請',
  approve: '核可',
  reject: '否決',
  return: '退簽',
  resubmit: '重新送出',
  cancel: '撤回',
  move_next: '進入下一關',
  skip: '自動略過',
  finish: '流程完成',
  admin_override: '管理員代為處理',
  annual_leave: '特休扣減',
  annual_leave_error: '特休扣減失敗',
}

export function actionLabel(action) {
  return ACTION_LABELS[action] || action || '-'
}

function actorId(value) {
  if (value && typeof value === 'object') return String(value._id || value.id || '')
  return value ? String(value) : ''
}

/** 簽核紀錄整理成表格列（時間由舊到新） */
export function buildLogRows(doc, nameOf = () => '') {
  const logs = Array.isArray(doc?.logs) ? doc.logs : []
  return logs.map((log, index) => {
    const id = actorId(log.by_employee)
    const embeddedName = log.by_employee && typeof log.by_employee === 'object' ? log.by_employee.name : ''
    return {
      key: `${index}-${log.action || ''}`,
      time: formatTaipeiDateTime(log.at || log.createdAt),
      actor: embeddedName || (id ? nameOf(id) : '') || '系統',
      action: actionLabel(log.action),
      message: String(log.message || '').trim(),
    }
  })
}

// 系統自動產生的退簽說明（「退回申請者」「退回到第 N 關」「管理員代為退簽第 N 關」）後面接的才是簽核人寫的原因
const RETURN_MESSAGE_RE = /^(?:退回申請者|退回到第\s*\d+\s*關|管理員代為退簽第\s*\d+\s*關)(?:[：:]\s*([\s\S]*))?$/

function isReturnLog(log) {
  return log?.action === 'return' || (log?.action === 'admin_override' && log?.decision === 'return')
}

/**
 * 被退簽時，申請人要看到的退簽原因。
 * 優先用伺服器整理好的 last_return，其次最後一筆退簽紀錄（comment 為簽核人寫的原因，
 * 沒有時從 message 去掉系統前綴），再退而找各關簽核人的退簽意見。
 */
export function findReturnInfo(doc, nameOf = () => '') {
  if (doc?.status !== 'returned') return null
  const logs = Array.isArray(doc.logs) ? doc.logs : []
  const lastReturn = doc.last_return || [...logs].reverse().find(isReturnLog) || null
  const actor = lastReturn?.by || lastReturn?.by_employee
  const id = actorId(actor)
  let by = (actor && typeof actor === 'object' && actor.name) || (id ? nameOf(id) : '')
  let time = lastReturn ? formatTaipeiDateTime(lastReturn.at || lastReturn.createdAt) : ''

  let message = String(lastReturn?.comment || '').trim()
  if (!message) {
    const raw = String(lastReturn?.message || '').trim()
    const match = RETURN_MESSAGE_RE.exec(raw)
    message = match ? String(match[1] || '').trim() : raw
  }

  if (!message) {
    const steps = Array.isArray(doc.steps) ? doc.steps : []
    for (const step of steps) {
      const approvers = Array.isArray(step?.approvers) ? step.approvers : []
      const hit = approvers.find(a => a?.decision === 'returned' && String(a.comment || '').trim())
      if (hit) {
        message = String(hit.comment).trim()
        by = by || hit.approver?.name || nameOf(actorId(hit.approver))
        time = time || formatTaipeiDateTime(hit.decided_at)
        break
      }
    }
  }
  return { by: by || '', message, time }
}
