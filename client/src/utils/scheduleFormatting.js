import dayjs from 'dayjs'

/** Formats a shift's code/name into the "CODE(name)" label used in legends and cells. */
export function formatShiftLabel(shift) {
  if (!shift) return ''
  const code = shift.code ?? ''
  const name = shift.name ?? ''
  if (!code && !name) return ''
  return name ? `${code}(${name})` : code
}

/** Formats one row-level import error object into a user-facing line of text. */
export function formatScheduleImportIssue(item = {}) {
  const row = item.row || '-'
  const day = item.day ? `／${item.day} 日` : ''
  const code = String(item.code || '').trim()
  const identifier = code
    ? item.day
      ? `／班別代號或名稱「${code}」`
      : `／員工代號「${code}」`
    : ''
  return `第 ${row} 列${day}${identifier}：${item.message || '資料錯誤'}`
}

/** Turns an Excel-import API error payload into a list of user-facing issue strings. */
export function formatScheduleImportPayloadIssues(payload = {}) {
  const issues = Array.isArray(payload.errors)
    ? payload.errors.map(formatScheduleImportIssue)
    : []
  if (payload.code !== 'EMPLOYEE_ID_AMBIGUOUS') return issues

  const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts : []
  return conflicts.map(conflict => {
    const employeeId = String(conflict?.employeeId || '').trim() || '未提供'
    const count = Number(conflict?.count || 0)
    return `員工代號「${employeeId}」在系統內有 ${count} 筆資料，請先修正員工資料再匯入`
  })
}

/** Normalizes heterogeneous notification "details" (string or object) into a uniform shape. */
export function normalizeNotificationDetails(details) {
  return (Array.isArray(details) ? details : [])
    .map(detail => {
      if (typeof detail === 'string') return { message: detail.trim() }
      if (!detail || typeof detail !== 'object') return { message: String(detail || '').trim() }
      return {
        rule: String(detail.rule || detail.code || '').trim(),
        employee: String(detail.employee?._id || detail.employee || '').trim(),
        date: detail.date || detail.startDate || detail.weekStart || null,
        message: String(detail.message || '').trim(),
      }
    })
    .filter(detail => detail.message)
}

/** Safely reads a delegated DOM event target's checked state (checkbox/radio). */
export const parseDelegatedBoolean = target => {
  if (!target) return undefined
  if (typeof target.checked === 'boolean') return target.checked
  return undefined
}

/** Looks up a display label ("CODE Name") for an employee id from a list of employees. */
export function getEmployeeIssueLabel(employeeId, employees = []) {
  const normalizedId = String(employeeId || '')
  if (!normalizedId) return ''
  const employee = (employees || []).find(item => String(item?._id || '') === normalizedId)
  if (!employee) return `員工 ${normalizedId}`
  const code = String(employee.employeeId || '').trim()
  return [code, employee.name].filter(Boolean).join(' ') || `員工 ${normalizedId}`
}

const LABOR_RULE_LABELS = {
  'daily-work-hours': '每日總工時上限',
  'regular-work-hours': '正常班工時上限',
  'shift-gap': '換班休息間隔',
  'continuous-work-days': '連續出勤限制',
  'weekly-one-regular-rest-one-rest-day': '每週一例一休',
  'weekly-rest-pending': '每週一例一休（待判斷）',
}

/** Formats a labor-rule-validation violation object into a user-facing message. */
export function formatLaborRuleViolation(item = {}, employees = []) {
  if (typeof item === 'string') return item
  const employee = item.employeeCode || item.employeeName
    ? pendingEmployeeLabel(item, employees)
    : getEmployeeIssueLabel(item.employee, employees)
  const parsedDate = dayjs(item.date || item.weekStart || item.startDate || item.dates?.[0] || '')
  const date = parsedDate?.isValid() ? ` ${parsedDate.format('YYYY-MM-DD')}` : ''
  const rule = item.rule ? ` [${LABOR_RULE_LABELS[item.rule] || item.rule}]` : ''
  const subject = `${employee}${date}${rule}`.trim()
  return `${subject ? `${subject}：` : ''}${item.message || '排班規範檢核未通過'}`
}

/** Formats one import warning (same {row, day, code, message} shape as errors); rows without a row number show the message only. */
export function formatScheduleImportWarning(item = {}) {
  if (typeof item === 'string') return item
  if (!item?.row) return String(item?.message || '資料提醒')
  return formatScheduleImportIssue(item)
}

// 員工不在目前載入的那一頁名單時，改用伺服器附上的代號與姓名
function pendingEmployeeLabel(item, employees) {
  const id = String(item.employee?._id || item.employee || '')
  const known = (employees || []).some(employee => String(employee?._id || '') === id)
  const named = [item.employeeCode, item.employeeName].map(value => String(value || '').trim()).filter(Boolean).join(' ')
  return known || !named ? getEmployeeIssueLabel(id, employees) : named
}

/** 'YYYY-MM' → '2026年7月' */
function formatMonthKey(key) {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(key || '').trim())
  return match ? `${Number(match[1])}年${Number(match[2])}月` : String(key || '')
}

/**
 * 跨月週還無法判斷（鄰月尚未排班）的項目，同一週的員工併成一行，避免四十位員工出現四十行幾乎一樣的文字：
 * 「2026-06-29～2026-07-05：12 人（A0003 王小美、A0069 林小華…等 12 人）尚無法判斷，2026年6月尚未排班」。
 * `pendingWeeks` 是伺服器回傳的項目（employee、weekStart、weekEnd、missingMonths）。
 */
export function buildPendingWeekLines(pendingWeeks = [], employees = [], { nameLimit = 5 } = {}) {
  const groups = new Map()
  for (const item of Array.isArray(pendingWeeks) ? pendingWeeks : []) {
    if (!item || typeof item !== 'object') continue
    const weekStart = String(item.weekStart || item.date || '').slice(0, 10)
    if (!weekStart) continue
    const weekEnd = String(item.weekEnd || '').slice(0, 10)
    const key = `${weekStart}|${weekEnd}`
    if (!groups.has(key)) groups.set(key, { weekStart, weekEnd, employees: [], months: new Set() })
    const group = groups.get(key)
    const label = pendingEmployeeLabel(item, employees)
    if (label && !group.employees.includes(label)) group.employees.push(label)
    for (const month of item.missingMonths || []) group.months.add(month)
  }
  return [...groups.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map(group => {
      const count = group.employees.length
      const names = group.employees.slice(0, nameLimit).join('、')
      const people = count > nameLimit ? `${names}…等 ${count} 人` : names
      const range = group.weekEnd ? `${group.weekStart}～${group.weekEnd}` : group.weekStart
      const months = [...group.months].sort().map(formatMonthKey).join('、')
      return `${range}：${count} 人（${people}）尚無法判斷${months ? `，${months}尚未排班` : ''}`
    })
}

/** 匯入檔裡不套用排班規範檢核的兼職人員提示：「其中 2 位兼職人員不套用排班規範檢核（A0003 王小明、…）。」 */
export function formatRuleExemptNotice(employees = [], limit = 5) {
  const list = (Array.isArray(employees) ? employees : []).filter(Boolean)
  if (!list.length) return ''
  const labels = list
    .slice(0, limit)
    .map(item => [String(item.employeeId || '').trim(), String(item.name || '').trim()].filter(Boolean).join(' '))
    .filter(Boolean)
  const detail = labels.length ? `（${labels.join('、')}${list.length > limit ? '…等' : ''}）` : ''
  return `其中 ${list.length} 位兼職人員不套用排班規範檢核${detail}。`
}

export const IMPORT_CONFIRM_LINE_LIMIT = 20

/** Keeps at most `limit` lines and closes with a "…另有 N 項" line so a long list never floods the dialog. */
export function limitDialogLines(lines, limit = IMPORT_CONFIRM_LINE_LIMIT) {
  const list = (Array.isArray(lines) ? lines : []).filter(Boolean)
  if (list.length <= limit) return list
  return [
    ...list.slice(0, limit),
    `…另有 ${list.length - limit} 項，匯入後可在通知紀錄查看完整明細`,
  ]
}

// 清單項目加上「・」；limitDialogLines 追加的「…另有 N 項」收尾行不加
const bulletLines = (lines, limit) => lines.map((line, index) => (index < limit ? `・${line}` : line))

/**
 * Builds the text of the schedule-import confirmation dialog from a preview payload:
 * counts, the informational-day count, warning texts and labor-rule violation texts.
 * `warnings` / `violations` are already-formatted strings.
 */
export function buildScheduleImportConfirmMessage({
  employees = 0,
  scheduleDays = 0,
  informationalDays = 0,
  skippedDays,
  overwriteCount = 0,
  warnings = [],
  violations = [],
  ruleExemptEmployees = [],
  pendingWeekLines = [],
  pendingWeekCount,
  lineLimit = IMPORT_CONFIRM_LINE_LIMIT,
} = {}) {
  const blocks = []
  if (Number(overwriteCount) > 0) {
    blocks.push(
      `發現 ${Number(overwriteCount)} 個日期已有班表。選擇「覆蓋匯入」會取代原班別，並將員工確認狀態重設為待確認；取消不會修改任何資料。`
    )
  }
  const summary = [`將匯入 ${Number(employees) || 0} 名員工、${Number(scheduleDays) || 0} 個班次。`]
  // informationalDays：班表中國定假日 / 請假標記的總天數；skippedDays：其中因班別設定沒有對應班別而不會建立班表的天數
  const informational = Math.max(0, Number(informationalDays) || 0)
  if (informational > 0) {
    const skipped = skippedDays == null ? null : Math.min(informational, Math.max(0, Number(skippedDays) || 0))
    if (skipped == null) {
      summary.push(`班表中共有 ${informational} 天為國定假日或請假標記。`)
    } else if (skipped > 0) {
      summary.push(
        `班表中共有 ${informational} 天為國定假日或請假標記，其中 ${skipped} 天因班別設定中沒有對應的班別，不會建立班表；如需排入班表，請先到「班別設定」建立對應班別。`
      )
    } else {
      summary.push(`班表中共有 ${informational} 天為國定假日或請假標記，皆已依班別設定存入班表。`)
    }
  }
  const exemptNotice = formatRuleExemptNotice(ruleExemptEmployees)
  if (exemptNotice) summary.push(exemptNotice)
  blocks.push(summary.join('\n'))

  const warningLines = (Array.isArray(warnings) ? warnings : []).filter(Boolean)
  if (warningLines.length) {
    blocks.push([
      `資料提醒（${warningLines.length} 項）：`,
      ...bulletLines(limitDialogLines(warningLines, lineLimit), lineLimit),
    ].join('\n'))
  }
  const violationLines = (Array.isArray(violations) ? violations : []).filter(Boolean)
  if (violationLines.length) {
    blocks.push([
      `排班規範問題（${violationLines.length} 項，可先存為草稿，發布前必須修正）：`,
      ...bulletLines(limitDialogLines(violationLines, lineLimit), lineLimit),
    ].join('\n'))
  }
  const pendingLines = (Array.isArray(pendingWeekLines) ? pendingWeekLines : []).filter(Boolean)
  if (pendingLines.length) {
    const total = pendingWeekCount == null ? pendingLines.length : Math.max(0, Number(pendingWeekCount) || 0)
    blocks.push([
      `跨月週尚無法判斷一例一休（${total} 項，不影響匯入，待相鄰月份班表排定後會重新檢核）：`,
      ...bulletLines(limitDialogLines(pendingLines, lineLimit), lineLimit),
    ].join('\n'))
  }
  return blocks.join('\n\n')
}
