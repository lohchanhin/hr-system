// src/router/index.js (節錄)
import { createRouter, createWebHistory } from 'vue-router'
import Login from '@/views/Login.vue'
import Layout from '@/views/Layout.vue'
import Settings from '@/views/Settings.vue'

// 1~6 模組
import AttendanceSetting from '@/Components/backComponents/AttendanceSetting.vue'
import AttendanceManagementSetting from '@/Components/backComponents/AttendanceManagementSetting.vue'
import LeaveOvertimeSetting from '@/Components/backComponents/LeaveOvertimeSetting.vue'
import ShiftScheduleSetting from '@/Components/backComponents/ShiftScheduleSetting.vue'
import ApprovalFlowSetting from '@/Components/backComponents/ApprovalFlowSetting.vue'
import ReportManagementSetting from '@/Components/backComponents/ReportManagementSetting.vue'

// ★ 第七模組: 薪資管理設定
import SalaryManagementSetting from '@/Components/backComponents/SalaryManagementSetting.vue'
// ★ 第8模組: 勞健保、勞退管理設定
import SocialInsuranceRetirementSetting from '@/Components/backComponents/SocialInsuranceRetirementSetting.vue'

import HRManagementSystemSetting from '@/Components/backComponents/HRManagementSystemSetting.vue'


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
      { path: 'settings', name: 'Settings', component: Settings },
      { path: 'attendance-setting', name: 'AttendanceSetting', component: AttendanceSetting },
      { path: 'attendance-management', name: 'AttendanceManagementSetting', component: AttendanceManagementSetting },
      { path: 'leave-overtime-setting', name: 'LeaveOvertimeSetting', component: LeaveOvertimeSetting },
      { path: 'shift-schedule-setting', name: 'ShiftScheduleSetting', component: ShiftScheduleSetting },
      { path: 'approval-flow-setting', name: 'ApprovalFlowSetting', component: ApprovalFlowSetting },
      { path: 'report-management-setting', name: 'ReportManagementSetting', component: ReportManagementSetting },

      // ★ 第七模組: 薪資管理設定
      {
        path: 'salary-management-setting',
        name: 'SalaryManagementSetting',
        component: SalaryManagementSetting
      },

      {
        path: 'social-insurance-retirement-setting',
        name: 'SocialInsuranceRetirementSetting',
        component: SocialInsuranceRetirementSetting
      },

      // ★ 第9模組: 人事管理與系統設定
      {
        path: 'hr-management-system-setting',
        name: 'HRManagementSystemSetting',
        component: HRManagementSystemSetting
      }


    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守衛 (若需檢查登入)
router.beforeEach((to, from, next) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true'
  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: 'Login' })
  } else {
    next()
  }
})

export default router
