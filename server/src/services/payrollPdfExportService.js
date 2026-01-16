import PDFDocument from 'pdfkit';
import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import Organization from '../models/Organization.js';
import Department from '../models/Department.js';
import { calculateEmployeePayroll, extractRecurringAllowance } from './payrollService.js';
import { calculateCompleteWorkData } from './workHoursCalculationService.js';
import { aggregateBonusFromApprovals } from '../utils/payrollPreviewUtils.js';
import ApprovalRequest from '../models/approval_request.js';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 格式化貨幣
 */
function formatCurrency(value) {
  if (value == null || isNaN(value)) return 'NT$ 0';
  return 'NT$ ' + Math.round(value).toLocaleString('zh-TW');
}

/**
 * 格式化日期
 */
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 生成月薪資總覽 PDF
 * @param {string} month - 月份 (YYYY-MM-DD)
 * @param {Object} filters - 篩選條件 { organization, department, subDepartment, employeeId }
 * @returns {Promise<Buffer>} - PDF 文件緩衝區
 */
export async function generateMonthlyPayrollOverviewPdf(month, filters = {}) {
  // Validate month
  const monthDate = new Date(month);
  if (isNaN(monthDate.getTime())) {
    throw new Error('Invalid month format');
  }

  // Build employee query based on filters
  const employeeQuery = {};
  if (filters.organization) {
    employeeQuery.organization = filters.organization;
  }
  if (filters.department) {
    employeeQuery.department = filters.department;
  }
  if (filters.subDepartment) {
    employeeQuery.subDepartment = filters.subDepartment;
  }
  if (filters.employeeId) {
    employeeQuery._id = filters.employeeId;
  }

  // Find employees matching the criteria
  const employees = await Employee.find(employeeQuery)
    .populate('department')
    .populate('subDepartment')
    .populate('organization')
    .select('employeeId name department subDepartment organization salaryAmount salaryType salaryItems salaryItemAmounts annualLeave');

  if (employees.length === 0) {
    throw new Error('No employees found matching the criteria');
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
  const overviewData = await Promise.all(employees.map(async (employee) => {
    const employeeIdStr = employee._id.toString();
    let payroll = payrollMap[employeeIdStr];
    if (payroll && typeof payroll.toObject === 'function') {
      payroll = payroll.toObject();
    }
    const { total: recurringAllowanceFromItems } = extractRecurringAllowance(employee);

    // Calculate work data including night shift data dynamically
    let workData = null;
    try {
      workData = await calculateCompleteWorkData(employeeIdStr, month);
    } catch (error) {
      console.error(`Error calculating work data for employee ${employeeIdStr}:`, error);
    }

    // If no payroll record exists, calculate it automatically
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
        payroll = calculatedPayroll;
      } catch (error) {
        console.error(`Error calculating payroll for employee ${employeeIdStr}:`, error);
        payroll = null;
      }
    }

    // Override night shift data with dynamically calculated values if available
    if (payroll && workData) {
      payroll = {
        ...payroll,
        nightShiftDays: workData.nightShiftDays,
        nightShiftHours: workData.nightShiftHours,
        nightShiftAllowance: workData.nightShiftAllowance,
        nightShiftCalculationMethod: workData.nightShiftCalculationMethod,
        nightShiftBreakdown: workData.nightShiftBreakdown,
        nightShiftConfigurationIssues: workData.nightShiftConfigurationIssues,
        totalBonus: (payroll.overtimePay || 0) + 
                   (workData.nightShiftAllowance || 0) + 
                   (payroll.performanceBonus || 0) + 
                   (payroll.otherBonuses || 0),
      };
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
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department?.name || '-',
      subDepartment: employee.subDepartment?.name || '-',
      organization: employee.organization?.name || '-',
      baseSalary: payroll?.baseSalary || employee.salaryAmount || 0,
      overtimePay: payroll?.overtimePay || 0,
      nightShiftAllowance: payroll?.nightShiftAllowance || 0,
      performanceBonus: payroll?.performanceBonus || 0,
      otherBonuses: payroll?.otherBonuses || 0,
      recurringAllowance,
      laborInsuranceFee: payroll?.laborInsuranceFee || 0,
      healthInsuranceFee: payroll?.healthInsuranceFee || 0,
      laborPensionSelf: payroll?.laborPensionSelf || 0,
      leaveDeduction: payroll?.leaveDeduction || 0,
      otherDeductions: payroll?.otherDeductions || 0,
      netPay: netPayValue,
      totalBonus: totalBonusValue,
      totalPayment: totalPaymentValue
    };
  }));

  // Calculate summary statistics
  const totalEmployees = overviewData.length;
  const totalBaseSalary = overviewData.reduce((sum, row) => sum + (row.baseSalary || 0), 0);
  const totalNetPay = overviewData.reduce((sum, row) => sum + (row.netPay || 0), 0);
  const totalDeductions = overviewData.reduce((sum, row) => 
    sum + (row.laborInsuranceFee || 0) + (row.healthInsuranceFee || 0) + 
    (row.laborPensionSelf || 0) + (row.leaveDeduction || 0) + (row.otherDeductions || 0), 0);
  const totalPayment = overviewData.reduce((sum, row) => sum + (row.totalPayment || 0), 0);

  // Create PDF document
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 40, right: 40 }
    });

    // Collect chunks
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(18).text('月薪資總覽', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`月份：${formatDate(monthDate)}`, { align: 'center' });
    doc.moveDown(1);

    // Summary statistics
    doc.fontSize(10);
    const summaryY = doc.y;
    doc.text(`總人數：${totalEmployees}`, 50, summaryY);
    doc.text(`薪資總額：${formatCurrency(totalBaseSalary)}`, 200, summaryY);
    doc.text(`實發總額：${formatCurrency(totalNetPay)}`, 400, summaryY);
    doc.text(`扣款總額：${formatCurrency(totalDeductions)}`, 600, summaryY);
    doc.moveDown(1.5);

    // Table headers
    const tableTop = doc.y;
    const rowHeight = 20;
    const colWidths = [50, 60, 70, 70, 60, 60, 60, 60, 60, 70];
    let xPos = 50;

    // Draw header row
    doc.fontSize(8);
    const headers = ['員工編號', '姓名', '部門', '基本薪資', '加班費', '夜班津貼', '獎金', '扣款', '實發', '總計'];
    
    headers.forEach((header, i) => {
      doc.rect(xPos, tableTop, colWidths[i], rowHeight).stroke();
      doc.text(header, xPos + 5, tableTop + 5, { width: colWidths[i] - 10, align: 'center' });
      xPos += colWidths[i];
    });

    // Draw data rows
    let yPos = tableTop + rowHeight;
    overviewData.forEach((row, index) => {
      if (yPos > 520) { // Check if we need a new page
        doc.addPage();
        yPos = 50;
        
        // Redraw headers on new page
        xPos = 50;
        headers.forEach((header, i) => {
          doc.rect(xPos, yPos, colWidths[i], rowHeight).stroke();
          doc.text(header, xPos + 5, yPos + 5, { width: colWidths[i] - 10, align: 'center' });
          xPos += colWidths[i];
        });
        yPos += rowHeight;
      }

      xPos = 50;
      const values = [
        row.employeeId || '-',
        row.name || '-',
        row.department || '-',
        Math.round(row.baseSalary).toLocaleString(),
        Math.round(row.overtimePay).toLocaleString(),
        Math.round(row.nightShiftAllowance).toLocaleString(),
        Math.round((row.performanceBonus || 0) + (row.otherBonuses || 0) + (row.recurringAllowance || 0)).toLocaleString(),
        Math.round((row.laborInsuranceFee || 0) + (row.healthInsuranceFee || 0) + (row.laborPensionSelf || 0) + (row.leaveDeduction || 0) + (row.otherDeductions || 0)).toLocaleString(),
        Math.round(row.netPay).toLocaleString(),
        Math.round(row.totalPayment).toLocaleString()
      ];

      values.forEach((value, i) => {
        doc.rect(xPos, yPos, colWidths[i], rowHeight).stroke();
        doc.text(String(value), xPos + 5, yPos + 5, { width: colWidths[i] - 10, align: i < 3 ? 'left' : 'right' });
        xPos += colWidths[i];
      });

      yPos += rowHeight;
    });

    // Footer
    doc.fontSize(8).text(`生成時間：${new Date().toLocaleString('zh-TW')}`, 50, 560, { align: 'center' });

    doc.end();
  });
}

export default {
  generateMonthlyPayrollOverviewPdf
};
