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
