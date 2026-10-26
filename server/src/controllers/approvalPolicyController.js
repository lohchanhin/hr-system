// 簽核的全公司設定（只有管理員）：無上級主管時的最高層簽核人（R5）。
// 存在其他控制設定的 topLevelApproverIds（員工 _id 陣列）；空白 = 改送所有可簽核的系統管理員（預設）。
// 必簽的「主管」關卡找不到可簽核的主管（沒設定、主管就是申請人本人、主管已離職／停用）時改送這些人，任一位核准即可；
// 解析規則在 services/approverResolution.resolveStepApprovers。
import mongoose from 'mongoose'
import Employee from '../models/Employee.js'
import * as settingsStore from '../services/otherControlSettingsStore.js'
import { eligibleEmployeeFilter, isEligibleApprover } from '../services/approverEligibility.js'
import { MAX_TOP_LEVEL_APPROVERS, normalizeTopLevelApproverIds } from '../services/approverResolution.js'

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i
const READ_FAILED_MESSAGE = '無法讀取最高層簽核人設定，請稍後再試'
const WRITE_FAILED_MESSAGE = '無法儲存最高層簽核人設定，請稍後再試'

class PolicyRequestError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PolicyRequestError'
    this.status = 400
  }
}

function sendFailure(res, error, fallbackMessage) {
  if (error instanceof PolicyRequestError) return res.status(error.status).json({ error: error.message })
  // 只記錄錯誤名稱：資料庫錯誤訊息可能帶連線資訊
  console.error(`[approval-policy] request failed: ${error?.name || 'Error'}`)
  return res.status(500).json({ error: fallbackMessage })
}

function ineligibleReasonOf(employee) {
  if (!employee) return '找不到這位員工'
  if (employee.accountEnabled === false) return '帳號已停用'
  if (employee.status === '離職員工') return '已離職'
  if (employee.status === '留職停薪') return '留職停薪'
  return ''
}

function describePerson(employee) {
  return {
    id: String(employee._id),
    name: employee.name || '',
    employeeId: employee.employeeId || '',
    role: employee.role || '',
  }
}

async function loadEmployees(ids) {
  if (!ids.length) return []
  const rows = await Employee.find({ _id: { $in: ids } }, { name: 1, employeeId: 1, role: 1, status: 1, accountEnabled: 1 }).lean()
  return rows || []
}

/*
 * 回應內容：
 *   ids        已設定的員工 _id（空白 = 改送系統管理員）
 *   approvers  已設定的人（姓名、員編；eligible = 現在能簽核，已離職、停用的標出原因，簽核時會略過）
 *   admins     沒設定時會改送的系統管理員（可簽核的）
 */
async function describeSetting(ids) {
  const [rows, admins] = await Promise.all([
    loadEmployees(ids),
    Employee.find({ role: 'admin', ...eligibleEmployeeFilter() }, { name: 1, employeeId: 1, role: 1 }).lean(),
  ])
  const byId = new Map(rows.map(row => [String(row._id), row]))
  return {
    ids,
    approvers: ids.map((id) => {
      const row = byId.get(id)
      if (!row) return { id, name: '', employeeId: '', role: '', eligible: false, ineligibleReason: '找不到這位員工' }
      return { ...describePerson(row), eligible: isEligibleApprover(row), ineligibleReason: ineligibleReasonOf(row) }
    }),
    admins: (admins || []).map(describePerson),
    maxCount: MAX_TOP_LEVEL_APPROVERS,
  }
}

/** GET /api/approvals/top-level-approvers */
export async function getTopLevelApprovers(req, res) {
  try {
    const settings = await settingsStore.getSettings()
    res.json(await describeSetting(normalizeTopLevelApproverIds(settings?.topLevelApproverIds)))
  } catch (error) {
    sendFailure(res, error, READ_FAILED_MESSAGE)
  }
}

/* 管理員送來的名單：必須是陣列、每個都是存在而且可簽核的員工，最多 MAX_TOP_LEVEL_APPROVERS 位（重複的只算一次） */
async function parseApproverIds(body) {
  const raw = body?.ids ?? body?.topLevelApproverIds
  if (!Array.isArray(raw)) throw new PolicyRequestError('最高層簽核人格式不正確，請重新選擇')
  const ids = []
  const seen = new Set()
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String(item?._id ?? item?.id ?? '')
    if (!OBJECT_ID_PATTERN.test(id) || !mongoose.isValidObjectId(id)) throw new PolicyRequestError('最高層簽核人格式不正確，請重新選擇')
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (ids.length > MAX_TOP_LEVEL_APPROVERS) throw new PolicyRequestError(`最高層簽核人最多 ${MAX_TOP_LEVEL_APPROVERS} 位`)
  const rows = await loadEmployees(ids)
  const byId = new Map(rows.map(row => [String(row._id), row]))
  const missing = ids.filter(id => !byId.has(id))
  if (missing.length) throw new PolicyRequestError('找不到部分員工，請重新整理後再選')
  const ineligible = ids.map(id => byId.get(id)).filter(row => !isEligibleApprover(row))
  if (ineligible.length) {
    const names = ineligible.map(row => `${row.name || '（未命名）'}（${ineligibleReasonOf(row)}）`).join('、')
    throw new PolicyRequestError(`${names}不能簽核，請改選在職且帳號啟用的員工`)
  }
  return ids
}

/** PUT /api/approvals/top-level-approvers { ids: [員工 _id] }：空陣列 = 改送系統管理員 */
export async function updateTopLevelApprovers(req, res) {
  try {
    const ids = await parseApproverIds(req.body || {})
    await settingsStore.updateSettings((current) => {
      current.topLevelApproverIds = ids
    })
    res.json(await describeSetting(ids))
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export default { getTopLevelApprovers, updateTopLevelApprovers }
