import PDFDocument from 'pdfkit';
import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import {
  PAYROLL_EMPLOYEE_FIELDS,
  computeEmployeePayroll,
  createCalculationContext,
  loadBonusApprovals,
  loadPayrollBatchData,
  mapWithConcurrency,
} from './payrollBatchService.js';
import { registerTraditionalChinesePdfFont } from './pdfFontService.js';
import { loadPayrollPolicy } from './payrollPolicyService.js';

/**
 * 格式化貨幣
 */
function formatCurrency(value) {
  if (value == null || isNaN(value)) return 'NT$ 0';
  return 'NT$ ' + Math.round(value).toLocaleString('zh-TW');
}

/**
 * 格式化日期（薪資月份是該月第一天的 UTC 午夜，用 UTC 取年月）
 */
function formatDate(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// 一次處理多少位員工（每一批各讀一次班表與打卡，記憶體用量不會隨總人數一直增加）
const PDF_CHUNK_SIZE = 200;
const PDF_CONCURRENCY = 8;

// 「扣款」欄：從底薪扣掉、得到實領的項目。請假扣款不在裡面：底薪已經是扣掉請假之後的金額，
// 再列進來會重複，而且 底薪 - 扣款 會對不上實領；員工借支、債權扣押以前漏掉了。
function rowDeductions(row) {
  return (row.laborInsuranceFee || 0) + (row.healthInsuranceFee || 0) + (row.laborPensionSelf || 0)
    + (row.employeeAdvance || 0) + (row.debtGarnishment || 0) + (row.otherDeductions || 0);
}

/**
 * 月薪資總覽 PDF 的資料：每位員工一列，加上扣款欄（rowDeductions）。和 PDF 的繪製分開，數字才測得到。
 * @param {string} month - 月份 (YYYY-MM-DD)
 * @param {Object} filters - 篩選條件 { organization, department, subDepartment, employeeId }
 * @returns {Promise<{ monthDate: Date, rows: Array }>}
 */
export async function buildMonthlyPayrollOverviewRows(month, filters = {}) {
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
    .select(PAYROLL_EMPLOYEE_FIELDS);

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
  (payrollRecords || []).forEach(record => {
    const recordEmployeeId = record.employee?._id ?? record.employee;
    if (recordEmployeeId) payrollMap[recordEmployeeId.toString()] = record;
  });

  // 整批員工共用一份國定假日判斷資料（只讀一次，不會每位員工各查一次）與薪資政策（整個匯出只讀一次）
  const payrollBatch = { employees, payrollPolicy: await loadPayrollPolicy() };

  // Build the overview data：計算方式與薪資總覽畫面、銀行匯款 Excel 相同（services/payrollBatchService.js）
  let overviewData = [];
  for (let offset = 0; offset < employees.length; offset += PDF_CHUNK_SIZE) {
    const chunk = employees.slice(offset, offset + PDF_CHUNK_SIZE);
    // 這一批員工的班別設定、班表、打卡、勞保級距、核准的獎金申請各讀一次
    const batchData = await loadPayrollBatchData(chunk, month);
    const { approvalsByEmployee, bonusFieldsByForm, bonusRange } = await loadBonusApprovals(chunk, monthDate);

    const rows = await mapWithConcurrency(chunk, PDF_CONCURRENCY, async (employee) => {
      const employeeIdStr = employee._id.toString();
      const { payroll, recurringAllowance, baseSalary, netPay, totalBonus, totalPayment } = await computeEmployeePayroll({
        employee,
        month,
        storedRecord: payrollMap[employeeIdStr],
        approvals: approvalsByEmployee.get(employeeIdStr) ?? [],
        bonusFieldsByForm,
        bonusRange,
        calculationContext: createCalculationContext(batchData, employee, payrollBatch),
        insuranceRates: batchData.insuranceRates,
      });

      return {
        employeeId: employee.employeeId,
        name: employee.name,
        department: employee.department?.name || '-',
        subDepartment: employee.subDepartment?.name || '-',
        organization: employee.organization?.name || '-',
        baseSalary,
        overtimePay: payroll?.overtimePay || 0,
        nightShiftAllowance: payroll?.nightShiftAllowance || 0,
        performanceBonus: payroll?.performanceBonus || 0,
        otherBonuses: payroll?.otherBonuses || 0,
        recurringAllowance,
        laborInsuranceFee: payroll?.laborInsuranceFee || 0,
        healthInsuranceFee: payroll?.healthInsuranceFee || 0,
        laborPensionSelf: payroll?.laborPensionSelf || 0,
        employeeAdvance: payroll?.employeeAdvance || 0,
        debtGarnishment: payroll?.debtGarnishment || 0,
        leaveDeduction: payroll?.leaveDeduction || 0,
        otherDeductions: payroll?.otherDeductions || 0,
        netPay,
        totalBonus,
        totalPayment
      };
    });
    overviewData = overviewData.concat(rows);
  }

  return { monthDate, rows: overviewData.map((row) => ({ ...row, deductions: rowDeductions(row) })) };
}

/**
 * 生成月薪資總覽 PDF
 * @param {string} month - 月份 (YYYY-MM-DD)
 * @param {Object} filters - 篩選條件 { organization, department, subDepartment, employeeId }
 * @returns {Promise<Buffer>} - PDF 文件緩衝區
 */
export async function generateMonthlyPayrollOverviewPdf(month, filters = {}) {
  const { monthDate, rows: overviewData } = await buildMonthlyPayrollOverviewRows(month, filters);

  // Calculate summary statistics
  const totalEmployees = overviewData.length;
  const totalBaseSalary = overviewData.reduce((sum, row) => sum + (row.baseSalary || 0), 0);
  const totalNetPay = overviewData.reduce((sum, row) => sum + (row.netPay || 0), 0);
  const totalDeductions = overviewData.reduce((sum, row) => sum + rowDeductions(row), 0);
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
      registerTraditionalChinesePdfFont(doc, 'NotoSansCJK');
    } catch (error) {
      reject(error);
      return;
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
        Math.round(rowDeductions(row)).toLocaleString('zh-TW'),
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
  generateMonthlyPayrollOverviewPdf,
  buildMonthlyPayrollOverviewRows
};
