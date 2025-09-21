export function getMenu(req, res) {
  const role = req.user?.role || 'employee';
  const menus = {
    employee: [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
    ],
    supervisor: [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
      { name: 'DepartmentReports', label: '部門報表', icon: 'el-icon-data-analysis' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
    ],
    hr: [
      { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' },
      { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
    ],
    admin: [
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
      { name: 'AttendanceManagementSetting', label: '出勤管理', icon: 'el-icon-postcard' },
      { name: 'LeaveOvertimeSetting', label: '請假加班設定', icon: 'el-icon-date' },
      { name: 'ShiftScheduleSetting', label: '排班表設定', icon: 'el-icon-timer' },
      { name: 'ApprovalFlowSetting', label: '簽核流程設定', icon: 'el-icon-s-operation' },
      { name: 'ReportManagementSetting', label: '報表管理', icon: 'el-icon-document' },
      { name: 'SalaryManagementSetting', label: '薪資管理', icon: 'el-icon-money' },
      { name: 'SocialInsuranceRetirementSetting', label: '社保與退休', icon: 'el-icon-s-check' },
      { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' },
      { name: 'OtherControlSetting', label: '其他控制設定', icon: 'el-icon-more' },
      { name: 'OrgDepartmentSetting', label: '權限&機構&部門設定', icon: 'el-icon-s-grid' }
    ]
  };
  res.json(menus[role] || []);
}
