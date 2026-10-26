import Employee from '../models/Employee.js';
import { getScheduleAccessSummary } from '../services/scheduleAccessService.js';

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

    // 排班管理看排班權限：被指定為排班人員的員工也看得到；排班權限模式切開主管後，沒被指定的主管就看不到
    if (['employee', 'supervisor'].includes(role) && req.user?.id) {
      let access = null;
      try {
        access = await getScheduleAccessSummary(req.user);
      } catch (accessError) {
        // 讀不到排班權限時維持原本依角色的選單（主管看得到、員工看不到），各排班 API 仍會再檢查
        console.error('Failed to resolve schedule access for menu', accessError?.name ?? 'Error');
      }
      if (role === 'employee' && access?.canSchedule) {
        menus.employee.splice(1, 0, { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' });
      }
      if (role === 'supervisor' && access && !access.canSchedule) {
        menus.supervisor = menus.supervisor.filter((item) => item.name !== 'Schedule');
      }
    }

    if (role === 'supervisor' && req.user?.id) {
      const profile = await Employee.findById(req.user.id)
        .select('schedulePreferences.includeSelf')
        .lean();
      const includeSelf = Boolean(profile?.schedulePreferences?.includeSelf);
      if (includeSelf) {
        menus.supervisor.push({ name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' });
      }
    }

    res.json(menus[role] || []);
  } catch (error) {
    if (typeof next === 'function') {
      next(error);
    } else {
      res.status(500).json({ message: 'Failed to load menu' });
    }
  }
}
