import Employee from '../models/Employee.js';
import { getScheduleAccessSummary } from '../services/scheduleAccessService.js';

// 前台（員工系統）的頁面名稱；要和 client/src/utils/authNavigation.js 的 FRONT_MENU_NAMES 一致
const FRONT_PAGE_NAMES = new Set(['Attendance', 'MySchedule', 'Schedule', 'FrontDepartmentReports', 'PreviewWeek', 'PreviewMonth', 'Approval', 'FrontChangePassword']);
// 管理員也能用的前台頁面（管理員的 items 只有後台項目）。以前只寫在前端（FrontLayout 的備援選單），改選單要兩邊一起改
const ADMIN_FRONT_ITEMS = Object.freeze([
  { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
  { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
  { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
  { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' },
]);

export async function getMenu(req, res, next) {
  try {
    const role = req.user?.role || 'employee';
    const menus = {
      employee: [
        { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
        { name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' },
        { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
        { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
      ],
      supervisor: [
        { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
        { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
        { name: 'FrontDepartmentReports', label: '部門報表', icon: 'el-icon-data-analysis' },
        { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
        { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
      ],
      hr: [
        { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
        { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
        { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' },
        { name: 'FrontChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
      ],
      admin: [
        { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
        { name: 'AttendanceManagementSetting', label: '出勤管理', icon: 'el-icon-postcard' },
        { name: 'LeaveOvertimeSetting', label: '請假加班設定', icon: 'el-icon-date' },
        { name: 'ShiftScheduleSetting', label: '排班表設定', icon: 'el-icon-timer' },
        { name: 'ApprovalFlowSetting', label: '簽核流程設定', icon: 'el-icon-s-operation' },
        { name: 'SalaryManagementSetting', label: '薪資管理', icon: 'el-icon-money' },
      { name: 'SocialInsuranceRetirementSetting', label: '勞健保設定', icon: 'el-icon-s-check' },
      { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' },
      { name: 'OtherControlSetting', label: '其他控制設定', icon: 'el-icon-more' },
      { name: 'OrgDepartmentSetting', label: '權限&機構&部門設定', icon: 'el-icon-s-grid' },
      { name: 'ScheduleOverview', label: '班表總覽', icon: 'el-icon-s-data' },
      { name: 'DepartmentReports', label: '報表查看', icon: 'el-icon-data-analysis' },
      { name: 'ManagerChangePassword', label: '變更密碼', icon: 'el-icon-lock' }
    ]
  };

    // 排班管理看排班權限：被指定為排班人員的員工也看得到；主管預設（只有排班人員能排班）沒被指定就看不到，
    // 改看「我的排班」（自己的班表）。部門報表、簽核流程不受影響
    if (['employee', 'supervisor'].includes(role) && req.user?.id) {
      let access = null;
      try {
        access = await getScheduleAccessSummary(req.user);
      } catch (accessError) {
        // 讀不到排班權限時不顯示「排班管理」（與預設模式相同，fail closed），各排班 API 仍會再檢查
        console.error('Failed to resolve schedule access for menu', accessError?.name ?? 'Error');
      }
      if (role === 'employee' && access?.canSchedule) {
        menus.employee.splice(1, 0, { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' });
      }
      if (role === 'supervisor' && !access?.canSchedule) {
        menus.supervisor = menus.supervisor.filter((item) => item.name !== 'Schedule');
        // 以前「我的排班」只在排班頁勾了「包含自己」才出現，看不到排班頁的主管就沒有地方看自己的班表
        menus.supervisor.splice(1, 0, { name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' });
      }
    }

    if (role === 'supervisor' && req.user?.id) {
      const profile = await Employee.findById(req.user.id)
        .select('schedulePreferences.includeSelf')
        .lean();
      const includeSelf = Boolean(profile?.schedulePreferences?.includeSelf);
      if (includeSelf && !menus.supervisor.some((item) => item.name === 'MySchedule')) {
        menus.supervisor.push({ name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' });
      }
    }

    const items = menus[role] || [];
    // ?include=front：回傳 { items, frontItems }（items 和沒帶參數時的陣列完全相同；frontItems 是前台要顯示的項目，
    // 管理員是 ADMIN_FRONT_ITEMS，其他角色是 items 裡的前台頁面）。沒帶參數時照舊回傳陣列，舊畫面不受影響
    if (req.query?.include === 'front') {
      const frontItems = role === 'admin'
        ? ADMIN_FRONT_ITEMS.map((item) => ({ ...item }))
        : items.filter((item) => FRONT_PAGE_NAMES.has(item.name));
      return res.json({ items, frontItems });
    }
    res.json(items);
  } catch (error) {
    if (typeof next === 'function') {
      next(error);
    } else {
      res.status(500).json({ message: '選單讀取失敗，請重新整理' });
    }
  }
}
