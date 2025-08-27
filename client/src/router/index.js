import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '@/utils/tokenService'

// ★ 既有的後台檔案
const ManagerLogin = () => import('@/views/Login.vue')
const ManagerLayout = () => import('@/views/ModernLayout.vue')
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

const OrgDepartmentSettingView = () => import('@/views/OrgDepartmentSettingView.vue')

// ★ 錯誤頁面
const Forbidden = () => import('@/views/Forbidden.vue')
const NotFound = () => import('@/views/NotFound.vue')

// ★ 新增的前台檔案 (先確定檔案路徑無大小寫差異)
const FrontLogin = () => import('@/views/front/FrontLogin.vue')
const FrontLayout = () => import('@/views/front/FrontLayout.vue')
const Schedule = () => import('@/views/front/Schedule.vue')
const Attendance = () => import('@/views/front/Attendance.vue')
const Approval = () => import('@/views/front/Approval.vue')
const PreviewWeek = () => import('@/views/front/PreviewWeek.vue')
const PreviewMonth = () => import('@/views/front/PreviewMonth.vue')

const routes = [
  // 首頁重導至前台登入
  { path: '/', redirect: '/login' },

  // 前台登入
  { path: '/login', name: 'FrontLogin', component: FrontLogin },

  // 後台登入
  { path: '/manager/login', name: 'ManagerLogin', component: ManagerLogin },

  // ========== 後台路由區段 ==========
  {
    path: '/manager',
    name: 'ManagerLayout',
    component: ManagerLayout,
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
      { path: 'org-department-setting', name: 'OrgDepartmentSetting', component: OrgDepartmentSettingView },
    ],
  },

  // ========== 前台路由區段 ==========
  {
    path: '/front',
    name: 'FrontLayout',
    component: FrontLayout,
    // 若需要簡易的「前台登入判斷」，可加 meta
    meta: { frontRequiresAuth: true },

    // 定義子路由: 排班 / 出勤 / 簽核
    children: [
      {
        path: 'attendance',
        name: 'Attendance',
        component: Attendance,
        meta: { roles: ['employee', 'supervisor', 'admin'] },
      },
      {
        path: 'schedule',
        name: 'Schedule',
        component: Schedule,
        meta: { roles: ['supervisor', 'admin'] },
      },
      {
        path: 'preview-week',
        name: 'PreviewWeek',
        component: PreviewWeek,
        meta: { roles: ['supervisor', 'admin'] },
      },
      {
        path: 'preview-month',
        name: 'PreviewMonth',
        component: PreviewMonth,
        meta: { roles: ['supervisor', 'admin'] },
      },
      {
        path: 'approval',
        name: 'Approval',
        component: Approval,
        meta: { roles: ['employee', 'supervisor', 'admin'] },
      },
    ],
  },

  // 錯誤頁面
  { path: '/403', name: 'Forbidden', component: Forbidden },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// ★ 路由守衛
router.beforeEach((to, from, next) => {
  const requiresAuth = to.matched.some(r => r.meta.requiresAuth)
  const frontRequiresAuth = to.matched.some(r => r.meta.frontRequiresAuth)

  // 後台登入檢查
  if (requiresAuth) {
    const token = getToken()
    if (!token) {
      return next({ name: 'ManagerLogin' })
    }
    const userRole = localStorage.getItem('role') || 'employee'
    if (!['supervisor', 'admin'].includes(userRole)) {
      return next('/login')
    }
  }

  // 前台登入檢查
  if (frontRequiresAuth) {
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
