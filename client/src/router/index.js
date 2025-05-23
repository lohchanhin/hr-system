import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '@/utils/tokenService'

// ★ 既有的後台檔案
const Login = () => import('@/views/Login.vue')
const Layout = () => import('@/views/ModernLayout.vue')
const Settings = () => import('@/views/Settings.vue')
const AttendanceSetting = () => import('@/components/backComponents/AttendanceSetting.vue')
const AttendanceManagementSetting = () => import('@/components/backComponents/AttendanceManagementSetting.vue')
const LeaveOvertimeSetting = () => import('@/components/backComponents/LeaveOvertimeSetting.vue')
const ShiftScheduleSetting = () => import('@/components/backComponents/ShiftScheduleSetting.vue')
const ApprovalFlowSetting = () => import('@/components/backComponents/ApprovalFlowSetting.vue')
const ReportManagementSetting = () => import('@/components/backComponents/ReportManagementSetting.vue')
const SalaryManagementSetting = () => import('@/components/backComponents/SalaryManagementSetting.vue')
const SocialInsuranceRetirementSetting = () => import('@/components/backComponents/SocialInsuranceRetirementSetting.vue')
const HRManagementSystemSetting = () => import('@/components/backComponents/HRManagementSystemSetting.vue')
const OrgDepartmentSetting = () => import('@/components/backComponents/OrgDepartmentSetting.vue')

// ★ 錯誤頁面
const Forbidden = () => import('@/views/Forbidden.vue')
const NotFound = () => import('@/views/NotFound.vue')

// ★ 新增的前台檔案 (先確定檔案路徑無大小寫差異)
const FrontLogin = () => import('@/views/front/FrontLogin.vue')
const FrontLayout = () => import('@/views/front/FrontLayout.vue')
const Schedule = () => import('@/views/front/Schedule.vue')
const Attendance = () => import('@/views/front/Attendance.vue')
const Leave = () => import('@/views/front/Leave.vue')
const Approval = () => import('@/views/front/Approval.vue')

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
      { path: 'org-department-setting', name: 'OrgDepartmentSetting', component: OrgDepartmentSetting },
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

  // 錯誤頁面
  { path: '/403', name: 'Forbidden', component: Forbidden },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// ★ 路由守衛
router.beforeEach((to, from, next) => {
  // 簡易示範: 後台 requiresAuth
  if (to.meta.requiresAuth) {
    const token = getToken()
    if (!token) {
      return next({ name: 'Login' })
    }
  }

  // 若要檢查前台也需登入
  if (to.meta.frontRequiresAuth) {
    const token = getToken()
    if (!token) {
      return next({ name: 'FrontLogin' })
    }
  }

  // 若有角色限制 meta.roles
  if (to.meta.roles) {
    const userRole = localStorage.getItem('role') || 'employee'
    if (!to.meta.roles.includes(userRole)) {
      return next({ name: 'Forbidden' })
    }
  }

  next()
})

export default router
