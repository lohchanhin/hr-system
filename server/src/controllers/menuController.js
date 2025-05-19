export function getMenu(req, res) {
  const role = req.user?.role || 'employee';
  const menus = {
    employee: [
      { name: 'attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'leave', label: '請假申請', icon: 'el-icon-date' }
    ],
    supervisor: [
      { name: 'attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'leave', label: '請假申請', icon: 'el-icon-date' },
      { name: 'schedule', label: '排班管理', icon: 'el-icon-timer' },
      { name: 'approval', label: '簽核流程', icon: 'el-icon-s-operation' }
    ],
    hr: [
      { name: 'attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
      { name: 'leave', label: '請假申請', icon: 'el-icon-date' },
      { name: 'schedule', label: '排班管理', icon: 'el-icon-timer' },
      { name: 'approval', label: '簽核流程', icon: 'el-icon-s-operation' }
    ],
    admin: [
      { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-postcard' },
      { name: 'AttendanceManagementSetting', label: '考勤管理設定', icon: 'el-icon-folder-opened' },
      { name: 'LeaveOvertimeSetting', label: '請假與加班設定', icon: 'el-icon-date' },
      { name: 'ShiftScheduleSetting', label: '排班管理設定', icon: 'el-icon-timer' },
      { name: 'ApprovalFlowSetting', label: '簽核流程設定', icon: 'el-icon-s-operation' },
      { name: 'ReportManagementSetting', label: '報表管理設定', icon: 'el-icon-document-copy' },
      { name: 'SalaryManagementSetting', label: '薪資管理設定', icon: 'el-icon-coin' },
      { name: 'SocialInsuranceRetirementSetting', label: '勞健保 / 勞退設定', icon: 'el-icon-s-check' },
      { name: 'HRManagementSystemSetting', label: '人事管理與系統設定', icon: 'el-icon-user-solid' }
    ]
  };
  res.json(menus[role] || []);
}
