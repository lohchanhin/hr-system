// 薪資總覽、月薪資總覽 PDF、銀行匯款 Excel 共用的「一位員工一個月」薪資計算。
// 三個地方以前各寫一份，同一位員工同一個月會算出不同的數字（總覽沒有加班費、匯出沒有帳號、只存了幾筆薪資記錄時
// 匯出只剩那幾個人）。現在都走 computeEmployeePayroll，數字才會一致。
import mongoose from 'mongoose';
import AttendanceSetting from '../models/AttendanceSetting.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import { calculateEmployeePayroll } from './payrollService.js';
import { calculateCompleteWorkData } from './workHoursCalculationService.js';
import { loadInsuranceRateTable } from './laborInsuranceService.js';
import { aggregateBonusFromApprovals, loadBonusFieldsByForm } from '../utils/payrollPreviewUtils.js';
import { approvedInMonthFilter, payrollMonthRange } from '../utils/payrollMonth.js';
import { extractRecurringAllowance } from '../config/salaryConfig.js';
import { isOvertimeFormTemplate } from '../utils/formSemantics.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// 整批計算時，月份前後各多讀幾天的班表（一次查完；跨月的假單超出這個範圍時才另外查那位員工）
const SCHEDULE_MARGIN_DAYS = 7;

// 員工資料要帶哪些欄位才算得出薪資（薪資總覽、PDF 的投影共用）：
// autoOvertimeCalc 沒帶會讓加班費一律是 0；status、appointment 用來判斷月中到職、離職；
// holidayRegime、requiresScheduling、isIndigenous 是國定假日判斷要用的，帶了就不必每位員工再查一次。
export const PAYROLL_EMPLOYEE_FIELDS = [
  'employeeId', 'name', 'department', 'subDepartment', 'organization',
  'salaryAmount', 'salaryType', 'salaryItems', 'salaryItemAmounts', 'annualLeave', 'monthlySalaryAdjustments',
  'laborPensionSelf', 'employeeAdvance', 'salaryAccountA', 'salaryAccountB',
  'autoOvertimeCalc', 'status', 'appointment', 'holidayRegime', 'requiresScheduling', 'isIndigenous',
].join(' ');

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function groupByEmployee(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.employee?._id ?? row.employee ?? '');
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function validEmployeeIds(employees) {
  return (employees || [])
    .map((employee) => employee?._id)
    .filter((id) => id && mongoose.isValidObjectId(id));
}

/**
 * 一批員工共用的資料：班別設定、這批員工當月的班表與打卡、勞保級距表各只讀一次
 * （以前每位員工各查一次班別設定、班表、打卡、級距，500 人的匯出要九千多次查詢）。
 * 查詢範圍與 workHoursCalculationService.calculateWorkHours 相同（打卡多讀前後各一天）。
 * 沒有資料庫連線（單元測試）或讀取失敗時回傳空物件，各計算函式照舊自己查。
 */
export async function loadPayrollBatchData(employees, month) {
  const ids = validEmployeeIds(employees);
  if (!ids.length || mongoose.connection.readyState !== 1) return {};
  const start = new Date(month);
  if (Number.isNaN(start.getTime())) return {};
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const marginFrom = new Date(start.getTime() - SCHEDULE_MARGIN_DAYS * MS_PER_DAY);
  const marginTo = new Date(end.getTime() + SCHEDULE_MARGIN_DAYS * MS_PER_DAY);
  try {
    const [attendanceSetting, schedules, attendanceRecords, insuranceRates, formTemplates] = await Promise.all([
      AttendanceSetting.findOne().lean(),
      // 月份前後各多讀幾天的班表（不算進這個月）：月初前一天那一班要認領自己的打卡（matchSchedulesPunches 的 contextOnly），
      // 跨月的請假單要知道其他月份那幾天是不是休息日（calculateLeaveImpact）
      ShiftSchedule.find({ employee: { $in: ids }, date: { $gte: marginFrom, $lt: marginTo } }).lean(),
      AttendanceRecord.find({
        employee: { $in: ids },
        timestamp: { $gte: new Date(start.getTime() - MS_PER_DAY), $lt: new Date(end.getTime() + MS_PER_DAY) },
        action: { $in: ['clockIn', 'clockOut'] },
      }).lean(),
      loadInsuranceRateTable(),
      // 哪些表單是加班表單（加班費只讀這些表單的單，不必每位員工把所有已核准的單讀出來再篩）
      FormTemplate.find({}).select('name semanticType').lean(),
    ]);
    const inMonth = (row) => {
      const time = new Date(row.date).getTime();
      return time >= start.getTime() && time < end.getTime();
    };
    return {
      attendanceSetting,
      schedulesByEmployee: groupByEmployee((schedules || []).filter(inMonth)),
      marginSchedulesByEmployee: groupByEmployee((schedules || []).filter((row) => !inMonth(row))),
      marginRange: { from: marginFrom, to: marginTo },
      overtimeFormIds: (formTemplates || []).filter(isOvertimeFormTemplate).map((form) => form._id),
      recordsByEmployee: groupByEmployee(attendanceRecords),
      insuranceRates: insuranceRates?.length ? insuranceRates : null,
    };
  } catch (error) {
    console.error('Failed to preload shared payroll data', error?.name ?? 'Error');
    return {};
  }
}

/**
 * 一位員工的計算用 context（每位員工一個新物件）：帶入整批共用的資料，沒有預先讀好的部分由計算函式自己查。
 * 薪資政策（payrollBatch.payrollPolicy）由呼叫端在請求開始時讀一次放進 payrollBatch，整批員工用同一份。
 */
export function createCalculationContext(batchData, employee, payrollBatch) {
  const context = { employee };
  if (payrollBatch) context.payrollBatch = payrollBatch;
  if (payrollBatch?.payrollPolicy) context.payrollPolicy = payrollBatch.payrollPolicy;
  if (batchData?.attendanceSetting) context.attendanceSetting = batchData.attendanceSetting;
  if (batchData?.schedulesByEmployee && batchData?.recordsByEmployee) {
    const key = String(employee?._id ?? '');
    context.schedules = batchData.schedulesByEmployee.get(key) ?? [];
    if (Array.isArray(batchData.overtimeFormIds)) context.overtimeFormIds = batchData.overtimeFormIds;
    if (batchData.marginSchedulesByEmployee) {
      context.marginSchedules = batchData.marginSchedulesByEmployee.get(key) ?? [];
      context.marginRange = batchData.marginRange;
    }
    context.attendanceRecords = batchData.recordsByEmployee.get(key) ?? [];
  }
  return context;
}

/**
 * 這批員工在薪資月份內核准完成的獎金申請（一次查完，不是每位員工各查一次）。
 * 獎金申請依「核准完成」的時間歸屬月份（台灣時間），精確的月份由 aggregateBonusFromApprovals 的 range 判斷。
 * 回傳 { approvalsByEmployee: Map, bonusFieldsByForm, bonusRange }。
 */
export async function loadBonusApprovals(employees, month) {
  const bonusRange = payrollMonthRange(month);
  const result = { approvalsByEmployee: new Map(), bonusFieldsByForm: new Map(), bonusRange };
  const ids = validEmployeeIds(employees).map((id) => id.toString());
  if (!bonusRange || !ids.length) return result;
  try {
    const approvals = await ApprovalRequest.find({
      applicant_employee: { $in: ids },
      ...approvedInMonthFilter(bonusRange),
    }).populate('form').lean();
    result.bonusFieldsByForm = await loadBonusFieldsByForm(approvals);
    (approvals || []).forEach((approval) => {
      const applicantId = approval.applicant_employee?._id ?? approval.applicant_employee;
      if (!applicantId) return;
      const key = applicantId.toString();
      const list = result.approvalsByEmployee.get(key) ?? [];
      list.push(approval);
      result.approvalsByEmployee.set(key, list);
    });
  } catch (error) {
    console.error('Error aggregating payroll approvals', { error: error?.name ?? 'Error' });
  }
  return result;
}

/**
 * 一位員工一個月的薪資。
 * - 沒有薪資記錄（storedRecord）：依出勤、請假、加班、核准的獎金申請即時計算（不存檔）。
 * - 有薪資記錄：金額以記錄為準（存檔時的數字），只有夜班津貼與夜班明細照現在的班表重算
 *   （夜班津貼 = 依班表計算的金額 + 本月核准的夜班獎金申請），加班的提醒也用現在的。
 * 回傳的 baseSalary、netPay、totalBonus、totalPayment 是整理過的最後數字：
 * totalBonus = 加班費 + 夜班津貼 + 績效獎金 + 其他獎金 + 定期津貼，totalPayment = netPay + totalBonus。
 */
export async function computeEmployeePayroll({
  employee,
  month,
  storedRecord = null,
  approvals = [],
  bonusFieldsByForm,
  bonusRange,
  calculationContext,
  insuranceRates,
}) {
  const employeeIdStr = employee._id.toString();
  const hasPayrollRecord = Boolean(storedRecord);
  let payroll = storedRecord && typeof storedRecord.toObject === 'function' ? storedRecord.toObject() : storedRecord;
  const context = calculationContext ?? { employee };

  // Always calculate work data including night shift data dynamically to ensure accuracy
  let workData = null;
  try {
    workData = await calculateCompleteWorkData(employeeIdStr, month, context);
  } catch (error) {
    console.error(`Error calculating work data for employee ${employeeIdStr}:`, error);
  }

  // 核准的金額是「加在」員工每月調整設定的獎金（夜班津貼是加在動態計算值）之上，不會蓋掉原本設定的金額
  let bonusData = {};
  if (approvals?.length) {
    try {
      bonusData = aggregateBonusFromApprovals(approvals, {
        employee,
        workData,
        fieldsByForm: bonusFieldsByForm,
        range: bonusRange,
      }) || {};
    } catch (error) {
      console.error(`Error aggregating approvals for employee ${employeeIdStr}:`, error);
    }
  }

  if (!payroll) {
    try {
      const customData = {};
      if (workData) {
        Object.assign(customData, {
          workDays: workData.workDays,
          scheduledHours: workData.scheduledHours,
          actualWorkHours: workData.actualWorkHours,
          hourlyRate: workData.hourlyRate,
          dailyRate: workData.dailyRate,
          leaveHours: workData.leaveHours,
          paidLeaveHours: workData.paidLeaveHours,
          unpaidLeaveHours: workData.unpaidLeaveHours,
          sickLeaveHours: workData.sickLeaveHours,
          personalLeaveHours: workData.personalLeaveHours,
          leaveDeduction: workData.leaveDeduction,
          overtimeHours: workData.overtimeHours,
          overtimePay: workData.overtimePay,
          overtimeIssues: workData.overtimeIssues,
          baseSalary: workData.baseSalary,
          // Include night shift data
          nightShiftDays: workData.nightShiftDays,
          nightShiftHours: workData.nightShiftHours,
          nightShiftAllowance: workData.nightShiftAllowance,
          nightShiftCalculationMethod: workData.nightShiftCalculationMethod,
          nightShiftBreakdown: workData.nightShiftBreakdown,
          nightShiftConfigurationIssues: workData.nightShiftConfigurationIssues,
        });
      }
      Object.entries(bonusData).forEach(([key, value]) => {
        if (typeof value === 'number') customData[key] = value;
      });

      const nightShiftAllowanceData = workData ? {
        nightShiftDays: workData.nightShiftDays,
        nightShiftHours: workData.nightShiftHours,
        allowanceAmount: workData.nightShiftAllowance,
        calculationMethod: workData.nightShiftCalculationMethod,
        shiftBreakdown: workData.nightShiftBreakdown,
        configurationIssues: workData.nightShiftConfigurationIssues,
      } : undefined;
      // Note: We don't save the calculated payroll automatically, just return it for preview
      payroll = await calculateEmployeePayroll(employeeIdStr, month, customData, {
        employee,
        workData,
        nightShiftAllowanceData,
        calculationContext: context,
        insuranceRates,
        approvedBonusApplied: true,
      });
    } catch (error) {
      console.error(`Error calculating payroll for employee ${employeeIdStr}:`, error);
      payroll = null;
    }
  }

  // Override night shift data with dynamically calculated values if available
  // This ensures even existing payroll records show up-to-date night shift allowances
  if (payroll && workData) {
    // 剛算出來的薪資（沒有薪資記錄）夜班津貼已經加上核准的夜班獎金申請，不能再被動態值蓋掉；
    // 有薪資記錄時用「現在的班表算出的津貼 + 本月核准的夜班獎金申請」
    const nightShiftAllowance = hasPayrollRecord
      ? (typeof bonusData.nightShiftAllowance === 'number' ? bonusData.nightShiftAllowance : workData.nightShiftAllowance)
      : (payroll.nightShiftAllowance ?? workData.nightShiftAllowance);
    payroll = {
      ...payroll,
      nightShiftDays: workData.nightShiftDays,
      nightShiftHours: workData.nightShiftHours,
      nightShiftAllowance,
      nightShiftCalculationMethod: workData.nightShiftCalculationMethod,
      nightShiftBreakdown: workData.nightShiftBreakdown,
      nightShiftConfigurationIssues: workData.nightShiftConfigurationIssues,
      overtimeIssues: workData.overtimeIssues,
    };
  }

  const { total: recurringAllowanceFromItems, breakdown: recurringAllowanceBreakdown } = extractRecurringAllowance(employee);
  const recurringAllowance = payroll?.recurringAllowance ?? recurringAllowanceFromItems ?? 0;
  // 算不出來（payroll 為 null）時才退回員工的薪資金額；算出 0 元（整月無薪假、時薪沒有出勤）就是 0，不能換成薪資金額
  const baseSalary = payroll && payroll.baseSalary != null ? payroll.baseSalary : (employee.salaryAmount || 0);
  const netPay = payroll?.netPay ?? employee.salaryAmount ?? 0;
  const totalBonus = (payroll?.overtimePay || 0)
    + (payroll?.nightShiftAllowance || 0)
    + (payroll?.performanceBonus || 0)
    + (payroll?.otherBonuses || 0)
    + recurringAllowance;
  const totalPayment = netPay + totalBonus;
  if (payroll) payroll = { ...payroll, totalBonus, totalPayment };

  return {
    payroll,
    workData,
    hasPayrollRecord,
    recurringAllowance,
    recurringAllowanceBreakdown,
    baseSalary,
    netPay,
    totalBonus,
    totalPayment,
  };
}

export default {
  PAYROLL_EMPLOYEE_FIELDS,
  mapWithConcurrency,
  loadPayrollBatchData,
  createCalculationContext,
  loadBonusApprovals,
  computeEmployeePayroll,
};
