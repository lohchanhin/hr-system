import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 排班頁（meta.allowScheduler）的路由守衛：被指定為排班人員的員工任何角色都能進入，
// 排班權限模式切開主管後沒被指定的主管不能進入；讀不到排班權限時維持原本的角色限制。
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

  it('refuses a supervisor cut off by the scheduler_only mode, and lets a normal supervisor in', async () => {
    setToken(tokenFor('supervisor'))
    profileState.profile = { id: 's1', scheduleAccess: { canSchedule: false, supervisorScope: false } }
    expect(await runGuard(scheduleRoute())).toHaveBeenCalledWith({ name: 'Forbidden' })

    profileState.profile = { id: 's1', scheduleAccess: { canSchedule: true, supervisorScope: true } }
    const allowed = await runGuard(scheduleRoute())
    expect(allowed.mock.calls[0][0]).toBeUndefined()
  })

  it('falls back to the role rules when the schedule access cannot be read', async () => {
    profileState.fetchProfile = vi.fn(async () => { throw new Error('offline') })
    setToken(tokenFor('supervisor'))
    expect((await runGuard(scheduleRoute())).mock.calls[0][0]).toBeUndefined()
    setToken(tokenFor('employee'))
    expect(await runGuard(scheduleRoute())).toHaveBeenCalledWith({ name: 'Forbidden' })
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
