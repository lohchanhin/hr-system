import { createRouter, createWebHistory } from 'vue-router'

// ★ 既有的後台檔案
import Login from '@/views/Login.vue'
import Layout from '@/views/Layout.vue'
import Settings from '@/views/Settings.vue'
import AttendanceSetting from '@/components/backComponents/AttendanceSetting.vue'
import AttendanceManagementSetting from '@/components/backComponents/AttendanceManagementSetting.vue'
import LeaveOvertimeSetting from '@/components/backComponents/LeaveOvertimeSetting.vue'
import ShiftScheduleSetting from '@/components/backComponents/ShiftScheduleSetting.vue'
import ApprovalFlowSetting from '@/components/backComponents/ApprovalFlowSetting.vue'
import ReportManagementSetting from '@/components/backComponents/ReportManagementSetting.vue'
import SalaryManagementSetting from '@/components/backComponents/SalaryManagementSetting.vue'
import SocialInsuranceRetirementSetting from '@/components/backComponents/SocialInsuranceRetirementSetting.vue'
import HRManagementSystemSetting from '@/components/backComponents/HRManagementSystemSetting.vue'

// ★ 新增的前台檔案 (先確定檔案路徑無大小寫差異)
import FrontLogin from '@/views/front/FrontLogin.vue'
import FrontLayout from '@/views/front/FrontLayout.vue'
import Schedule from '@/views/front/Schedule.vue'
import Attendance from '@/views/front/Attendance.vue'
import Leave from '@/views/front/Leave.vue'
import Approval from '@/views/front/Approval.vue'

const routes = [
  // ========== 後台路由區段 (既有) ==========
  {
    path: '/',
    redirect: '/front/login'
  },
  {
    path: '/login',    // 後台用 Login
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
      { path: 'salary-management-setting', name: 'SalaryManagementSetting', component: SalaryManagementSetting },
      { path: 'social-insurance-retirement-setting', name: 'SocialInsuranceRetirementSetting', component: SocialInsuranceRetirementSetting },
      { path: 'hr-management-system-setting', name: 'HRManagementSystemSetting', component: HRManagementSystemSetting },
    ]
  },

  // ========== 前台路由區段 (新) ==========
  {
    path: '/front/login',  // 前台登入
    name: 'FrontLogin',
    component: FrontLogin
  },
  {
    path: '/front',        // 前台主骨架
    name: 'FrontLayout',
    component: FrontLayout,
    // 若需要簡易的「前台登入判斷」，可加 meta
    meta: { frontRequiresAuth: true },

    // 定義子路由: 排班 / 出勤 / 請假 / 簽核
    children: [
      {
        path: 'attendance',
        name: 'Attendance',
        component: Attendance,
        // 若要做角色限制可加: meta: { roles: ['employee','supervisor','hr','admin'] }
      },
      {
        path: 'leave',
        name: 'Leave',
        component: Leave,
        // meta: { roles: ['employee','supervisor','hr','admin'] }
      },
      {
        path: 'schedule',
        name: 'Schedule',
        component: Schedule,
        // meta: { roles: ['supervisor','hr','admin'] }
      },
      {
        path: 'approval',
        name: 'Approval',
        component: Approval,
        // meta: { roles: ['supervisor','hr','admin'] }
      }
    ]
  },

  // (可選) 404 頁面 or 其他
  // { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFoundView }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// ★ 路由守衛
router.beforeEach((to, from, next) => {
  // 簡易示範: 後台 requiresAuth
  if (to.meta.requiresAuth) {
    const token = localStorage.getItem('token')
    if (!token) {
      return next({ name: 'Login' })
    }
  }

  // 若要檢查前台也需登入
  if (to.meta.frontRequiresAuth) {
    const token = localStorage.getItem('token')
    if (!token) {
      return next({ name: 'FrontLogin' })
    }
  }

  // 若有角色限制 meta.roles
  if (to.meta.roles) {
    const userRole = localStorage.getItem('role') || 'employee'
    if (!to.meta.roles.includes(userRole)) {
      return next('/403')
    }
  }

  next()
})

export default router
