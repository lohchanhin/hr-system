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
}

/** Formats a labor-rule-validation violation object into a user-facing message. */
export function formatLaborRuleViolation(item = {}, employees = []) {
  if (typeof item === 'string') return item
  const employee = getEmployeeIssueLabel(item.employee, employees)
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
  return blocks.join('\n\n')
}
