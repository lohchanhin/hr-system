import Employee from '../models/Employee.js'
import ApprovalRequest from '../models/approval_request.js'

/**
 * 扣減員工特休天數（使用原子操作）
 * @param {string} employeeId - 員工 ID
 * @param {number} days - 扣減天數
 * @param {string} approvalRequestId - 審核單 ID（用於記錄）
 * @returns {Promise<Object>} 更新後的員工資料
 */
export async function deductAnnualLeave(employeeId, days, approvalRequestId = null) {
  if (!employeeId || days <= 0) {
    throw new Error('Invalid parameters for annual leave deduction')
  }

  // 使用原子操作更新，並驗證餘額充足
  // 使用 $expr 確保 usedDays + days <= totalDays
  const updated = await Employee.findOneAndUpdate(
    {
      _id: employeeId,
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ['$annualLeave.usedDays', 0] }, days] },
          { $ifNull: ['$annualLeave.totalDays', 0] }
        ]
      }
    },
    { $inc: { 'annualLeave.usedDays': days } },
    { new: true, runValidators: true }
  )

  if (!updated) {
    // 查詢員工以提供詳細錯誤信息
    const employee = await Employee.findById(employeeId)
    if (!employee) {
      throw new Error('Employee not found')
    }
    const remaining = (employee.annualLeave?.totalDays || 0) - (employee.annualLeave?.usedDays || 0)
    throw new Error(`Insufficient annual leave balance. Remaining: ${remaining} days, Requested: ${days} days`)
  }

  console.log(`[AnnualLeave] Deducted ${days} days from employee ${employeeId}. Approval: ${approvalRequestId || 'N/A'}`)

  return updated
}

/**
 * 查詢員工特休餘額
 * @param {string} employeeId - 員工 ID
 * @returns {Promise<Object>} 特休餘額資訊
 */
export async function getAnnualLeaveBalance(employeeId) {
  const employee = await Employee.findById(employeeId, 'name employeeId annualLeave')
  if (!employee) {
    throw new Error('Employee not found')
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

/**
 * 查詢員工特休使用記錄（從審核單查詢）
 * @param {string} employeeId - 員工 ID
 * @param {number} year - 年度（可選）
 * @returns {Promise<Array>} 特休使用記錄
 */
export async function getAnnualLeaveHistory(employeeId, year = null) {
  const query = {
    applicant_employee: employeeId,
    status: 'approved',
    'form_data.leaveType': { $in: ['特休', '特休假'] } // 支持不同的特休名稱
  }

  if (year) {
    const startDate = new Date(year, 0, 1)
    const endDate = new Date(year + 1, 0, 1)
    query.createdAt = { $gte: startDate, $lt: endDate }
  }

  const requests = await ApprovalRequest.find(query)
    .populate('form', 'name')
    .sort({ createdAt: -1 })
    .lean()

  return requests.map(req => ({
    requestId: req._id,
    formName: req.form?.name,
    createdAt: req.createdAt,
    days: req.form_data?.days || 1,
    startDate: req.form_data?.startDate,
    endDate: req.form_data?.endDate,
    reason: req.form_data?.reason
  }))
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
 * @param {string} employeeId - 員工 ID
 * @param {number} totalDays - 年度特休總天數
 * @param {number} year - 年度
 * @returns {Promise<Object>} 更新後的員工資料
 */
export async function setAnnualLeaveQuota(employeeId, totalDays, year = null) {
  const employee = await Employee.findById(employeeId)
  if (!employee) {
    throw new Error('Employee not found')
  }

  const targetYear = year || new Date().getFullYear()
  
  // 如果是設定新年度，重置已用天數
  if (employee.annualLeave?.year !== targetYear) {
    employee.annualLeave = {
      totalDays,
      usedDays: 0,
      year: targetYear
    }
  } else {
    // 同年度只更新總天數
    if (!employee.annualLeave) {
      employee.annualLeave = { totalDays: 0, usedDays: 0, year: targetYear }
    }
    employee.annualLeave.totalDays = totalDays
  }

  await employee.save()
  console.log(`[AnnualLeave] Set quota for employee ${employeeId}: ${totalDays} days for year ${targetYear}`)

  return employee
}
