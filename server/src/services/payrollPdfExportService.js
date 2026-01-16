import PDFDocument from 'pdfkit';
import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import { calculateEmployeePayroll, extractRecurringAllowance } from './payrollService.js';
import { calculateCompleteWorkData } from './workHoursCalculationService.js';
import { aggregateBonusFromApprovals } from '../utils/payrollPreviewUtils.js';
import ApprovalRequest from '../models/approval_request.js';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to Chinese font for PDF generation
// Can be overridden by environment variable PDF_CHINESE_FONT_PATH
const DEFAULT_FONT_PATH = path.join(__dirname, '../../fonts/NotoSansCJKtc-Regular.otf');
const CHINESE_FONT_PATH = process.env.PDF_CHINESE_FONT_PATH || DEFAULT_FONT_PATH;

// Validate font path on module load
if (!fs.existsSync(CHINESE_FONT_PATH)) {
  console.warn('警告：繁體中文字型檔案不存在 / Warning: Traditional Chinese font file not found');
  console.warn(`路徑 / Path: ${CHINESE_FONT_PATH}`);
  console.warn('PDF 匯出可能會顯示亂碼。請執行字型安裝腳本：./setup-fonts.sh');
  console.warn('PDF export may show garbled text. Please run font installation script: ./setup-fonts.sh');
}

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

    // Register Chinese font
    try {
      doc.registerFont('NotoSansCJK', CHINESE_FONT_PATH);
      doc.font('NotoSansCJK');
    } catch (error) {
      console.error('警告：無法載入繁體中文字型，PDF 中的中文可能會顯示為亂碼或方框');
      console.error('Warning: Failed to load Traditional Chinese font. Chinese characters in PDF may appear garbled or as boxes.');
      console.error('請確認字型檔案存在：Please ensure font file exists:', CHINESE_FONT_PATH);
      console.error('執行字型安裝腳本：Run font installation script: ./setup-fonts.sh');
      console.error(error);
      // Fallback to default font - Chinese text will not display correctly
    }

    // Collect chunks
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title in Traditional Chinese
    doc.fontSize(18).text('月薪資總覽', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`期間：${formatDate(monthDate)}`, { align: 'center' });
    doc.moveDown(1);

    // Summary statistics in Traditional Chinese
    doc.fontSize(10);
    const summaryY = doc.y;
    doc.text(`員工人數：${totalEmployees}`, 50, summaryY);
    doc.text(`底薪總計：${formatCurrency(totalBaseSalary)}`, 200, summaryY);
    doc.text(`實領總計：${formatCurrency(totalNetPay)}`, 400, summaryY);
    doc.text(`扣款總計：${formatCurrency(totalDeductions)}`, 600, summaryY);
    doc.moveDown(1.5);

    // Table headers in Traditional Chinese
    const tableTop = doc.y;
    const rowHeight = 20;
    const colWidths = [50, 60, 70, 70, 60, 60, 60, 60, 60, 70];
    let xPos = 50;

    // Draw header row
    doc.fontSize(8);
    const headers = ['員工編號', '姓名', '部門', '底薪', '加班費', '夜班津貼', '獎金', '扣款', '實領', '總計'];
    
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
        Math.round(row.baseSalary).toLocaleString('zh-TW'),
        Math.round(row.overtimePay).toLocaleString('zh-TW'),
        Math.round(row.nightShiftAllowance).toLocaleString('zh-TW'),
        Math.round((row.performanceBonus || 0) + (row.otherBonuses || 0) + (row.recurringAllowance || 0)).toLocaleString('zh-TW'),
        Math.round((row.laborInsuranceFee || 0) + (row.healthInsuranceFee || 0) + (row.laborPensionSelf || 0) + (row.leaveDeduction || 0) + (row.otherDeductions || 0)).toLocaleString('zh-TW'),
        Math.round(row.netPay).toLocaleString('zh-TW'),
        Math.round(row.totalPayment).toLocaleString('zh-TW')
      ];

      values.forEach((value, i) => {
        doc.rect(xPos, yPos, colWidths[i], rowHeight).stroke();
        doc.text(String(value), xPos + 5, yPos + 5, { width: colWidths[i] - 10, align: i < 3 ? 'left' : 'right' });
        xPos += colWidths[i];
      });

      yPos += rowHeight;
    });

    // Footer in Traditional Chinese
    doc.fontSize(8).text(`產生時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`, 50, 560, { align: 'center' });

    doc.end();
  });
}

export default {
  generateMonthlyPayrollOverviewPdf
};
