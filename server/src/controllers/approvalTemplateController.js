import FormTemplate from '../models/form_template.js'
import { buildLiteralSearchRegex } from '../utils/safeSearch.js'
import FormField from '../models/form_field.js'
import ApprovalWorkflow from '../models/approval_workflow.js'
import ApprovalRequest from '../models/approval_request.js'
import Employee from '../models/Employee.js'
import { resolveFieldOptions, resolveFieldsOptions, normalizeFieldKeyInput } from '../services/formFieldOptionsService.js'
import { resetLeaveFieldCache } from '../services/leaveFieldService.js'
import { eligibleEmployeeFilter } from '../services/approverEligibility.js'
import { UNRESOLVED_REASON_TEXT, resolveApproversDetailed } from '../services/approverResolution.js'
import { normalizeSignTag, normalizeSignTags } from '../utils/signTags.js'
import { DEFAULT_APPROVAL_TEMPLATES, DEFAULT_POLICY, findDefaultTemplate } from '../services/defaultApprovalTemplates.js'

const SIGN_ROLE_OPTIONS = [
  { value: 'R001', label: '填報', description: '提出申請與初始資料填寫' },
  { value: 'R002', label: '覆核', description: '確認申請內容與佐證完整性' },
  { value: 'R003', label: '審核', description: '評估申請是否符合政策與規範' },
  { value: 'R004', label: '核定', description: '做出最終核准或駁回決策' },
  { value: 'R005', label: '知會', description: '接收流程進度並保留紀錄' },
  { value: 'R006', label: '財務覆核', description: '檢視成本預算與財務影響' },
  { value: 'R007', label: '人資覆核', description: '確保人事政策與法規符合' },
]

const SIGN_LEVEL_OPTIONS = [
  { value: 'U001', label: 'L1', description: '單位承辦或第一層主管' },
  { value: 'U002', label: 'L2', description: '部門主管或組長' },
  { value: 'U003', label: 'L3', description: '處室主管或經理' },
  { value: 'U004', label: 'L4', description: '高階主管或副執行長' },
  { value: 'U005', label: 'L5', description: '執行長 / 院長 / 董事會' },
]

// 表單性質：決定請假 / 加班相關功能（假勤日曆、特休餘額、扣減、加班檢核）會不會處理這張表單
const SEMANTIC_TYPES = ['general', 'leave', 'overtime', 'shift_change', 'business_trip']
const OVERTIME_NAME_PATTERN = /加班|overtime/i
const LEAVE_NAME_PATTERN = /請假|休假|事假|病假|特休|公假|假單|假別|leave/i
// 名稱雖含假別字眼，但不是「請假申請」本身（例如特休保留、各種證明、銷假、出差），不能被當成請假單
const NOT_LEAVE_REQUEST_NAME_PATTERN = /保留|證明|結算|銷假|出差/

// 依表單名稱推論表單性質；管理員在介面上明確選擇時以選擇為準
export function inferSemanticType(name) {
  const text = String(name ?? '')
  if (OVERTIME_NAME_PATTERN.test(text)) return 'overtime'
  if (LEAVE_NAME_PATTERN.test(text) && !NOT_LEAVE_REQUEST_NAME_PATTERN.test(text)) return 'leave'
  return 'general'
}

// 空值視為未指定；回傳 { valid, value }
function parseSemanticTypeInput(raw) {
  if (raw === undefined || raw === null || raw === '') return { valid: true, value: undefined }
  if (typeof raw !== 'string' || !SEMANTIC_TYPES.includes(raw)) return { valid: false, value: undefined }
  return { valid: true, value: raw }
}

// true / false / 'true' / 'false' 以外的值視為格式錯誤
function parseBooleanInput(raw) {
  if (raw === true || raw === 'true') return { valid: true, value: true }
  if (raw === false || raw === 'false') return { valid: true, value: false }
  return { valid: false, value: undefined }
}

const VALIDATION_FIELD_LABELS = {
  name: '名稱',
  label: '欄位名稱',
  type_1: '欄位型別',
  category: '分類',
  semanticType: '表單性質',
  approver_type: '簽核類型',
  scope_type: '範圍',
  overdueAction: '逾時處理方式',
  maxApprovalLevel: '最大簽核關卡數',
  overdueDays: '逾時天數',
}

function describeValidationError(error) {
  const details = Object.values(error?.errors || {}).map((item) => {
    const path = String(item?.path || '').split('.').pop()
    const label = VALIDATION_FIELD_LABELS[path] || path || '欄位'
    switch (item?.kind) {
      case 'required': return `「${label}」不可空白`
      case 'enum': return `「${label}」的值不在允許的範圍內`
      case 'maxlength': return `「${label}」太長`
      case 'min':
      case 'max': return `「${label}」超出允許的範圍`
      default: return `「${label}」格式不正確`
    }
  })
  return details.length ? `資料格式不正確：${details.join('、')}` : '資料格式不正確'
}

const DUPLICATE_NAME_MESSAGE = '已經有同名的表單樣板，請換一個名稱'

// 把儲存時的資料庫錯誤轉成中文訊息（重複名稱、驗證失敗、格式錯誤）；其他錯誤沿用原訊息
function describeSaveFailure(error, duplicateMessage = DUPLICATE_NAME_MESSAGE) {
  if (error?.code === 11000) {
    return { status: 409, error: duplicateMessage }
  }
  if (error?.name === 'ValidationError') return { status: 400, error: describeValidationError(error) }
  if (error?.name === 'CastError') return { status: 400, error: '資料格式不正確，請檢查後再試' }
  return { status: 400, error: error?.message || '儲存失敗' }
}

function respondSaveFailure(res, error, duplicateMessage) {
  const failure = describeSaveFailure(error, duplicateMessage)
  return res.status(failure.status).json({ error: failure.error })
}

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/

function isObjectIdString(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
}

const FORM_ID_INVALID_MESSAGE = '表單編號格式不正確'
const SERVER_ERROR_MESSAGE = '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員'

// 讀取、刪除、補齊預設值這類失敗：只在伺服器記下錯誤名稱，不把資料庫或框架的英文訊息回給前端
function respondFailure(res, error, context) {
  console.error(`[approval-template] ${context} failed: ${error?.name || 'Error'}`)
  if (error?.name === 'CastError') return res.status(400).json({ error: '資料格式不正確，請檢查後再試' })
  return res.status(500).json({ error: SERVER_ERROR_MESSAGE })
}

/**
 * 一次性補正：請假單名稱的判斷詞新增了「假別」（例如客戶的「(全)假別申請單」），
 * 之前啟動時的補正已經把這類表單當作「已處理」標記起來，所以這裡另外用 leave_keyword_migrated 標記只處理一次：
 * 表單性質還是一般、名稱含「假別」的舊表單改成 leave，每張表單只會處理一次，
 * 處理過之後管理員在介面選的表單性質（包含特地選「一般」）不會在重啟後被改回去。
 * 回傳改成請假的筆數。
 */
export async function migrateLeaveKeywordForms() {
  const pending = await FormTemplate.find(
    { leave_keyword_migrated: { $ne: true } },
    { name: 1, semanticType: 1 }
  ).lean()
  const rows = pending || []
  if (!rows.length) return 0

  const isGeneral = (value) => value === undefined || value === null || value === 'general'
  const leaveIds = rows
    .filter(form => isGeneral(form.semanticType) && /假別/.test(String(form.name ?? '')) && inferSemanticType(form.name) === 'leave')
    .map(form => form._id)

  let flipped = 0
  if (leaveIds.length) {
    const result = await FormTemplate.updateMany(
      { _id: { $in: leaveIds }, leave_keyword_migrated: { $ne: true }, semanticType: { $in: ['general', null] } },
      { $set: { semanticType: 'leave', semantic_type_set: true } },
      { timestamps: false }
    )
    flipped = result?.modifiedCount ?? leaveIds.length
    resetLeaveFieldCache()
  }
  await FormTemplate.updateMany(
    { _id: { $in: rows.map(form => form._id) }, leave_keyword_migrated: { $ne: true } },
    { $set: { leave_keyword_migrated: true } },
    { timestamps: false }
  )
  return flipped
}

/**
 * 啟動時補正舊資料：名稱看起來是請假單、表單性質仍是預設 general 的舊表單改成 leave；
 * 名稱看起來是加班單的（例如客戶自建的「加班申請單」）同樣改成 overtime，加班檢核才會套用到它。
 * 只處理「還沒被明確寫入表單性質」的舊表單（semantic_type_set 不是 true）：處理完一律標記，
 * 之後管理員在介面選的表單性質（包含特地選「一般」）不會在重啟後被改回去；重複執行不會再有變動。
 * 回傳改成請假的筆數（改成加班的筆數只記在伺服器日誌）。
 */
export async function migrateLeaveFormSemantics() {
  const pending = await FormTemplate.find(
    { semantic_type_set: { $ne: true } },
    { name: 1, semanticType: 1 }
  ).lean()
  const rows = pending || []
  if (!rows.length) return 0

  const isUnset = (value) => value === undefined || value === null || value === 'general'
  const idsInferredAs = (type) => rows
    .filter(form => isUnset(form.semanticType) && inferSemanticType(form.name) === type)
    .map(form => form._id)
  const leaveFormIds = idsInferredAs('leave')
  const overtimeFormIds = idsInferredAs('overtime')

  let flipped = 0
  if (leaveFormIds.length) {
    const result = await FormTemplate.updateMany(
      { _id: { $in: leaveFormIds }, semantic_type_set: { $ne: true }, semanticType: { $in: ['general', null] } },
      { $set: { semanticType: 'leave', semantic_type_set: true } },
      { timestamps: false }
    )
    flipped = result?.modifiedCount ?? leaveFormIds.length
    resetLeaveFieldCache()
  }
  if (overtimeFormIds.length) {
    const result = await FormTemplate.updateMany(
      { _id: { $in: overtimeFormIds }, semantic_type_set: { $ne: true }, semanticType: { $in: ['general', null] } },
      { $set: { semanticType: 'overtime', semantic_type_set: true } },
      { timestamps: false }
    )
    const flippedOvertime = result?.modifiedCount ?? overtimeFormIds.length
    if (flippedOvertime) console.log(`Migrated semantic types for ${flippedOvertime} overtime forms`)
  }

  const flippedIds = new Set([...leaveFormIds, ...overtimeFormIds].map(String))
  const restIds = rows.map(form => form._id).filter(id => !flippedIds.has(String(id)))
  if (restIds.length) {
    await FormTemplate.updateMany(
      { _id: { $in: restIds }, semantic_type_set: { $ne: true } },
      { $set: { semantic_type_set: true } },
      { timestamps: false }
    )
  }
  return flipped
}

/* ---------------------- FormTemplate CRUD ---------------------- */
export async function listFormTemplates(req, res) {
  try {
    const { q, category, is_active } = req.query
    const isAdmin = req.user?.role === 'admin'
    const filter = {}
    if (q) filter.name = buildLiteralSearchRegex(q)
    if (typeof category === 'string' && category) filter.category = category
    if (!isAdmin) {
      // 一般員工只看得到啟用中的表單：停用的表單選了也送不出去
      filter.is_active = { $ne: false }
    } else if (is_active !== undefined) {
      // 管理員預設看到全部（每筆都帶 is_active 旗標），需要時可用 ?is_active=true|false 篩選
      filter.is_active = is_active === 'true' ? { $ne: false } : false
    }
    const list = await FormTemplate.find(filter).sort({ updatedAt: -1 })
    res.json(list)
  } catch (e) {
    respondFailure(res, e, 'list forms')
  }
}

export async function createFormTemplate(req, res) {
  let doc = null
  try {
    const { category, description, owner_org_id, is_active, semanticType } = req.body || {}
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) return res.status(400).json({ error: '請輸入表單名稱' })
    const semantic = parseSemanticTypeInput(semanticType)
    if (!semantic.valid) return res.status(400).json({ error: '表單性質不正確' })
    doc = await FormTemplate.create({
      name, category, description, owner_org_id,
      semanticType: semantic.value || inferSemanticType(name),
      semantic_type_set: true, // 建立時已寫入表單性質（明確選擇或依名稱推論），啟動補正不會再動它
      is_active: is_active !== undefined ? !!is_active : true,
      created_by: req.user?.id, // 若有 auth
    })
    // 建立預設空流程
    try {
      await ApprovalWorkflow.create({ form: doc._id, steps: [], policy: { ...DEFAULT_POLICY } })
    } catch (workflowError) {
      // 流程沒建起來就不要留下一張沒有流程的樣板
      await FormTemplate.deleteOne({ _id: doc._id }).catch(() => {})
      throw workflowError
    }
    resetLeaveFieldCache()
    res.status(201).json(doc)
  } catch (e) {
    respondSaveFailure(res, e)
  }
}

export async function getFormTemplate(req, res) {
  try {
    const formId = String(req.params.id ?? '')
    if (!isObjectIdString(formId)) return res.status(400).json({ error: FORM_ID_INVALID_MESSAGE })
    const form = await FormTemplate.findById(formId)
    if (!form) return res.status(404).json({ error: '找不到這張表單樣板' })
    const fields = await FormField.find({ form: form._id, is_active: { $ne: false } }).sort({ order: 1 })
    const workflow = await ApprovalWorkflow.findOne({ form: form._id })
    res.json({ form, fields: await resolveFieldsOptions(fields), workflow })
  } catch (e) {
    respondFailure(res, e, 'get form')
  }
}

export async function updateFormTemplate(req, res) {
  try {
    const body = req.body || {}
    const semantic = parseSemanticTypeInput(body.semanticType)
    if (!semantic.valid) return res.status(400).json({ error: '表單性質不正確' })

    // 只更新有帶的欄位；名稱前後空白會去掉，不能改成空白
    const update = {}
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return res.status(400).json({ error: '表單名稱不可空白' })
      update.name = name
    }
    for (const key of ['category', 'description', 'owner_org_id']) {
      if (body[key] !== undefined) update[key] = body[key]
    }
    if (body.is_active !== undefined) {
      const active = parseBooleanInput(body.is_active)
      if (!active.valid) return res.status(400).json({ error: '「啟用」必須是開或關' })
      update.is_active = active.value
    }
    if (semantic.value) {
      update.semanticType = semantic.value
      update.semantic_type_set = true // 管理員明確寫入的表單性質（包含「一般」）重啟後不會被補正改回去
    }

    const updated = await FormTemplate.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    )
    if (!updated) return res.status(404).json({ error: '找不到這張表單樣板' })
    resetLeaveFieldCache()
    res.json(updated)
  } catch (e) {
    respondSaveFailure(res, e)
  }
}

/**
 * 刪除表單樣板。
 * - 沒有任何申請單用過：連同欄位與流程一起刪除。
 * - 已有申請單：不能刪（刪了舊申請單會打不開、簽核中的單子無法處理），改為「停用」並保留欄位與流程，回傳 deactivated: true。
 */
export async function deleteFormTemplate(req, res) {
  try {
    const formId = String(req.params.id ?? '')
    if (!isObjectIdString(formId)) return res.status(400).json({ error: FORM_ID_INVALID_MESSAGE })
    const form = await FormTemplate.findById(formId)
    if (!form) return res.status(404).json({ error: '找不到這張表單樣板' })

    const requestCount = await ApprovalRequest.countDocuments({ form: form._id })
    if (requestCount > 0) {
      const pendingCount = await ApprovalRequest.countDocuments({ form: form._id, status: 'pending' })
      await FormTemplate.findByIdAndUpdate(form._id, { $set: { is_active: false } })
      resetLeaveFieldCache()
      return res.json({
        success: true,
        deleted: false,
        deactivated: true,
        requestCount,
        pendingCount,
        message: `這張表單已有 ${requestCount} 筆申請單（其中 ${pendingCount} 筆簽核中），為了保留歷史紀錄並讓簽核可以繼續，已改為停用而沒有刪除。`,
      })
    }

    await FormField.deleteMany({ form: form._id })
    await ApprovalWorkflow.deleteOne({ form: form._id })
    await FormTemplate.deleteOne({ _id: form._id })
    resetLeaveFieldCache()
    res.json({ success: true, deleted: true, deactivated: false, message: '已刪除表單樣板' })
  } catch (e) {
    respondFailure(res, e, 'delete form')
  }
}

/* ---------------------- FormField CRUD ---------------------- */
export async function addField(req, res) {
  try {
    const form = await FormTemplate.findById(req.params.formId)
    if (!form) return res.status(404).json({ error: '找不到這張表單樣板' })
    const { type_1, type_2, required, options, placeholder, order, is_active } = req.body || {}
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : ''
    if (!label || !type_1) return res.status(400).json({ error: '請填寫欄位名稱並選擇欄位型別' })
    const fieldKey = normalizeFieldKeyInput(req.body.field_key)
    if (!fieldKey.valid) return res.status(400).json({ error: '欄位代碼格式不正確' })
    const doc = await FormField.create({
      form: form._id, label, type_1, type_2, required: !!required, options, placeholder, order: order ?? 0, is_active: is_active !== false,
      ...(fieldKey.provided ? { field_key: fieldKey.value } : {}),
    })
    resetLeaveFieldCache()
    res.status(201).json(await resolveFieldOptions(doc))
  } catch (e) {
    respondSaveFailure(res, e)
  }
}

export async function updateField(req, res) {
  try {
    const body = req.body || {}
    const fieldKey = normalizeFieldKeyInput(body.field_key)
    if (!fieldKey.valid) return res.status(400).json({ error: '欄位代碼格式不正確' })

    // 只更新有帶的欄位；欄位名稱不能改成空白
    const update = {}
    if (body.label !== undefined) {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label) return res.status(400).json({ error: '欄位名稱不可空白' })
      update.label = label
    }
    for (const key of ['type_1', 'type_2', 'options', 'placeholder', 'order']) {
      if (body[key] !== undefined) update[key] = body[key]
    }
    for (const key of ['required', 'is_active']) {
      if (body[key] === undefined) continue
      const parsed = parseBooleanInput(body[key])
      if (!parsed.valid) return res.status(400).json({ error: `「${key === 'required' ? '必填' : '啟用'}」必須是開或關` })
      update[key] = parsed.value
    }
    // 沒帶 field_key 就維持原本的連結；帶空字串 / null 代表解除連結改手動輸入
    if (fieldKey.provided) update.field_key = fieldKey.value

    // 只能改「這張表單」的欄位，避免用別張表單的網址改到不相干的欄位
    const { formId, fieldId } = req.params
    const filter = formId ? { _id: fieldId, form: formId } : { _id: fieldId }
    const updated = await FormField.findOneAndUpdate(
      filter,
      { $set: update },
      { new: true, runValidators: true }
    )
    if (!updated) return res.status(404).json({ error: '找不到這個欄位' })
    resetLeaveFieldCache()
    res.json(await resolveFieldOptions(updated))
  } catch (e) {
    respondSaveFailure(res, e)
  }
}

/**
 * 刪除欄位。這張表單已有申請單時不真的刪（舊申請單要靠欄位顯示當時填的內容），改為停用，回傳 deactivated: true。
 */
export async function deleteField(req, res) {
  try {
    const { formId, fieldId } = req.params
    const filter = formId ? { _id: fieldId, form: formId } : { _id: fieldId }
    const field = await FormField.findOne(filter)
    if (!field) return res.status(404).json({ error: '找不到這個欄位' })

    const requestCount = await ApprovalRequest.countDocuments({ form: field.form })
    if (requestCount > 0) {
      await FormField.findByIdAndUpdate(field._id, { $set: { is_active: false } })
      resetLeaveFieldCache()
      return res.json({
        success: true,
        deleted: false,
        deactivated: true,
        requestCount,
        message: `這張表單已有 ${requestCount} 筆申請單，欄位「${field.label}」已改為停用而沒有刪除：新的申請不會再看到它，舊申請單仍會顯示當時填寫的內容。`,
      })
    }

    await FormField.findByIdAndDelete(field._id)
    resetLeaveFieldCache()
    res.json({ success: true, deleted: true, deactivated: false })
  } catch (e) {
    respondFailure(res, e, 'delete field')
  }
}

export async function listFields(req, res) {
  try {
    const formId = String(req.params.formId ?? '')
    if (!isObjectIdString(formId)) return res.status(400).json({ error: FORM_ID_INVALID_MESSAGE })
    const isAdmin = req.user?.role === 'admin'
    const filter = { form: formId }
    if (!isAdmin) {
      // 填寫申請用的欄位只回傳啟用中的；停用的欄位只有管理員（設計表單時）看得到
      filter.is_active = { $ne: false }
    } else if (req.query?.is_active !== undefined) {
      filter.is_active = req.query.is_active === 'true' ? { $ne: false } : false
    }
    const fields = await FormField.find(filter).sort({ order: 1 })
    res.json(await resolveFieldsOptions(fields))
  } catch (e) {
    respondFailure(res, e, 'list fields')
  }
}

/* ---------------------- Workflow Setting ---------------------- */

// 沒有符合原因代碼時的說明（例如標籤沒有任何在職持有者）：只說「為什麼找不到人」，不帶任何人員姓名或編號
function describeNoApprover(step, reasonCode) {
  if (UNRESOLVED_REASON_TEXT[reasonCode]) return UNRESOLVED_REASON_TEXT[reasonCode]
  const raw = Array.isArray(step?.approver_value) ? step.approver_value[0] : step?.approver_value
  switch (step?.approver_type) {
    case 'tag': {
      const tag = normalizeSignTag(raw)
      return tag ? `目前沒有在職員工持有「${tag}」標籤` : UNRESOLVED_REASON_TEXT['invalid-config']
    }
    case 'role': return '目前沒有符合此角色的在職員工'
    case 'level': return '目前沒有符合此層級的在職員工'
    case 'department': return '指定部門目前沒有在職員工'
    case 'org': return '指定機構目前沒有在職員工'
    case 'group': return '指定的小單位目前沒有在職員工'
    default: return '目前找不到符合條件的在職簽核人'
  }
}

/**
 * 流程預覽（員工申請前就能看到某一關找不到人）：每一關加上
 * - resolved_count：以「目前登入的人當申請人」解析，這一關有幾位可簽核的在職員工（不含申請人本人）；無法計算時為 null
 * - unresolved_reason：resolved_count 為 0 時的中文原因，其餘為 null
 * 只回傳人數與原因，不含任何人員姓名或編號。
 */
async function withApproverPreview(steps, actorId) {
  const list = Array.isArray(steps) ? steps : []
  if (!list.length) return list
  let applicant = null
  if (isObjectIdString(String(actorId ?? ''))) {
    try {
      applicant = await Employee.findById(String(actorId), '_id department organization supervisor')
    } catch (error) {
      console.error(`[approval-template] load applicant for preview failed: ${error?.name || 'Error'}`)
    }
  }
  const previewed = []
  for (const step of list) {
    let resolvedCount = null
    let unresolvedReason = null
    if (applicant) {
      try {
        const { ids, reason } = await resolveApproversDetailed(step, applicant)
        resolvedCount = ids.length
        unresolvedReason = ids.length ? null : describeNoApprover(step, reason)
      } catch (error) {
        console.error(`[approval-template] preview step failed: ${error?.name || 'Error'}`)
      }
    }
    previewed.push({ ...step, resolved_count: resolvedCount, unresolved_reason: unresolvedReason })
  }
  return previewed
}

export async function getWorkflow(req, res) {
  try {
    const formId = String(req.params.formId ?? '')
    if (!isObjectIdString(formId)) return res.status(400).json({ error: FORM_ID_INVALID_MESSAGE })
    const wf = await ApprovalWorkflow.findOne({ form: formId })
    if (!wf) return res.status(404).json({ error: '這張表單還沒有簽核流程' })
    const body = typeof wf.toJSON === 'function' ? wf.toJSON() : { ...wf }
    body.steps = await withApproverPreview(body.steps, req.user?.id)
    res.json(body)
  } catch (e) {
    respondFailure(res, e, 'get workflow')
  }
}

const APPROVER_TYPES = ['manager', 'tag', 'user', 'role', 'level', 'department', 'org', 'group']
const APPROVER_TYPE_LABELS = {
  manager: '主管', tag: '標籤', user: '員工', role: '角色', level: '層級', department: '部門', org: '機構', group: '群組',
}
const SCOPE_TYPES = ['none', 'dept', 'org']
const MAX_WORKFLOW_STEPS = 20
const MAX_TAG_LENGTH = 50
const MAX_STEP_NAME_LENGTH = 50
const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'
const SYSTEM_ROLE_VALUES = ['admin', 'supervisor', 'employee']
const POLICY_OVERDUE_ACTIONS = ['none', 'autoPass', 'autoReject']

function flattenValues(raw) {
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((item) => {
      if (item && typeof item === 'object') return String(item._id ?? item.id ?? item.value ?? '')
      return item == null ? '' : String(item)
    })
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 檢查並整理一關的內容（不查資料庫）。回傳 { step } 或 { error }；
 * employeeIds 是這關指定的員工 / 主管 id，稍後統一確認是否存在。
 */
function cleanWorkflowStep(raw, index) {
  const number = index + 1
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `第${number}關：內容格式不正確` }
  }
  const type = raw.approver_type
  if (!APPROVER_TYPES.includes(type)) {
    return { error: `第${number}關：簽核類型「${type ?? ''}」不正確，請重新選擇` }
  }
  const typeLabel = APPROVER_TYPE_LABELS[type]
  const prefix = `第${number}關（${typeLabel}）`

  const scope = raw.scope_type === undefined || raw.scope_type === null || raw.scope_type === '' ? 'none' : raw.scope_type
  if (!SCOPE_TYPES.includes(scope)) {
    return { error: `${prefix}：範圍「${scope}」不正確，只能選不限、部門或機構` }
  }

  const flags = {}
  for (const [key, label, fallback] of [
    ['is_required', '必簽', true],
    ['all_must_approve', '需全員同意', true],
    ['can_return', '允許退簽', true],
  ]) {
    if (raw[key] === undefined || raw[key] === null) {
      flags[key] = fallback
    } else if (typeof raw[key] === 'boolean') {
      flags[key] = raw[key]
    } else {
      return { error: `${prefix}：「${label}」必須是開或關` }
    }
  }

  let name
  if (raw.name !== undefined && raw.name !== null) {
    if (typeof raw.name !== 'string') return { error: `${prefix}：關卡說明格式不正確` }
    name = raw.name.trim()
    if (name.length > MAX_STEP_NAME_LENGTH) return { error: `${prefix}：關卡說明最多 ${MAX_STEP_NAME_LENGTH} 個字` }
  }

  const values = flattenValues(raw.approver_value)
  let value
  const employeeIds = []
  let managerId = ''
  switch (type) {
    case 'manager': {
      // 沒指定＝申請者的直屬主管；指定時必須是主管的員工 id
      const selected = values[0]
      if (!selected || selected === APPLICANT_SUPERVISOR_VALUE) {
        value = APPLICANT_SUPERVISOR_VALUE
      } else if (isObjectIdString(selected)) {
        value = selected
        managerId = selected
        employeeIds.push(selected)
      } else {
        return { error: `${prefix}：指定的主管資料不正確，請重新選擇` }
      }
      break
    }
    case 'tag': {
      const tag = normalizeSignTag(values[0])
      if (!tag) return { error: `${prefix}：請選擇或輸入簽核標籤` }
      if (tag.length > MAX_TAG_LENGTH) return { error: `${prefix}：標籤最多 ${MAX_TAG_LENGTH} 個字` }
      value = tag
      break
    }
    case 'user': {
      const ids = [...new Set(values)]
      if (!ids.length) return { error: `${prefix}：請至少選擇一位員工` }
      if (ids.some((id) => !isObjectIdString(id))) return { error: `${prefix}：包含無效的員工資料，請重新選擇` }
      value = ids
      employeeIds.push(...ids)
      break
    }
    case 'role': {
      const role = values[0]
      const allowed = [...SYSTEM_ROLE_VALUES, ...SIGN_ROLE_OPTIONS.map((option) => option.value)]
      if (!role) return { error: `${prefix}：請選擇角色` }
      if (!allowed.includes(role)) return { error: `${prefix}：「${role}」不是有效的角色，請重新選擇` }
      value = role
      break
    }
    case 'level': {
      const level = values[0]
      if (!level) return { error: `${prefix}：請選擇層級` }
      if (!SIGN_LEVEL_OPTIONS.some((option) => option.value === level)) {
        return { error: `${prefix}：「${level}」不是有效的層級，請重新選擇` }
      }
      value = level
      break
    }
    case 'department': {
      const department = values[0]
      if (!department) return { error: `${prefix}：請選擇部門` }
      if (!isObjectIdString(department)) return { error: `${prefix}：指定的部門資料不正確，請重新選擇` }
      value = department
      break
    }
    case 'org': {
      const org = values[0]
      if (!org) return { error: `${prefix}：請選擇機構` }
      value = org
      break
    }
    case 'group': {
      const ids = [...new Set(values)]
      if (!ids.length) return { error: `${prefix}：請至少選擇一個小單位` }
      if (ids.some((id) => !isObjectIdString(id))) return { error: `${prefix}：包含無效的小單位資料，請重新選擇` }
      value = ids
      break
    }
    default:
      return { error: `${prefix}：簽核類型不正確` }
  }

  return {
    step: {
      approver_type: type,
      approver_value: value,
      scope_type: scope,
      is_required: flags.is_required,
      all_must_approve: flags.all_must_approve,
      can_return: flags.can_return,
      ...(name ? { name } : {}),
    },
    employeeIds,
    managerId,
  }
}

/**
 * 檢查整條流程（K4）：最多 20 關、每關類型 / 值 / 範圍 / 布林欄位正確、指定的員工與主管真的存在。
 * 依 step_order 排序（沒有就照陣列順序）後重新編號 1..n。
 * 回傳 { steps } 或 { error, step }。
 */
export async function validateWorkflowSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return { error: '關卡設定格式不正確：steps 必須是陣列' }
  if (rawSteps.length > MAX_WORKFLOW_STEPS) {
    return { error: `簽核關卡最多 ${MAX_WORKFLOW_STEPS} 關，目前有 ${rawSteps.length} 關` }
  }

  const cleaned = []
  for (let index = 0; index < rawSteps.length; index += 1) {
    const result = cleanWorkflowStep(rawSteps[index], index)
    if (result.error) return { error: result.error, step: index + 1 }
    const order = Number(rawSteps[index].step_order)
    cleaned.push({ ...result, index, order: Number.isFinite(order) ? order : index + 1 })
  }

  // 指定員工 / 主管必須存在（流程存下去之後才不會在員工送出申請時才發現）
  const employeeIds = [...new Set(cleaned.flatMap((item) => item.employeeIds))]
  if (employeeIds.length) {
    const found = await Employee.find({ _id: { $in: employeeIds } }, { _id: 1, role: 1 }).lean()
    const byId = new Map((found || []).map((employee) => [String(employee._id), employee]))
    for (const item of cleaned) {
      const prefix = `第${item.index + 1}關（${APPROVER_TYPE_LABELS[item.step.approver_type]}）`
      const missing = item.employeeIds.find((id) => !byId.has(id))
      if (missing) return { error: `${prefix}：找不到指定的員工，可能已被刪除，請重新選擇`, step: item.index + 1 }
      if (item.managerId && byId.get(item.managerId)?.role !== 'supervisor') {
        return { error: `${prefix}：指定的人員目前不是主管角色，請重新選擇`, step: item.index + 1 }
      }
    }
  }

  const ordered = [...cleaned].sort((a, b) => (a.order - b.order) || (a.index - b.index))
  return { steps: ordered.map((item, position) => ({ step_order: position + 1, ...item.step })) }
}

/**
 * 檢查通用規則；只回傳有帶的欄位。回傳 { policy } 或 { error }。
 * 目前這些規則只會被記錄，系統尚未依它們自動處理。
 */
function validateWorkflowPolicy(rawPolicy) {
  if (!rawPolicy || typeof rawPolicy !== 'object' || Array.isArray(rawPolicy)) {
    return { error: '通用規則格式不正確' }
  }
  const policy = {}
  if (rawPolicy.maxApprovalLevel !== undefined) {
    const value = Number(rawPolicy.maxApprovalLevel)
    if (!Number.isInteger(value) || value < 1 || value > MAX_WORKFLOW_STEPS) {
      return { error: `最大簽核關卡數必須是 1 到 ${MAX_WORKFLOW_STEPS} 的整數` }
    }
    policy.maxApprovalLevel = value
  }
  if (rawPolicy.allowDelegate !== undefined) {
    if (typeof rawPolicy.allowDelegate !== 'boolean') return { error: '「是否允許代理簽核」必須是開或關' }
    policy.allowDelegate = rawPolicy.allowDelegate
  }
  if (rawPolicy.overdueDays !== undefined) {
    const value = Number(rawPolicy.overdueDays)
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      return { error: '逾時提醒天數必須是 1 到 365 的整數' }
    }
    policy.overdueDays = value
  }
  if (rawPolicy.overdueAction !== undefined) {
    if (!POLICY_OVERDUE_ACTIONS.includes(rawPolicy.overdueAction)) {
      return { error: '逾時處理方式只能選不處理、自動通過或自動退回' }
    }
    policy.overdueAction = rawPolicy.overdueAction
  }
  return { policy }
}

export async function setWorkflow(req, res) {
  try {
    const { formId } = req.params
    const { steps, policy } = req.body || {}
    // 只儲存有帶的部分：只改通用規則時不能把既有關卡清掉，反過來也一樣
    if (steps === undefined && policy === undefined) {
      return res.status(400).json({ error: '請提供要儲存的簽核關卡（steps）或通用規則（policy）' })
    }
    const form = await FormTemplate.findById(formId)
    if (!form) return res.status(404).json({ error: '找不到這張表單樣板' })

    const setObj = {}
    if (steps !== undefined) {
      const checked = await validateWorkflowSteps(steps)
      if (checked.error) {
        return res.status(400).json({ error: checked.error, ...(checked.step ? { step: checked.step } : {}) })
      }
      setObj.steps = checked.steps
    }
    if (policy !== undefined) {
      const checked = validateWorkflowPolicy(policy)
      if (checked.error) return res.status(400).json({ error: checked.error })
      for (const [key, value] of Object.entries(checked.policy)) setObj[`policy.${key}`] = value
    }
    if (!Object.keys(setObj).length) {
      return res.status(400).json({ error: '請提供要儲存的簽核關卡（steps）或通用規則（policy）' })
    }

    const wf = await ApprovalWorkflow.findOneAndUpdate(
      { form: form._id },
      { $set: setObj },
      { new: true, upsert: true, runValidators: true }
    )
    res.json(wf)
  } catch (e) {
    // 同一張表單同時被存了兩次（流程文件唯一索引衝突）
    respondSaveFailure(res, e, '這張表單的流程同時被其他人修改，請重新整理後再試一次')
  }
}

export async function getSignRoles(req, res) {
  res.json(SIGN_ROLE_OPTIONS)
}

export async function getSignLevels(req, res) {
  res.json(SIGN_LEVEL_OPTIONS)
}

/* ---------------------- Default templates (ensure / restore) ---------------------- */
const TEMPLATE_MATCH_PROJECTION = 'name semanticType default_key is_active'

/**
 * 找出「已經存在的」預設表單：先認 default_key，再認原名，
 * 請假 / 加班這類有表單性質的預設再認同性質的表單（客戶改過名也不會再建一張重複的）。
 * claimed：已被別的預設認走的表單 id。
 */
function matchDefaultTemplate(def, templates, claimed = new Set()) {
  const usable = (templates || []).filter((template) => !claimed.has(String(template._id)))
  let template = usable.find((item) => item.default_key === def.key)
  if (template) return { template, matchedBy: 'key' }
  template = usable.find((item) => String(item.name ?? '').trim() === def.name)
  if (template) return { template, matchedBy: 'name' }
  if (def.semanticType && def.semanticType !== 'general') {
    const sameType = usable.filter((item) => item.semanticType === def.semanticType)
    template = sameType.find((item) => item.is_active !== false) || sameType[0]
    if (template) return { template, matchedBy: 'semanticType' }
  }
  return null
}

function cloneSteps(steps) {
  return steps.map((step) => ({ ...step }))
}

/**
 * 建立一張預設表單（含欄位與流程）。同時有人也在補齊而撞到同名時，視為已存在（existing）；
 * 欄位 / 流程建到一半失敗會把這張還沒完成的表單清掉，避免留下空殼。
 */
async function createDefaultTemplate(def, createdBy) {
  let form
  try {
    form = await FormTemplate.create({
      name: def.name,
      category: def.category,
      description: def.description,
      semanticType: def.semanticType,
      semantic_type_set: true,
      default_key: def.key,
      is_active: true,
      created_by: createdBy,
    })
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await FormTemplate.findOne({ name: def.name })
      if (existing) return { existing }
    }
    throw error
  }

  try {
    // Parallelize field and workflow creation for better performance
    await Promise.all([
      FormField.insertMany(def.fields.map(field => ({ ...field, form: form._id, is_active: true }))),
      ApprovalWorkflow.create({ form: form._id, steps: cloneSteps(def.steps), policy: { ...DEFAULT_POLICY } }),
    ])
  } catch (error) {
    await Promise.allSettled([
      FormField.deleteMany({ form: form._id }),
      ApprovalWorkflow.deleteOne({ form: form._id }),
      FormTemplate.deleteOne({ _id: form._id }),
    ])
    throw error
  }
  return { created: form }
}

// 每個簽核標籤目前有幾位「可簽核」(K1) 的員工持有；標籤依 K3 正規化後比對
async function loadEligibleTagHolderCounts() {
  const employees = await Employee.find(
    { ...eligibleEmployeeFilter(), signTags: { $exists: true, $ne: [] } },
    { signTags: 1 }
  ).lean()
  const counts = new Map()
  for (const employee of employees || []) {
    for (const tag of normalizeSignTags(employee.signTags)) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }
  return counts
}

/**
 * 整理一張預設表單目前的流程需要哪些標籤、各有多少位可簽核的員工持有，
 * 以及哪些「必簽」的關卡現在會找不到人。holders 為 null 代表無法計算（不產生標籤警告）。
 */
function describeDefaultTemplate({ def, form, status, matchedBy, steps, holders }) {
  const stepList = Array.isArray(steps) ? steps : []
  const requiredTags = []
  const warnings = []
  const formName = form?.name || def.name
  if (!stepList.length) {
    warnings.push({
      type: 'empty_workflow',
      form: formName,
      formId: String(form?._id ?? ''),
      message: `「${formName}」目前沒有任何簽核關卡，員工無法送出申請，請到「設定關卡」補上。`,
    })
  }
  // 補齊預設值不會替管理員重新啟用表單：停用中的預設表單要明確提醒，否則報表看起來像是已經補好了
  if (form?.is_active === false) {
    warnings.push({
      type: 'inactive_template',
      form: formName,
      formId: String(form?._id ?? ''),
      message: `「${formName}」目前是停用狀態，員工看不到也無法申請，請到「編輯」重新啟用。`,
    })
  }
  stepList.forEach((step, index) => {
    if (step?.approver_type !== 'tag') return
    const tag = normalizeSignTag(step.approver_value)
    if (!tag) return
    const stepNumber = step.step_order ?? index + 1
    const count = holders ? (holders.get(tag) || 0) : null
    requiredTags.push({ tag, step: stepNumber, holders: count, required: step.is_required !== false })
    if (count === 0 && step.is_required !== false) {
      warnings.push({
        type: 'tag_without_holder',
        form: formName,
        formId: String(form?._id ?? ''),
        step: stepNumber,
        tag,
        message: `「${formName}」第 ${stepNumber} 關需要有「${tag}」標籤的在職員工，目前沒有任何人持有，員工送出申請時會被擋下。請到員工管理為負責的人加上此標籤。`,
      })
    }
  })
  return {
    template: {
      key: def.key,
      name: formName,
      formId: String(form?._id ?? ''),
      status,
      matchedBy: matchedBy || null,
      isActive: form?.is_active !== false,
      stepCount: stepList.length,
      requiredTags,
    },
    warnings,
  }
}

async function safeLoadHolders() {
  try {
    return await loadEligibleTagHolderCounts()
  } catch (error) {
    console.error('Failed to count sign tag holders', error?.name ?? 'Error')
    return null
  }
}

/* ---------------------- Ensure Leave Form ---------------------- */
export async function ensureLeaveForm(req, res) {
  try {
    const def = findDefaultTemplate('leave')
    // 依 default_key / 原名 / 表單性質找（改過名、被停用的請假單也算存在），找不到才建立；不會再因同名撞到 E11000
    const templates = await FormTemplate.find({}, TEMPLATE_MATCH_PROJECTION).lean()
    const match = matchDefaultTemplate(def, templates)

    let form = null
    let wasGenerated = false
    if (match) {
      form = await FormTemplate.findById(match.template._id)
    } else {
      const result = await createDefaultTemplate(def, req.user?.id)
      if (result.created) {
        form = result.created
        wasGenerated = true
        console.log('Auto-generated leave form template')
      } else {
        form = await FormTemplate.findById(result.existing._id)
      }
    }
    if (!form) return res.status(404).json({ error: '找不到請假表單' })
    // 只有「新建」時才會產生欄位；既有的請假單不會補回管理員特地刪掉的欄位
    if (wasGenerated) resetLeaveFieldCache()

    // Return the form with its fields and workflow
    const fields = await FormField.find({ form: form._id, is_active: { $ne: false } }).sort({ order: 1 })
    const workflow = await ApprovalWorkflow.findOne({ form: form._id })

    res.json({
      form,
      fields: await resolveFieldsOptions(fields),
      workflow,
      generated: wasGenerated,
      inactive: form.is_active === false,
    })
  } catch (e) {
    respondFailure(res, e, 'ensure leave form')
  }
}

/* ---------------------- Restore Default Templates ---------------------- */
export async function restoreDefaultTemplates(req, res) {
  try {
    const existingTemplates = await FormTemplate.find({}, TEMPLATE_MATCH_PROJECTION).lean()

    // 先把每個預設對上既有的表單（default_key → 原名 → 同性質），對不上的才需要新建
    const claimed = new Set()
    const matches = new Map()
    for (const def of DEFAULT_APPROVAL_TEMPLATES) {
      const match = matchDefaultTemplate(def, existingTemplates, claimed)
      if (!match) continue
      claimed.add(String(match.template._id))
      matches.set(def.key, match)
    }
    const workflowByForm = new Map()
    if (matches.size) {
      const workflows = await ApprovalWorkflow.find(
        { form: { $in: [...matches.values()].map((match) => match.template._id) } }
      ).lean()
      for (const workflow of workflows || []) workflowByForm.set(String(workflow.form), workflow)
    }

    const createdForms = []
    const preservedForms = []
    const repairedForms = []
    const reports = []
    for (const def of DEFAULT_APPROVAL_TEMPLATES) {
      const match = matches.get(def.key)
      if (!match) {
        const result = await createDefaultTemplate(def, req.user?.id)
        if (result.created) {
          createdForms.push(result.created)
          reports.push({ def, form: result.created, status: 'created', matchedBy: null, steps: def.steps })
        } else {
          // 同時有人也在補齊，這張已經被建好了
          preservedForms.push(result.existing)
          const workflow = await ApprovalWorkflow.findOne({ form: result.existing._id }).lean()
          reports.push({ def, form: result.existing, status: 'preserved', matchedBy: 'name', steps: workflow?.steps || [] })
        }
        continue
      }

      const { template, matchedBy } = match
      preservedForms.push(template)
      let steps = workflowByForm.get(String(template._id))?.steps || []
      let status = 'preserved'
      // 認得是這張預設表單（default_key 或原名）才補：舊資料補上固定代號，改名後也不會被當成缺少
      if (matchedBy !== 'semanticType') {
        if (!template.default_key) {
          await FormTemplate.updateOne(
            { _id: template._id, default_key: { $in: [null, ''] } },
            { $set: { default_key: def.key } },
            { timestamps: false }
          )
        }
        // 流程被清空（或根本沒有）的預設表單無法送出申請，補回預設關卡
        if (!steps.length) {
          await ApprovalWorkflow.findOneAndUpdate(
            { form: template._id },
            { $set: { steps: cloneSteps(def.steps) } },
            { new: true, upsert: true }
          )
          steps = def.steps
          status = 'repaired'
          repairedForms.push(template)
        }
      }
      reports.push({ def, form: template, status, matchedBy, steps })
    }
    if (createdForms.length || repairedForms.length) resetLeaveFieldCache()

    // 提醒管理員：這些預設表單需要的標籤現在有幾位在職員工持有，必簽的關卡找不到人就會讓員工送不出申請
    const holders = await safeLoadHolders()
    const templatesReport = []
    const warnings = []
    for (const report of reports) {
      const described = describeDefaultTemplate({ ...report, holders })
      templatesReport.push(described.template)
      warnings.push(...described.warnings)
    }

    res.json({
      success: true,
      message: '已非破壞性補齊預設簽核表單',
      count: createdForms.length,
      createdCount: createdForms.length,
      preservedCount: preservedForms.length,
      repairedCount: repairedForms.length,
      forms: createdForms,
      repaired: repairedForms.map((form) => ({ _id: form._id, name: form.name })),
      templates: templatesReport,
      warnings,
    })
  } catch (e) {
    respondFailure(res, e, 'restore defaults')
  }
}
