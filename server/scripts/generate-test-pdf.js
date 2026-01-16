#!/usr/bin/env node
/**
 * 完整 PDF 生成測試
 * Complete PDF Generation Test
 * 
 * 此腳本會生成一個包含測試資料的 PDF 檔案，用於手動檢查繁體中文字型顯示效果
 * This script generates a PDF file with test data for manual verification of Chinese font rendering
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHINESE_FONT_PATH = path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.otf');
const OUTPUT_PATH = path.join(__dirname, '../test-output-payroll.pdf');

function formatCurrency(value) {
  if (value == null || isNaN(value)) return 'NT$ 0';
  return 'NT$ ' + Math.round(value).toLocaleString('zh-TW');
}

async function generateTestPdf() {
  console.log('開始生成測試 PDF...');
  console.log('Generating test PDF...\n');

  // Check if font exists
  if (!fs.existsSync(CHINESE_FONT_PATH)) {
    console.error('❌ 錯誤：字型檔案不存在');
    console.error('❌ Error: Font file not found');
    console.error(`   路徑 / Path: ${CHINESE_FONT_PATH}`);
    console.error('\n請執行字型安裝腳本：');
    console.error('Please run the font installation script:');
    console.error('   ./setup-fonts.sh\n');
    process.exit(1);
  }

  // Sample data
  const testData = [
    {
      employeeId: 'E001',
      name: '王小明',
      department: '工程部',
      baseSalary: 50000,
      overtimePay: 5000,
      nightShiftAllowance: 3000,
      bonus: 2000,
      deductions: 7500,
      netPay: 45000,
      totalPayment: 52500
    },
    {
      employeeId: 'E002',
      name: '李美麗',
      department: '人事部',
      baseSalary: 45000,
      overtimePay: 3000,
      nightShiftAllowance: 0,
      bonus: 1500,
      deductions: 6800,
      netPay: 38200,
      totalPayment: 42700
    },
    {
      employeeId: 'E003',
      name: '張大華',
      department: '財務部',
      baseSalary: 55000,
      overtimePay: 4500,
      nightShiftAllowance: 2500,
      bonus: 3000,
      deductions: 8200,
      netPay: 46800,
      totalPayment: 56800
    }
  ];

  return new Promise((resolve, reject) => {
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
      console.error('❌ 字型載入失敗 / Font loading failed:', error);
      reject(error);
      return;
    }

    // Pipe to file
    const stream = fs.createWriteStream(OUTPUT_PATH);
    doc.pipe(stream);

    // Title in Traditional Chinese
    doc.fontSize(18).text('月薪資總覽（測試）', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text('期間：2024-01', { align: 'center' });
    doc.moveDown(1);

    // Summary statistics in Traditional Chinese
    const totalEmployees = testData.length;
    const totalBaseSalary = testData.reduce((sum, row) => sum + row.baseSalary, 0);
    const totalNetPay = testData.reduce((sum, row) => sum + row.netPay, 0);
    const totalDeductions = testData.reduce((sum, row) => sum + row.deductions, 0);

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
    testData.forEach((row) => {
      xPos = 50;
      const values = [
        row.employeeId,
        row.name,
        row.department,
        Math.round(row.baseSalary).toLocaleString('zh-TW'),
        Math.round(row.overtimePay).toLocaleString('zh-TW'),
        Math.round(row.nightShiftAllowance).toLocaleString('zh-TW'),
        Math.round(row.bonus).toLocaleString('zh-TW'),
        Math.round(row.deductions).toLocaleString('zh-TW'),
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

    stream.on('finish', () => {
      console.log('✓ PDF 生成成功！/ PDF generated successfully!');
      console.log(`  檔案位置 / File location: ${OUTPUT_PATH}`);
      const stats = fs.statSync(OUTPUT_PATH);
      console.log(`  檔案大小 / File size: ${(stats.size / 1024).toFixed(2)} KB\n`);
      console.log('請開啟 PDF 檔案檢查：');
      console.log('Please open the PDF file to verify:');
      console.log('  1. 繁體中文字型顯示正常 / Traditional Chinese characters display correctly');
      console.log('  2. 表格格式正確 / Table format is correct');
      console.log('  3. 數字對齊正確 / Numbers are properly aligned');
      console.log('  4. 沒有亂碼 / No garbled characters\n');
      resolve();
    });

    stream.on('error', (error) => {
      console.error('❌ PDF 生成失敗 / PDF generation failed:', error);
      reject(error);
    });
  });
}

// Run the test
generateTestPdf().catch(error => {
  console.error(error);
  process.exit(1);
});
