import mongoose from 'mongoose';
import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import { findInsuranceLevelBySalary } from './laborInsuranceService.js';
import { calculateCompleteWorkData } from './workHoursCalculationService.js';
import { calculateLateEarlyDeductions } from './attendanceDeductionService.js';
import { calculateNightShiftAllowance } from './nightShiftAllowanceService.js';
import ApprovalRequest from '../models/approval_request.js';
import { aggregateBonusFromApprovals, loadBonusFieldsByForm } from '../utils/payrollPreviewUtils.js';
import { approvedInMonthFilter, payrollMonthRange } from '../utils/payrollMonth.js';
import { extractRecurringAllowance } from '../config/salaryConfig.js';
import { loadPayrollPolicy } from './payrollPolicyService.js';

// 金額一律是整數元：設定值帶小數（例如每次遲到扣 33.5 元、津貼 1000.5 元）或不是數字時，
// 各項先四捨五入成整數（不是數字算 0）再加總，實領與總額才不會出現小數或 NaN，各項加起來也才會等於總額
function toMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

/**
 * 這位員工在薪資月份內核准完成的獎金申請，加在員工每月調整設定的獎金（夜班津貼是加在動態計算值）之上。
 * 回傳 { nightShiftAllowance?, performanceBonus?, otherBonuses? }（只有有核准金額的項目）；沒有資料庫連線時不查。
 * 薪資總覽與匯出整批計算時已經自己查好、加總過（context.approvedBonusApplied），不會走到這裡。
 */
export async function loadApprovedBonusData(employee, month, workData) {
  const range = payrollMonthRange(month);
  const employeeId = employee?._id;
  if (!range || !employeeId || !mongoose.isValidObjectId(employeeId) || mongoose.connection.readyState !== 1) return {};
  const approvals = await ApprovalRequest.find({
    applicant_employee: employeeId,
    ...approvedInMonthFilter(range),
  }).populate('form').lean();
  if (!approvals?.length) return {};
  return aggregateBonusFromApprovals(approvals, {
    employee,
    workData,
    fieldsByForm: await loadBonusFieldsByForm(approvals),
    range,
  });
}

// 定期津貼的計算放在 config/salaryConfig.js（薪資總覽、匯出共用），這裡照舊匯出同一個函式
export { extractRecurringAllowance };

/**
 * 計算單個員工的月薪資
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式，通常為該月的第一天)
 * @param {Object} customData - 自定義數據 (可選)
 * @returns {Object} - 薪資計算結果
 */
export async function calculateEmployeePayroll(employeeId, month, customData = {}, context = {}) {
  const employee = context.employee ?? await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }
  const calculationContext = context.calculationContext ?? { employee };
  calculationContext.employee = employee;

  const { total: recurringAllowanceFromItems, breakdown: recurringAllowanceBreakdown } = extractRecurringAllowance(employee);
  
  // 計算工作時數和請假影響
  let workData = null;
  try {
    workData = context.workData ?? await calculateCompleteWorkData(employeeId, month, calculationContext);
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
  const baseSalary = toMoney(customData.baseSalary ?? workData.baseSalary);
  
  // 計算遲到早退自動扣款
  let lateEarlyDeduction = 0;
  try {
    const deductionData = await calculateLateEarlyDeductions(employeeId, month, calculationContext);
    lateEarlyDeduction = toMoney(deductionData.totalDeduction);
  } catch (error) {
    console.error(`Error calculating late/early deductions for employee ${employeeId}:`, error);
  }
  
  // 計算夜班津貼（根據實際排班）
  let nightShiftAllowanceData = null;
  try {
    nightShiftAllowanceData = context.nightShiftAllowanceData ??
      await calculateNightShiftAllowance(employeeId, month, employee, calculationContext);
  } catch (error) {
    console.error(`Error calculating night shift allowance for employee ${employeeId}:`, error);
  }
  
  // 查找勞保等級（整批計算時呼叫端已把級距表讀好放在 context.insuranceRates，不必每位員工各查一次）
  const insuranceRate = context.insuranceRates
    ? await findInsuranceLevelBySalary(baseSalary, context.insuranceRates)
    : await findInsuranceLevelBySalary(baseSalary);
  const laborInsuranceFee = toMoney(customData.laborInsuranceFee ?? (insuranceRate?.workerFee || 0));
  
  // 健保費自付額 (優先使用自定義值，然後使用員工設定的每月調整項目，最後默認為0)
  const healthInsuranceFee = toMoney(customData.healthInsuranceFee ??
                             employee.monthlySalaryAdjustments?.healthInsuranceFee ?? 0);
  
  // 勞退個人提繳 (從員工資料獲取或自定義)
  const laborPensionSelf = toMoney(customData.laborPensionSelf ?? employee.laborPensionSelf ?? 0);
  
  // 員工借支
  const employeeAdvance = toMoney(customData.employeeAdvance ?? employee.employeeAdvance ?? 0);
  
  // 債權扣押 (優先使用自定義值，然後使用員工設定的每月調整項目)
  const debtGarnishment = toMoney(customData.debtGarnishment ??
                          employee.monthlySalaryAdjustments?.debtGarnishment ?? 0);
  
  // 其他扣款 (包含遲到早退自動扣款和員工設定的每月調整項目)
  const otherDeductions = toMoney(customData.otherDeductions ??
                          employee.monthlySalaryAdjustments?.otherDeductions ?? 0) + lateEarlyDeduction;
  
  // 計算實領金額 (Stage A)
  const totalDeductions = laborInsuranceFee + healthInsuranceFee + laborPensionSelf + 
                          employeeAdvance + debtGarnishment + otherDeductions;
  const netPay = Math.max(0, baseSalary - totalDeductions); // Ensure non-negative net pay
  // 扣款超過本薪時實領只會是 0，沒扣到的部分另外列出來（各扣款項目仍是原本的金額，加起來會比本薪多出這個數字）
  const deductionShortfall = Math.max(0, totalDeductions - baseSalary);
  
  // Warning if deductions exceed base salary
  if (totalDeductions > baseSalary) {
    console.warn(`Warning: Total deductions (${totalDeductions}) exceed base salary (${baseSalary}) for employee ${employeeId}`);
  }
  
  // 獎金項目 (Stage B) - 加班費加入獎金
  // 夜班津貼使用動態計算值或自定義值（不再使用員工個人設定）
  // 核准的獎金申請（依核准完成的月份）加在設定值之上：薪資總覽、匯出已經在 customData 帶入加總後的數字
  // （context.approvedBonusApplied），單獨計算、計算並儲存、個人薪資表則在這裡查，同一位員工同一個月才會是同樣的數字
  let approvedBonus = {};
  if (!context.approvedBonusApplied) {
    try {
      approvedBonus = await loadApprovedBonusData(employee, month, {
        nightShiftAllowance: nightShiftAllowanceData?.allowanceAmount,
      });
    } catch (error) {
      console.error(`Error aggregating approved bonuses for employee ${employeeId}:`, error?.name ?? 'Error');
    }
  }
  const nightShiftAllowance = toMoney(customData.nightShiftAllowance ??
                              approvedBonus.nightShiftAllowance ??
                              nightShiftAllowanceData?.allowanceAmount ?? 0);
  const performanceBonus = toMoney(customData.performanceBonus ??
                           approvedBonus.performanceBonus ??
                           employee.monthlySalaryAdjustments?.performanceBonus ?? 0);
  const otherBonuses = toMoney(customData.otherBonuses ??
                       approvedBonus.otherBonuses ??
                       employee.monthlySalaryAdjustments?.otherBonuses ?? 0);
  const overtimePay = toMoney(customData.overtimePay ?? workData.overtimePay ?? 0);
  const recurringAllowance = toMoney(customData.recurringAllowance ?? recurringAllowanceFromItems ?? 0);
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
    overtimeIssues: workData.overtimeIssues ?? [],

    // 這次套用的薪資政策：在職期間（含月中到職、離職的比例算法 employment.method）與加班費倍率
    employment: workData.employment ?? null,
    appliedPolicy: {
      prorationMethod: workData.employment?.method ?? calculationContext.payrollPolicy?.proration?.method ?? null,
      overtimeRates: workData.overtimeRates ?? calculationContext.payrollPolicy?.overtime?.rates ?? null,
    },
    
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
    lateEarlyDeduction, // 遲到早退自動扣款（已包含在 otherDeductions 裡，另外列出供明細使用）
    deductionShortfall,
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
    insuredSalary: insuranceRate?.insuredSalary ?? 0, // 勞保投保薪資（級距金額）
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
  // 薪資政策整批只讀一次，每位員工各自一個新的計算 context
  const payrollPolicy = await loadPayrollPolicy();

  for (const employeeId of employees) {
    try {
      const customData = customDataMap[employeeId] || {};
      const payroll = await calculateEmployeePayroll(employeeId, month, customData, { calculationContext: { payrollPolicy } });
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
  extractRecurringAllowance,
  loadApprovedBonusData
};
