import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import PayrollRecord from '../models/PayrollRecord.js';
import Employee from '../models/Employee.js';
import ApprovalRequest from '../models/approval_request.js';
import { calculateEmployeePayroll } from './payrollService.js';
import { calculateCompleteWorkData } from './workHoursCalculationService.js';
import { aggregateBonusFromApprovals } from '../utils/payrollPreviewUtils.js';

/**
 * 格式化日期為 YYYYMMDD
 */
function formatDateYYYYMMDD(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 格式化日期為 YYYY/MM/DD
 */
function formatDateSlash(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * 生成獎金紙條 Excel
 * @param {Array} payrollRecords - 薪資記錄數組
 * @param {Object} companyInfo - 公司資訊
 * @returns {Buffer} - Excel 文件緩衝區
 */
export async function generateBonusSlipExcel(payrollRecords, companyInfo = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('獎金紙條');

  worksheet.columns = [
    { key: 'employeeId', width: 12 },
    { key: 'name', width: 14 },
    { key: 'department', width: 16 },
    { key: 'bankCode', width: 12 },
    { key: 'accountTail', width: 12 },
    { key: 'overtimePay', width: 12 },
    { key: 'nightShift', width: 12 },
    { key: 'performance', width: 12 },
    { key: 'others', width: 12 },
    { key: 'bonusAdjustment', width: 12 },
    { key: 'total', width: 14 },
    { key: 'note', width: 20 }
  ];

  const monthDate = companyInfo.monthDate || payrollRecords[0]?.month || new Date();
  const issueMonth = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
  const title = companyInfo.companyName || '公司名稱';

  worksheet.mergeCells('A1:L1');
  worksheet.getCell('A1').value = `${title} - 個人獎金紙條`;
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A2:L2');
  worksheet.getCell('A2').value = `撥款月份：${issueMonth}`;
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  worksheet.addRow([]);

  const headerRow = worksheet.addRow([
    '員工編號',
    '姓名',
    '部門',
    '銀行代碼',
    '帳號末四碼',
    '加班費',
    '夜班津貼',
    '績效獎金',
    '其他獎金',
    '簽核調整',
    '獎金合計',
    '備註'
  ]);
  headerRow.font = { bold: true };

  payrollRecords.forEach(record => {
    const employee = record.employee || {};
    const overtimePay = record.overtimePay || 0;
    const nightShiftAllowance = record.nightShiftAllowance || 0;
    const performanceBonus = record.performanceBonus || 0;
    const otherBonuses = record.otherBonuses || 0;
    const bonusAdjustment = record.bonusAdjustment || 0;
    const bonusTotal = overtimePay + nightShiftAllowance + performanceBonus + otherBonuses + bonusAdjustment;

    const accountNumber = record.bankAccountB?.accountNumber || '';
    const accountTail = accountNumber ? accountNumber.slice(-4).padStart(4, '*') : '';

    worksheet.addRow({
      employeeId: employee.employeeId || employee.employeeNo || '',
      name: employee.name || '',
      department: employee.department?.name || '',
      bankCode: record.bankAccountB?.bankCode || record.bankAccountB?.bank || '',
      accountTail,
      overtimePay,
      nightShift: nightShiftAllowance,
      performance: performanceBonus,
      others: otherBonuses,
      bonusAdjustment,
      total: bonusTotal,
      note: '請確認獎金明細後再行撥款'
    });
  });

  headerRow.eachCell(cell => {
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F5F5' }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      right: { style: 'thin', color: { argb: 'FFBFBFBF' } }
    };
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRow.number) {
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E5E5' } },
          left: { style: 'thin', color: { argb: 'FFE5E5E5' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } },
          right: { style: 'thin', color: { argb: 'FFE5E5E5' } }
        };
      });
    }
  });

  worksheet.addRow([]);
  const summaryRow = worksheet.addRow({ note: '此示意表僅供確認匯出欄位與欄位順序。' });
  worksheet.mergeCells(`A${summaryRow.number}:L${summaryRow.number}`);
  worksheet.getCell(`A${summaryRow.number}`).alignment = { horizontal: 'left' };

  return await workbook.xlsx.writeBuffer();
}

/**
 * 生成臺灣企銀匯款格式 Excel
 * @param {Array} payrollRecords - 薪資記錄數組
 * @param {Object} companyInfo - 公司資訊
 * @returns {Buffer} - Excel 文件緩衝區
 */
export async function generateTaiwanBusinessBankExcel(payrollRecords, companyInfo = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('臺企匯款');
  
  // 設置列寬
  worksheet.columns = [
    { width: 15 }, { width: 12 }, { width: 15 }, { width: 20 },
    { width: 12 }, { width: 12 }, { width: 8 }, { width: 12 },
    { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 },
    { width: 25 }, { width: 15 }, { width: 15 }
  ];
  
  // 付款人資料標題行
  const headerRow1 = worksheet.addRow([
    '付款人資料\n固定為0001', '付款日期', '付款帳號', '付款人戶名',
    '付款行總行代碼', '付款行分行代碼', '固定輸入1', '', '', '', '', '', '', '', ''
  ]);
  headerRow1.height = 30;
  headerRow1.font = { bold: true };
  
  // 付款人資料
  const paymentDate = companyInfo.paymentDate || formatDateYYYYMMDD(new Date());
  worksheet.addRow([
    '0001',
    paymentDate,
    companyInfo.paymentAccount || '',
    companyInfo.paymentAccountName || '',
    companyInfo.bankCode || '050',
    companyInfo.branchCode || '5206',
    '1', '', '', '', '', '', '', '', ''
  ]);
  
  // 收款人資料標題行
  const headerRow2 = worksheet.addRow([
    '收款人資料-0002\n(發票資料-0003)',
    '收款金額\n(發票號碼)',
    '收款帳號\n(發票金額)',
    '收款戶名\n(發票日期)',
    '收款行總行代碼',
    '收款行分行代碼',
    '識別碼類別',
    '收款人識別碼',
    '手續費負擔別',
    '固定欄位\n(固定為Y)',
    '收款人通知',
    '傳真號碼',
    'Email帳號',
    '備註',
    '附言'
  ]);
  headerRow2.height = 30;
  headerRow2.font = { bold: true };
  
  // 收款人資料
  for (const record of payrollRecords) {
    const employee = record.employee;
    
    worksheet.addRow([
      '0002',
      '', // 收款金額留空，由銀行填寫
      record.bankAccountA?.accountNumber || '',
      employee.name || '',
      record.bankAccountA?.bankCode || '050',
      record.bankAccountA?.branchCode || '5206',
      '174', // 識別碼類別
      employee.idNumber || '',
      '13', // 手續費負擔別
      'Y',
      '4', // 收款人通知方式
      '', // 傳真號碼
      employee.email || '',
      '', // 備註
      '薪資'
    ]);
  }
  
  return await workbook.xlsx.writeBuffer();
}

/**
 * 生成台中銀行匯款格式 Excel
 * @param {Array} payrollRecords - 薪資記錄數組
 * @param {Object} companyInfo - 公司資訊
 * @returns {Buffer} - Excel 文件緩衝區
 */
export async function generateTaichungBankExcel(payrollRecords, companyInfo = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('台中銀匯');
  
  // 設置列寬
  worksheet.columns = [
    { width: 8 }, { width: 8 }, { width: 15 }, { width: 20 },
    { width: 12 }
  ];
  
  const companyName = companyInfo.companyName || '';
  const companyCode = companyInfo.companyCode || '6204';
  const transferAccount = companyInfo.transferAccount || '';
  const paymentDate = companyInfo.paymentDate || formatDateSlash(new Date());
  
  // 計算核證總數和總金額
  let totalAmount = 0;
  let checksum = 0;
  
  payrollRecords.forEach((record, index) => {
    const amount = record.netPay || 0;
    totalAmount += amount;
    checksum += amount * (index + 1);
  });
  
  // 公司名稱標題
  worksheet.addRow([companyName]);
  worksheet.mergeCells('A1:E1');
  worksheet.getCell('A1').alignment = { horizontal: 'left' };
  
  // 薪津轉帳遞送單標題
  worksheet.addRow(['<<薪津轉帳遞送單>>']);
  worksheet.mergeCells('A2:E2');
  worksheet.getCell('A2').alignment = { horizontal: 'left' };
  worksheet.getCell('A2').font = { bold: true };
  
  // 資料內容
  worksheet.addRow([`資料內容`, `轉 帳 類 別:　轉帳一`, '', `企業編號:　${companyCode}`, '']);
  worksheet.addRow(['', `轉 帳 筆 數:　${payrollRecords.length}`, '', `轉出帳號:　${transferAccount}`, '']);
  worksheet.addRow(['', `轉 帳 金 額:　NT$${totalAmount.toLocaleString()}`, '', '', '']);
  worksheet.addRow(['', `預定撥帳日: 　${paymentDate}`, '', '', '']);
  worksheet.addRow(['', `核 證 總 數:　${checksum}`, '', '', '']);
  
  // 備註
  worksheet.addRow([`備註`, '　本單由委託企業填妥連同轉帳資料磁片、付款憑證送交受委託分行。', '', '', '']);
  
  // 簽章區
  worksheet.addRow([`收件簽章\n受託分行`, '', '', `送件簽章\n委託企業`, '']);
  worksheet.addRow(['', '', '', '', '']);
  worksheet.addRow(['', '', '', '', '']);
  
  // 此致
  worksheet.addRow(['此　　致', '', '', '', '']);
  worksheet.addRow(['', '', '', '', '']);
  
  const branchName = companyInfo.branchName || '埔里';
  const branchCode = companyInfo.branchFullCode || '054';
  worksheet.addRow([`台中銀行`, '', '', `${branchCode}　${branchName}　分行`, '']);
  worksheet.addRow(['', '', '', '', '']);
  
  // 處理狀態
  worksheet.addRow(['處理狀態', '', '收件者', '', '核章', '', '經辦', '', '', '主管', '', '撥帳時間', '', '備註']);
  worksheet.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  worksheet.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  
  // 清冊標題
  worksheet.addRow([companyName]);
  worksheet.mergeCells(`A${worksheet.lastRow.number}:E${worksheet.lastRow.number}`);
  worksheet.getCell(`A${worksheet.lastRow.number}`).alignment = { horizontal: 'left' };
  
  worksheet.addRow(['<<薪津轉帳清冊>>']);
  worksheet.mergeCells(`A${worksheet.lastRow.number}:E${worksheet.lastRow.number}`);
  worksheet.getCell(`A${worksheet.lastRow.number}`).alignment = { horizontal: 'left' };
  worksheet.getCell(`A${worksheet.lastRow.number}`).font = { bold: true };
  
  worksheet.addRow([`核證總數：${checksum}`]);
  worksheet.mergeCells(`A${worksheet.lastRow.number}:E${worksheet.lastRow.number}`);
  
  // 清冊表頭
  const headerRow = worksheet.addRow(['流水號', '', '編號', '', '姓名', '', '轉入帳號', '', '', '轉入金額']);
  headerRow.font = { bold: true };
  
  // 清冊資料
  payrollRecords.forEach((record, index) => {
    const employee = record.employee;
    worksheet.addRow([
      index + 1,
      '',
      index + 1,
      '',
      employee.name || '',
      '',
      record.bankAccountB?.accountNumber || '',
      '',
      '',
      (record.netPay || 0).toLocaleString()
    ]);
  });
  
  // 合計行
  worksheet.addRow([
    `共${payrollRecords.length}筆`, '', '', '', '', '', '', '', '', totalAmount.toLocaleString()
  ]);
  
  return await workbook.xlsx.writeBuffer();
}

/**
 * 根據月份和銀行類型生成匯款 Excel
 * @param {String} month - 月份 (YYYY-MM-DD)
 * @param {String} bankType - 銀行類型 ('taiwan' 或 'taichung')
 * @param {Object} companyInfo - 公司資訊
 * @returns {Buffer} - Excel 文件緩衝區
 */
export async function generatePayrollExcel(month, bankTypeOrFormat, companyInfo = {}) {
  const monthDate = new Date(month);
  const format = bankTypeOrFormat || companyInfo.format;

  // 獲取該月的所有薪資記錄
  let payrollRecords = await PayrollRecord.find({
    month: monthDate
  }).populate('employee').sort({ 'employee.name': 1 });
  
  // 如果沒有薪資記錄，則自動計算所有員工的薪資
  if (payrollRecords.length === 0) {
    // 獲取所有員工
    const employees = await Employee.find({})
      .populate('department')
      .populate('subDepartment')
      .sort({ name: 1 });
    
    if (employees.length === 0) {
      throw new Error('No employees found');
    }

    // 為每個員工計算薪資
    payrollRecords = await Promise.all(employees.map(async (employee) => {
      try {
        const customData = {};

        // 計算工作時數資料
        try {
          const workData = await calculateCompleteWorkData(employee._id.toString(), month);
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
            baseSalary: workData.baseSalary
          });
        } catch (error) {
          console.error(`Error calculating work data for employee ${employee._id}:`, error);
        }

        // 聚合獎金資料
        try {
          const startDate = new Date(monthDate);
          startDate.setUTCHours(0, 0, 0, 0);
          const endDate = new Date(startDate);
          endDate.setUTCMonth(endDate.getUTCMonth() + 1);

          const approvals = await ApprovalRequest.find({
            applicant_employee: employee._id,
            status: 'approved',
            createdAt: { $gte: startDate, $lt: endDate }
          }).populate('form').lean();

          const bonusData = aggregateBonusFromApprovals(approvals);
          Object.assign(customData, bonusData);
        } catch (error) {
          console.error(`Error aggregating approvals for employee ${employee._id}:`, error);
        }

        // 計算薪資
        const calculatedPayroll = await calculateEmployeePayroll(employee._id.toString(), month, customData);
        
        // 返回類似 PayrollRecord 的物件結構
        return {
          employee: employee,
          month: monthDate,
          baseSalary: calculatedPayroll.baseSalary || 0,
          netPay: calculatedPayroll.netPay || 0,
          overtimePay: calculatedPayroll.overtimePay || 0,
          nightShiftAllowance: calculatedPayroll.nightShiftAllowance || 0,
          performanceBonus: calculatedPayroll.performanceBonus || 0,
          otherBonuses: calculatedPayroll.otherBonuses || 0,
          bonusAdjustment: calculatedPayroll.bonusAdjustment || 0,
          totalBonus: calculatedPayroll.totalBonus || 0,
          bankAccountA: employee.salaryAccountA || {},
          bankAccountB: employee.salaryAccountB || {}
        };
      } catch (error) {
        console.error(`Error calculating payroll for employee ${employee._id}:`, error);
        // 返回基本的薪資資料作為後備
        // Note: Using baseSalary as netPay is intentional - this is a simplified fallback
        // that ensures export can complete even if detailed calculation fails.
        // In production, administrators should review and correct these records.
        return {
          employee: employee,
          month: monthDate,
          baseSalary: employee.salaryAmount || 0,
          netPay: employee.salaryAmount || 0,
          overtimePay: 0,
          nightShiftAllowance: 0,
          performanceBonus: 0,
          otherBonuses: 0,
          bonusAdjustment: 0,
          totalBonus: 0,
          bankAccountA: employee.salaryAccountA || {},
          bankAccountB: employee.salaryAccountB || {}
        };
      }
    }));
  }

  const enhancedCompanyInfo = { ...companyInfo, monthDate };

  if (format === 'taiwan') {
    return await generateTaiwanBusinessBankExcel(payrollRecords, companyInfo);
  } else if (format === 'taichung') {
    return await generateTaichungBankExcel(payrollRecords, companyInfo);
  } else if (format === 'bonusSlip') {
    return await generateBonusSlipExcel(payrollRecords, enhancedCompanyInfo);
  } else {
    throw new Error('Invalid format. Must be "taiwan", "taichung" or "bonusSlip"');
  }
}

export default {
  generateTaiwanBusinessBankExcel,
  generateTaichungBankExcel,
  generateBonusSlipExcel,
  generatePayrollExcel
};
