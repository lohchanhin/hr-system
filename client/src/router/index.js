import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getToken } from '@/utils/tokenService'
import { resolveUserRole } from '@/utils/roleResolver'

// ★ 既有的後台檔案
const ManagerLogin = () => import('@/views/Login.vue')
const ManagerLayout = () => import('@/views/ModernLayout.vue')
const Settings = () => import('@/views/Settings.vue')
const AttendanceSetting = () => import('@/components/backComponents/AttendanceSetting.vue')
const AttendanceManagementSetting = () => import('@/components/backComponents/AttendanceManagementSetting.vue')
const LeaveOvertimeSetting = () => import('@/components/backComponents/LeaveOvertimeSetting.vue')
const ShiftScheduleSetting = () => import('@/components/backComponents/ShiftScheduleSetting.vue')
const ApprovalFlowSetting = () => import('@/components/backComponents/ApprovalFlowSetting.vue')
const SalaryManagementSetting = () => import('@/components/backComponents/SalaryManagementSetting.vue')
const SocialInsuranceRetirementSetting = () => import('@/components/backComponents/SocialInsuranceRetirementSetting.vue')
const HRManagementSystemSetting = () => import('@/components/backComponents/HRManagementSystemSetting.vue')

const OrgDepartmentSettingView = () => import('@/views/OrgDepartmentSettingView.vue')
const OtherControlSettingView = () => import('@/views/OtherControlSettingView.vue')
const ScheduleOverview = () => import('@/views/ScheduleOverview.vue')
const ManagerChangePassword = () => import('@/views/ChangePasswordView.vue')

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
const MySchedule = () => import('@/views/front/MySchedule.vue')
const DepartmentReports = () => import('@/views/front/DepartmentReports.vue')
const FrontChangePassword = () => import('@/views/front/FrontChangePassword.vue')

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
    redirect: '/manager/settings',
    children: [
      { path: 'settings', name: 'Settings', component: Settings },
      { path: 'attendance-setting', name: 'AttendanceSetting', component: AttendanceSetting },
      { path: 'attendance-management', name: 'AttendanceManagementSetting', component: AttendanceManagementSetting },
      {
        path: 'department-reports',
        name: 'DepartmentReports',
        component: DepartmentReports,
        meta: { roles: ['admin'], warningMessage: '僅系統管理員可以存取後台報表，請確認您的權限' },
      },
      {
        path: 'schedule-overview',
        name: 'ScheduleOverview',
        component: ScheduleOverview,
        meta: { roles: ['admin'], warningMessage: '僅系統管理員可以檢視班表總覽' },
      },
      { path: 'leave-overtime-setting', name: 'LeaveOvertimeSetting', component: LeaveOvertimeSetting },
      { path: 'shift-schedule-setting', name: 'ShiftScheduleSetting', component: ShiftScheduleSetting },
      { path: 'approval-flow-setting', name: 'ApprovalFlowSetting', component: ApprovalFlowSetting },
      { path: 'salary-management-setting', name: 'SalaryManagementSetting', component: SalaryManagementSetting },
      { path: 'social-insurance-retirement-setting', name: 'SocialInsuranceRetirementSetting', component: SocialInsuranceRetirementSetting },
      { path: 'hr-management-system-setting', name: 'HRManagementSystemSetting', component: HRManagementSystemSetting },
      { path: 'org-department-setting', name: 'OrgDepartmentSetting', component: OrgDepartmentSettingView },
      { path: 'other-control-setting', name: 'OtherControlSetting', component: OtherControlSettingView },
      { path: 'change-password', name: 'ManagerChangePassword', component: ManagerChangePassword },
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
        alias: 'Attendance',
        component: Attendance,
        meta: { roles: ['employee', 'supervisor', 'admin'] },
      },
      {
        path: 'my-schedule',
        name: 'MySchedule',
        alias: 'MySchedule',
        component: MySchedule,
        meta: { roles: ['employee', 'supervisor', 'admin'] },
      },
      {
        path: 'schedule',
        name: 'Schedule',
        component: Schedule,
        meta: { roles: ['supervisor', 'admin'] },
      },
      {
        path: 'department-reports',
        name: 'FrontDepartmentReports',
        component: DepartmentReports,
        meta: {
          roles: ['supervisor', 'admin'],
          warningMessage: '僅主管可以存取部門報表，請聯絡您的主管協助',
        },
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
        alias: 'Approval',
        component: Approval,
        meta: { roles: ['employee', 'supervisor', 'admin'] },
      },
      {
        path: 'change-password',
        name: 'FrontChangePassword',
        component: FrontChangePassword,
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

const showWarningMessage = message => {
  const globalWarning = typeof window !== 'undefined' ? window.ElMessage?.warning : undefined
  const moduleWarning = ElMessage?.warning
  const handler = globalWarning || moduleWarning
  if (handler) {
    handler(message)
  }
}

// ★ 路由守衛
router.beforeEach((to, from, next) => {
  const requiresAuth = to.matched.some(r => r.meta.requiresAuth)
  const frontRequiresAuth = to.matched.some(r => r.meta.frontRequiresAuth)
  const token = getToken()
  let cachedRole = null

  // 後台登入檢查
  if (requiresAuth) {
    if (!token) {
      return next({ name: 'ManagerLogin' })
    }
    cachedRole = resolveUserRole({ token }) || 'employee'
    if (!['supervisor', 'admin'].includes(cachedRole)) {
      return next('/login')
    }
  }

  // 前台登入檢查
  if (frontRequiresAuth && !token) {
    return next({ name: 'FrontLogin' })
  }

  // 若有角色限制 meta.roles
  if (to.meta.roles) {
    if (cachedRole == null) {
      cachedRole = resolveUserRole({ token })
    }
    if (!cachedRole) {
      cachedRole = 'employee'
    }
    if (!to.meta.roles.includes(cachedRole)) {
      const warningMessage = to.meta.warningMessage || '您沒有權限瀏覽此頁面'
      showWarningMessage(warningMessage)
      return next({ name: 'Forbidden' })
    }
  }

  next()
})

export default router
