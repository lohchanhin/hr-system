import Employee from '../models/Employee.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import { computeLeaveRequestDays, isAnnualLeaveType } from './leaveRequestDays.js'
import { toTaipeiDateKey } from '../utils/taipeiTime.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'
import { orderFieldCandidateIds, pickFieldValue } from '../utils/fieldCandidates.js'
import { resolveLeaveFieldsForRequest } from '../utils/leaveFieldResolution.js'

// 特休餘額相關的錯誤：message 保留英文供紀錄與既有測試，code / remaining / requested 讓呼叫端組出中文訊息
export class AnnualLeaveError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'AnnualLeaveError'
    this.code = code
    Object.assign(this, extra)
  }
}

/**
 * 員工是否已設定特休（有年度總天數或已有使用紀錄）。
 * 匯入時沒填「年度特休總天數」的員工預設是 0 天，視為尚未設定，送出申請時不以餘額擋下。
 */
export function isAnnualLeaveConfigured(employee) {
  const annualLeave = employee?.annualLeave
  if (!annualLeave) return false
  return Number(annualLeave.totalDays) > 0 || Number(annualLeave.usedDays) > 0
}

/**
 * 扣減員工特休天數（使用原子操作）
 * @param {string} employeeId - 員工 ID
 * @param {number} days - 扣減天數
 * @param {string} approvalRequestId - 審核單 ID（用於記錄）
 * @returns {Promise<Object>} 更新後的員工資料
 */
export async function deductAnnualLeave(employeeId, days, approvalRequestId = null) {
  if (!employeeId || days <= 0) {
    throw new AnnualLeaveError('INVALID_PARAMS', 'Invalid parameters for annual leave deduction')
  }

  const requestKey = approvalRequestId ? String(approvalRequestId) : null
  const filter = {
    _id: employeeId,
    $expr: {
      $lte: [
        { $add: [{ $ifNull: ['$annualLeave.usedDays', 0] }, days] },
        { $ifNull: ['$annualLeave.totalDays', 0] }
      ]
    }
  }
  if (requestKey) filter['annualLeave.appliedApprovalRequestIds'] = { $ne: requestKey }

  const update = { $inc: { 'annualLeave.usedDays': days } }
  if (requestKey) update.$addToSet = { 'annualLeave.appliedApprovalRequestIds': requestKey }

  const updated = await Employee.findOneAndUpdate(
    filter,
    update,
    { new: true, runValidators: true }
  )

  if (!updated) {
    const employee = await Employee.findById(employeeId)
      .select('+annualLeave.appliedApprovalRequestIds')
    if (!employee) throw new AnnualLeaveError('EMPLOYEE_NOT_FOUND', 'Employee not found')
    if (requestKey && employee.annualLeave?.appliedApprovalRequestIds?.includes(requestKey)) {
      return employee
    }
    const remaining = (employee.annualLeave?.totalDays || 0) - (employee.annualLeave?.usedDays || 0)
    throw new AnnualLeaveError(
      'INSUFFICIENT_BALANCE',
      `Insufficient annual leave balance. Remaining: ${remaining} days, Requested: ${days} days`,
      { remaining, requested: days },
    )
  }

  console.log(`[AnnualLeave] Deducted ${days} days from employee ${employeeId}. Approval: ${approvalRequestId || 'N/A'}`)
  return updated
}

/**
 * 返還先前為某張簽核單扣掉的特休（核准後撤回／銷假）。
 * 只有「該簽核單確實扣過」（appliedApprovalRequestIds 內有它）才會返還，並把紀錄移除，所以重複呼叫不會重複返還。
 * @returns {Promise<{ refunded: boolean, days: number }>}
 */
export async function refundAnnualLeave(employeeId, days, approvalRequestId) {
  if (!employeeId || !approvalRequestId || !(days > 0)) {
    throw new AnnualLeaveError('INVALID_PARAMS', 'Invalid parameters for annual leave refund')
  }
  const requestKey = String(approvalRequestId)
  const updated = await Employee.findOneAndUpdate(
    { _id: employeeId, 'annualLeave.appliedApprovalRequestIds': requestKey },
    {
      $inc: { 'annualLeave.usedDays': -days },
      $pull: { 'annualLeave.appliedApprovalRequestIds': requestKey },
    },
    { new: true },
  )
  if (!updated) return { refunded: false, days: 0 }
  // 已使用天數被人工調低後再返還，不可變成負數
  if ((updated.annualLeave?.usedDays || 0) < 0) {
    await Employee.updateOne(
      { _id: employeeId, 'annualLeave.usedDays': { $lt: 0 } },
      { $set: { 'annualLeave.usedDays': 0 } },
    )
  }
  console.log(`[AnnualLeave] Refunded ${days} days to employee ${employeeId}. Approval: ${requestKey}`)
  return { refunded: true, days }
}

/**
 * 查詢員工特休餘額
 * @param {string} employeeId - 員工 ID
 * @returns {Promise<Object>} 特休餘額資訊
 */
export async function getAnnualLeaveBalance(employeeId) {
  const employee = await Employee.findById(employeeId, 'name employeeId annualLeave')
  if (!employee) {
    throw new AnnualLeaveError('EMPLOYEE_NOT_FOUND', 'Employee not found')
  }

  const totalDays = employee.annualLeave?.totalDays || 0
  const usedDays = employee.annualLeave?.usedDays || 0
  const remainingDays = totalDays - usedDays
  const year = employee.annualLeave?.year || new Date().getFullYear()

  return {
    employeeId: employee.employeeId,
    name: employee.name,
    totalDays,
    usedDays,
    remainingDays,
    year
  }
}

const REASON_LABEL_PATTERN = /事由|原因|備註|reason/i

// 事由欄位的候選欄位 ID：第一個符合的欄位（啟用中的優先）加上同標籤的其他欄位，啟用中的在前、停用的在後
function reasonFieldCandidateIds(fields) {
  const matched = (fields || []).filter(field => REASON_LABEL_PATTERN.test(String(field.label || '')))
  const picked = matched.find(field => field.is_active !== false) || matched[0]
  if (!picked) return []
  const label = String(picked.label || '').trim()
  return orderFieldCandidateIds((fields || []).filter(field => String(field.label || '').trim() === label))
}

/**
 * 查詢員工特休使用記錄（從審核單查詢）
 * 假單的欄位 key 是欄位 id（不是固定的 leaveType / days），所以逐一請假表單用 getLeaveFieldIdsForForm 取欄位 id。
 * @param {string} employeeId - 員工 ID
 * @param {number} year - 年度（可選，以請假開始日的台灣年份為準；沒有開始日時用申請日）
 * @returns {Promise<Array>} 特休使用記錄
 */
export async function getAnnualLeaveHistory(employeeId, year = null) {
  // 只有查詢使用紀錄才需要請假欄位對應；延後載入，避免只用到扣減／返還的呼叫端（與其測試）被牽連
  const { getLeaveFieldIdsForForm } = await import('./leaveFieldService.js')
  const candidates = await FormTemplate.find({
    $or: [{ semanticType: 'leave' }, { name: '請假' }],
  }).lean()
  // 與扣減特休同一套判斷：名稱叫「請假」但表單性質明確選了「一般」的表單不算請假單，也就不會有特休使用紀錄
  const forms = (candidates || []).filter(isLeaveFormTemplate)

  const records = []
  for (const form of forms) {
    const leaveFields = await getLeaveFieldIdsForForm(form)
    if (!leaveFields.typeId) continue

    const requests = await ApprovalRequest.find({
      applicant_employee: employeeId,
      status: 'approved',
      form: form._id,
    })
      .sort({ createdAt: -1 })
      .lean()
    if (!requests.length) continue

    const fields = await FormField.find({ form: form._id }).lean()
    const reasonIds = reasonFieldCandidateIds(fields)

    for (const request of requests) {
      const data = request.form_data || {}
      // 假別、日期、天數欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位底下：逐張假單挑第一個有填值的欄位
      const requestFields = resolveLeaveFieldsForRequest(leaveFields, data)
      if (!isAnnualLeaveType(data[requestFields.typeId], leaveFields.typeOptions)) continue

      const startValue = requestFields.startId ? data[requestFields.startId] : undefined
      const endValue = requestFields.endId ? data[requestFields.endId] : undefined
      if (year) {
        const key = toTaipeiDateKey(startValue) || toTaipeiDateKey(request.createdAt)
        if (!key || Number(key.slice(0, 4)) !== Number(year)) continue
      }

      const deducted = request.annual_leave?.state === 'deducted' ? request.annual_leave.days : null
      records.push({
        requestId: request._id,
        formName: form.name,
        createdAt: request.createdAt,
        days: deducted ?? computeLeaveRequestDays({ formData: data, leaveFields: requestFields }).days,
        startDate: startValue,
        endDate: endValue,
        reason: pickFieldValue(data, reasonIds),
      })
    }
  }

  return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

/**
 * 驗證特休申請是否可行
 * @param {string} employeeId - 員工 ID
 * @param {number} days - 申請天數
 * @returns {Promise<Object>} 驗證結果
 */
export async function validateAnnualLeaveRequest(employeeId, days) {
  const employee = await Employee.findById(employeeId)
  if (!employee) {
    return { valid: false, message: 'Employee not found' }
  }

  const canDeduct = employee.canDeductAnnualLeave(days)
  const remaining = (employee.annualLeave?.totalDays || 0) - (employee.annualLeave?.usedDays || 0)

  if (!canDeduct) {
    return {
      valid: false,
      message: `特休餘額不足。剩餘 ${remaining} 天，申請 ${days} 天`,
      remaining,
      requested: days
    }
  }

  return {
    valid: true,
    message: 'Valid',
    remaining,
    requested: days
  }
}

/**
 * 設定員工年度特休天數（僅限管理員）
 * 改用單一原子更新：同年度只改 totalDays（不碰 usedDays，避免蓋掉剛好核准的扣減），
 * 換年度才整組重設。
 * @param {string} employeeId - 員工 ID
 * @param {number} totalDays - 年度特休總天數
 * @param {number} year - 年度
 * @returns {Promise<Object>} 更新後的員工資料
 */
export async function setAnnualLeaveQuota(employeeId, totalDays, year = null) {
  const targetYear = year || new Date().getFullYear()

  let employee = await Employee.findOneAndUpdate(
    { _id: employeeId, 'annualLeave.year': targetYear },
    { $set: { 'annualLeave.totalDays': totalDays } },
    { new: true },
  )
  if (!employee) {
    // 設定新年度，重置已用天數
    employee = await Employee.findOneAndUpdate(
      { _id: employeeId, 'annualLeave.year': { $ne: targetYear } },
      {
        $set: {
          annualLeave: {
            totalDays,
            usedDays: 0,
            year: targetYear,
            appliedApprovalRequestIds: [],
          },
        },
      },
      { new: true },
    )
  }
  if (!employee) {
    throw new AnnualLeaveError('EMPLOYEE_NOT_FOUND', 'Employee not found')
  }

  console.log(`[AnnualLeave] Set quota for employee ${employeeId}: ${totalDays} days for year ${targetYear}`)

  return employee
}
