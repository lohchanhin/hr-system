import ShiftSchedule from '../models/ShiftSchedule.js';

export async function getMenu(req, res, next) {
  try {
    const role = req.user?.role || 'employee';
    const menuTemplates = {
      employee: [
        {
          group: '出勤與排班',
          children: [
            { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
            { name: 'MySchedule', label: '我的排班', icon: 'el-icon-timer' }
          ]
        },
        {
          group: '簽核作業',
          children: [
            { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
          ]
        }
      ],
      supervisor: [
        {
          group: '出勤管理',
          children: [
            { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' }
          ]
        },
        {
          group: '排班管理',
          children: [
            { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' }
          ]
        },
        {
          group: '部門報表',
          children: [
            { name: 'FrontDepartmentReports', label: '部門報表', icon: 'el-icon-data-analysis' }
          ]
        },
        {
          group: '簽核作業',
          children: [
            { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
          ]
        }
      ],
      hr: [
        {
          group: '出勤與排班',
          children: [
            { name: 'Attendance', label: '出勤打卡', icon: 'el-icon-postcard' },
            { name: 'Schedule', label: '排班管理', icon: 'el-icon-timer' }
          ]
        },
        {
          group: '簽核作業',
          children: [
            { name: 'Approval', label: '簽核流程', icon: 'el-icon-s-operation' }
          ]
        }
      ],
      admin: [
        {
          group: '出勤與假勤設定',
          children: [
            { name: 'AttendanceSetting', label: '出勤設定', icon: 'el-icon-setting' },
            { name: 'AttendanceManagementSetting', label: '出勤管理', icon: 'el-icon-postcard' },
            { name: 'LeaveOvertimeSetting', label: '請假加班設定', icon: 'el-icon-date' }
          ]
        },
        {
          group: '排班與流程',
          children: [
            { name: 'ShiftScheduleSetting', label: '排班表設定', icon: 'el-icon-timer' },
            { name: 'ApprovalFlowSetting', label: '簽核流程設定', icon: 'el-icon-s-operation' }
          ]
        },
        {
          group: '薪資與福利',
          children: [
            { name: 'SalaryManagementSetting', label: '薪資管理', icon: 'el-icon-money' },
            { name: 'SocialInsuranceRetirementSetting', label: '社保與退休', icon: 'el-icon-s-check' }
          ]
        },
        {
          group: '系統管理',
          children: [
            { name: 'HRManagementSystemSetting', label: '人資管理', icon: 'el-icon-user-solid' },
            { name: 'OtherControlSetting', label: '其他控制設定', icon: 'el-icon-more' },
            { name: 'OrgDepartmentSetting', label: '權限&機構&部門設定', icon: 'el-icon-s-grid' }
          ]
        },
        {
          group: '報表與分析',
          children: [
            { name: 'ScheduleOverview', label: '班表總覽', icon: 'el-icon-s-data' },
            { name: 'DepartmentReports', label: '報表查看', icon: 'el-icon-data-analysis' }
          ]
        }
      ]
    };

    const menus = (menuTemplates[role] || []).map(group => ({
      ...group,
      children: group.children.map(item => ({ ...item }))
    }));

    if (role === 'supervisor' && req.user?.id) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const includeSelf = await ShiftSchedule.exists({
        employee: req.user.id,
        date: { $gte: startOfMonth, $lte: endOfMonth }
      });

      if (includeSelf) {
        const scheduleGroup = menus.find(group => group.group === '排班管理');
        if (scheduleGroup) {
          scheduleGroup.children.push({
            name: 'MySchedule',
            label: '我的排班',
            icon: 'el-icon-timer'
          });
        }
      }
    }

    res.json(menus);
  } catch (error) {
    if (typeof next === 'function') {
      next(error);
    } else {
      res.status(500).json({ message: 'Failed to load menu' });
    }
  }
}
