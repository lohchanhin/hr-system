import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 排班頁（meta.allowScheduler）的路由守衛：被指定為排班人員的員工任何角色都能進入，
// 主管預設（只有排班人員能排班）沒被指定就不能進入，改帶到出勤打卡；讀不到排班權限時不放行（管理員除外）。
var capturedGuard
var warningSpy
vi.mock('vue-router', () => ({
  createRouter: ({ routes }) => ({
    getRoutes: () => routes,
    beforeEach: fn => { capturedGuard = fn },
    onError: () => {},
    afterEach: () => {}
  }),
  createWebHistory: () => ({})
}))

vi.mock('element-plus', () => {
  warningSpy = vi.fn()
  return { ElMessage: { warning: (...args) => warningSpy(...args) } }
})

const profileState = vi.hoisted(() => ({ profile: null, fetchProfile: null }))
vi.mock('../src/stores/profile', () => ({
  useProfileStore: () => profileState
}))

import router, { canEnterSchedulePage } from '../src/router/index.js'
import { setToken } from '../src/utils/tokenService'
import { getAuthenticatedHomeRoute } from '../src/utils/authNavigation'

const tokenFor = role => `h.${btoa(JSON.stringify({ role }))}.s`
const scheduleRoute = () => {
  const front = router.getRoutes().find(route => route.name === 'FrontLayout')
  const route = front.children.find(child => child.name === 'Schedule')
  return { matched: [{ meta: { frontRequiresAuth: true } }], meta: route.meta, name: 'Schedule' }
}
const runGuard = async (to) => {
  const next = vi.fn()
  await capturedGuard(to, {}, next)
  await vi.waitFor(() => expect(next).toHaveBeenCalled())
  return next
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  warningSpy?.mockClear()
  profileState.profile = null
  profileState.fetchProfile = vi.fn(async () => profileState.profile)
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('schedule page route guard', () => {
  it('marks the schedule and preview pages as open to schedulers', () => {
    const front = router.getRoutes().find(route => route.name === 'FrontLayout')
    const flags = Object.fromEntries(front.children.map(child => [child.name, Boolean(child.meta?.allowScheduler)]))
    expect(flags).toMatchObject({ Schedule: true, PreviewWeek: true, PreviewMonth: true, Attendance: false, Approval: false })
  })

  it('lets an employee-role scheduler open the schedule page', async () => {
    setToken(tokenFor('employee'))
    profileState.profile = { id: 'e1', scheduleAccess: { canSchedule: true, subDepartmentIds: ['u1'] } }
    const next = await runGuard(scheduleRoute())
    expect(next.mock.calls[0][0]).toBeUndefined()
    expect(warningSpy).not.toHaveBeenCalled()
  })

  it('sends an employee without an assignment to the forbidden page', async () => {
    setToken(tokenFor('employee'))
    profileState.profile = { id: 'e1', scheduleAccess: { canSchedule: false } }
    const next = await runGuard(scheduleRoute())
    expect(next).toHaveBeenCalledWith({ name: 'Forbidden' })
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('排班權限'))
  })

  // 以前停在沒有任何連結的 403；2026/11 起主管預設沒有排班權限，改帶到出勤打卡（仍提示沒有排班權限）
  it('sends a supervisor without schedule access (the default mode) to 出勤打卡, and lets a supervisor who can schedule in', async () => {
    setToken(tokenFor('supervisor'))
    profileState.profile = { id: 's1', scheduleAccess: { canSchedule: false, supervisorScope: false } }
    expect(await runGuard(scheduleRoute())).toHaveBeenCalledWith('/front/attendance')
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('排班權限'))

    profileState.profile = { id: 's1', scheduleAccess: { canSchedule: true, supervisorScope: true } }
    const allowed = await runGuard(scheduleRoute())
    expect(allowed.mock.calls[0][0]).toBeUndefined()
  })

  // 以前讀不到排班權限時退回角色限制（等於假設主管都能排班）；預設改成只有排班人員後不放行（fail closed）
  it('does not let anyone but an administrator in when the schedule access cannot be read', async () => {
    profileState.fetchProfile = vi.fn(async () => { throw new Error('offline') })
    setToken(tokenFor('supervisor'))
    expect(await runGuard(scheduleRoute())).toHaveBeenCalledWith({ name: 'Forbidden' })
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('無法確認排班權限'))
    setToken(tokenFor('employee'))
    expect(await runGuard(scheduleRoute())).toHaveBeenCalledWith({ name: 'Forbidden' })
  })

  it('sends a logged-in supervisor who opens a login page to the schedule only when they can schedule', async () => {
    const loginRoute = name => ({ matched: [], meta: {}, name })
    setToken(tokenFor('supervisor'))
    profileState.profile = { id: 's1', scheduleAccess: { canSchedule: false } }
    expect(await runGuard(loginRoute('ManagerLogin'))).toHaveBeenCalledWith('/front/attendance')
    expect(await runGuard(loginRoute('FrontLogin'))).toHaveBeenCalledWith('/front/attendance')
    profileState.profile = { id: 's1', scheduleAccess: { canSchedule: true } }
    expect(await runGuard(loginRoute('ManagerLogin'))).toHaveBeenCalledWith('/front/schedule')

    setToken(tokenFor('employee'))
    expect(await runGuard(loginRoute('FrontLogin'))).toHaveBeenCalledWith('/front/attendance')
    setToken(tokenFor('admin'))
    expect(await runGuard(loginRoute('ManagerLogin'))).toHaveBeenCalledWith('/manager/settings')
  })

  it('never asks the profile for an administrator', async () => {
    setToken(tokenFor('admin'))
    const next = await runGuard(scheduleRoute())
    expect(next.mock.calls[0][0]).toBeUndefined()
    expect(profileState.fetchProfile).not.toHaveBeenCalled()
  })

  it('reloads the profile when the cached one belongs to another account', async () => {
    sessionStorage.setItem('employeeId', 'e2')
    profileState.profile = { id: 'e1', scheduleAccess: { canSchedule: true } }
    await canEnterSchedulePage('employee', ['supervisor', 'admin'])
    expect(profileState.fetchProfile).toHaveBeenCalledWith({ force: true })
  })
})

// 登入後的首頁（Login.vue 用登入回應的 scheduleAccess）：主管沒有排班權限時進出勤打卡
describe('getAuthenticatedHomeRoute', () => {
  it('picks the schedule page for a supervisor only when they can schedule', () => {
    expect(getAuthenticatedHomeRoute('supervisor', { canSchedule: true })).toBe('/front/schedule')
    expect(getAuthenticatedHomeRoute('supervisor', { canSchedule: false })).toBe('/front/attendance')
    expect(getAuthenticatedHomeRoute('supervisor')).toBe('/front/attendance')
    expect(getAuthenticatedHomeRoute('employee', { canSchedule: true })).toBe('/front/attendance')
    expect(getAuthenticatedHomeRoute('admin')).toBe('/manager/settings')
    expect(getAuthenticatedHomeRoute('guest')).toBeNull()
  })
})
