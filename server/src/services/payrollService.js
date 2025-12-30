import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import { findInsuranceLevelBySalary } from './laborInsuranceService.js';
import { calculateCompleteWorkData } from './workHoursCalculationService.js';
import { calculateLateEarlyDeductions } from './attendanceDeductionService.js';
import { calculateNightShiftAllowance } from './nightShiftAllowanceService.js';
import ApprovalRequest from '../models/approval_request.js';

export function extractRecurringAllowance(employee) {
  const salaryItems = Array.isArray(employee?.salaryItems) ? employee.salaryItems : [];
  const amounts = employee?.salaryItemAmounts || {};
  const breakdown = [];
  let total = 0;

  salaryItems.forEach((item) => {
    const value = Number(amounts[item]);
    if (!Number.isFinite(value)) return;
    if (value > 0) {
      total += value;
      breakdown.push({ item, amount: value });
    }
  });

  return { total, breakdown };
}

/**
 * 計算單個員工的月薪資
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式，通常為該月的第一天)
 * @param {Object} customData - 自定義數據 (可選)
 * @returns {Object} - 薪資計算結果
 */
export async function calculateEmployeePayroll(employeeId, month, customData = {}) {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }

  const { total: recurringAllowanceFromItems, breakdown: recurringAllowanceBreakdown } = extractRecurringAllowance(employee);
  
  // 計算工作時數和請假影響
  let workData = null;
  try {
    workData = await calculateCompleteWorkData(employeeId, month);
  } catch (error) {
    console.error(`Error calculating work data for employee ${employeeId}:`, error);
    // 如果計算失敗，使用預設值
    workData = {
      workDays: 0,
      scheduledHours: 0,
      actualWorkHours: 0,
      hourlyRate: 0,
      dailyRate: 0,
      leaveHours: 0,
      paidLeaveHours: 0,
      unpaidLeaveHours: 0,
      sickLeaveHours: 0,
      personalLeaveHours: 0,
      leaveDeduction: 0,
      overtimeHours: 0,
      overtimePay: 0,
      baseSalary: employee.salaryAmount ?? 0
    };
  }
  
  // 基本薪資 (優先使用自定義值，否則使用工作時數計算結果)
  const baseSalary = customData.baseSalary ?? workData.baseSalary;
  
  // 計算遲到早退自動扣款
  let lateEarlyDeduction = 0;
  try {
    const deductionData = await calculateLateEarlyDeductions(employeeId, month);
    lateEarlyDeduction = deductionData.totalDeduction || 0;
  } catch (error) {
    console.error(`Error calculating late/early deductions for employee ${employeeId}:`, error);
  }
  
  // 計算夜班津貼（根據實際排班）
  let nightShiftAllowanceData = null;
  try {
    nightShiftAllowanceData = await calculateNightShiftAllowance(employeeId, month, employee);
  } catch (error) {
    console.error(`Error calculating night shift allowance for employee ${employeeId}:`, error);
  }
  
  // 查找勞保等級
  const insuranceRate = await findInsuranceLevelBySalary(baseSalary);
  const laborInsuranceFee = customData.laborInsuranceFee ?? (insuranceRate?.workerFee || 0);
  
  // 健保費自付額 (優先使用自定義值，然後使用員工設定的每月調整項目，最後默認為0)
  const healthInsuranceFee = customData.healthInsuranceFee ?? 
                             employee.monthlySalaryAdjustments?.healthInsuranceFee ?? 0;
  
  // 勞退個人提繳 (從員工資料獲取或自定義)
  const laborPensionSelf = customData.laborPensionSelf ?? employee.laborPensionSelf ?? 0;
  
  // 員工借支
  const employeeAdvance = customData.employeeAdvance ?? employee.employeeAdvance ?? 0;
  
  // 債權扣押 (優先使用自定義值，然後使用員工設定的每月調整項目)
  const debtGarnishment = customData.debtGarnishment ?? 
                          employee.monthlySalaryAdjustments?.debtGarnishment ?? 0;
  
  // 其他扣款 (包含遲到早退自動扣款和員工設定的每月調整項目)
  const otherDeductions = (customData.otherDeductions ?? 
                          employee.monthlySalaryAdjustments?.otherDeductions ?? 0) + lateEarlyDeduction;
  
  // 計算實領金額 (Stage A)
  const totalDeductions = laborInsuranceFee + healthInsuranceFee + laborPensionSelf + 
                          employeeAdvance + debtGarnishment + otherDeductions;
  const netPay = Math.max(0, baseSalary - totalDeductions); // Ensure non-negative net pay
  
  // Warning if deductions exceed base salary
  if (totalDeductions > baseSalary) {
    console.warn(`Warning: Total deductions (${totalDeductions}) exceed base salary (${baseSalary}) for employee ${employeeId}`);
  }
  
  // 獎金項目 (Stage B) - 加班費加入獎金
  // 夜班津貼使用動態計算值或自定義值（不再使用員工個人設定）
  const nightShiftAllowance = customData.nightShiftAllowance ?? 
                              nightShiftAllowanceData?.allowanceAmount ?? 0;
  const performanceBonus = customData.performanceBonus ?? 
                           employee.monthlySalaryAdjustments?.performanceBonus ?? 0;
  const otherBonuses = customData.otherBonuses ?? 
                       employee.monthlySalaryAdjustments?.otherBonuses ?? 0;
  const overtimePay = customData.overtimePay ?? workData.overtimePay ?? 0;
  const recurringAllowance = customData.recurringAllowance ?? recurringAllowanceFromItems ?? 0;
  const totalBonus = nightShiftAllowance + performanceBonus + otherBonuses + overtimePay + recurringAllowance;
  
  // 計算總實發金額 (netPay + totalBonus)
  const totalPayment = netPay + totalBonus;
  
  // 銀行帳戶資訊
  const bankAccountA = {
    bank: employee.salaryAccountA?.bank || '',
    accountNumber: employee.salaryAccountA?.acct || '',
    accountName: employee.name
  };
  
  const bankAccountB = {
    bank: employee.salaryAccountB?.bank || '',
    accountNumber: employee.salaryAccountB?.acct || '',
    accountName: employee.name
  };
  
  return {
    employee: employeeId,
    month: new Date(month),
    
    // 工作時數資料
    workDays: customData.workDays ?? workData.workDays ?? 0,
    scheduledHours: customData.scheduledHours ?? workData.scheduledHours ?? 0,
    actualWorkHours: customData.actualWorkHours ?? workData.actualWorkHours ?? 0,
    hourlyRate: customData.hourlyRate ?? workData.hourlyRate ?? 0,
    dailyRate: customData.dailyRate ?? workData.dailyRate ?? 0,
    
    // 請假資料
    leaveHours: customData.leaveHours ?? workData.leaveHours ?? 0,
    paidLeaveHours: customData.paidLeaveHours ?? workData.paidLeaveHours ?? 0,
    unpaidLeaveHours: customData.unpaidLeaveHours ?? workData.unpaidLeaveHours ?? 0,
    sickLeaveHours: customData.sickLeaveHours ?? workData.sickLeaveHours ?? 0,
    personalLeaveHours: customData.personalLeaveHours ?? workData.personalLeaveHours ?? 0,
    leaveDeduction: customData.leaveDeduction ?? workData.leaveDeduction ?? 0,
    
    // 加班資料
    overtimeHours: customData.overtimeHours ?? workData.overtimeHours ?? 0,
    overtimePay,
    
    // 夜班資料
    nightShiftDays: nightShiftAllowanceData?.nightShiftDays ?? 0,
    nightShiftHours: nightShiftAllowanceData?.nightShiftHours ?? 0,
    nightShiftCalculationMethod: nightShiftAllowanceData?.calculationMethod ?? 'not_calculated',
    nightShiftBreakdown: nightShiftAllowanceData?.shiftBreakdown ?? [],
    nightShiftConfigurationIssues: nightShiftAllowanceData?.configurationIssues ?? [],
    
    // 薪資計算
    baseSalary,
    laborInsuranceFee,
    healthInsuranceFee,
    laborPensionSelf,
    employeeAdvance,
    debtGarnishment,
    otherDeductions,
    netPay,
    nightShiftAllowance,
    performanceBonus,
    otherBonuses,
    recurringAllowance,
    recurringAllowanceBreakdown,
    totalBonus,
    totalPayment, // Total amount employee receives (netPay + totalBonus)
    bankAccountA,
    bankAccountB,
    insuranceLevel: insuranceRate?.level,
    insuranceRate: insuranceRate ? {
      level: insuranceRate.level,
      insuredSalary: insuranceRate.insuredSalary,
      workerFee: insuranceRate.workerFee,
      employerFee: insuranceRate.employerFee,
      ordinaryRate: insuranceRate.ordinaryRate,
      employmentInsuranceRate: insuranceRate.employmentInsuranceRate
    } : null,
    amount: netPay // For backward compatibility
  };
}

/**
 * 批量計算多個員工的月薪資
 * @param {Array} employees - 員工 ID 數組
 * @param {String} month - 月份
 * @param {Object} customDataMap - 自定義數據映射 { employeeId: customData }
 * @returns {Array} - 薪資計算結果數組
 */
export async function calculateBatchPayroll(employees, month, customDataMap = {}) {
  const results = [];
  
  for (const employeeId of employees) {
    try {
      const customData = customDataMap[employeeId] || {};
      const payroll = await calculateEmployeePayroll(employeeId, month, customData);
      results.push(payroll);
    } catch (error) {
      console.error(`Error calculating payroll for employee ${employeeId}:`, error.message);
      results.push({ employeeId, error: error.message });
    }
  }
  
  return results;
}

/**
 * 保存或更新薪資記錄
 * @param {Object} payrollData - 薪資數據
 * @returns {Object} - 保存的薪資記錄
 */
export async function savePayrollRecord(payrollData) {
  const { employee, month } = payrollData;
  
  const record = await PayrollRecord.findOneAndUpdate(
    { employee, month: new Date(month) },
    payrollData,
    { upsert: true, new: true }
  );
  
  return record;
}

/**
 * 獲取員工的薪資記錄
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (可選)
 * @returns {Array|Object} - 薪資記錄
 */
export async function getEmployeePayrollRecords(employeeId, month = null) {
  const query = { employee: employeeId };
  
  if (month) {
    query.month = new Date(month);
    return await PayrollRecord.findOne(query).populate('employee');
  }
  
  return await PayrollRecord.find(query).populate('employee').sort({ month: -1 });
}

export default {
  calculateEmployeePayroll,
  calculateBatchPayroll,
  savePayrollRecord,
  getEmployeePayrollRecords,
  extractRecurringAllowance
};
