import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import { findInsuranceLevelBySalary } from './laborInsuranceService.js';

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
  
  // 基本薪資
  const baseSalary = customData.baseSalary ?? employee.salaryAmount ?? 0;
  
  // 查找勞保等級
  const insuranceRate = await findInsuranceLevelBySalary(baseSalary);
  const laborInsuranceFee = customData.laborInsuranceFee ?? (insuranceRate?.workerFee || 0);
  
  // 健保費自付額 (這裡需要根據實際情況計算，暫時使用自定義值或默認值)
  const healthInsuranceFee = customData.healthInsuranceFee ?? 0;
  
  // 勞退個人提繳 (從員工資料獲取或自定義)
  const laborPensionSelf = customData.laborPensionSelf ?? employee.laborPensionSelf ?? 0;
  
  // 員工借支
  const employeeAdvance = customData.employeeAdvance ?? employee.employeeAdvance ?? 0;
  
  // 債權扣押
  const debtGarnishment = customData.debtGarnishment ?? 0;
  
  // 其他扣款
  const otherDeductions = customData.otherDeductions ?? 0;
  
  // 計算實領金額 (Stage A)
  const totalDeductions = laborInsuranceFee + healthInsuranceFee + laborPensionSelf + 
                          employeeAdvance + debtGarnishment + otherDeductions;
  const netPay = Math.max(0, baseSalary - totalDeductions); // Ensure non-negative net pay
  
  // Warning if deductions exceed base salary
  if (totalDeductions > baseSalary) {
    console.warn(`Warning: Total deductions (${totalDeductions}) exceed base salary (${baseSalary}) for employee ${employeeId}`);
  }
  
  // 獎金項目 (Stage B)
  const nightShiftAllowance = customData.nightShiftAllowance ?? 0;
  const performanceBonus = customData.performanceBonus ?? 0;
  const otherBonuses = customData.otherBonuses ?? 0;
  const totalBonus = nightShiftAllowance + performanceBonus + otherBonuses;
  
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
    totalBonus,
    bankAccountA,
    bankAccountB,
    insuranceLevel: insuranceRate?.level,
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
  getEmployeePayrollRecords
};
