#!/usr/bin/env node
/**
 * Test script to verify schedule PDF export with Chinese text
 * This script creates a sample PDF with Chinese characters to verify font support
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to Chinese font
const DEFAULT_FONT_PATH = path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.otf');
const CHINESE_FONT_PATH = process.env.PDF_CHINESE_FONT_PATH || DEFAULT_FONT_PATH;

console.log('測試排班 PDF 匯出功能...');
console.log('Testing schedule PDF export...\n');

// Check if font file exists
if (!fs.existsSync(CHINESE_FONT_PATH)) {
  console.error('❌ 字型檔案不存在 / Font file not found:', CHINESE_FONT_PATH);
  console.error('請執行字型安裝腳本：./setup-fonts.sh');
  console.error('Please run font installation script: ./setup-fonts.sh');
  process.exit(1);
}

console.log('✓ 字型檔案存在 / Font file exists:', CHINESE_FONT_PATH);

// Create test PDF
const outputPath = path.join(__dirname, '../test-schedule-export.pdf');
const doc = new PDFDocument();
const stream = fs.createWriteStream(outputPath);

doc.pipe(stream);

try {
  // Register Chinese font
  doc.registerFont('NotoSansCJK', CHINESE_FONT_PATH);
  doc.font('NotoSansCJK');
  console.log('✓ 字型註冊成功 / Font registered successfully');

  // Test PDF content with Chinese text
  doc.fontSize(16).text('排班表', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text('月份：2024-01', { align: 'center' });
  doc.moveDown();
  
  // Add table header
  doc.fontSize(10);
  doc.text('員工姓名\t\t日期\t\t\t班別名稱', { underline: true });
  doc.moveDown(0.5);
  
  // Sample data
  const testData = [
    { name: '張三', date: '2024/01/01', shift: '早班' },
    { name: '李四', date: '2024/01/02', shift: '中班' },
    { name: '王五', date: '2024/01/03', shift: '晚班' },
    { name: '趙六', date: '2024/01/04', shift: '夜班' },
  ];
  
  testData.forEach((item) => {
    doc.fontSize(10).text(
      `${item.name}\t\t${item.date}\t\t${item.shift}`
    );
  });
  
  doc.end();
  
  stream.on('finish', () => {
    console.log('✓ PDF 生成成功 / PDF generated successfully');
    console.log('輸出檔案 / Output file:', outputPath);
    console.log('\n測試完成！請檢查生成的 PDF 檔案確認繁體中文是否正確顯示。');
    console.log('Test completed! Please check the generated PDF file to verify Traditional Chinese characters display correctly.');
  });
  
  stream.on('error', (err) => {
    console.error('❌ PDF 生成失敗 / PDF generation failed:', err);
    process.exit(1);
  });
  
} catch (error) {
  console.error('❌ 錯誤 / Error:', error);
  process.exit(1);
}
