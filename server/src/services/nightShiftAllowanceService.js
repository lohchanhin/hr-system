import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js';

/**
 * 計算員工在指定月份的夜班津貼
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @param {Object} employee - 員工資料對象
 * @returns {Object} - 夜班津貼計算結果
 */
export async function calculateNightShiftAllowance(employeeId, month, employee, context = {}) {
  try {
    // 計算月份的起始和結束日期
    const monthStart = new Date(month);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    // 獲取班別設定
    const attendanceSetting = context.attendanceSetting ?? await AttendanceSetting.findOne();
    if (!attendanceSetting || !attendanceSetting.shifts) {
      return {
        nightShiftDays: 0,
        nightShiftHours: 0,
        allowanceAmount: 0,
        calculationMethod: 'no_shifts',
        shiftBreakdown: [],
        configurationIssues: [],
      };
    }

    // 建立班別 ID 到班別資料的映射
    const shiftMap = new Map();
    attendanceSetting.shifts.forEach(shift => {
      shiftMap.set(shift._id.toString(), shift);
    });

    // 查詢該員工在當月的排班記錄
    // 注意：建議在 ShiftSchedule 上建立 (employee, date) 的複合索引以提升查詢效能
    const schedules = context.schedules ?? await ShiftSchedule.find({
      employee: employeeId,
      date: { $gte: monthStart, $lt: monthEnd },
    });

    if (schedules.length === 0) {
      return {
        nightShiftDays: 0,
        nightShiftHours: 0,
        allowanceAmount: 0,
        calculationMethod: 'no_schedules',
        shiftBreakdown: [],
        configurationIssues: [],
      };
    }

    // 統計夜班天數和計算夜班津貼
    let nightShiftDays = 0;
    let totalNightShiftHours = 0;
    let totalAllowance = 0;
    const shiftBreakdown = []; // 詳細的班次計算資訊
    const configurationIssues = []; // 配置問題列表
    const flaggedCrossDayShiftCodes = new Set(); // 避免同一班別跨日警告重複出現多次

    for (const schedule of schedules) {
      const shift = shiftMap.get(schedule.shiftId.toString());
      if (!shift) continue;

      // 只計算標記為夜班且啟用津貼的班別
      if (shift.isNightShift && shift.hasAllowance) {
        nightShiftDays++;

        // 計算夜班工作時數（考慮休息時間）
        const workHours = calculateShiftHours(shift);
        totalNightShiftHours += workHours;

        // 班別時間結束早於開始（例如 22:00-06:00），但未勾選「跨日」，
        // 工時會被靜默算成 0，而不會報錯，需要提醒管理員檢查班別設定。
        let hasCrossDayIssue = false;
        if (isMissingCrossDayFlag(shift)) {
          hasCrossDayIssue = true;
          const shiftKey = `${shift.name}|${shift.code}`;
          if (!flaggedCrossDayShiftCodes.has(shiftKey)) {
            flaggedCrossDayShiftCodes.add(shiftKey);
            const issue = `班別「${shift.name}」(${shift.code}) 時間為 ${shift.startTime}-${shift.endTime}，疑似跨日班別但未勾選「跨日」，工時已被算為 0，請檢查班別設定`;
            console.warn(`Night shift "${shift.name}" (${shift.code}) looks cross-day (end before start) but crossDay flag is not set.`);
            configurationIssues.push(issue);
          }
        }

        // Fixed allowance: pay a fixed amount per night shift
        const allowanceAmount = Number(shift.fixedAllowanceAmount);
        let shiftAllowance = 0;
        let calculationDetail = '';
        let hasIssue = false;

        if (allowanceAmount > 0 && Number.isFinite(allowanceAmount)) {
          shiftAllowance = allowanceAmount;
          calculationDetail = `固定津貼: NT$ ${allowanceAmount.toFixed(0)} / 班`;
        } else {
          const issue = `班別「${shift.name}」(${shift.code}) 已啟用夜班津貼但金額未設定`;
          console.warn(`Night shift "${shift.name}" (${shift.code}) is missing fixedAllowanceAmount.`);
          configurationIssues.push(issue);
          calculationDetail = '固定津貼未設定 (請設定固定津貼金額)';
          hasIssue = true;
        }

        // 記錄班次詳情
        shiftBreakdown.push({
          shiftName: shift.name,
          shiftCode: shift.code,
          allowanceType: '固定津貼',
          workHours,
          allowanceAmount: shiftAllowance,
          calculationDetail,
          hasIssue,
          hasCrossDayIssue,
        });

        totalAllowance += shiftAllowance;
      }
    }

    // 如果有計算出的夜班津貼，使用它；否則為 0（不再使用員工設定的固定津貼）
    const finalAllowance = totalAllowance > 0 ? totalAllowance : 0;

    // 判斷計算方式
    let calculationMethod = 'not_calculated';
    if (nightShiftDays > 0) {
      if (totalAllowance > 0) {
        calculationMethod = 'calculated';
      } else if (configurationIssues.length > 0) {
        calculationMethod = 'configuration_error';
      } else {
        calculationMethod = 'no_allowance_configured';
      }
    }

    return {
      nightShiftDays,
      nightShiftHours: totalNightShiftHours,
      allowanceAmount: Math.round(finalAllowance), // 四捨五入到整數
      calculationMethod,
      shiftBreakdown, // 詳細的班次計算資訊
      configurationIssues, // 配置問題列表
    };
  } catch (error) {
    console.error(`Error calculating night shift allowance for employee ${employeeId}:`, error);
    // 發生錯誤時，返回 0（不再使用員工設定的固定津貼）
    return {
      nightShiftDays: 0,
      nightShiftHours: 0,
      allowanceAmount: 0,
      calculationMethod: 'error_fallback',
      shiftBreakdown: [],
      configurationIssues: [`計算錯誤: ${error.message}`],
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

/**
 * 判斷班別是否疑似跨日（結束時間早於開始時間）但未勾選「跨日」
 * @param {Object} shift - 班別資料
 * @returns {Boolean}
 */
function isMissingCrossDayFlag(shift) {
  if (shift.crossDay) return false;
  const [startHour, startMin] = String(shift.startTime || '').split(':').map(Number);
  const [endHour, endMin] = String(shift.endTime || '').split(':').map(Number);
  if ([startHour, startMin, endHour, endMin].some((value) => !Number.isFinite(value))) return false;
  const totalMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);
  return totalMinutes < 0;
}

export default {
  calculateNightShiftAllowance,
};
