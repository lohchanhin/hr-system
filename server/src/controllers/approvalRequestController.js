import mongoose from 'mongoose'
import ApprovalWorkflow from '../models/approval_workflow.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import Employee from '../models/Employee.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getLeaveFieldIdsForForm } from '../services/leaveFieldService.js'
import { resolveFieldsOptions } from '../services/formFieldOptionsService.js'
import {
  deductAnnualLeave,
  getAnnualLeaveBalance,
  refundAnnualLeave,
} from '../services/annualLeaveService.js'
import {
  assertApprovalRequestCompliance,
  isLaborRuleValidationError,
} from '../services/laborRuleValidationService.js'
import {
  APPLICANT_SUPERVISOR_VALUE,
  UNRESOLVED_REASON_TEXT,
  resolveApprovers,
  resolveApproversDetailed,
} from '../services/approverResolution.js'
import {
  advanceApprovalState,
  applyReturn,
  restartRequest,
  skipRemainingApprovers,
  startRequest,
} from '../services/approvalRequestEngine.js'
import { sanitizeApprovalFormData } from '../services/approvalFormData.js'
import {
  bindApprovalAttachments,
  isAttachmentBoundElsewhere,
  newRequestId,
  registerUploadedAttachments,
  releaseAttachments,
} from '../services/approvalAttachmentService.js'
import {
  MAX_LEAVE_REQUEST_HOURS,
  collectLeaveTypeNames,
  computeLeaveRequestHours,
  isAnnualLeaveType,
  leaveStartInstant,
} from '../services/leaveRequestDays.js'
import { getLeavePolicy, matchLeaveType } from '../services/leavePolicyService.js'
import {
  buildLeaveBalances,
  currentTaipeiYear,
  describeRequestFocus,
  evaluateLeaveRequestAgainstBalance,
} from '../services/leaveBalanceService.js'
// 調休存摺的餘額函式用命名空間取用：別的測試把 leaveBalanceService 換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as leaveBalanceModule from '../services/leaveBalanceService.js'
import {
  acquireCompLeaveFilingLease,
  buildCompLeaveDayPlan,
  buildCompensatoryBank,
  consumeCreditsForRequest,
  findRequestConsumption,
  refundCreditsForRequest,
} from '../services/compensatoryLeaveService.js'
import { checkLeaveHours, LeaveHoursValidationError } from '../services/leaveHoursValidation.js'
import { extraCeilings, loadScheduledShiftHours } from '../services/leaveShiftHours.js'
import { parseLeaveInterval } from '../utils/leaveDuration.js'
import { readAnnualLeaveHours } from '../utils/annualLeaveHours.js'
import { daysToHours, formatHoursText, hoursToDays, isLeaveHoursFilled } from '../utils/leaveHours.js'
import { normalizeSignTag } from '../utils/signTags.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'
import { resolveLeaveFieldsForRequest } from '../utils/leaveFieldResolution.js'
import { toTaipeiDateKey } from '../utils/taipeiTime.js'
import { getAllowedScheduleEmployeeIds } from './schedule/scheduleShared.js'

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i
const MAX_COMMENT_LENGTH = 1000
const MAX_VERSION_RETRIES = 12
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
// 沒帶 page / limit 的舊式呼叫仍回傳純陣列，但加上上限避免一次載入全部歷史；實際總筆數看 X-Total-Count
const LEGACY_LIST_LIMIT = 500
const HISTORY_STATUSES = ['pending', 'approved', 'rejected', 'returned', 'canceled']
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APPROVAL_UPLOAD_DIR = path.join(__dirname, '../../../upload/approvals')

// 錯誤訊息裡顯示用的名稱（與員工表單的簽核角色／層級選項一致）
const SIGN_ROLE_NAMES = {
  R001: '填報', R002: '覆核', R003: '審核', R004: '核定', R005: '知會', R006: '財務覆核', R007: '人資覆核',
}
const SIGN_LEVEL_NAMES = { U001: 'L1', U002: 'L2', U003: 'L3', U004: 'L4', U005: 'L5' }

const MESSAGES = {
  invalidUser: '登入狀態無效，請重新登入',
  notFound: '找不到這張簽核單',
}

/* ---------------------------- 錯誤處理 ---------------------------- */

// 有意對使用者顯示的錯誤（訊息一律是繁體中文）。其餘未預期的錯誤只記錄在伺服器，不回傳內部訊息。
class ApprovalError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.name = 'ApprovalError'
    this.status = status
    this.extra = extra
  }
}

function fail(status, message, extra) {
  return new ApprovalError(status, message, extra)
}

function respondError(res, error, context = '') {
  if (error instanceof ApprovalError) {
    return res.status(error.status).json({ error: error.message, ...error.extra })
  }
  if (error?.name === 'FormDataError') {
    return res.status(error.status || 400).json({ error: error.message, code: error.code, ...(error.extra || {}) })
  }
  if (isLaborRuleValidationError(error)) {
    return res.status(error.status || 400).json({
      error: error.message,
      violations: error.violations || [],
    })
  }
  if (error?.name === 'VersionError') {
    return res.status(409).json({ error: '這張簽核單剛被其他人更新，請重新整理後再試', code: 'CONFLICT' })
  }
  console.error(`[approval] ${context || 'request'} failed: ${error?.name || 'Error'}`, error?.message)
  if (error?.name === 'CastError' || error?.name === 'ValidationError') {
    return res.status(400).json({ error: '資料格式不正確，請確認後重新送出' })
  }
  return res.status(500).json({ error: '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員' })
}

// 讀取後修改再存檔的流程遇到並行更新（VersionError）時，重新載入再判斷一次：
// 同一關的其他簽核人同時送出不會互相擋住；真的已被處理過就會得到明確的 409。
async function withVersionRetry(task) {
  for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt += 1) {
    try {
      return await task(attempt)
    } catch (error) {
      if (error?.name !== 'VersionError') throw error
    }
    // 每一輪至少有一個人存檔成功；稍微錯開重試時間，同一關很多人同時簽核時也能全部完成
    if (attempt < MAX_VERSION_RETRIES - 1) {
      const spread = Math.min(10 * (attempt + 1) ** 2, 300)
      await new Promise(resolve => setTimeout(resolve, 2 + Math.floor(Math.random() * spread)))
    }
  }
  throw fail(409, '這張簽核單剛被其他人更新，請重新整理後再試', { code: 'CONFLICT' })
}

/* ---------------------------- 共用小工具 ---------------------------- */

function normalizeId(value) {
  if (value == null) return ''
  if (typeof value === 'object' && value._id != null && value._id !== value) {
    return normalizeId(value._id)
  }
  return String(value)
}

function isObjectIdString(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
}

function getAuthenticatedEmployeeId(req) {
  return normalizeId(req.user?.id)
}

function hasIdentityOverride(value, actorId) {
  return value != null && normalizeId(value) !== actorId
}

function getIdempotencyKey(req) {
  const raw = req.get?.('Idempotency-Key') ?? req.headers?.['idempotency-key']
  return typeof raw === 'string' ? raw.trim() : ''
}

function requireRequestId(req) {
  const id = String(req.params?.id ?? '')
  if (!isObjectIdString(id)) throw fail(400, '簽核單編號格式不正確')
  return id
}

function parseComment(raw) {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw fail(400, '意見內容格式不正確')
  const text = raw.trim()
  if (!text) return undefined
  if (text.length > MAX_COMMENT_LENGTH) throw fail(400, `意見內容過長（上限 ${MAX_COMMENT_LENGTH} 字）`)
  return text
}

function formatDays(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(2))) : String(value)
}

function toPlainDoc(doc) {
  return typeof doc?.toObject === 'function' ? doc.toObject() : { ...doc }
}

function respondDoc(res, doc, warnings = []) {
  if (!warnings.length) return res.json(doc)
  return res.json({ ...toPlainDoc(doc), warnings })
}

function isApprovalParticipant(doc, actorId) {
  if (!doc || !actorId) return false
  if (normalizeId(doc.applicant_employee) === actorId) return true
  return (doc.steps || []).some((step) => (
    (step.approvers || []).some((approver) => normalizeId(approver?.approver) === actorId)
  ))
}

// 申請人在不在這位使用者的排班範圍內：和排班頁「相關簽核」清單用同一個範圍函式，不另外定義誰看得到誰
async function isApplicantInScheduleScope(req, applicant) {
  const applicantId = normalizeId(applicant)
  if (!applicantId) return false
  const allowedIds = await getAllowedScheduleEmployeeIds(req)
  return allowedIds === null || allowedIds.includes(applicantId)
}

function findApprovalAttachment(value, expectedPath) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findApprovalAttachment(item, expectedPath)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const storedPath = value.url || value.path
  if (typeof storedPath === 'string' && storedPath === expectedPath) return value
  for (const nested of Object.values(value)) {
    const found = findApprovalAttachment(nested, expectedPath)
    if (found) return found
  }
  return null
}

async function loadFormFields(formId) {
  const query = FormField.find({ form: formId })
  const sorted = typeof query?.sort === 'function' ? query.sort({ order: 1 }) : query
  const rows = typeof sorted?.lean === 'function' ? await sorted.lean() : await sorted
  return rows || []
}

/* ---------------------------- 簽核人解析 ---------------------------- */

// 解析邏輯在 services/approverResolution.js（流程預覽 getWorkflow 也要用）；這裡維持原本的匯出，呼叫端與測試不受影響
export { resolveApprovers, resolveApproversDetailed }

function describeWorkflowStep(step) {
  const type = step.approver_type
  const raw = Array.isArray(step.approver_value) ? step.approver_value[0] : step.approver_value
  let label = ''
  if (type === 'manager') {
    const value = typeof raw === 'string' ? raw : ''
    label = !value || value === APPLICANT_SUPERVISOR_VALUE ? '申請者的主管' : '指定主管'
  } else if (type === 'tag') {
    label = `標籤：${normalizeSignTag(raw) || '未設定'}`
  } else if (type === 'user') {
    label = '指定員工'
  } else if (type === 'role') {
    const code = String(raw ?? '').trim()
    label = SIGN_ROLE_NAMES[code] ? `角色：${SIGN_ROLE_NAMES[code]}（${code}）` : `角色：${code || '未設定'}`
  } else if (type === 'level') {
    const code = String(raw ?? '').trim()
    label = SIGN_LEVEL_NAMES[code] ? `層級：${SIGN_LEVEL_NAMES[code]}（${code}）` : `層級：${code || '未設定'}`
  } else if (type === 'department') {
    label = '部門'
  } else if (type === 'org') {
    label = '機構'
  } else if (type === 'group') {
    label = '群組'
  } else {
    label = String(type || '未設定')
  }
  if (step.scope_type === 'dept') label += '，範圍：部門'
  if (step.scope_type === 'org') label += '，範圍：機構'
  return label
}

function missingApproverError(form, item) {
  const stepNumber = item.position + 1
  const reason = UNRESOLVED_REASON_TEXT[item.reason]
  const detail = reason ? `：${reason}` : ''
  return fail(
    400,
    `【${form?.name || '表單'}】第${stepNumber}關（${describeWorkflowStep(item.source)}）找不到可簽核的人員${detail}，請聯絡管理員設定`,
    { code: 'REQUIRED_APPROVER_MISSING', step: stepNumber },
  )
}

function buildDecisionList(employeeIds) {
  return employeeIds.map(id => ({ approver: id, decision: 'pending' }))
}

/**
 * 依流程設定與申請人，建立這張單的各關簽核人（建立、重新送出共用）。
 * 必簽關卡找不到人、或所有關卡都沒有人（會變成無人簽核直接通過）時回報 REQUIRED_APPROVER_MISSING。
 */
async function buildRequestSteps({ wf, applicantEmp, form }) {
  const workflowSteps = Array.from(wf.steps || [])
  const resolved = []
  for (let position = 0; position < workflowSteps.length; position += 1) {
    const source = workflowSteps[position]
    const { ids, reason } = await resolveApproversDetailed(source, applicantEmp)
    const approverIds = []
    const seen = new Set()
    for (const rawId of ids || []) {
      const id = rawId != null ? String(rawId) : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      approverIds.push(id)
    }
    resolved.push({ source, position, approverIds, reason })
  }

  const missing = resolved.find(item => item.source.is_required !== false && !item.approverIds.length)
  if (missing) throw missingApproverError(form, missing)
  if (resolved.length && !resolved.some(item => item.approverIds.length)) {
    throw missingApproverError(form, resolved[0])
  }

  // 連續且簽核人與設定完全相同的關卡合併成一關
  const steps = []
  let previousSignature = null
  for (const item of resolved) {
    const normalizedConfig = {
      approvers: [...item.approverIds].sort(),
      all_must_approve: item.source.all_must_approve !== false,
      is_required: item.source.is_required !== false,
      can_return: item.source.can_return !== false,
    }
    const signature = JSON.stringify(normalizedConfig)
    if (signature === previousSignature) continue
    previousSignature = signature
    steps.push({
      step_order: steps.length + 1,
      approvers: buildDecisionList(item.approverIds),
      all_must_approve: normalizedConfig.all_must_approve,
      is_required: normalizedConfig.is_required,
      can_return: normalizedConfig.can_return,
    })
  }
  return { steps }
}

async function notifyUsers(userIds, message) {
  // TODO: 串你的通知系統（站內信/Email/Line 等）
  // console.log('notify', userIds, message)
}

/* ---------------------------- 附件上傳 / 下載 ---------------------------- */

export async function uploadApprovalAttachments(req, res) {
  const uploaded = req.files || []
  try {
    const actorId = getAuthenticatedEmployeeId(req)
    if (!actorId) return res.status(401).json({ error: MESSAGES.invalidUser })
    const files = uploaded.map((file) => ({
      name: file.originalname,
      url: `/upload/approvals/${file.filename}`,
      size: file.size,
      type: file.mimetype,
    }))
    if (!files.length) return res.status(400).json({ error: '請選擇附件' })
    // 登記上傳者：之後只有本人能把這些檔案掛到自己的申請單上
    await registerUploadedAttachments(uploaded, actorId)
    return res.status(201).json({ files })
  } catch (error) {
    uploaded.forEach((file) => {
      try {
        if (file?.path) fs.unlinkSync(file.path)
      } catch {
        // 清理失敗不影響回應
      }
    })
    return respondError(res, error, 'upload attachments')
  }
}

export async function downloadApprovalAttachment(req, res) {
  try {
    const actorId = getAuthenticatedEmployeeId(req)
    if (!actorId) return res.status(401).json({ error: MESSAGES.invalidUser })
    const requestId = requireRequestId(req)

    const doc = await ApprovalRequest.findById(requestId).lean()
    if (!doc) return res.status(404).json({ error: MESSAGES.notFound })
    // 與開啟明細同一條規則：管理員、申請人與簽核人，以及申請人在自己排班範圍內的主管（唯讀）
    if (
      req.user?.role !== 'admin'
      && !isApprovalParticipant(doc, actorId)
      && !(await isApplicantInScheduleScope(req, doc.applicant_employee))
    ) {
      return res.status(404).json({ error: MESSAGES.notFound })
    }

    const filename = String(req.params.filename || '')
    if (!filename || path.basename(filename) !== filename) {
      return res.status(404).json({ error: '找不到附件' })
    }
    const storedPath = `/upload/approvals/${filename}`
    const metadata = findApprovalAttachment(doc.form_data, storedPath)
    if (!metadata) return res.status(404).json({ error: '找不到附件' })
    // 檔案若已綁定到別張單（有上傳紀錄且不是這張），不從這張單提供下載
    if (await isAttachmentBoundElsewhere(filename, doc._id)) {
      return res.status(404).json({ error: '找不到附件' })
    }

    const absolutePath = path.join(APPROVAL_UPLOAD_DIR, filename)
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: '找不到附件' })

    const downloadName = path.basename(String(metadata.name || filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', "default-src 'none'; sandbox")
    return res.download(absolutePath, downloadName, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: '找不到附件' })
    })
  } catch (error) {
    return respondError(res, error, 'download attachment')
  }
}

/* ---------------------------- 請假：時數、特休、假別額度 ---------------------------- */

// 是不是請假單：與假勤日曆、勞動規範、薪資、報表同一套判斷（utils/formSemantics）——
// 表單性質有設定時一律以它為準，管理員特地選「一般」的表單即使名稱叫「請假」也不扣特休；
// 只有完全沒有表單性質的舊表單才用名稱推論
function isAnnualLeaveFormTemplate(form) {
  return Boolean(form) && isLeaveFormTemplate(form)
}

const hoursWithDays = (hours) => `${formatHoursText(hours)}（${formatDays(hoursToDays(hours))} 天）`

/*
 * 這張假單的假別與請假時數（請假的單位是小時）；不是請假表單回傳 null。
 * 欄位在單據還在簽核中時被停用、換成同標籤的新欄位，答案仍在舊欄位底下，所以逐張單據挑第一個有填值的欄位。
 * 回傳 { leaveFields, names, isAnnual, hours, days, source, invalidRange }。
 */
async function analyzeLeaveRequest(form, formData) {
  if (!isAnnualLeaveFormTemplate(form)) return null

  // 取得這張假單所屬表單的假別 / 日期 / 時數欄位設定
  const leaveFields = resolveLeaveFieldsForRequest(await getLeaveFieldIdsForForm(form), formData)
  if (!leaveFields.typeId) {
    console.warn('[AnnualLeave] Leave type field not found')
    return null
  }
  const typeValue = formData?.[leaveFields.typeId]
  // 檢查假別是否為特休（連結字典的欄位存的是字典項目名稱，例如「特休假」）
  return {
    leaveFields,
    names: collectLeaveTypeNames(typeValue, leaveFields.typeOptions),
    isAnnual: isAnnualLeaveType(typeValue, leaveFields.typeOptions),
    ...computeLeaveRequestHours({ formData, leaveFields }),
  }
}

/* 這張假單是不是特休、幾小時；不是請假表單或不是特休回傳 null */
async function analyzeAnnualLeave(form, formData) {
  const analysis = await analyzeLeaveRequest(form, formData)
  return analysis?.isAnnual ? analysis : null
}

/* 這張假單的假別是不是調休（調休存摺：調休、補休、補假）；analysis 是 analyzeLeaveRequest 的結果 */
function isCompLeaveAnalysis(analysis, policy) {
  if (!analysis || analysis.isAnnual) return false
  return matchLeaveType(analysis.names, policy?.types || [])?.source === 'comp_bank'
}

/* 這張假單是不是調休、幾小時；不是請假表單或不是調休回傳 null（不是請假單時不讀假別規則） */
async function analyzeCompLeave(form, formData) {
  const analysis = await analyzeLeaveRequest(form, formData)
  if (!analysis || analysis.isAnnual) return null
  const policy = await getLeavePolicy()
  return isCompLeaveAnalysis(analysis, policy) ? { ...analysis, policy } : null
}

// 表單欄位清單裡某個欄位的型別（date / datetime…），判斷請假是整天還是有時分
function fieldTypeOf(fields, fieldId) {
  if (!fieldId) return undefined
  return (fields || []).find(field => String(field._id) === String(fieldId))?.type_1
}

// 請假單的年度：以請假開始日（台灣時間）為準，沒有開始日就用今年
function leaveYearOf(formData, leaveFields) {
  const startKey = toTaipeiDateKey(leaveFields.startId ? formData?.[leaveFields.startId] : undefined)
  return Number(startKey?.slice(0, 4)) || currentTaipeiYear()
}

// 班表查不到（例如資料庫暫時有問題）就用每日上限，不能因此擋住送出申請
async function loadDayCeilings({ applicantEmp, startValue, endValue, startType, endType, policy }) {
  try {
    if (!applicantEmp?._id) return null
    const interval = parseLeaveInterval(startValue, endValue, { startType, endType })
    if (!interval || interval.reversed) return null
    const schedule = await loadScheduledShiftHours(applicantEmp._id, interval.startKey, interval.lastKey)
    return extraCeilings(schedule, policy.maxHoursPerDay)
  } catch (error) {
    console.error(`[LeaveHours] Schedule lookup skipped: ${error?.name || 'Error'}`)
    return null
  }
}

/*
 * 送出（或重新送出）時檢查請假：日期與時數合理、特休餘額足夠，其他假別依假別規則檢查額度。
 * - 時數欄位：大於 0、是最小單位（預設 0.5 小時）的倍數、不超過所選期間可請的上限（每日最多 8 小時，管理員可調）。
 * - 特休：尚未設定特休時數的員工不以餘額擋下；超過剩餘時數擋下（400 ANNUAL_LEAVE_INSUFFICIENT）。
 * - 事假、病假等：超額處理設為「禁止」時擋下（400 LEAVE_QUOTA_INSUFFICIENT），設為「警告」時照常送出並回傳警告。
 * - 調休：超過可用時數擋下（400 COMP_LEAVE_INSUFFICIENT）；lockCompLeave(員工 _id) 在檢查存摺前呼叫（拿調休申請鎖，見 acquireCompFilingLease）。
 * 回傳 { warnings }（給 201 回應附上）。
 */
async function assertLeaveAllowed({ form, formData, applicantEmp, fields = null, lockCompLeave = null }) {
  const analysis = await analyzeLeaveRequest(form, formData)
  if (!analysis) return { warnings: [] }
  const { leaveFields } = analysis
  if (analysis.invalidRange) {
    throw fail(400, '請假結束日期不可早於開始日期', { code: 'INVALID_LEAVE_RANGE' })
  }
  if (analysis.hours > MAX_LEAVE_REQUEST_HOURS) {
    throw fail(400, '請假時數超出合理範圍，請確認日期或時數', { code: 'INVALID_LEAVE_HOURS' })
  }

  const policy = await getLeavePolicy()
  const hoursValue = leaveFields.hoursId ? formData?.[leaveFields.hoursId] : undefined
  const startValue = leaveFields.startId ? formData?.[leaveFields.startId] : undefined
  const endValue = leaveFields.endId ? formData?.[leaveFields.endId] : undefined
  const startType = fieldTypeOf(fields, leaveFields.startId)
  const endType = fieldTypeOf(fields, leaveFields.endId)
  // 班表上排了比每日上限更長的班（例如 12 小時班）的日子，那天可以請整個班的時數
  const dayCeilings = isLeaveHoursFilled(hoursValue)
    ? await loadDayCeilings({ applicantEmp, startValue, endValue, startType, endType, policy })
    : null
  const hoursViolations = checkLeaveHours({
    hoursValue,
    hoursFieldId: leaveFields.hoursId,
    startValue,
    endValue,
    startType,
    endType,
    minUnitHours: policy.minUnitHours,
    maxHoursPerDay: policy.maxHoursPerDay,
    dayCeilings,
  })
  if (hoursViolations.length) throw new LeaveHoursValidationError(hoursViolations)

  if (analysis.isAnnual) {
    const annual = readAnnualLeaveHours(applicantEmp?.annualLeave)
    if (!annual.configured) return { warnings: [] }
    if (analysis.hours > annual.remainingHours) {
      throw fail(
        400,
        `特休餘額不足：剩餘 ${hoursWithDays(Math.max(annual.remainingHours, 0))}，本次申請 ${hoursWithDays(analysis.hours)}`,
        { code: 'ANNUAL_LEAVE_INSUFFICIENT', remainingHours: annual.remainingHours, requestedHours: analysis.hours },
      )
    }
    return { warnings: [] }
  }

  if (isCompLeaveAnalysis(analysis, policy)) {
    // 先拿這位員工的調休申請鎖（呼叫端建立單據後才放開），同時送出的另一筆會等這筆建立好再檢查
    if (lockCompLeave && applicantEmp?._id) await lockCompLeave(applicantEmp._id)
    await assertCompLeaveAvailable({ hours: analysis.hours, employeeId: applicantEmp?._id, policy })
    return { warnings: [] }
  }

  return { warnings: await checkLeaveQuota({ analysis, formData, applicantEmp, policy }) }
}

/*
 * 調休一定要有存摺：申請的時數超過可用時數（存摺剩餘 - 其他簽核中的調休）就擋下（400 COMP_LEAVE_INSUFFICIENT）。
 * 和特休一樣不看「超額處理」的設定；讀不到存摺時也不放行（錯誤往外丟），不然沒有額度的人也能請調休。
 * excludeRequestId：核准時略過這張單本身（它還在簽核中）。
 */
async function assertCompLeaveAvailable({ hours, employeeId, policy, excludeRequestId = null, status = 400, verb = '本次申請' }) {
  if (!employeeId) return
  const pendingHours = await leaveBalanceModule.computeCompLeavePendingHours({ employeeId, policy, excludeRequestId })
  const bank = await leaveBalanceModule.summarizeCompLeaveBank({ employeeId, policy, pendingHours })
  if (hours <= bank.availableHours + 1e-9) return
  const pendingText = pendingHours > 0 ? `、其他簽核中的調休 ${hoursWithDays(pendingHours)}` : ''
  throw fail(
    status,
    `調休餘額不足：存摺剩餘 ${hoursWithDays(Math.max(bank.balanceHours, 0))}${pendingText}，可用 ${hoursWithDays(Math.max(bank.availableHours, 0))}，${verb} ${hoursWithDays(hours)}`,
    {
      code: 'COMP_LEAVE_INSUFFICIENT',
      availableHours: bank.availableHours,
      balanceHours: bank.balanceHours,
      pendingHours,
      requestedHours: hours,
    },
  )
}

/*
 * 調休申請：檢查存摺之前先拿這位員工的鎖，建立（或重新送出）單據後才放開（呼叫端在 finally 呼叫 release）。
 * 同時送出兩筆時第二筆會等第一筆建立好再檢查，把第一筆算進簽核中的時數，不會兩筆都通過、合計超過存摺而之後都核准不了。
 */
async function acquireCompFilingLease(employeeId) {
  try {
    return await acquireCompLeaveFilingLease({ employeeId })
  } catch (error) {
    if (error?.code === 'COMP_LEAVE_FILING_BUSY') throw fail(409, error.message, { code: error.code })
    throw error
  }
}

/* 事假、病假等有額度的假別：超額時依「超額處理」設定擋下（block）或回傳警告（warn） */
async function checkLeaveQuota({ analysis, formData, applicantEmp, policy }) {
  const matched = matchLeaveType(analysis.names, policy.types)
  if (!matched || matched.source !== 'policy' || matched.enforcement === 'none' || !applicantEmp?._id) return []

  let verdict = null
  try {
    const balances = await buildLeaveBalances({
      employeeId: applicantEmp._id,
      year: leaveYearOf(formData, analysis.leaveFields),
      focusKey: matched.key,
      employee: applicantEmp,
      policy,
    })
    const items = balances?.items || []
    const item = items.find(entry => entry.key === matched.key)
    const parent = matched.countsAgainst ? items.find(entry => entry.key === matched.countsAgainst.key) : null
    verdict = evaluateLeaveRequestAgainstBalance(item, analysis.hours, parent, matched.countsAgainst)
    if (verdict.exceeded) verdict = { ...verdict, remainingHours: item?.availableHours ?? null }
  } catch (error) {
    // 餘額只是參考：算不出來（例如資料庫暫時有問題）不能擋住送出申請
    console.error(`[LeaveQuota] Balance check skipped: ${error?.name || 'Error'}`)
    return []
  }
  if (!verdict?.exceeded) return []
  if (verdict.enforcement === 'block') {
    throw fail(400, `${verdict.message}，無法送出`, {
      code: 'LEAVE_QUOTA_INSUFFICIENT',
      typeKey: matched.key,
      remainingHours: verdict.remainingHours,
      requestedHours: analysis.hours,
    })
  }
  return [{
    code: 'LEAVE_QUOTA_EXCEEDED',
    message: verdict.message,
    typeKey: matched.key,
    remainingHours: verdict.remainingHours,
    requestedHours: analysis.hours,
  }]
}

function annualLeaveFailureMessage(error) {
  if (error?.code === 'INSUFFICIENT_BALANCE') {
    return `特休扣減失敗：餘額不足（剩餘 ${hoursWithDays(Math.max(Number(error.remainingHours) || 0, 0))}，本次需扣 ${hoursWithDays(error.requestedHours)}），請人資確認特休時數後手動補登`
  }
  if (error?.code === 'EMPLOYEE_NOT_FOUND') return '特休扣減失敗：找不到申請人的員工資料，請人資手動補登'
  return '特休扣減失敗：系統發生錯誤，請人資確認特休餘額後手動補登'
}

// 把特休扣減（或返還）的結果寫進單據；剛核准後極少數遇到並行更新時，重新載入再寫一次
async function recordAnnualLeaveOutcome(doc, { annualLeave, logs }) {
  let target = doc
  for (let attempt = 0; attempt < 2; attempt += 1) {
    target.annual_leave = annualLeave
    logs.forEach(log => target.logs.push(log))
    try {
      await target.save()
      return
    } catch (error) {
      if (error?.name !== 'VersionError' || attempt === 1) {
        console.error(`[AnnualLeave] Failed to record outcome: ${error?.name || 'Error'}`)
        return
      }
      const fresh = await ApprovalRequest.findById(doc._id)
      if (!fresh) return
      target = fresh
    }
  }
}

/* 處理特休扣減（當請假審核通過時）；回傳 { state, hours, days, message }，不是特休回傳 null */
async function handleAnnualLeaveDeduction(doc) {
  try {
    const form = await FormTemplate.findById(doc.form).lean()
    const analysis = await analyzeAnnualLeave(form, doc.form_data)
    if (!analysis) return null // 不是請假表單或不是特休，不處理

    const hours = analysis.hours
    const days = hoursToDays(hours, undefined, 4)
    if (!doc.applicant_employee || !(hours > 0)) return null

    const at = new Date()
    let deductError = null
    try {
      await deductAnnualLeave(doc.applicant_employee, hours, doc._id.toString())
      console.log(`[AnnualLeave] Successfully deducted ${hours} hours for employee ${doc.applicant_employee}`)
    } catch (error) {
      deductError = error
    }

    if (!deductError) {
      await recordAnnualLeaveOutcome(doc, {
        annualLeave: { hours, days, state: 'deducted', at },
        logs: [{ action: 'annual_leave', message: `已扣除特休 ${hoursWithDays(hours)}` }],
      })
      return { state: 'deducted', hours, days }
    }

    // 不影響審核結果，但要讓人看得到：寫進單據紀錄並回傳給核准的人
    console.error(`[AnnualLeave] Failed to deduct annual leave: ${deductError?.name || 'Error'}`, deductError?.message)
    const message = annualLeaveFailureMessage(deductError)
    await recordAnnualLeaveOutcome(doc, {
      annualLeave: { hours, days, state: 'failed', message, at },
      logs: [{ action: 'annual_leave_error', message }],
    })
    return { state: 'failed', hours, days, message }
  } catch (error) {
    console.error(`[AnnualLeave] Deduction skipped: ${error?.name || 'Error'}`, error?.message)
    return null
  }
}

function annualLeaveWarnings(outcome) {
  if (outcome?.state !== 'failed') return []
  return [{ code: 'ANNUAL_LEAVE_DEDUCTION_FAILED', message: outcome.message }]
}

/* ---------------------------- 調休：核准扣用存摺、撤回返還 ---------------------------- */

// 只在單據上加紀錄（扣用的明細在存摺上）；剛核准後極少數遇到並行更新時，重新載入再寫一次
async function appendRequestLogs(doc, logs) {
  let target = doc
  for (let attempt = 0; attempt < 2; attempt += 1) {
    logs.forEach(log => target.logs.push(log))
    try {
      await target.save()
      return
    } catch (error) {
      if (error?.name !== 'VersionError' || attempt === 1) {
        console.error(`[CompLeave] Failed to record outcome: ${error?.name || 'Error'}`)
        return
      }
      const fresh = await ApprovalRequest.findById(doc._id)
      if (!fresh) return
      target = fresh
    }
  }
}

function compLeaveFailureMessage(error) {
  if (error?.code === 'COMP_LEAVE_INSUFFICIENT') {
    return `調休扣用失敗：存摺可用 ${hoursWithDays(Math.max(Number(error.availableHours) || 0, 0))}，本次需扣 ${hoursWithDays(error.requestedHours)}，請人資確認調休存摺後手動調整`
  }
  return '調休扣用失敗：系統發生錯誤，請人資確認調休存摺後手動調整'
}

// 單據上的時間欄位型別（date / datetime）：判斷整天或有時分
async function leaveFieldTypes(form, leaveFields) {
  const fields = await loadFormFields(form._id)
  return { startType: fieldTypeOf(fields, leaveFields.startId), endType: fieldTypeOf(fields, leaveFields.endId) }
}

/*
 * 調休單核准時扣用存摺（依到期日、取得日先後，可跨好幾筆額度）；整天調休的日子當天具國定假日性質（holidayResolver）。
 * 回傳 { state, hours, message }，不是調休回傳 null。扣用失敗不影響審核結果（核准前已檢查過餘額），寫進單據紀錄並回傳警告給核准的人。
 */
async function handleCompLeaveConsumption(doc) {
  try {
    const form = await FormTemplate.findById(doc.form).lean()
    const analysis = await analyzeCompLeave(form, doc.form_data)
    if (!analysis || !doc.applicant_employee || !(analysis.hours > 0)) return null
    const hours = analysis.hours
    const { leaveFields, policy } = analysis
    const applicant = await Employee.findById(normalizeId(doc.applicant_employee)).select('_id holidayRegime requiresScheduling isIndigenous').lean()
    const { startType, endType } = await leaveFieldTypes(form, leaveFields)
    const plan = await buildCompLeaveDayPlan({
      employee: applicant || normalizeId(doc.applicant_employee),
      startValue: leaveFields.startId ? doc.form_data?.[leaveFields.startId] : undefined,
      endValue: leaveFields.endId ? doc.form_data?.[leaveFields.endId] : undefined,
      startType,
      endType,
      hours,
    })
    try {
      const outcome = await consumeCreditsForRequest({
        employeeId: doc.applicant_employee,
        requestId: doc._id,
        hours,
        days: plan.days,
        fullDayDates: plan.fullDayDates,
        policy,
      })
      if (outcome.state === 'consumed') {
        const dates = outcome.fullDayDates?.length ? `，整天調休：${outcome.fullDayDates.join('、')}` : ''
        await appendRequestLogs(doc, [{ action: 'comp_leave', message: `已扣用調休 ${hoursWithDays(hours)}${dates}` }])
      }
      return { state: outcome.state, hours }
    } catch (error) {
      console.error(`[CompLeave] Failed to consume: ${error?.name || 'Error'}`, error?.code || '')
      const message = compLeaveFailureMessage(error)
      await appendRequestLogs(doc, [{ action: 'comp_leave_error', message }])
      return { state: 'failed', hours, message }
    }
  } catch (error) {
    console.error(`[CompLeave] Consumption skipped: ${error?.name || 'Error'}`, error?.message)
    return null
  }
}

function compLeaveWarnings(outcome) {
  if (outcome?.state !== 'failed') return []
  return [{ code: 'COMP_LEAVE_CONSUMPTION_FAILED', message: outcome.message }]
}

/*
 * 核准到最後一關前（這次核准會讓單據變成已核准）再檢查一次調休存摺：送出之後存摺可能被人資扣除、其他調休單先核准，
 * 不夠時不核准（409 COMP_LEAVE_INSUFFICIENT），單據維持簽核中。不是調休單不檢查。
 */
async function assertCompLeaveCoversApproval({ doc, form }) {
  if (!form || !doc?.applicant_employee) return
  const analysis = await analyzeCompLeave(form, doc.form_data)
  if (!analysis) return
  await assertCompLeaveAvailable({
    hours: analysis.hours,
    employeeId: doc.applicant_employee,
    policy: analysis.policy,
    excludeRequestId: doc._id,
    status: 409,
    verb: '這張單需要',
  })
}

/* ---------------------------- 建立送審單 ---------------------------- */

export async function createApprovalRequest(req, res) {
  let actorId = ''
  let idempotencyKey = ''
  let requestId = null
  let claimed = []
  let compLease = null
  try {
    const body = req.body || {}
    const { form_id, form_data, applicant_employee_id } = body
    actorId = getAuthenticatedEmployeeId(req)
    if (!actorId) return res.status(401).json({ error: MESSAGES.invalidUser })
    if (hasIdentityOverride(applicant_employee_id, actorId)) {
      return res.status(403).json({ error: '不可代替他人送出申請' })
    }
    idempotencyKey = getIdempotencyKey(req)
    if (idempotencyKey.length > 128) {
      return res.status(400).json({ error: 'Idempotency-Key 長度不可超過 128 個字元' })
    }
    if (idempotencyKey) {
      const existing = await ApprovalRequest.findOne({
        applicant_employee: actorId,
        idempotency_key: idempotencyKey,
      })
      if (existing) return res.status(200).json(existing)
    }
    if (!form_id) return res.status(400).json({ error: '請選擇要申請的表單' })
    if (!isObjectIdString(String(form_id))) return res.status(400).json({ error: '表單編號格式不正確' })
    const form = await FormTemplate.findById(form_id)
    if (!form) return res.status(400).json({ error: '找不到這個表單' })
    if (!form.is_active) return res.status(400).json({ error: '這個表單已停用，無法申請' })

    const wf = await ApprovalWorkflow.findOne({ form: form._id })
    if (!wf || !wf.steps?.length) {
      return res.status(400).json({ error: `【${form.name}】尚未設定簽核流程，請聯絡管理員` })
    }

    const applicantEmp = await Employee.findById(actorId)
    if (!applicantEmp) return res.status(401).json({ error: MESSAGES.invalidUser })

    // 只留下表單定義的欄位並檢查型別、大小；之後的檢核與儲存都用整理過的資料
    const fields = await loadFormFields(form._id)
    const { data: sanitized, fileFieldIds } = sanitizeApprovalFormData({ fields, formData: form_data })

    await assertApprovalRequestCompliance({
      form,
      formData: sanitized,
      applicantEmployeeId: applicantEmp?._id || req.user?.id,
      checkLeaveConflicts: true,
    })
    // 調休：檢查存摺到建立單據之間同一位員工只處理一筆（連點、兩個分頁同時送出不會一起超過存摺）
    const leaveCheck = await assertLeaveAllowed({
      form,
      formData: sanitized,
      applicantEmp,
      fields,
      lockCompLeave: async (employeeId) => { compLease = await acquireCompFilingLease(employeeId) },
    })

    // 依每關解析審核人
    const { steps } = await buildRequestSteps({ wf, applicantEmp, form })

    // 附件：只能用自己上傳、尚未用過的檔案；通過後綁定到這張單
    requestId = newRequestId()
    const bound = await bindApprovalAttachments({ data: sanitized, fileFieldIds, actorId, requestId })
    claimed = bound.claimed

    const applicantRef = applicantEmp?._id || req.user?.id
    const draft = {
      status: 'pending',
      current_step_index: 0,
      steps,
      logs: [{ action: 'create', by_employee: applicantRef, message: '建立送審單' }],
    }
    // 進入第一個有簽核人的關卡（前面沒有人的選填關卡略過）
    startRequest(draft)

    const doc = await ApprovalRequest.create({
      _id: requestId,
      form: form._id,
      workflow: wf._id,
      form_data: bound.data,
      applicant_employee: applicantRef,
      applicant_org: applicantEmp?.organization,
      applicant_department: applicantEmp?.department,
      idempotency_key: idempotencyKey || undefined,
      status: draft.status,
      current_step_index: draft.current_step_index,
      steps: draft.steps,
      logs: draft.logs,
    })

    const currentStep = doc.steps[doc.current_step_index]
    const approverIds = (currentStep?.approvers || [])
      .filter(a => a.decision === 'pending')
      .map(a => a.approver)
    await notifyUsers(approverIds, `有新的【${form.name}】待簽`)

    // 事假、病假等超過額度但設定為「警告」時，單照常送出，回應多帶 warnings 讓畫面提醒申請人（沒有警告時內容與以前相同）
    if (leaveCheck.warnings.length) return res.status(201).json({ ...toPlainDoc(doc), warnings: leaveCheck.warnings })
    return res.status(201).json(doc)
  } catch (e) {
    if (claimed.length) await releaseAttachments(requestId, claimed)
    if (e?.code === 11000 && actorId && idempotencyKey) {
      const existing = await ApprovalRequest.findOne({
        applicant_employee: actorId,
        idempotency_key: idempotencyKey,
      })
      if (existing) return res.status(200).json(existing)
    }
    return respondError(res, e, 'create')
  } finally {
    if (compLease) await compLease.release()
  }
}

/* ---------------------------- 取得送審單 ---------------------------- */

function lastReturnSummary(logs) {
  const entries = Array.from(logs || [])
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const log = entries[index]
    const isReturn = log?.action === 'return' || (log?.action === 'admin_override' && log?.decision === 'return')
    if (!isReturn) continue
    return {
      at: log.at,
      by: log.by_employee && typeof log.by_employee === 'object' ? log.by_employee : null,
      comment: log.comment ?? null,
      message: log.message,
      step_order: log.step_order ?? null,
    }
  }
  return null
}

// 畫面上每個人名旁邊都要顯示大頭照，所以送審單裡的人（申請人、簽核人、紀錄的操作人）都帶 photo（照片路徑，
// 沒有照片時沒有值）；實際圖片由 GET /api/employees/:id/photo 取得，這裡不放圖片內容
const DETAIL_APPLICANT_FIELDS = 'name employeeId department organization photo'
const DETAIL_PERSON_FIELDS = 'name employeeId photo'

/*
 * 這張請假單的申請人在請假當年的各假別餘額。簽核中的單略過它自己（顯示的是「這張單核准前」的餘額），
 * 並附上 focus：這張單的假別、時數、核准後剩多少、有沒有超額。已核准／其他狀態的單已經算在餘額裡，不略過也不附 focus。
 */
async function loadRequestLeaveBalances(doc) {
  const analysis = await analyzeLeaveRequest(doc.form, doc.form_data)
  const policy = await getLeavePolicy()
  const matched = analysis ? matchLeaveType(analysis.names, policy.types) : null
  const isPending = doc.status === 'pending'
  const balances = await buildLeaveBalances({
    employeeId: normalizeId(doc.applicant_employee),
    year: analysis ? leaveYearOf(doc.form_data, analysis.leaveFields) : currentTaipeiYear(),
    excludeRequestId: isPending ? doc._id : null,
    focusKey: matched?.key || null,
    policy,
  })
  if (!balances) return null
  const focus = analysis && isPending
    ? describeRequestFocus({ balances, policy, names: analysis.names, requestedHours: analysis.hours })
    : null
  const compensatory = await loadRequestCompensatoryBank({ doc, policy, matched, balances })
  return compensatory ? { ...balances, focus, compensatory } : { ...balances, focus }
}

/*
 * 簽核人看得到申請人的調休存摺（每一筆額度的來源、狀態、用在哪張單）：調休單一定附上，其他請假單在申請人有任何額度時附上。
 * thisRequest：這張單已經在存摺上扣了哪些額度（核准後才有）。
 */
async function loadRequestCompensatoryBank({ doc, policy, matched, balances }) {
  const compType = typeof leaveBalanceModule.findCompLeaveType === 'function' ? leaveBalanceModule.findCompLeaveType(policy) : null
  if (!compType) return null
  const isCompRequest = matched?.key === compType.key
  const item = (balances?.items || []).find(entry => entry.key === compType.key)
  const bank = await buildCompensatoryBank({
    employeeId: normalizeId(doc.applicant_employee),
    pendingHours: item?.pendingHours || 0,
    policy,
    includeVoid: false,
  })
  if (!isCompRequest && !bank.credits.length) return null
  return { ...bank, focus: isCompRequest, thisRequest: isCompRequest ? await findRequestConsumption(doc._id) : null }
}

/* 取得送審單 */
export async function getApprovalRequest(req, res) {
  try {
    const actorId = getAuthenticatedEmployeeId(req)
    if (!actorId) return res.status(401).json({ error: MESSAGES.invalidUser })
    const requestId = requireRequestId(req)
    const doc = await ApprovalRequest.findById(requestId)
      .populate('form', 'name category semanticType')
      .populate('applicant_employee', DETAIL_APPLICANT_FIELDS)
      .populate('steps.approvers.approver', DETAIL_PERSON_FIELDS)
      .populate('logs.by_employee', DETAIL_PERSON_FIELDS)
    if (!doc) return res.status(404).json({ error: MESSAGES.notFound })
    const isAdmin = req.user?.role === 'admin'
    // 簽核人與申請人之外，申請人在排班範圍內的主管也可以唯讀開啟（排班頁「相關簽核」列出這些單）；
    // 簽核、撤回、重送的權限仍只看簽核人與申請人，下方 viewer 的判斷不受影響
    if (!isAdmin && !isApprovalParticipant(doc, actorId) && !(await isApplicantInScheduleScope(req, doc.applicant_employee))) {
      return res.status(404).json({ error: MESSAGES.notFound })
    }

    const result = doc.toObject()
    if (doc.form) {
      const fields = await FormField.find({ form: doc.form._id }).sort({ order: 1 })
      result.form.fields = await resolveFieldsOptions(fields)
    } else {
      // 表單範本已被刪除：仍要讓單據可以開啟檢視
      const formId = typeof doc.populated === 'function' ? doc.populated('form') : null
      result.form = { _id: formId ? normalizeId(formId) : null, name: '（表單已刪除）', category: '', fields: [], deleted: true }
    }
    if (doc.form && isLeaveFormTemplate(doc.form) && doc.applicant_employee?._id) {
      try {
        result.leave_balance = await getAnnualLeaveBalance(doc.applicant_employee._id)
      } catch (err) {
        // 特休餘額僅供顯示參考，查詢失敗不應阻擋簽核表單載入
        result.leave_balance = null
      }
      // 申請人所有假別的餘額（時數）：簽核人看得到這個人各種假還剩多少，這張單核准前後的差別也一併帶上
      try {
        result.leave_balances = await loadRequestLeaveBalances(doc)
      } catch (err) {
        console.error(`[LeaveBalance] Detail balances skipped: ${err?.name || 'Error'}`)
        result.leave_balances = null
      }
    }

    // 給畫面判斷按鈕用：我是不是申請人、現在能不能簽、管理員能不能代為處理
    const isApplicant = normalizeId(doc.applicant_employee) === actorId
    const currentStep = doc.steps?.[doc.current_step_index]
    const canAct = doc.status === 'pending' && !isApplicant && Boolean(currentStep?.approvers?.some(
      approver => normalizeId(approver.approver) === actorId && approver.decision === 'pending',
    ))
    result.viewer = {
      is_applicant: isApplicant,
      can_act: canAct,
      can_override: isAdmin && doc.status === 'pending' && !isApplicant && !canAct,
    }
    result.last_return = lastReturnSummary(result.logs)
    return res.json(result)
  } catch (e) {
    return respondError(res, e, 'get')
  }
}

/* ---------------------------- 清單（我的申請 / 待簽 / 歷史） ---------------------------- */

function parseListPaging(query = {}) {
  const hasPage = query.page !== undefined && query.page !== ''
  const hasLimit = query.limit !== undefined && query.limit !== ''
  const paginated = hasPage || hasLimit
  const pageNumber = Number.parseInt(query.page, 10)
  const limitNumber = Number.parseInt(query.limit, 10)
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? pageNumber : 1
  const limit = paginated
    ? Math.min(Number.isFinite(limitNumber) && limitNumber >= 1 ? limitNumber : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    : LEGACY_LIST_LIMIT
  return { paginated, page, limit, skip: paginated ? (page - 1) * limit : 0 }
}

// K6 list shape：
// - 帶 ?page= 或 ?limit=（預設每頁 50、最多 200）→ { items, total, page, limit }
// - 都沒帶 → 與以往相同的純陣列（最多 500 筆，最新的在前）
// 兩種都會帶 X-Total-Count / X-Page / X-Limit 標頭，純陣列的呼叫端可據此知道是否有更多資料。
function respondList(res, { items, total, page, limit, paginated }) {
  if (typeof res.set === 'function') {
    res.set('X-Total-Count', String(total))
    res.set('X-Page', String(page))
    res.set('X-Limit', String(limit))
  }
  return res.json(paginated ? { items, total, page, limit } : items)
}

const LIST_FORM_FIELDS = 'name category semanticType'
const LIST_APPLICANT_FIELDS = 'name employeeId department organization photo'
const LIST_APPROVER_FIELDS = 'name'

/* 申請者的清單 */
export async function myApprovalRequests(req, res) {
  try {
    const empId = getAuthenticatedEmployeeId(req)
    if (!empId) return res.status(401).json({ error: MESSAGES.invalidUser })
    if (hasIdentityOverride(req.query?.employee_id, empId)) {
      return res.status(403).json({ error: '只能查看自己的申請' })
    }
    const paging = parseListPaging(req.query)
    const filter = { applicant_employee: empId }
    const [items, total] = await Promise.all([
      ApprovalRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .populate('form', LIST_FORM_FIELDS)
        .populate('applicant_employee', LIST_APPLICANT_FIELDS)
        .populate('steps.approvers.approver', LIST_APPROVER_FIELDS)
        .lean(),
      ApprovalRequest.countDocuments(filter),
    ])
    return respondList(res, { items, total, ...paging })
  } catch (e) {
    return respondError(res, e, 'list mine')
  }
}

/* 審核者的待辦匣：目前關卡包含我、且我的 decision 是 pending */
export async function inboxApprovals(req, res) {
  try {
    const empId = getAuthenticatedEmployeeId(req)
    if (!empId) return res.status(401).json({ error: MESSAGES.invalidUser })
    if (hasIdentityOverride(req.query?.employee_id, empId)) {
      return res.status(403).json({ error: '只能查看自己的待簽核事項' })
    }
    const paging = parseListPaging(req.query)
    if (!isObjectIdString(empId)) return respondList(res, { items: [], total: 0, ...paging })

    const employeeObjectId = new mongoose.Types.ObjectId(empId)
    // 先用索引縮小範圍，再由 $expr 確認「目前關卡」才是有我待簽的那一關（分頁與總數才會正確）
    const filter = {
      status: 'pending',
      steps: {
        $elemMatch: {
          approvers: { $elemMatch: { approver: employeeObjectId, decision: 'pending' } },
        },
      },
      $expr: {
        $let: {
          vars: { step: { $arrayElemAt: ['$steps', '$current_step_index'] } },
          in: {
            $gt: [{
              $size: {
                $filter: {
                  input: { $ifNull: ['$$step.approvers', []] },
                  as: 'candidate',
                  cond: {
                    $and: [
                      { $eq: ['$$candidate.approver', employeeObjectId] },
                      { $eq: ['$$candidate.decision', 'pending'] },
                    ],
                  },
                },
              },
            }, 0],
          },
        },
      },
    }
    const [items, total] = await Promise.all([
      ApprovalRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .populate('form', LIST_FORM_FIELDS)
        .populate('applicant_employee', LIST_APPLICANT_FIELDS)
        .populate('steps.approvers.approver', LIST_APPROVER_FIELDS)
        .lean(),
      ApprovalRequest.countDocuments(filter),
    ])
    return respondList(res, { items, total, ...paging })
  } catch (e) {
    return respondError(res, e, 'list inbox')
  }
}

// 「真的簽過」：核可要有簽核時間（舊資料把沒簽的人記成 approved 但沒有時間）、否決、退簽
const DECIDED_APPROVER_MATCH = [
  { decision: { $in: ['rejected', 'returned'] } },
  { decision: 'approved', decided_at: { $type: 'date' } },
]

function isDecidedApproval(approver) {
  if (!approver) return false
  if (approver.decision === 'rejected' || approver.decision === 'returned') return true
  return approver.decision === 'approved' && Boolean(approver.decided_at)
}

function buildHistoryItem(obj, empId, { isAdmin }) {
  const mine = []
  const others = []
  ;(obj.steps || []).forEach((step, index) => {
    const stepOrder = step.step_order ?? (index + 1)
    ;(step.approvers || []).forEach((approver) => {
      if (!isDecidedApproval(approver)) return
      const action = {
        step_order: stepOrder,
        decision: approver.decision,
        decided_at: approver.decided_at,
        comment: approver.comment,
      }
      if (normalizeId(approver.approver) === empId) mine.push(action)
      else others.push({ ...action, approver: approver.approver })
    })
  })

  const item = {
    _id: obj._id,
    status: obj.status,
    form: obj.form,
    applicant_employee: obj.applicant_employee,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    my_approvals: mine,
  }
  if (isAdmin) {
    // 管理員看全部：自己沒簽過的單，顯示其他人的簽核動作（oversight）
    item.oversight = mine.length === 0
    if (!mine.length) item.my_approvals = others
    item.current_step_index = obj.current_step_index
    if (obj.status === 'pending') {
      const currentStep = (obj.steps || [])[obj.current_step_index]
      item.pending_approvers = (currentStep?.approvers || [])
        .filter(approver => approver.decision === 'pending')
        .map(approver => approver.approver)
    }
  }
  return item
}

/* 已簽核歷史紀錄：每位簽核人看自己簽過的單；管理員看全部（可用 ?status= 篩選，含進行中） */
export async function historyApprovals(req, res) {
  try {
    const empId = getAuthenticatedEmployeeId(req)
    if (!empId) return res.status(401).json({ error: MESSAGES.invalidUser })
    if (hasIdentityOverride(req.query?.employee_id, empId)) {
      return res.status(403).json({ error: '只能查看自己的簽核紀錄' })
    }
    const isAdmin = req.user?.role === 'admin'
    const paging = parseListPaging(req.query)

    let filter
    if (isAdmin) {
      filter = {}
      const status = String(req.query?.status || '')
      if (HISTORY_STATUSES.includes(status)) filter.status = status
    } else {
      filter = {
        steps: {
          $elemMatch: {
            approvers: { $elemMatch: { approver: empId, $or: DECIDED_APPROVER_MATCH } },
          },
        },
      }
    }

    let query = ApprovalRequest.find(filter)
      .sort({ updatedAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate('form', LIST_FORM_FIELDS)
      .populate('applicant_employee', LIST_APPLICANT_FIELDS)
    if (isAdmin) query = query.populate('steps.approvers.approver', LIST_APPROVER_FIELDS)
    const [docs, total] = await Promise.all([query.lean(), ApprovalRequest.countDocuments(filter)])

    const items = docs
      .map((doc) => buildHistoryItem(typeof doc.toObject === 'function' ? doc.toObject() : doc, empId, { isAdmin }))
      .filter(item => isAdmin || item.my_approvals.length)
    return respondList(res, { items, total, ...paging })
  } catch (e) {
    return respondError(res, e, 'list history')
  }
}

/* ---------------------------- 簽核動作（核可 / 否決 / 退簽） ---------------------------- */

function notStepApproverError(me) {
  if (me?.decision === 'skipped') return fail(409, '這一關已由其他簽核人處理完成', { code: 'ALREADY_DECIDED' })
  if (me && me.decision !== 'pending') return fail(409, '您已經處理過這一關，請重新整理頁面', { code: 'ALREADY_DECIDED' })
  return fail(409, '目前不是由您簽核的關卡，或這一關已被他人處理，請重新整理頁面', { code: 'NOT_STEP_APPROVER' })
}

const DECISION_VERBS = { approve: '核可', reject: '否決', return: '退簽' }

const STEP_CHANGED_MESSAGE = '這張簽核單剛被其他人處理，目前關卡已經改變，請重新整理後再確認'

// 選填：畫面上看到的是第幾關。帶了而且和單據目前的關卡不一樣，代表這個畫面已經過期（另一個分頁、另一位管理員剛處理過）
function parseExpectedStepOrder(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (!Number.isInteger(value) || value < 1) throw fail(400, '關卡編號格式不正確')
  return value
}

/* Approve/Reject/Return */
export async function actOnApproval(req, res) {
  try {
    const body = req.body || {}
    const { decision } = body
    const empId = getAuthenticatedEmployeeId(req)
    if (!empId) return res.status(401).json({ error: MESSAGES.invalidUser })
    if (hasIdentityOverride(body.employee_id, empId)) {
      return res.status(403).json({ error: '不可代替他人簽核' })
    }
    if (!['approve', 'reject', 'return'].includes(decision)) {
      return res.status(400).json({ error: '不支援的簽核動作' })
    }
    const comment = parseComment(body.comment)
    const requestId = requireRequestId(req)
    const expectedStepOrder = parseExpectedStepOrder(body.step_order)
    const isAdmin = req.user?.role === 'admin'

    // 第一次嘗試時單據停在第幾關：並行更新後重新載入，單據若已經前進（或退回）到別的關卡，
    // 同一個動作不能套用到另一關（兩位管理員同時代為核可，不能變成連跳兩關；連按兩次退簽也不能退兩關）
    let firstAttemptIndex = null
    const saved = await withVersionRetry(async () => {
      const doc = await ApprovalRequest.findById(requestId)
      if (!doc) throw fail(404, MESSAGES.notFound)
      if (!isAdmin && !isApprovalParticipant(doc, empId)) throw fail(404, MESSAGES.notFound)
      if (doc.status !== 'pending') {
        throw fail(409, '這張簽核單已不是待簽核狀態（可能已被處理或撤回），請重新整理頁面', { code: 'NOT_PENDING' })
      }
      if (normalizeId(doc.applicant_employee) === empId) {
        throw fail(403, '不可簽核自己的申請單；若要取消請使用「撤回」', { code: 'SELF_APPROVAL' })
      }

      const idx = doc.current_step_index
      if (firstAttemptIndex === null) firstAttemptIndex = idx
      else if (idx !== firstAttemptIndex) throw fail(409, STEP_CHANGED_MESSAGE, { code: 'CONFLICT' })
      const step = doc.steps[idx]
      if (!step) throw fail(400, '簽核單的關卡資料異常，請聯絡管理員')
      if (expectedStepOrder !== undefined && expectedStepOrder !== (step.step_order ?? idx + 1)) {
        throw fail(409, STEP_CHANGED_MESSAGE, { code: 'CONFLICT' })
      }
      const me = step.approvers.find(approver => String(approver.approver) === String(empId))
      const isOverride = !me || me.decision !== 'pending'
      // 管理員同時是這一關的簽核人、而且已經處理過：重複送出（雙擊、另一個分頁、並行重試）不能默默變成代為處理，
      // 否則會跳過同一關其他必簽的人。只有「代為處理」對話框明確帶 override: true 才放行；
      // 單純不在這一關名單上的管理員仍直接走代為處理（帶不帶旗標都可以）。
      if (me && me.decision !== 'pending' && body.override !== true) throw notStepApproverError(me)
      if (isOverride && !isAdmin) throw notStepApproverError(me)

      if (decision === 'return' && step.can_return === false) {
        throw fail(400, '這一關不允許退簽，請改用核可或否決', { code: 'RETURN_NOT_ALLOWED' })
      }

      let approveForm = null
      if (decision === 'approve') {
        // 核可時重新檢核勞動規範（加班時數、班表等）；送簽之後才新增／改為必填的欄位不追溯，
        // 否則管理員加一個必填欄位就會讓所有待簽的單都無法核可
        const form = await FormTemplate.findById(normalizeId(doc.form))
        if (!form) {
          throw fail(409, '這張單的表單已被刪除或停用，無法核可；請改用否決或退簽', { code: 'FORM_NOT_AVAILABLE' })
        }
        approveForm = form
        await assertApprovalRequestCompliance({
          form,
          formData: doc.form_data || {},
          applicantEmployeeId: doc.applicant_employee,
          ignoreRequestId: doc._id,
          requiredFieldsAsOf: doc.createdAt,
        })
      }

      const at = new Date()
      const stepOrder = step.step_order ?? idx + 1
      const verb = DECISION_VERBS[decision]
      if (isOverride) {
        // 管理員代為處理：不是這關的簽核人，單據上留下 admin_override 紀錄
        doc.logs.push({
          action: 'admin_override',
          message: `管理員代為${verb}第 ${stepOrder} 關${comment ? `：${comment}` : ''}`,
          comment,
          by_employee: empId,
          step_order: stepOrder,
          decision,
        })
      } else {
        me.decision = decision === 'reject' ? 'rejected' : (decision === 'return' ? 'returned' : 'approved')
        me.comment = comment
        me.decided_at = at
      }

      let transition = { completed: false, nextApprovers: [] }
      if (decision === 'reject') {
        doc.status = 'rejected'
        if (!isOverride) {
          doc.logs.push({ action: 'reject', message: comment, comment, by_employee: empId, step_order: stepOrder, decision })
        }
      } else if (decision === 'return') {
        const outcome = applyReturn(doc, idx, at)
        if (!isOverride) {
          const target = outcome.toApplicant ? '退回申請者' : `退回到第 ${outcome.targetIndex + 1} 關`
          doc.logs.push({
            action: 'return',
            message: comment ? `${target}：${comment}` : target,
            comment,
            by_employee: empId,
            step_order: stepOrder,
            decision,
          })
        }
      } else {
        if (isOverride) {
          skipRemainingApprovers(step, { at, comment: '管理員代為核可' })
        } else {
          doc.logs.push({ action: 'approve', message: comment, comment, by_employee: empId, step_order: stepOrder, decision })
        }
        transition = advanceApprovalState(doc, at)
        // 這次核准讓調休單變成已核准：存摺不夠就不核准（送出之後存摺可能被扣除或用掉）
        if (doc.status === 'approved') await assertCompLeaveCoversApproval({ doc, form: approveForm })
      }

      await doc.save()
      return { doc, transition }
    })

    const { doc, transition } = saved
    if (transition.nextApprovers.length) {
      await notifyUsers(transition.nextApprovers, '有新的簽核待處理')
    }
    let warnings = []
    if (transition.completed) {
      warnings = annualLeaveWarnings(await handleAnnualLeaveDeduction(doc))
      warnings = [...warnings, ...compLeaveWarnings(await handleCompLeaveConsumption(doc))]
    }

    const fresh = await ApprovalRequest.findById(doc._id)
    return respondDoc(res, fresh || doc, warnings)
  } catch (error) {
    return respondError(res, error, 'act')
  }
}

/* ---------------------------- 撤回 / 重新送出 ---------------------------- */

export async function cancelApprovalRequest(req, res) {
  try {
    const actorId = getAuthenticatedEmployeeId(req)
    if (!actorId) return res.status(401).json({ error: MESSAGES.invalidUser })
    const requestId = requireRequestId(req)
    const comment = parseComment(req.body?.comment)
    const isAdmin = req.user?.role === 'admin'
    let refundOutcome = null

    const doc = await withVersionRetry(async () => {
      const doc = await ApprovalRequest.findById(requestId)
      const isApplicant = Boolean(doc) && normalizeId(doc.applicant_employee) === normalizeId(actorId)
      // 申請人可撤回自己的單；管理員只能處理「已核准的特休、調休」（返還時數），其餘仍只有申請人能撤回
      if (!doc || (!isApplicant && !(isAdmin && doc.status === 'approved'))) throw fail(404, MESSAGES.notFound)
      if (doc.status === 'canceled') return doc

      if (doc.status === 'approved') {
        const form = await FormTemplate.findById(doc.form).lean()
        const leaveAnalysis = await analyzeLeaveRequest(form, doc.form_data)
        const analysis = leaveAnalysis?.isAnnual ? leaveAnalysis : null
        const compAnalysis = analysis || !leaveAnalysis ? null : (isCompLeaveAnalysis(leaveAnalysis, await getLeavePolicy()) ? leaveAnalysis : null)
        if (!analysis && !compAnalysis) throw fail(409, '已核准的申請單無法撤回，請聯絡管理員', { code: 'CANNOT_CANCEL' })
        if (!isAdmin) {
          const fields = (analysis || compAnalysis).leaveFields
          const startValue = fields.startId ? doc.form_data?.[fields.startId] : undefined
          const start = leaveStartInstant(startValue)
          if (!start || start.getTime() <= Date.now()) {
            throw fail(409, '假期已經開始（或無法判斷開始時間），無法自行撤回，請聯絡管理員', { code: 'LEAVE_STARTED' })
          }
        }
        if (compAnalysis) {
          // 調休：返還這張單在存摺上扣過的時數（只退確實扣過的，重試不會重複返還）
          if (!refundOutcome) {
            try {
              refundOutcome = await refundCreditsForRequest({ requestId: doc._id })
            } catch (error) {
              console.error(`[CompLeave] Refund failed: ${error?.name || 'Error'}`, error?.message)
              throw fail(500, '返還調休失敗，單據未變更，請稍後再試或聯絡管理員')
            }
          }
          const detail = refundOutcome.refunded
            ? `已撤回已核准的調休，返還 ${hoursWithDays(refundOutcome.hours)}`
            : '已撤回已核准的調休（原核准時沒有扣用調休存摺，無需返還）'
          doc.status = 'canceled'
          doc.logs.push({
            action: 'cancel',
            message: comment ? `${detail}：${comment}` : detail,
            comment,
            by_employee: actorId,
          })
          await doc.save()
          return doc
        }
        // 返還的是核准當時記下的扣減時數（以前以天數記錄的舊單只有 days，乘 8 換成小時）；沒有記錄才重新計算
        const recorded = doc.annual_leave?.state === 'deducted'
          ? (doc.annual_leave.hours > 0 ? doc.annual_leave.hours : daysToHours(doc.annual_leave.days))
          : 0
        const hours = recorded > 0 ? recorded : analysis.hours
        if (!refundOutcome) {
          try {
            refundOutcome = await refundAnnualLeave(doc.applicant_employee, hours, doc._id)
          } catch (error) {
            console.error(`[AnnualLeave] Refund failed: ${error?.name || 'Error'}`, error?.message)
            throw fail(500, '返還特休失敗，單據未變更，請稍後再試或聯絡管理員')
          }
        }
        const refunded = refundOutcome.refunded
        const refundedHours = refundOutcome.hours ?? daysToHours(refundOutcome.days)
        const detail = refunded
          ? `已撤回已核准的特休，返還 ${hoursWithDays(refundedHours)}`
          : '已撤回已核准的特休（原核准時沒有扣減特休，無需返還）'
        if (refunded) doc.annual_leave = { hours: refundedHours, days: hoursToDays(refundedHours, undefined, 4), state: 'refunded', at: new Date() }
        doc.status = 'canceled'
        doc.logs.push({
          action: 'cancel',
          message: comment ? `${detail}：${comment}` : detail,
          comment,
          by_employee: actorId,
        })
        await doc.save()
        return doc
      }

      if (!['pending', 'returned'].includes(doc.status)) {
        throw fail(409, '這張申請單目前的狀態無法撤回', { code: 'CANNOT_CANCEL' })
      }
      doc.status = 'canceled'
      doc.logs.push({ action: 'cancel', message: comment, comment, by_employee: actorId })
      await doc.save()
      return doc
    })
    return res.json(doc)
  } catch (error) {
    return respondError(res, error, 'cancel')
  }
}

// 重新送出時畫面只會送「目前啟用的欄位」。已停用的欄位（有申請單的欄位被刪除時只是停用，舊答案要保留）
// 和這次沒送的欄位，沿用單據上原本的答案；不在表單裡的舊 key 一樣不保留。沿用的是早就存好的答案，不再逐欄檢查，
// 否則停用欄位的舊答案（例如選項後來改過）會讓申請人怎麼改都送不出去。
function keepUneditedAnswers(stored, submitted, fields) {
  const kept = {}
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const known = new Set((fields || []).map(field => String(field._id)))
    for (const [key, value] of Object.entries(stored)) {
      if (known.has(key) && !Object.prototype.hasOwnProperty.call(submitted, key)) kept[key] = value
    }
  }
  return { ...kept, ...submitted }
}

export async function resubmitApprovalRequest(req, res) {
  let requestId = null
  let claimed = []
  let compLease = null
  try {
    const actorId = getAuthenticatedEmployeeId(req)
    if (!actorId) return res.status(401).json({ error: MESSAGES.invalidUser })
    requestId = requireRequestId(req)
    const body = req.body || {}
    const comment = parseComment(body.comment)
    const hasNewData = body.form_data !== undefined

    const saved = await withVersionRetry(async () => {
      const doc = await ApprovalRequest.findById(requestId)
      if (!doc || normalizeId(doc.applicant_employee) !== normalizeId(actorId)) {
        throw fail(404, MESSAGES.notFound)
      }
      if (doc.status !== 'returned') {
        throw fail(409, '只有被退回的申請單可以重新送出', { code: 'NOT_RETURNED' })
      }

      const form = await FormTemplate.findById(doc.form)
      if (!form?.is_active) {
        throw fail(409, '這個表單已停用或已刪除，無法重新送出；請撤回後重新申請', { code: 'FORM_NOT_AVAILABLE' })
      }
      const applicantEmp = await Employee.findById(actorId)
      if (!applicantEmp) throw fail(401, MESSAGES.invalidUser)

      // 內容：有送新的 form_data 就重新整理檢查；沒有就沿用原本的
      const fields = await loadFormFields(form._id)
      const fileFieldIds = fields.filter(field => field.type_1 === 'file').map(field => String(field._id))
      let formData = doc.form_data || {}
      let attachmentFileFieldIds = fileFieldIds
      if (hasNewData) {
        const sanitizedResult = sanitizeApprovalFormData({ fields, formData: body.form_data })
        formData = keepUneditedAnswers(doc.form_data, sanitizedResult.data, fields)
        attachmentFileFieldIds = sanitizedResult.fileFieldIds
      }

      await assertApprovalRequestCompliance({
        form,
        formData,
        applicantEmployeeId: actorId,
        checkLeaveConflicts: true,
        ignoreRequestId: doc._id,
      })
      // 調休：和新申請一樣，檢查存摺到存檔之間同一位員工只處理一筆（重試時沿用已拿到的鎖）
      const leaveCheck = await assertLeaveAllowed({
        form,
        formData,
        applicantEmp,
        fields,
        lockCompLeave: async (employeeId) => { if (!compLease) compLease = await acquireCompFilingLease(employeeId) },
      })

      // 重新解析簽核人（人員、標籤、主管可能已經更動）；流程設定已不存在時沿用原本的簽核人
      const wf = (doc.workflow ? await ApprovalWorkflow.findById(doc.workflow) : null)
        || await ApprovalWorkflow.findOne({ form: form._id })
      if (wf?.steps?.length) {
        const rebuilt = await buildRequestSteps({ wf, applicantEmp, form })
        doc.steps = rebuilt.steps
      } else if (doc.steps.some(step => step.is_required !== false && !(step.approvers || []).length)) {
        throw fail(400, `【${form.name}】的簽核流程已不存在且沒有簽核人，請聯絡管理員`, { code: 'REQUIRED_APPROVER_MISSING' })
      }

      if (hasNewData) {
        // 原本就在這張單上的附件可沿用（舊資料沒有上傳紀錄）；新的附件必須是自己上傳且未用過的
        const alreadyAttached = Object.values(doc.form_data || {})
          .flatMap(value => (Array.isArray(value) ? value : [value]))
          .map(item => /^\/upload\/approvals\/([^/]+)$/.exec(String(item?.url || ''))?.[1])
          .filter(Boolean)
        const bound = await bindApprovalAttachments({
          data: formData,
          fileFieldIds: attachmentFileFieldIds,
          actorId,
          requestId: doc._id,
          alreadyAttached,
        })
        claimed = bound.claimed
        formData = bound.data
        doc.form_data = formData
        doc.markModified('form_data')
      }

      const at = new Date()
      doc.logs.push({
        action: 'resubmit',
        message: comment,
        comment,
        by_employee: actorId,
      })
      const transition = restartRequest(doc, at)
      await doc.save()
      return { doc, transition, leaveWarnings: leaveCheck.warnings }
    })

    const { doc, transition, leaveWarnings } = saved
    const currentApprovers = transition.nextApprovers.length
      ? transition.nextApprovers
      : (doc.steps[doc.current_step_index]?.approvers || []).map(approver => approver.approver)
    if (currentApprovers.length) await notifyUsers(currentApprovers, '有重新送出的簽核待處理')
    let warnings = [...(leaveWarnings || [])]
    if (transition.completed) {
      warnings = [...warnings, ...annualLeaveWarnings(await handleAnnualLeaveDeduction(doc))]
      warnings = [...warnings, ...compLeaveWarnings(await handleCompLeaveConsumption(doc))]
    }
    return respondDoc(res, doc, warnings)
  } catch (error) {
    if (claimed.length && requestId) await releaseAttachments(requestId, claimed)
    return respondError(res, error, 'resubmit')
  } finally {
    if (compLease) await compLease.release()
  }
}
