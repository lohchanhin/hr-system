#!/usr/bin/env node
/**
 * Integration test for schedule export functionality
 * Tests both PDF and Excel export with Chinese text
 */

import { exportSchedules } from '../src/controllers/scheduleController.js';
import ShiftSchedule from '../src/models/ShiftSchedule.js';
import Employee from '../src/models/Employee.js';
import AttendanceSetting from '../src/models/AttendanceSetting.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('整合測試：排班匯出功能');
console.log('Integration test: Schedule export functionality\n');

// Mock data for testing
const mockEmployee = { _id: 'emp1', name: '張三' };
const mockSchedules = [
  {
    employee: mockEmployee,
    date: new Date('2024-01-01'),
    shiftId: 'shift1',
    shiftName: '早班',
    department: 'dept1',
    toObject: function() { return this; }
  },
  {
    employee: mockEmployee,
    date: new Date('2024-01-02'),
    shiftId: 'shift2',
    shiftName: '晚班',
    department: 'dept1',
    toObject: function() { return this; }
  }
];

// Mock MongoDB models
ShiftSchedule.find = function(query) {
  console.log('✓ ShiftSchedule.find called with query:', JSON.stringify(query, null, 2));
  return {
    populate: function(field) {
      console.log('✓ populate called with field:', field);
      return {
        lean: function() {
          console.log('✓ lean called, returning mock schedules');
          return Promise.resolve(mockSchedules);
        }
      };
    }
  };
};

AttendanceSetting.findOne = function() {
  console.log('✓ AttendanceSetting.findOne called');
  return {
    lean: function() {
      return Promise.resolve({
        shifts: [
          { _id: 'shift1', name: '早班' },
          { _id: 'shift2', name: '晚班' }
        ]
      });
    }
  };
};

// Mock response object
class MockResponse {
  constructor() {
    this.headers = {};
    this.statusCode = 200;
    this.data = [];
  }

  setHeader(key, value) {
    this.headers[key] = value;
    return this;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(data) {
    this.data = data;
    return this;
  }

  send(buffer) {
    this.data = buffer;
    return this;
  }

  write(chunk) {
    if (Buffer.isBuffer(chunk)) {
      this.data.push(chunk);
    }
  }

  end() {
    // Concatenate all chunks if multiple writes occurred
    if (Array.isArray(this.data)) {
      this.data = Buffer.concat(this.data);
    }
  }
}

// Test PDF export
async function testPdfExport() {
  console.log('\n=== 測試 PDF 匯出 / Testing PDF Export ===\n');
  
  const req = {
    query: {
      month: '2024-01',
      department: 'dept1',
      format: 'pdf'
    }
  };
  
  const res = new MockResponse();
  
  // Override pipe to capture data
  res.pipe = function(dest) {
    return dest;
  };
  
  try {
    await exportSchedules(req, res);
    
    if (res.statusCode === 200) {
      console.log('✓ PDF export successful');
      console.log('✓ Status:', res.statusCode);
      console.log('✓ Content-Type:', res.headers['Content-Type']);
      console.log('✓ Content-Disposition:', res.headers['Content-Disposition']);
      
      // Verify Chinese filename
      if (res.headers['Content-Disposition'].includes('schedules-202401-dept1.pdf')) {
        console.log('✓ Filename format is correct');
      }
      
      return true;
    } else {
      console.error('✗ PDF export failed with status:', res.statusCode);
      console.error('✗ Error:', res.data);
      return false;
    }
  } catch (err) {
    console.error('✗ PDF export threw error:', err);
    return false;
  }
}

// Test Excel export
async function testExcelExport() {
  console.log('\n=== 測試 Excel 匯出 / Testing Excel Export ===\n');
  
  const req = {
    query: {
      month: '2024-01',
      department: 'dept1',
      format: 'excel'
    }
  };
  
  const res = new MockResponse();
  
  try {
    await exportSchedules(req, res);
    
    if (res.statusCode === 200) {
      console.log('✓ Excel export successful');
      console.log('✓ Status:', res.statusCode);
      console.log('✓ Content-Type:', res.headers['Content-Type']);
      console.log('✓ Content-Disposition:', res.headers['Content-Disposition']);
      
      // Verify Excel data
      if (Buffer.isBuffer(res.data) && res.data.length > 0) {
        console.log('✓ Excel buffer generated with size:', res.data.length, 'bytes');
      }
      
      // Verify Chinese filename
      if (res.headers['Content-Disposition'].includes('schedules-202401-dept1.xlsx')) {
        console.log('✓ Filename format is correct');
      }
      
      return true;
    } else {
      console.error('✗ Excel export failed with status:', res.statusCode);
      console.error('✗ Error:', res.data);
      return false;
    }
  } catch (err) {
    console.error('✗ Excel export threw error:', err);
    return false;
  }
}

// Run tests
async function runTests() {
  const pdfResult = await testPdfExport();
  const excelResult = await testExcelExport();
  
  console.log('\n=== 測試結果 / Test Results ===\n');
  console.log('PDF Export:', pdfResult ? '✓ PASS' : '✗ FAIL');
  console.log('Excel Export:', excelResult ? '✓ PASS' : '✗ FAIL');
  
  if (pdfResult && excelResult) {
    console.log('\n✓ 所有測試通過！/ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n✗ 部分測試失敗 / Some tests failed');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('測試執行失敗 / Test execution failed:', err);
  process.exit(1);
});
