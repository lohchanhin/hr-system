import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import { convertToHourlyRate, WORK_HOURS_CONFIG } from '../config/salaryConfig.js';

/**
 * 計算員工在指定月份的夜班津貼
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @param {Object} employee - 員工資料對象
 * @returns {Object} - 夜班津貼計算結果
 */
export async function calculateNightShiftAllowance(employeeId, month, employee) {
  try {
    // 計算月份的起始和結束日期
    const monthStart = new Date(month);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    // 獲取班別設定
    const attendanceSetting = await AttendanceSetting.findOne();
    if (!attendanceSetting || !attendanceSetting.shifts) {
      return {
        nightShiftDays: 0,
        nightShiftHours: 0,
        allowanceAmount: 0,
        calculationMethod: 'no_shifts',
      };
    }

    // 建立班別 ID 到班別資料的映射
    const shiftMap = new Map();
    attendanceSetting.shifts.forEach(shift => {
      shiftMap.set(shift._id.toString(), shift);
    });

    // 查詢該員工在當月的排班記錄
    // 注意：建議在 ShiftSchedule 上建立 (employee, date) 的複合索引以提升查詢效能
    const schedules = await ShiftSchedule.find({
      employee: employeeId,
      date: { $gte: monthStart, $lt: monthEnd },
    });

    if (schedules.length === 0) {
      return {
        nightShiftDays: 0,
        nightShiftHours: 0,
        allowanceAmount: 0,
        calculationMethod: 'no_schedules',
      };
    }

    // 統計夜班天數和計算夜班津貼
    let nightShiftDays = 0;
    let totalNightShiftHours = 0;
    let totalAllowance = 0;

    for (const schedule of schedules) {
      const shift = shiftMap.get(schedule.shiftId.toString());
      if (!shift) continue;

      // 只計算標記為夜班且啟用津貼的班別
      if (shift.isNightShift && shift.hasAllowance) {
        nightShiftDays++;

        // 計算夜班工作時數（考慮休息時間）
        const workHours = calculateShiftHours(shift);
        totalNightShiftHours += workHours;

        // 根據津貼類型計算該班次的津貼
        let shiftAllowance = 0;
        if (shift.allowanceType === 'fixed') {
          // 固定津貼：直接使用設定的金額
          shiftAllowance = shift.fixedAllowanceAmount || 0;
        } else {
          // 倍率計算：津貼 = 時薪 × 工作時數 × 津貼倍數
          if (shift.allowanceMultiplier > 0) {
            const hourlyRate = convertToHourlyRate(
              employee.salaryAmount || 0,
              employee.salaryType || '月薪'
            );
            shiftAllowance = hourlyRate * workHours * shift.allowanceMultiplier;
          }
        }
        totalAllowance += shiftAllowance;
      }
    }

    // 如果有計算出的夜班津貼，使用它；否則使用員工設定的固定津貼
    const finalAllowance = totalAllowance > 0
      ? totalAllowance
      : (employee.monthlySalaryAdjustments?.nightShiftAllowance || 0);

    return {
      nightShiftDays,
      nightShiftHours: totalNightShiftHours,
      allowanceAmount: Math.round(finalAllowance), // 四捨五入到整數
      calculationMethod: totalAllowance > 0 ? 'calculated' : 'fixed',
    };
  } catch (error) {
    console.error(`Error calculating night shift allowance for employee ${employeeId}:`, error);
    // 發生錯誤時，返回員工設定的固定津貼
    return {
      nightShiftDays: 0,
      nightShiftHours: 0,
      allowanceAmount: employee.monthlySalaryAdjustments?.nightShiftAllowance || 0,
      calculationMethod: 'error_fallback',
    };
  }
}

/**
 * 計算班別的實際工作時數（扣除休息時間）
 * @param {Object} shift - 班別資料
 * @returns {Number} - 工作時數
 */
function calculateShiftHours(shift) {
  try {
    // 解析開始和結束時間
    const [startHour, startMin] = shift.startTime.split(':').map(Number);
    const [endHour, endMin] = shift.endTime.split(':').map(Number);

    let totalMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);

    // 處理跨日班別
    if (shift.crossDay && totalMinutes < 0) {
      totalMinutes += 24 * 60;
    }

    // 扣除休息時間
    const breakMinutes = shift.breakDuration || 0;
    const workMinutes = Math.max(0, totalMinutes - breakMinutes);

    // 轉換為小時
    return workMinutes / 60;
  } catch (error) {
    console.error('Error calculating shift hours:', error);
    // 使用配置中的預設工作時數
    return WORK_HOURS_CONFIG.HOURS_PER_DAY;
  }
}

export default {
  calculateNightShiftAllowance,
};
