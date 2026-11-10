// 簽核申請單明細共用：狀態文字、附件下載、欄位內容與簽核紀錄整理成可讀文字
// （簽核頁的「申請單明細」與排班頁引用的 ApprovalDetailContent 共用）

import { apiFetch } from '../api'
import { readApiError } from './approvalErrors'
import { formatFormValue, formatTaipeiDateTime, isBlankValue } from './approvalDisplay'
import { approvalStatusTagType, approvalStatusText } from './approvalStatus'

// 狀態的文字與標籤顏色定義在 utils/approvalStatus.js（排班頁的相關簽核、調休存摺也用同一份）
export function getStatusText(status) {
  return approvalStatusText(status)
}

export function getStatusTagType(status) {
  return approvalStatusTagType(status)
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
  // 調休單核准時從調休存摺扣用（失敗時請人資手動調整）
  comp_leave: '調休扣用',
  comp_leave_error: '調休扣用失敗',
  // 主管關卡找不到可簽核的主管，改由最高層簽核人（預設是系統管理員）簽核
  approver_fallback: '無上級主管改送',
  // 請假長度條件（例如請假滿 56 小時才需要）不符合，這一關不送；讀不到請假長度時照常簽核
  step_not_applicable: '關卡不適用',
  step_condition: '關卡照常簽核',
  // 已是前面關卡簽核人的人，後面的關卡不再重複簽（主管鏈一律、其他關卡依通用流程規則）
  skip_repeated_approver: '略過重複簽核人',
  // 主管鏈往上找時略過離職、停用、留職停薪的主管等說明
  manager_chain: '主管鏈',
}

export function actionLabel(action) {
  return ACTION_LABELS[action] || action || '-'
}

/* -------------------- 關卡名稱（主管鏈：第n級主管） -------------------- */

/** 單據上一關的標題：「第 2 關」；有名稱（主管鏈展開的「第n級主管」）時「第 2 關・第2級主管」 */
export function requestStepTitle(step, index) {
  const name = typeof step?.name === 'string' ? step.name.trim() : ''
  return name ? `第 ${index + 1} 關・${name}` : `第 ${index + 1} 關`
}

/** 單據上一關的說明（主管鏈略過離職的主管等）；沒有說明時回傳空字串 */
export function requestStepNote(step) {
  return typeof step?.note === 'string' ? step.note.trim() : ''
}

/* -------------------- 流程預覽：主管鏈、條件、略過重複 -------------------- */

/**
 * 主管鏈關卡的預覽文字（GET /forms/:id/workflow 的 chain_levels 只有級數、沒有姓名）：
 * 「主管鏈：第1級主管 → 第2級主管（到持有「一般假單決行」標籤的主管為止）」；已是前面關卡簽核人的那一級不列出。
 */
export function describeChainPreview(step) {
  const config = step?.approver_value && typeof step.approver_value === 'object' && !Array.isArray(step.approver_value) ? step.approver_value : {}
  const tag = typeof config.stopAtTag === 'string' ? config.stopAtTag.trim() : ''
  const limit = Number(config.maxLevels) || 5
  const scope = tag ? `到持有「${tag}」標籤的主管為止，最多 ${limit} 級` : `最多 ${limit} 級`
  const levels = Array.isArray(step?.chain_levels) ? step.chain_levels.filter(level => level && !level.repeated) : []
  if (!levels.length) return `主管鏈（${scope}）`
  return `主管鏈：${levels.map(level => level.label || `第${level.level}級主管`).join(' → ')}（${scope}）`
}

/** 有請假長度條件的關卡：「請假滿 56 小時才需要」；沒有條件回傳空字串 */
export function describeStepConditionPreview(step) {
  return typeof step?.condition_text === 'string' ? step.condition_text.trim() : ''
}

/** 略過重複簽核人的預覽說明；沒有重複時回傳空字串 */
export function describeRepeatPreview(step) {
  if (step?.skipped_as_repeat) return '這一關的簽核人都已在前面的關卡簽核，送出時會自動略過'
  const count = Number(step?.repeated_count) || 0
  return count ? `已在前面關卡簽核的 ${count} 位不會重複簽核` : ''
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
    const embedded = log.by_employee && typeof log.by_employee === 'object' ? log.by_employee : null
    const embeddedName = embedded ? embedded.name : ''
    const actor = embeddedName || (id ? nameOf(id) : '') || '系統'
    return {
      key: `${index}-${log.action || ''}`,
      time: formatTaipeiDateTime(log.at || log.createdAt),
      actor,
      // 處理人的員工物件（頭像用）；系統自動處理的紀錄沒有人，這裡是 null
      actorPerson: id ? { ...(embedded || {}), _id: id, name: embedded?.name || nameOf(id) || '' } : null,
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
