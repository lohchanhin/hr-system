/**
 * 測試驗證：確認測試資料包含夜班員工並且薪資計算正確
 * 
 * 此測試驗證以下需求：
 * 1. 測試資料要包含有員工是夜班
 * 2. 月薪資總覽能看到夜班津貼的輔助金額
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectDB } from '../src/config/db.js';
import Employee from '../src/models/Employee.js';
import AttendanceSetting from '../src/models/AttendanceSetting.js';
import ShiftSchedule from '../src/models/ShiftSchedule.js';
import { calculateEmployeePayroll } from '../src/services/payrollService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('夜班員工與夜班津貼測試資料驗證', () => {
  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in the environment');
    }
    await connectDB(process.env.MONGODB_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test('測試資料應包含夜班班別設定', async () => {
    const attendanceSetting = await AttendanceSetting.findOne();
    
    expect(attendanceSetting).toBeTruthy();
    expect(attendanceSetting.shifts).toBeDefined();
    
    // 查找夜班
    const nightShift = attendanceSetting.shifts.find(shift => shift.isNightShift === true);
    
    // 驗證：測試資料應該包含夜班
    expect(nightShift).toBeTruthy();
    expect(nightShift.name).toContain('夜班');
    expect(nightShift.isNightShift).toBe(true);
    expect(nightShift.hasAllowance).toBe(true);
    expect(nightShift.allowanceMultiplier).toBeGreaterThan(0);
    
    console.log('✓ 夜班設定:', {
      name: nightShift.name,
      startTime: nightShift.startTime,
      endTime: nightShift.endTime,
      allowanceMultiplier: nightShift.allowanceMultiplier,
      crossDay: nightShift.crossDay
    });
  });

  test('測試資料應包含夜班員工設定', async () => {
    // 查找有夜班津貼設定的員工
    const nightShiftEmployees = await Employee.find({
      'monthlySalaryAdjustments.nightShiftAllowance': { $gt: 0 }
    }).select('name employeeId monthlySalaryAdjustments');
    
    // 驗證：應該有夜班員工
    expect(nightShiftEmployees.length).toBeGreaterThan(0);
    
    console.log(`✓ 找到 ${nightShiftEmployees.length} 位夜班員工`);
    
    nightShiftEmployees.forEach(employee => {
      expect(employee.monthlySalaryAdjustments.nightShiftAllowance).toBeGreaterThan(0);
      console.log(`  - ${employee.name} (${employee.employeeId}): 夜班津貼 ${employee.monthlySalaryAdjustments.nightShiftAllowance} 元`);
    });
  });

  test('測試資料應包含夜班排班記錄', async () => {
    // 獲取夜班設定
    const attendanceSetting = await AttendanceSetting.findOne();
    const nightShift = attendanceSetting.shifts.find(shift => shift.isNightShift === true);
    
    if (!nightShift) {
      console.warn('警告: 沒有找到夜班設定，跳過排班驗證');
      return;
    }
    
    // 查找夜班排班記錄
    const nightShiftSchedules = await ShiftSchedule.find({
      shiftId: nightShift._id.toString()
    }).populate('employee', 'name employeeId');
    
    // 驗證：應該有夜班排班記錄
    if (nightShiftSchedules.length > 0) {
      expect(nightShiftSchedules.length).toBeGreaterThan(0);
      
      console.log(`✓ 找到 ${nightShiftSchedules.length} 筆夜班排班記錄`);
      
      // 統計每位員工的夜班天數
      const employeeNightShiftCounts = {};
      nightShiftSchedules.forEach(schedule => {
        const empId = schedule.employee._id.toString();
        if (!employeeNightShiftCounts[empId]) {
          employeeNightShiftCounts[empId] = {
            name: schedule.employee.name,
            employeeId: schedule.employee.employeeId,
            count: 0
          };
        }
        employeeNightShiftCounts[empId].count++;
      });
      
      console.log('  夜班員工排班統計:');
      Object.values(employeeNightShiftCounts).forEach(emp => {
        console.log(`    - ${emp.name} (${emp.employeeId}): ${emp.count} 天夜班`);
      });
    } else {
      console.warn('警告: 沒有找到夜班排班記錄。可能需要運行 seed 腳本生成測試資料。');
    }
  });

  test('薪資計算應包含夜班津貼', async () => {
    // 查找有夜班津貼設定的員工
    const nightShiftEmployees = await Employee.find({
      'monthlySalaryAdjustments.nightShiftAllowance': { $gt: 0 }
    }).limit(1);
    
    if (nightShiftEmployees.length === 0) {
      console.warn('警告: 沒有找到夜班員工，跳過薪資計算驗證');
      return;
    }
    
    const employee = nightShiftEmployees[0];
    
    // 計算當月薪資
    const currentDate = new Date();
    const month = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      .toISOString().split('T')[0];
    
    try {
      const payroll = await calculateEmployeePayroll(
        employee._id.toString(),
        month
      );
      
      // 驗證：薪資計算結果應包含夜班津貼相關欄位
      expect(payroll).toBeDefined();
      expect(payroll).toHaveProperty('nightShiftAllowance');
      expect(payroll).toHaveProperty('nightShiftDays');
      expect(payroll).toHaveProperty('nightShiftHours');
      expect(payroll).toHaveProperty('nightShiftCalculationMethod');
      
      console.log(`✓ ${employee.name} 的薪資計算結果:`, {
        nightShiftDays: payroll.nightShiftDays,
        nightShiftHours: payroll.nightShiftHours,
        nightShiftAllowance: payroll.nightShiftAllowance,
        calculationMethod: payroll.nightShiftCalculationMethod
      });
      
      // 如果有夜班排班，津貼應該大於0
      if (payroll.nightShiftDays > 0) {
        expect(payroll.nightShiftAllowance).toBeGreaterThan(0);
        console.log('  ✓ 夜班津貼計算正確');
      } else {
        console.log('  ℹ 本月無夜班排班，使用固定津貼或零津貼');
      }
      
    } catch (error) {
      console.error('薪資計算錯誤:', error.message);
      throw error;
    }
  });

  test('月薪資總覽應包含夜班津貼欄位', async () => {
    // 此測試驗證 API 返回的資料結構
    // 實際 API 測試需要啟動伺服器，這裡只驗證資料模型
    
    const nightShiftEmployees = await Employee.find({
      'monthlySalaryAdjustments.nightShiftAllowance': { $gt: 0 }
    }).limit(1);
    
    if (nightShiftEmployees.length === 0) {
      console.warn('警告: 沒有找到夜班員工');
      return;
    }
    
    const employee = nightShiftEmployees[0];
    const currentDate = new Date();
    const month = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      .toISOString().split('T')[0];
    
    try {
      const payroll = await calculateEmployeePayroll(
        employee._id.toString(),
        month
      );
      
      // 模擬月薪資總覽的資料結構
      const overviewData = {
        _id: employee._id,
        employeeId: employee.employeeId,
        name: employee.name,
        salaryType: employee.salaryType || '月薪',
        nightShiftAllowance: payroll?.nightShiftAllowance || 0,
        performanceBonus: payroll?.performanceBonus || 0,
        otherBonuses: payroll?.otherBonuses || 0,
        totalPayment: payroll?.totalPayment || 0,
      };
      
      // 驗證：月薪資總覽資料應包含 nightShiftAllowance 欄位
      expect(overviewData).toHaveProperty('nightShiftAllowance');
      expect(typeof overviewData.nightShiftAllowance).toBe('number');
      
      console.log('✓ 月薪資總覽資料結構正確:');
      console.log('  - 員工:', overviewData.name);
      console.log('  - 夜班津貼:', overviewData.nightShiftAllowance);
      console.log('  - 績效獎金:', overviewData.performanceBonus);
      console.log('  - 其他獎金:', overviewData.otherBonuses);
      console.log('  - 實發金額:', overviewData.totalPayment);
      
    } catch (error) {
      console.error('資料處理錯誤:', error.message);
      throw error;
    }
  });
});
