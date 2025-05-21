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
      { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' },
      { name: 'Approval', label: '簽核表單', icon: 'el-icon-s-operation' },
      { name: 'ShiftScheduleSetting', label: '排班表設定', icon: 'el-icon-timer' },
      { name: 'SystemOrgSetting', label: '權限 & 機構 & 部門設定', icon: 'el-icon-setting' }
    ]
  };
  res.json(menus[role] || []);
}
