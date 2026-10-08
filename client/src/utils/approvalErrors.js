// 簽核頁共用：把伺服器回應 / 網路錯誤轉成給使用者看的繁體中文訊息

export const NETWORK_ERROR_MESSAGE = '網路連線異常，請確認網路後再試一次'
export const GENERIC_ERROR_MESSAGE = '操作失敗，請稍後再試，若持續發生請聯絡管理員'

const HAS_CHINESE_RE = /[㐀-鿿＀-￯]/

// 伺服器仍可能回傳的英文訊息（含 Mongoose 訊息）對應的中文說明
const ENGLISH_MESSAGES = new Map([
  ['not found', '找不到這筆資料，可能已被處理或刪除，請重新整理'],
  ['forbidden', '您沒有權限執行此操作'],
  ['invalid user', '登入狀態已失效，請重新登入'],
  ['not pending', '此單已不是待簽核狀態，請重新整理'],
  ['not step approver or already acted', '此單已被處理，或已不在您的簽核關卡，請重新整理'],
  ['approval request changed; reload and retry', '此單已被處理，請重新整理'],
  ['return not allowed', '此關卡不允許退簽'],
  ['form not available', '此表單已停用，無法送出申請'],
  ['form not found', '找不到申請表單，請重新選擇'],
  ['form_id required', '請先選擇表單樣板'],
  ['workflow not configured', '此表單尚未設定簽核流程，請聯絡管理員'],
  ['request cannot be canceled', '此單目前無法撤回，請重新整理'],
  ['request is not returned', '此單不是退簽狀態，無法重新送出'],
  ['invalid decision', '簽核動作不正確，請重新整理後再試'],
  ['invalid step', '此單的簽核關卡有誤，請重新整理後再試'],
  ['idempotency-key is too long', '送出資料有誤，請重新整理後再試'],
  ['too many requests', '操作太頻繁，請稍後再試'],
])

const STATUS_MESSAGES = {
  400: '送出的資料有誤，請檢查後再試',
  401: '登入已逾時，請重新登入',
  403: '您沒有權限執行此操作',
  404: '找不到這筆資料，可能已被處理或刪除，請重新整理',
  409: '此單已被處理，請重新整理',
  413: '檔案太大，無法上傳',
  429: '操作太頻繁，請稍後再試',
}

function statusMessage(status) {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]
  if (status >= 500) return '系統暫時發生問題，請稍後再試，若持續發生請聯絡管理員'
  return GENERIC_ERROR_MESSAGE
}

function missingApproverMessage(step) {
  return Number.isFinite(Number(step)) && Number(step) > 0
    ? `第 ${Number(step)} 關找不到可簽核的人員，請聯絡管理員設定`
    : '有關卡找不到可簽核的人員，請聯絡管理員設定'
}

/** 把伺服器回的 error 文字轉成中文；已是中文就原樣使用 */
export function translateServerMessage(message, { code, step, status } = {}) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (text && HAS_CHINESE_RE.test(text)) return text
  // 舊版伺服器的英文訊息裡帶有關卡編號，優先用它
  const approverMatch = /^required approval step (\d+) has no approver/i.exec(text)
  if (approverMatch) return missingApproverMessage(approverMatch[1])
  if (code === 'REQUIRED_APPROVER_MISSING') return missingApproverMessage(step)
  if (text) {
    const lower = text.toLowerCase()
    if (ENGLISH_MESSAGES.has(lower)) return ENGLISH_MESSAGES.get(lower)
    if (/cast to objectid failed|validation failed|is not valid/i.test(text)) {
      return '資料格式有誤，請重新整理頁面後再試'
    }
  }
  return statusMessage(status)
}

/** 整理 violations（物件 { rule, message } 或純字串），一條一行，去除空白與重複 */
export function violationLines(violations) {
  if (!Array.isArray(violations)) return []
  const lines = []
  for (const item of violations) {
    const text = typeof item === 'string'
      ? item
      : (item?.message || item?.error || item?.rule || '')
    const line = String(text || '').trim()
    if (line && !lines.includes(line)) lines.push(line)
  }
  return lines
}

/** 伺服器回應（非 2xx）轉成的錯誤；message 已是中文，lines 為逐條檢核結果 */
export class ApprovalApiError extends Error {
  constructor({ message, lines = [], code = '', step = null, status = 0 }) {
    super(message)
    this.name = 'ApprovalApiError'
    this.lines = lines
    this.code = code
    this.step = step
    this.status = status
  }
}

export async function readApiError(res) {
  const body = await res.json().catch(() => ({}))
  const lines = violationLines(body?.violations)
  const status = Number(res?.status) || 0
  const message = translateServerMessage(body?.error, { code: body?.code, step: body?.step, status })
  return new ApprovalApiError({
    message,
    lines,
    code: body?.code || '',
    step: body?.step ?? null,
    status,
  })
}

const NETWORK_ERROR_RE = /failed to fetch|network|load failed|fetch failed|timed? ?out|ECONN|ENOTFOUND/i

/** 任何被 catch 到的錯誤 -> { message, lines, code, status, network } */
export function describeError(error, fallback = GENERIC_ERROR_MESSAGE) {
  if (error instanceof ApprovalApiError) {
    return {
      message: error.message,
      lines: error.lines,
      code: error.code,
      status: error.status,
      network: false,
    }
  }
  const text = typeof error?.message === 'string' ? error.message.trim() : ''
  if (text && HAS_CHINESE_RE.test(text)) {
    return { message: text, lines: [], code: '', status: 0, network: false }
  }
  if (error?.name === 'NetworkError' || NETWORK_ERROR_RE.test(text)) {
    return { message: NETWORK_ERROR_MESSAGE, lines: [], code: '', status: 0, network: true }
  }
  return { message: fallback, lines: [], code: '', status: 0, network: false }
}

/** 轉成單一文字（逐條檢核結果每條一行） */
export function errorText(info) {
  if (!info) return ''
  return info.lines?.length
    ? [info.message, ...info.lines.map(line => `・${line}`)].join('\n')
    : info.message
}
