import Employee from '../models/Employee.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import { computeLeaveRequestHours, isAnnualLeaveType } from './leaveRequestDays.js'
import { toTaipeiDateKey } from '../utils/taipeiTime.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'
import { orderFieldCandidateIds, pickFieldValue } from '../utils/fieldCandidates.js'
import { resolveLeaveFieldsForRequest } from '../utils/leaveFieldResolution.js'
import { interpretLegacyAnnualLeave, isLegacyAnnualLeave, readAnnualLeaveHours } from '../utils/annualLeaveHours.js'
import { LEAVE_DAY_EQUIVALENT_HOURS, formatHoursText, hoursToDays, roundHours } from '../utils/leaveHours.js'

// 特休以「小時」為單位儲存（1 天 = 8 小時只是換算顯示）。時數的讀取與舊資料（天數欄位）的解讀放在 utils/annualLeaveHours.js
export { interpretLegacyAnnualLeave, readAnnualLeaveHours }

// 特休餘額相關的錯誤：message 保留英文供紀錄與既有測試，code / remainingHours / requestedHours 讓呼叫端組出中文訊息
export class AnnualLeaveError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'AnnualLeaveError'
    this.code = code
    Object.assign(this, extra)
  }
}

/**
 * 員工是否已設定特休（有年度總時數或已有使用紀錄）。
 * 匯入時沒填特休的員工預設是 0，視為尚未設定，送出申請時不以餘額擋下。
 */
export function isAnnualLeaveConfigured(employee) {
  return readAnnualLeaveHours(employee?.annualLeave).configured
}

// 舊格式（還在天數欄位）的員工資料換成時數；啟動時的資料搬移失敗或搬移後才建立的舊格式資料，第一次扣減／返還／設定時補上
async function convertLegacyEmployee(employeeId) {
  const { ensureAnnualLeaveHours } = await import('./leaveHoursMigration.js')
  return ensureAnnualLeaveHours(employeeId)
}

/**
 * 扣減員工特休時數（使用原子操作）
 * @param {string} employeeId - 員工 ID
 * @param {number} hours - 扣減小時數
 * @param {string} approvalRequestId - 審核單 ID（用於記錄與避免重複扣減）
 * @returns {Promise<Object>} 更新後的員工資料
 */
export async function deductAnnualLeave(employeeId, hours, approvalRequestId = null) {
  if (!employeeId || !(hours > 0)) {
    throw new AnnualLeaveError('INVALID_PARAMS', 'Invalid parameters for annual leave deduction')
  }

  const requestKey = approvalRequestId ? String(approvalRequestId) : null
  const filter = {
    _id: employeeId,
    $expr: {
      $lte: [
        { $add: [{ $ifNull: ['$annualLeave.usedHours', 0] }, hours] },
        { $ifNull: ['$annualLeave.totalHours', 0] }
      ]
    }
  }
  if (requestKey) filter['annualLeave.appliedApprovalRequestIds'] = { $ne: requestKey }

  const update = { $inc: { 'annualLeave.usedHours': hours } }
  if (requestKey) update.$addToSet = { 'annualLeave.appliedApprovalRequestIds': requestKey }

  const attempt = () => Employee.findOneAndUpdate(filter, update, { new: true, runValidators: true })
  const load = () => Employee.findById(employeeId).select('+annualLeave.appliedApprovalRequestIds')
  const alreadyApplied = (employee) => Boolean(requestKey) && Boolean(employee?.annualLeave?.appliedApprovalRequestIds?.includes(requestKey))
  let updated = await attempt()

  if (!updated) {
    let employee = await load()
    if (!employee) throw new AnnualLeaveError('EMPLOYEE_NOT_FOUND', 'Employee not found')
    if (alreadyApplied(employee)) return employee
    // 還是舊格式（數量在天數欄位，沒有 totalHours）：先換成時數，不能因為格式問題誤判餘額不足
    if (isLegacyAnnualLeave(employee.annualLeave)) await convertLegacyEmployee(employeeId)
    // 再試一次（別的請求剛好同時把這位員工換成時數，或同時處理了同一張單，也在這裡一起處理）
    updated = await attempt()
    if (!updated) {
      employee = await load()
      if (alreadyApplied(employee)) return employee
      const remainingHours = readAnnualLeaveHours(employee?.annualLeave).remainingHours
      throw new AnnualLeaveError(
        'INSUFFICIENT_BALANCE',
        `Insufficient annual leave balance. Remaining: ${remainingHours} hours, Requested: ${hours} hours`,
        { remainingHours, requestedHours: hours },
      )
    }
  }

  console.log(`[AnnualLeave] Deducted ${hours} hours from employee ${employeeId}. Approval: ${approvalRequestId || 'N/A'}`)
  return updated
}

/**
 * 返還先前為某張簽核單扣掉的特休（核准後撤回／銷假）。
 * 只有「該簽核單確實扣過」（appliedApprovalRequestIds 內有它）才會返還，並把紀錄移除，所以重複呼叫不會重複返還。
 * @returns {Promise<{ refunded: boolean, hours: number, days: number }>}
 */
export async function refundAnnualLeave(employeeId, hours, approvalRequestId) {
  if (!employeeId || !approvalRequestId || !(hours > 0)) {
    throw new AnnualLeaveError('INVALID_PARAMS', 'Invalid parameters for annual leave refund')
  }
  const requestKey = String(approvalRequestId)
  const attempt = () => Employee.findOneAndUpdate(
    { _id: employeeId, 'annualLeave.appliedApprovalRequestIds': requestKey },
    {
      $inc: { 'annualLeave.usedHours': -hours },
      $pull: { 'annualLeave.appliedApprovalRequestIds': requestKey },
    },
    { new: true },
  )
  // 還是舊格式（沒有 usedHours）的資料先換成時數，否則扣不回去
  await convertLegacyEmployee(employeeId)
  const updated = await attempt()
  if (!updated) return { refunded: false, hours: 0, days: 0 }
  // 已使用時數被人工調低後再返還，不可變成負數
  if ((updated.annualLeave?.usedHours || 0) < 0) {
    await Employee.updateOne(
      { _id: employeeId, 'annualLeave.usedHours': { $lt: 0 } },
      { $set: { 'annualLeave.usedHours': 0 } },
    )
  }
  console.log(`[AnnualLeave] Refunded ${hours} hours to employee ${employeeId}. Approval: ${requestKey}`)
  return { refunded: true, hours, days: hoursToDays(hours, LEAVE_DAY_EQUIVALENT_HOURS, 4) }
}

/**
 * 查詢員工特休餘額（時數為主，天數是 時數 / 8 的換算）
 * @param {string} employeeId - 員工 ID
 * @returns {Promise<Object>} 特休餘額資訊
 */
export async function getAnnualLeaveBalance(employeeId) {
  const employee = await Employee.findById(employeeId, 'name employeeId annualLeave')
  if (!employee) {
    throw new AnnualLeaveError('EMPLOYEE_NOT_FOUND', 'Employee not found')
  }

  const hours = readAnnualLeaveHours(employee.annualLeave)
  const year = employee.annualLeave?.year || new Date().getFullYear()
  const toDays = (value) => hoursToDays(value, LEAVE_DAY_EQUIVALENT_HOURS, 4)

  return {
    employeeId: employee.employeeId,
    name: employee.name,
    totalHours: hours.totalHours,
    usedHours: hours.usedHours,
    remainingHours: hours.remainingHours,
    totalDays: toDays(hours.totalHours),
    usedDays: toDays(hours.usedHours),
    remainingDays: toDays(hours.remainingHours),
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
 * @returns {Promise<Array>} 特休使用記錄（hours 為主，days 是 hours / 8 的換算）
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
      // 假別、日期、時數（天數）欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位底下：逐張假單挑第一個有填值的欄位
      const requestFields = resolveLeaveFieldsForRequest(leaveFields, data)
      if (!isAnnualLeaveType(data[requestFields.typeId], leaveFields.typeOptions)) continue

      const startValue = requestFields.startId ? data[requestFields.startId] : undefined
      const endValue = requestFields.endId ? data[requestFields.endId] : undefined
      if (year) {
        const key = toTaipeiDateKey(startValue) || toTaipeiDateKey(request.createdAt)
        if (!key || Number(key.slice(0, 4)) !== Number(year)) continue
      }

      const annual = request.annual_leave
      const deductedHours = annual?.state === 'deducted'
        ? (annual.hours ?? (annual.days != null ? roundHours(annual.days * LEAVE_DAY_EQUIVALENT_HOURS) : null))
        : null
      const hours = deductedHours ?? computeLeaveRequestHours({ formData: data, leaveFields: requestFields }).hours
      records.push({
        requestId: request._id,
        formName: form.name,
        createdAt: request.createdAt,
        hours,
        days: hoursToDays(hours, LEAVE_DAY_EQUIVALENT_HOURS, 4),
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
 * @param {number} hours - 申請小時數
 * @returns {Promise<Object>} 驗證結果
 */
export async function validateAnnualLeaveRequest(employeeId, hours) {
  const employee = await Employee.findById(employeeId)
  if (!employee) {
    return { valid: false, message: 'Employee not found' }
  }

  const remainingHours = readAnnualLeaveHours(employee.annualLeave).remainingHours
  const canDeduct = remainingHours >= hours

  if (!canDeduct) {
    return {
      valid: false,
      message: `特休餘額不足。剩餘 ${formatHoursText(remainingHours)}，申請 ${formatHoursText(hours)}`,
      remainingHours,
      requestedHours: hours
    }
  }

  return {
    valid: true,
    message: 'Valid',
    remainingHours,
    requestedHours: hours
  }
}

/**
 * 設定員工年度特休時數（僅限管理員）
 * 改用單一原子更新：同年度只改 totalHours（不碰 usedHours，避免蓋掉剛好核准的扣減），
 * 換年度才重設已使用時數與已套用的簽核單；用點記法更新，積假、補休、請假期限、備註不會被蓋掉。
 * @param {string} employeeId - 員工 ID
 * @param {number} totalHours - 年度特休總時數
 * @param {number} year - 年度
 * @returns {Promise<Object>} 更新後的員工資料
 */
export async function setAnnualLeaveQuota(employeeId, totalHours, year = null) {
  const targetYear = year || new Date().getFullYear()
  // 舊格式的資料先換成時數，免得只寫 totalHours 而漏掉舊的使用量
  await convertLegacyEmployee(employeeId)

  let employee = await Employee.findOneAndUpdate(
    { _id: employeeId, 'annualLeave.year': targetYear },
    { $set: { 'annualLeave.totalHours': totalHours, 'annualLeave.unitSource': 'entered' } },
    { new: true },
  )
  if (!employee) {
    // 設定新年度，重置已用時數
    employee = await Employee.findOneAndUpdate(
      { _id: employeeId, 'annualLeave.year': { $ne: targetYear } },
      {
        $set: {
          'annualLeave.totalHours': totalHours,
          'annualLeave.usedHours': 0,
          'annualLeave.unitSource': 'entered',
          'annualLeave.year': targetYear,
          'annualLeave.appliedApprovalRequestIds': [],
        },
      },
      { new: true },
    )
  }
  if (!employee) {
    throw new AnnualLeaveError('EMPLOYEE_NOT_FOUND', 'Employee not found')
  }

  console.log(`[AnnualLeave] Set quota for employee ${employeeId}: ${totalHours} hours for year ${targetYear}`)

  return employee
}
