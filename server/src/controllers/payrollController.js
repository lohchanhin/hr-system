import mongoose from 'mongoose';
import PayrollRecord from '../models/PayrollRecord.js';
import LaborInsuranceRate from '../models/LaborInsuranceRate.js';
import Employee from '../models/Employee.js';
import Organization from '../models/Organization.js';
import ApprovalRequest from '../models/approval_request.js';
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
import {
  calculateEmployeePayroll,
  calculateBatchPayroll,
  savePayrollRecord,
  getEmployeePayrollRecords,
  extractRecurringAllowance
} from '../services/payrollService.js';
import {
  calculateWorkHours,
  calculateLeaveImpact,
  calculateOvertimePay,
  calculateCompleteWorkData
} from '../services/workHoursCalculationService.js';
import {
  initializeLaborInsuranceRates,
  refreshLaborInsuranceRates,
  fetchInsuranceRatesByType,
  refreshInsuranceRatesByType
} from '../services/laborInsuranceService.js';
import { generatePayrollExcel, generateIndividualPayrollExcel } from '../services/payrollExportService.js';
import { generateMonthlyPayrollOverviewPdf } from '../services/payrollPdfExportService.js';
import { aggregateBonusFromApprovals } from '../utils/payrollPreviewUtils.js';

export async function listPayrolls(req, res) {
  try {
    const { month, employeeId } = req.query;
    const query = {};
    
    if (month) {
      query.month = new Date(month);
    }
    if (employeeId) {
      query.employee = employeeId;
    }
    
    const records = await PayrollRecord.find(query).populate('employee').sort({ month: -1, 'employee.name': 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createPayroll(req, res) {
  try {
    const record = new PayrollRecord(req.body);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getPayroll(req, res) {
  try {
    const record = await PayrollRecord.findById(req.params.id).populate('employee');
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updatePayroll(req, res) {
  try {
    const record = await PayrollRecord.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deletePayroll(req, res) {
  try {
    const record = await PayrollRecord.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 計算單個員工的薪資
 */
export async function calculatePayroll(req, res) {
  try {
    const { employeeId, month } = req.body;
    const customData = req.body.customData || {};
    
    if (!employeeId || !month) {
      return res.status(400).json({ error: 'employeeId and month are required' });
    }
    
    const result = await calculateEmployeePayroll(employeeId, month, customData);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 批量計算薪資
 */
export async function calculateBatchPayrolls(req, res) {
  try {
    const { employees, month, customDataMap } = req.body;
    
    if (!employees || !Array.isArray(employees) || !month) {
      return res.status(400).json({ error: 'employees (array) and month are required' });
    }
    
    const results = await calculateBatchPayroll(employees, month, customDataMap || {});
    res.json(results);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 計算並保存薪資
 */
export async function calculateAndSavePayroll(req, res) {
  try {
    const { employeeId, month } = req.body;
    const customData = req.body.customData || {};
    
    if (!employeeId || !month) {
      return res.status(400).json({ error: 'employeeId and month are required' });
    }
    
    const payrollData = await calculateEmployeePayroll(employeeId, month, customData);
    const record = await savePayrollRecord(payrollData);
    
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的薪資記錄
 */
export async function getEmployeePayrolls(req, res) {
  try {
    const { employeeId } = req.params;
    const { month } = req.query;
    
    const records = await getEmployeePayrollRecords(employeeId, month);
    res.json(records);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 導出個人薪資表 Excel
 */
export async function exportIndividualPayrollExcel(req, res) {
  try {
    const { employeeId, month, paymentDate, organizationName } = req.query;

    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required' });
    }

    if (!month) {
      return res.status(400).json({ error: 'month is required' });
    }

    // 查找員工
    const employee = await Employee.findById(employeeId)
      .populate('organization')
      .populate('department')
      .populate('subDepartment');
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // 查找薪資記錄
    const monthDate = new Date(month);
    let payrollRecord = await PayrollRecord.findOne({
      employee: employeeId,
      month: monthDate
    });

    // 如果沒有薪資記錄，則計算一筆
    if (!payrollRecord) {
      try {
        const calculatedPayroll = await calculateEmployeePayroll(employeeId, month, {});
        
        // 構建類似 PayrollRecord 的物件
        payrollRecord = {
          employee: employee._id,
          month: monthDate,
          baseSalary: calculatedPayroll.baseSalary || 0,
          netPay: calculatedPayroll.netPay || 0,
          laborInsuranceFee: calculatedPayroll.laborInsuranceFee || 0,
          healthInsuranceFee: calculatedPayroll.healthInsuranceFee || 0,
          laborPensionSelf: calculatedPayroll.laborPensionSelf || 0,
          employeeAdvance: calculatedPayroll.employeeAdvance || 0,
          debtGarnishment: calculatedPayroll.debtGarnishment || 0,
          otherDeductions: calculatedPayroll.otherDeductions || 0,
          overtimePay: calculatedPayroll.overtimePay || 0,
          nightShiftAllowance: calculatedPayroll.nightShiftAllowance || 0,
          performanceBonus: calculatedPayroll.performanceBonus || 0,
          otherBonuses: calculatedPayroll.otherBonuses || 0,
          insuranceLevel: calculatedPayroll.insuranceLevel,
          hourlyRate: calculatedPayroll.hourlyRate || 0,
          personalLeaveHours: calculatedPayroll.personalLeaveHours || 0,
          sickLeaveHours: calculatedPayroll.sickLeaveHours || 0,
          annualLeave: employee.annualLeave || {}
        };
      } catch (calcError) {
        console.error('Failed to calculate payroll for export:', calcError);
        throw new Error(`無法計算員工薪資記錄: ${calcError.message}`);
      }
    }

    // 獲取組織名稱（優先使用 query parameter，否則從員工資料取得）
    let orgName = organizationName || '';
    if (!orgName && employee.organization) {
      if (typeof employee.organization === 'string') {
        // 如果是字串 ID，需要查詢
        const org = await Organization.findById(employee.organization);
        orgName = org?.name || '';
      } else if (employee.organization.name) {
        orgName = employee.organization.name;
      }
    }

    // 設定選項
    const exportOptions = {
      organizationName: orgName,
      paymentDate: paymentDate ? new Date(paymentDate) : undefined
    };

    const buffer = await generateIndividualPayrollExcel(payrollRecord, employee, exportOptions);

    // Sanitize filename to prevent directory traversal and invalid characters
    const sanitizedName = employee.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
    const filename = `個人薪資表_${sanitizedName}_${month}.xlsx`;
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (err) {
    console.error('Export individual payroll error:', err);
    res.status(400).json({ error: err.message });
  }
}

/**
 * 導出薪資 Excel (台灣企銀或台中銀格式)
 */
export async function exportPayrollExcel(req, res) {
  try {
    const { month } = req.query;
    const format = req.query.format || req.query.bankType;
    const companyInfo = req.body;

    if (!month) {
      return res.status(400).json({ error: 'month is required' });
    }

    if (!format || !['taiwan', 'taichung', 'bonusSlip'].includes(format)) {
      return res.status(400).json({ error: 'format must be "taiwan", "taichung" or "bonusSlip"' });
    }

    const buffer = await generatePayrollExcel(month, format, companyInfo);

    const filename = `payroll_${month}_${format}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 匯出月薪資總覽 PDF
 */
export async function exportMonthlyPayrollOverviewPdf(req, res) {
  try {
    const { month, organization, department, subDepartment, employeeId } = req.query;

    if (!month) {
      return res.status(400).json({ error: 'month is required' });
    }

    const filters = {};
    if (organization) filters.organization = organization;
    if (department) filters.department = department;
    if (subDepartment) filters.subDepartment = subDepartment;
    if (employeeId) filters.employeeId = employeeId;

    const buffer = await generateMonthlyPayrollOverviewPdf(month, filters);

    const filename = `monthly_payroll_overview_${month}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting monthly payroll overview PDF:', err);
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取勞保費率表
 */
export async function getLaborInsuranceRates(req, res) {
  try {
    const type = req.query.type || 'laborInsurance';
    const rates = await fetchInsuranceRatesByType(type);
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * 初始化勞保費率表
 */
export async function initializeLaborInsuranceRatesController(req, res) {
  try {
    const count = await initializeLaborInsuranceRates();
    res.json({ success: true, count, message: 'Labor insurance rates initialized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function refreshLaborInsuranceRatesController(req, res) {
  try {
    const type = req.query.type || req.body?.type || 'laborInsurance';
    const result = type === 'laborInsurance'
      ? await refreshLaborInsuranceRates()
      : await refreshInsuranceRatesByType(type);
    res.json({
      success: true,
      ...result,
      message: result.isUpToDate ? '級距已是最新' : '已從官網取得最新級距'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * 獲取月薪資總覽（支援篩選機構、部門、單位、員工）
 * 自動計算沒有薪資記錄的員工薪資
 */
export async function getMonthlyPayrollOverview(req, res) {
  try {
    const { month, organization, department, subDepartment, employeeId } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    // Validate month format (should be YYYY-MM-DD)
    const monthDate = new Date(month);
    if (isNaN(monthDate.getTime())) {
      return res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM-DD' });
    }
    
    // Build employee query based on filters
    const employeeQuery = {};
    if (organization) {
      employeeQuery.organization = organization;
    }
    if (department) {
      employeeQuery.department = department;
    }
    if (subDepartment) {
      employeeQuery.subDepartment = subDepartment;
    }
    if (employeeId) {
      employeeQuery._id = employeeId;
    }
    
    // Find employees matching the criteria
    const employees = await Employee.find(employeeQuery)
      .populate('department')
      .populate('subDepartment')
      .select('employeeId name department subDepartment organization salaryAmount salaryType salaryItems salaryItemAmounts annualLeave');
    
    if (employees.length === 0) {
      return res.json([]);
    }
    
    const employeeIds = employees.map(e => e._id.toString());
    
    // Find existing payroll records for this month
    const payrollRecords = await PayrollRecord.find({
      employee: { $in: employeeIds },
      month: monthDate
    }).populate('employee');
    
    // Create a map of employee ID to payroll record
    const payrollMap = {};
    payrollRecords.forEach(record => {
      payrollMap[record.employee._id.toString()] = record;
    });
    
    // Build the overview data
    const overview = await Promise.all(employees.map(async (employee) => {
      const employeeIdStr = employee._id.toString();
      let payroll = payrollMap[employeeIdStr];
      if (payroll && typeof payroll.toObject === 'function') {
        payroll = payroll.toObject();
      }
      const { total: recurringAllowanceFromItems, breakdown: recurringAllowanceBreakdown } = extractRecurringAllowance(employee);

      // Always calculate work data including night shift data dynamically to ensure accuracy
      // This fixes the issue where stored PayrollRecords may have outdated night shift allowance
      let workData = null;
      try {
        workData = await calculateCompleteWorkData(employeeIdStr, month);
      } catch (error) {
        console.error(`Error calculating work data for employee ${employeeIdStr}:`, error);
      }

      // If no payroll record exists, calculate it automatically based on attendance
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
              baseSalary: workData.baseSalary,
              // Include night shift data
              nightShiftDays: workData.nightShiftDays,
              nightShiftHours: workData.nightShiftHours,
              nightShiftAllowance: workData.nightShiftAllowance,
              nightShiftCalculationMethod: workData.nightShiftCalculationMethod,
              nightShiftBreakdown: workData.nightShiftBreakdown,
              nightShiftConfigurationIssues: workData.nightShiftConfigurationIssues
            });
          }

          try {
            if (mongoose.Types.ObjectId.isValid(employeeIdStr)) {
              const startDate = new Date(monthDate);
              startDate.setUTCHours(0, 0, 0, 0);
              const endDate = new Date(startDate);
              endDate.setUTCMonth(endDate.getUTCMonth() + 1);

              const approvals = await ApprovalRequest.find({
                applicant_employee: employeeIdStr,
                status: 'approved',
                createdAt: { $gte: startDate, $lt: endDate }
              }).populate('form').lean();

              if (approvals.length > 0) {
                const bonusData = aggregateBonusFromApprovals(approvals);
                Object.entries(bonusData || {}).forEach(([key, value]) => {
                  if (typeof value === 'number') {
                    customData[key] = value;
                  }
                });
              }
            }
          } catch (error) {
            console.error(`Error aggregating approvals for employee ${employeeIdStr}:`, error);
          }

          const calculatedPayroll = await calculateEmployeePayroll(employeeIdStr, month, customData);
          // Note: We don't save the calculated payroll automatically, just return it for preview
          payroll = calculatedPayroll;
        } catch (error) {
          console.error(`Error calculating payroll for employee ${employeeIdStr}:`, error);
          // If calculation fails, use default values
          payroll = null;
        }
      }
      
      // Override night shift data with dynamically calculated values if available
      // This ensures even existing payroll records show up-to-date night shift allowances
      if (payroll && workData) {
        payroll = {
          ...payroll,
          nightShiftDays: workData.nightShiftDays,
          nightShiftHours: workData.nightShiftHours,
          nightShiftAllowance: workData.nightShiftAllowance,
          nightShiftCalculationMethod: workData.nightShiftCalculationMethod,
          nightShiftBreakdown: workData.nightShiftBreakdown,
          nightShiftConfigurationIssues: workData.nightShiftConfigurationIssues,
          // Recalculate totalBonus to include updated nightShiftAllowance
          totalBonus: (payroll.overtimePay || 0) + 
                     (workData.nightShiftAllowance || 0) + 
                     (payroll.performanceBonus || 0) + 
                     (payroll.otherBonuses || 0),
        };
        // Recalculate totalPayment if totalBonus changed
        payroll.totalPayment = (payroll.netPay || 0) + payroll.totalBonus;
      }
      const recurringAllowance = payroll?.recurringAllowance ?? recurringAllowanceFromItems ?? 0;
      
      // Extract payroll values with fallbacks
      const netPayValue = payroll?.netPay ?? employee.salaryAmount ?? 0;
      const totalBonusValue = (payroll?.overtimePay || 0) + 
                              (payroll?.nightShiftAllowance || 0) + 
                              (payroll?.performanceBonus || 0) + 
                              (payroll?.otherBonuses || 0) +
                              recurringAllowance;
      const totalPaymentValue = netPayValue + totalBonusValue;
      
      return {
        _id: employee._id,
        employeeId: employee.employeeId,
        name: employee.name,
        department: employee.department?.name || '',
        departmentId: employee.department?._id,
        subDepartment: employee.subDepartment?.name || '',
        subDepartmentId: employee.subDepartment?._id,
        organization: employee.organization || '',
        salaryType: employee.salaryType || '月薪',
        // Work hours data
        workDays: payroll?.workDays || 0,
        scheduledHours: payroll?.scheduledHours || 0,
        actualWorkHours: payroll?.actualWorkHours || 0,
        hourlyRate: payroll?.hourlyRate || 0,
        // Leave data
        leaveHours: payroll?.leaveHours || 0,
        paidLeaveHours: payroll?.paidLeaveHours || 0,
        unpaidLeaveHours: payroll?.unpaidLeaveHours || 0,
        leaveDeduction: payroll?.leaveDeduction || 0,
        // Overtime data
        overtimeHours: payroll?.overtimeHours || 0,
        overtimePay: payroll?.overtimePay || 0,
        // Night shift data
        nightShiftDays: payroll?.nightShiftDays || 0,
        nightShiftHours: payroll?.nightShiftHours || 0,
        nightShiftCalculationMethod: payroll?.nightShiftCalculationMethod || 'not_calculated',
        nightShiftBreakdown: payroll?.nightShiftBreakdown || [],
        nightShiftConfigurationIssues: payroll?.nightShiftConfigurationIssues || [],
        // Payroll data (calculated or from existing record)
        baseSalary: payroll?.baseSalary || employee.salaryAmount || 0,
        laborInsuranceFee: payroll?.laborInsuranceFee || 0,
        healthInsuranceFee: payroll?.healthInsuranceFee || 0,
        laborPensionSelf: payroll?.laborPensionSelf || 0,
        employeeAdvance: payroll?.employeeAdvance || 0,
        debtGarnishment: payroll?.debtGarnishment || 0,
        otherDeductions: payroll?.otherDeductions || 0,
        netPay: netPayValue,
        nightShiftAllowance: payroll?.nightShiftAllowance || 0,
        performanceBonus: payroll?.performanceBonus || 0,
        otherBonuses: payroll?.otherBonuses || 0,
        recurringAllowance,
        recurringAllowanceBreakdown,
        totalBonus: totalBonusValue,
        totalPayment: totalPaymentValue,
        insuranceLevel: payroll?.insuranceLevel,
        insuranceRate: payroll?.insuranceRate,
        // Annual leave data
        annualLeave: {
          totalDays: employee.annualLeave?.totalDays || 0,
          totalHours: (employee.annualLeave?.totalDays || 0) * WORK_HOURS_CONFIG.HOURS_PER_DAY,
          usedDays: employee.annualLeave?.usedDays || 0,
          expiryDate: employee.annualLeave?.expiryDate || null,
          accumulatedLeave: employee.annualLeave?.accumulatedLeave || 0,
          notes: employee.annualLeave?.notes || ''
        },
        hasPayrollRecord: !!payrollMap[employeeIdStr],
        payrollRecordId: payrollMap[employeeIdStr]?._id
      };
    }));
    
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * 獲取員工的工作時數資料
 */
export async function getEmployeeWorkHours(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const workHours = await calculateWorkHours(employeeId, month);
    res.json(workHours);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的請假影響資料
 */
export async function getEmployeeLeaveImpact(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const leaveImpact = await calculateLeaveImpact(employeeId, month);
    res.json(leaveImpact);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的加班資料
 */
export async function getEmployeeOvertimePay(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const overtimePay = await calculateOvertimePay(employeeId, month);
    res.json(overtimePay);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的完整工作資料
 */
export async function getEmployeeCompleteWorkData(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const completeData = await calculateCompleteWorkData(employeeId, month);
    res.json(completeData);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
