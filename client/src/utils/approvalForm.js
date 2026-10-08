// 簽核申請表單（動態欄位）共用邏輯：初始值、必填檢核、簽核流程預覽文字

import { normalizeFieldOptions, isBlankValue } from './approvalDisplay'

/** 停用的欄位不顯示也不檢核；伺服器未回 is_active 時視為啟用 */
export function isActiveField(field) {
  return field?.is_active !== false
}

export function isActiveForm(form) {
  return form?.is_active !== false
}

/** 沒有選項的 checkbox 是單一勾選（是 / 否），有選項才是複選群組 */
export function isSingleCheckbox(field) {
  return field?.type_1 === 'checkbox' && normalizeFieldOptions(field).length === 0
}

/** 每種欄位的初始值：數字留空（null）才能讓必填檢核生效；單一勾選為 false；複選為 [] */
export function initialFieldValue(field) {
  const type = field?.type_1
  if (type === 'number') return null
  if (type === 'checkbox') return isSingleCheckbox(field) ? false : []
  return ''
}

export function buildInitialFormData(fields) {
  const data = {}
  for (const field of fields || []) data[field._id] = initialFieldValue(field)
  return data
}

/**
 * 把既有的 form_data（例如被退簽的申請）整理成可編輯的表單資料：
 * 缺的欄位補初始值，單一勾選轉成布林，複選轉成陣列。
 */
export function prefillFormData(fields, formData) {
  const source = formData && typeof formData === 'object' ? formData : {}
  const data = {}
  for (const field of fields || []) {
    const stored = source[field._id]
    if (field.type_1 === 'file') {
      data[field._id] = ''
      continue
    }
    if (stored === undefined || stored === null || stored === '') {
      data[field._id] = initialFieldValue(field)
      continue
    }
    if (field.type_1 === 'checkbox') {
      if (isSingleCheckbox(field)) {
        // 伺服器把單一勾選存成陣列（否 = [false]、是 = [true]），不能用「陣列有沒有元素」判斷，任何一個 true 才算勾選
        const isChecked = (value) => value === true || value === 'true'
        data[field._id] = Array.isArray(stored) ? stored.some(isChecked) : isChecked(stored)
      } else {
        data[field._id] = Array.isArray(stored) ? [...stored] : [stored]
      }
      continue
    }
    if (field.type_1 === 'number') {
      const num = Number(stored)
      data[field._id] = Number.isFinite(num) ? num : null
      continue
    }
    data[field._id] = stored
  }
  return data
}

/**
 * 找出第一個沒填的必填欄位，全部都填了回傳 null。
 * 單一勾選的「是否…」只有是 / 否兩種答案（未勾選就是「否」），一律視為已回答；
 * 複選群組至少要選一項。
 */
export function findMissingRequiredField(fields, formData, fileBuffers = {}, keptFileFields = {}) {
  for (const field of fields || []) {
    if (!field.required || !isActiveField(field)) continue
    if (isSingleCheckbox(field)) continue
    if (field.type_1 === 'file') {
      const files = fileBuffers?.[field._id]
      const hasNew = Array.isArray(files) && files.length > 0
      if (!hasNew && !keptFileFields?.[field._id]) return field
      continue
    }
    if (field.type_1 === 'number') {
      const value = formData?.[field._id]
      if (value == null || value === '' || Number.isNaN(Number(value))) return field
      continue
    }
    if (isBlankValue(formData?.[field._id])) return field
  }
  return null
}

/* -------------------- 簽核流程預覽 -------------------- */

const APPROVER_TYPE_LABELS = {
  manager: '申請者的主管',
  tag: '標籤',
  user: '指定員工',
  role: '角色',
  level: '層級',
  department: '部門',
  org: '機構',
  group: '群組',
}

const EMPLOYEE_ROLE_LABELS = {
  admin: '系統管理員',
  supervisor: '主管',
  employee: '一般員工',
}

const SCOPE_LABELS = {
  dept: '（限申請者同部門）',
  org: '（限申請者同機構）',
}

const toList = (value) => (Array.isArray(value) ? value : [value]).filter(v => v != null && v !== '')

/**
 * 把一關流程設定轉成易讀文字，例如「標籤：人資」「申請者的主管」「部門：護理部」。
 * lookups: { user(id), department(id), org(id), signRole(code), signLevel(code) } 皆回傳名稱，找不到回傳空值
 */
export function describeWorkflowApprovers(step, lookups = {}) {
  const type = step?.approver_type
  const values = toList(step?.approver_value)
  const scope = SCOPE_LABELS[step?.scope_type] || ''
  const name = (kind, id) => lookups[kind]?.(String(id))
  const joined = (kind, fallback) => {
    const names = values.map(id => name(kind, id) || fallback).filter(Boolean)
    return [...new Set(names)].join('、')
  }

  switch (type) {
    case 'manager': {
      const picked = values.filter(v => v !== 'APPLICANT_SUPERVISOR')
      if (!picked.length) return `申請者的主管${scope}`
      return `指定主管：${joined('user', '指定主管')}`
    }
    case 'tag':
      return values.length ? `標籤：${values.map(v => String(v).trim()).join('、')}${scope}` : `標籤（尚未指定）`
    case 'user':
      return values.length ? joined('user', '指定員工') : '指定員工（尚未指定）'
    case 'role': {
      if (!values.length) return `角色（尚未指定）`
      const labels = values.map(v => EMPLOYEE_ROLE_LABELS[v] || name('signRole', v) || String(v))
      return `角色：${[...new Set(labels)].join('、')}${scope}`
    }
    case 'level': {
      if (!values.length) return `層級（尚未指定）`
      const labels = values.map(v => name('signLevel', v) || String(v))
      return `層級：${[...new Set(labels)].join('、')}${scope}`
    }
    case 'department':
      return values.length ? `部門：${joined('department', '指定部門')}` : '申請者所屬部門'
    case 'org':
      return values.length ? `機構：${joined('org', '指定機構')}` : '申請者所屬機構'
    case 'group':
      return `群組成員${scope}`
    default:
      return APPROVER_TYPE_LABELS[type] || '未設定'
  }
}

/**
 * 伺服器在流程步驟上回傳這關目前的解析結果（GET /api/approvals/forms/:id/workflow）：
 * resolved_count（現在找得到幾位可簽核的人）與 unresolved_reason（找不到人的中文原因，找得到時為 null）。
 * 先讀這兩個欄位，舊寫法（名單、eligible_count 等）仍容許；沒有任何資訊就不提醒。
 * 回傳 { count, names }（有原因時多一個 reason）或 null
 */
const isCountValue = (value) => (
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
)

export function readResolvedApprovers(step) {
  const reason = typeof step?.unresolved_reason === 'string' ? step.unresolved_reason.trim() : ''
  const withReason = (result) => (reason ? { ...result, reason } : result)
  if (isCountValue(step?.resolved_count)) return withReason({ count: Number(step.resolved_count), names: [] })
  const list = step?.resolved_approvers ?? step?.eligible_approvers ?? step?.approvers_preview
  if (Array.isArray(list)) {
    const names = list.map(item => (typeof item === 'string' ? item : (item?.name || '')) ).filter(Boolean)
    return withReason({ count: list.length, names })
  }
  const count = step?.eligible_count ?? step?.approver_count
  if (isCountValue(count)) return withReason({ count: Number(count), names: [] })
  // 只有原因、沒有人數：有原因就代表找不到人
  if (reason) return { count: 0, names: [], reason }
  return null
}

/** 必簽的一關現在找不到簽核人時，申請頁要先提醒的文字（附上伺服器給的原因）；沒有問題回傳空字串 */
export function describeUnresolvedStep(step) {
  const resolved = readResolvedApprovers(step)
  if (!resolved || resolved.count !== 0 || step?.is_required === false) return ''
  const reason = resolved.reason ? `：${resolved.reason}` : ''
  return `此關目前找不到可簽核的人員${reason}，送出申請會失敗，請聯絡管理員設定`
}

/* -------------------- 表單種類（依表單性質 / 固定代號判斷，改名後不會失效） -------------------- */

const LEAVE_FORM_NAME = '請假'
// 名稱只在舊資料（沒有表單性質、也沒有固定代號）時當備援
const PAYROLL_FORM_NAMES = ['請假', '加班申請', '獎金申請']
const PAYROLL_SEMANTIC_TYPES = ['leave', 'overtime']
const PAYROLL_DEFAULT_KEYS = ['leave', 'overtime', 'bonus']

// 表單性質 general 是預設值，不算已分類；固定代號（default_key）有值就算
const isClassifiedForm = (form) => Boolean(form?.default_key) || (Boolean(form?.semanticType) && form.semanticType !== 'general')

/** 請假單：固定代號 leave 或表單性質 leave；都沒有分類的舊資料才看名稱「請假」 */
export function isLeaveForm(form) {
  if (!form) return false
  if (form.default_key === 'leave' || form.semanticType === 'leave') return true
  return !isClassifiedForm(form) && form.name === LEAVE_FORM_NAME
}

/** 會連接薪資的表單（請假 / 加班 / 獎金）：看表單性質與固定代號，名稱只是備援 */
export function isPayrollConnectedForm(form) {
  if (!form) return false
  if (PAYROLL_SEMANTIC_TYPES.includes(form.semanticType) || PAYROLL_DEFAULT_KEYS.includes(form.default_key)) return true
  return !isClassifiedForm(form) && PAYROLL_FORM_NAMES.includes(form.name)
}

/** 「快速請假」要選的表單：啟用中的預設請假單（default_key）優先，其次表單性質為請假，最後才找名稱「請假」 */
export function findLeaveFormId(forms) {
  const active = (Array.isArray(forms) ? forms : []).filter(isActiveForm)
  const hit = active.find(form => form.default_key === 'leave')
    || active.find(form => form.semanticType === 'leave')
    || active.find(form => form.name === LEAVE_FORM_NAME)
  return hit?._id || ''
}
