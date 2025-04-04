// src/router/index.js (節錄)
import { createRouter, createWebHistory } from 'vue-router'
import Login from '@/views/Login.vue'
import Layout from '@/views/Layout.vue'
import Settings from '@/views/Settings.vue'

// 已有前四個模組
import AttendanceSetting from '@/Components/backComponents/AttendanceSetting.vue'
import AttendanceManagementSetting from '@/Components/backComponents/AttendanceManagementSetting.vue'
import LeaveOvertimeSetting from '@/Components/backComponents/LeaveOvertimeSetting.vue'
import ShiftScheduleSetting from '@/Components/backComponents/ShiftScheduleSetting.vue'

// ★ 第五個模組: 簽核流程設定
import ApprovalFlowSetting from '@/Components/backComponents/ApprovalFlowSetting.vue'
import ReportManagementSetting from '@/components/backComponents/ReportManagementSetting.vue'

const routes = [
  {
    path: '/',
    redirect: '/login'
  },
  {
    path: '/login',
    name: 'Login',
    component: Login
  },
  {
    path: '/layout',
    name: 'Layout',
    component: Layout,
    meta: { requiresAuth: true },
    children: [
      // Settings
      { path: 'settings', name: 'Settings', component: Settings },
      // 1) 出勤設定
      { path: 'attendance-setting', name: 'AttendanceSetting', component: AttendanceSetting },
      // 2) 考勤管理設定
      { path: 'attendance-management', name: 'AttendanceManagementSetting', component: AttendanceManagementSetting },
      // 3) 請假與加班設定
      { path: 'leave-overtime-setting', name: 'LeaveOvertimeSetting', component: LeaveOvertimeSetting },
      // 4) 排班與班別管理設定
      { path: 'shift-schedule-setting', name: 'ShiftScheduleSetting', component: ShiftScheduleSetting },
      // 5) 簽核流程設定
      { path: 'approval-flow-setting', name: 'ApprovalFlowSetting', component: ApprovalFlowSetting },
      // ★ 第六模組: 報表管理設定
      {
        path: 'report-management-setting',
        name: 'ReportManagementSetting',
        component: ReportManagementSetting
      }

    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true'
  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: 'Login' })
  } else {
    next()
  }
})

export default router
