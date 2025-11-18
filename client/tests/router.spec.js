import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

var capturedGuard
var warningSpy
vi.mock('vue-router', () => ({
  createRouter: ({ routes }) => ({
    getRoutes: () => routes,
    beforeEach: fn => { capturedGuard = fn }
  }),
  createWebHistory: () => ({})
}))

vi.mock('element-plus', () => {
  warningSpy = vi.fn()
  return {
    ElMessage: {
      warning: (...args) => warningSpy(...args)
    }
  }
})

import router from '../src/router/index.js'
import { setToken } from '../src/utils/tokenService'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  warningSpy?.mockClear()
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('router', () => {
  it('loads routes without error', () => {
    expect(() => router.getRoutes()).not.toThrow()
  })

  it('contains error routes', () => {
    const names = router.getRoutes().map(r => r.name)
    expect(names).toContain('Forbidden')
    expect(names).toContain('NotFound')
  })

  it('redirects root to login', () => {
    const root = router.getRoutes().find(r => r.path === '/' )
    expect(root.redirect).toBe('/login')
  })

  it('includes manager login route', () => {
    const paths = router.getRoutes().map(r => r.path)
    expect(paths).toContain('/manager/login')
  })

  it('redirects /manager to settings', () => {
    const manager = router.getRoutes().find(r => r.path === '/manager')
    expect(manager.redirect).toBe('/manager/settings')
  })

  it('front child routes define role meta', () => {
    const front = router.getRoutes().find(r => r.name === 'FrontLayout')
    const childRoles = front.children.map(r => ({ name: r.name, roles: r.meta && r.meta.roles }))
    expect(childRoles.find(c => c.name === 'Attendance').roles).toEqual(['employee', 'supervisor', 'admin'])
    expect(childRoles.find(c => c.name === 'MySchedule').roles).toEqual(['employee', 'supervisor', 'admin'])
    expect(childRoles.find(c => c.name === 'Schedule').roles).toEqual(['supervisor', 'admin'])
    expect(childRoles.find(c => c.name === 'FrontDepartmentReports').roles).toEqual(['supervisor', 'admin'])
    expect(childRoles.find(c => c.name === 'Approval').roles).toEqual(['employee', 'supervisor', 'admin'])
    expect(childRoles.find(c => c.name === 'FrontChangePassword').roles).toEqual(['employee', 'supervisor', 'admin'])
  })

  it('includes admin department report route under manager layout', () => {
    const manager = router.getRoutes().find(r => r.name === 'ManagerLayout')
    const childRoles = manager.children.map(r => ({ name: r.name, roles: r.meta && r.meta.roles }))
    expect(childRoles.find(c => c.name === 'DepartmentReports').roles).toEqual(['admin'])
    expect(childRoles.find(c => c.name === 'ScheduleOverview').roles).toEqual(['admin'])
  })

  it('forwards employees to forbidden when opening department reports', () => {
    sessionStorage.setItem('role', 'employee')
    const next = vi.fn()
    capturedGuard({ matched: [], meta: { roles: ['supervisor', 'admin'], warningMessage: '僅主管可以存取部門報表，請聯絡您的主管協助' }, name: 'FrontDepartmentReports' }, {}, next)
    expect(next).toHaveBeenCalledWith({ name: 'Forbidden' })
    expect(warningSpy).toHaveBeenCalledWith('僅主管可以存取部門報表，請聯絡您的主管協助')
  })

  it('role guard blocks unauthorized user', () => {
    sessionStorage.setItem('role', 'employee')
    const next = vi.fn()
    capturedGuard({ matched: [], meta: { roles: ['supervisor'] }, name: 'OtherRoute' }, {}, next)
    expect(next).toHaveBeenCalledWith({ name: 'Forbidden' })
    expect(warningSpy).toHaveBeenCalledWith('您沒有權限瀏覽此頁面')
  })

  it('role guard allows employee when permitted', () => {
    sessionStorage.setItem('role', 'employee')
    const next = vi.fn()
    capturedGuard({ matched: [], meta: { roles: ['employee', 'supervisor', 'admin'] } }, {}, next)
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0][0]).toBeUndefined()
  })

  it('refreshes role after token change without re-login', () => {
    const scheduleRoute = {
      matched: [{ meta: { frontRequiresAuth: true } }],
      meta: {
        roles: ['supervisor', 'admin'],
        warningMessage: '僅主管可以存取部門報表，請聯絡您的主管協助',
      },
      name: 'Schedule',
    }
    const employeePayload = btoa(JSON.stringify({ role: 'employee' }))
    setToken(`h.${employeePayload}.s`)
    const firstNext = vi.fn()
    capturedGuard(scheduleRoute, {}, firstNext)
    expect(firstNext).toHaveBeenCalledWith({ name: 'Forbidden' })
    expect(warningSpy).toHaveBeenCalledWith('僅主管可以存取部門報表，請聯絡您的主管協助')

    const supervisorPayload = btoa(JSON.stringify({ role: 'supervisor' }))
    setToken(`h.${supervisorPayload}.s`)
    const secondNext = vi.fn()
    capturedGuard(scheduleRoute, {}, secondNext)
    expect(secondNext).toHaveBeenCalled()
    expect(secondNext.mock.calls[0][0]).toBeUndefined()
    expect(sessionStorage.getItem('role')).toBe('supervisor')
    expect(localStorage.getItem('role')).toBe('supervisor')
  })

  it('backend guard redirects non-supervisor', () => {
    localStorage.setItem('token', 't')
    sessionStorage.setItem('role', 'employee')
    const next = vi.fn()
    capturedGuard({ matched: [{ meta: { requiresAuth: true } }], meta: {} }, {}, next)
    expect(next).toHaveBeenCalledWith('/login')
  })

  it('backend guard allows supervisor', () => {
    const payload = btoa(JSON.stringify({ role: 'supervisor' }))
    localStorage.setItem('token', `h.${payload}.s`)
    sessionStorage.setItem('role', 'supervisor')
    const next = vi.fn()
    capturedGuard({ matched: [{ meta: { requiresAuth: true } }], meta: {} }, {}, next)
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0][0]).toBeUndefined()
  })

  it('allows admin to access reports after refresh using persisted role', () => {
    const payload = btoa(JSON.stringify({ role: 'admin' }))
    const token = `header.${payload}.signature`
    localStorage.setItem('token', token)
    localStorage.setItem('role', 'admin')
    const next = vi.fn()
    capturedGuard(
      {
        matched: [{ meta: { requiresAuth: true } }],
        meta: { roles: ['admin'], warningMessage: '僅系統管理員可以存取後台報表，請確認您的權限' },
        name: 'DepartmentReports'
      },
      {},
      next
    )
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0][0]).toBeUndefined()
    expect(sessionStorage.getItem('role')).toBe('admin')
  })

  it('decodes admin role from token when storages are empty', () => {
    const payload = btoa(JSON.stringify({ role: 'admin' }))
    const token = `header.${payload}.signature`
    localStorage.setItem('token', token)
    const next = vi.fn()
    capturedGuard(
      {
        matched: [{ meta: { requiresAuth: true } }],
        meta: { roles: ['admin'], warningMessage: '僅系統管理員可以存取後台報表，請確認您的權限' },
        name: 'DepartmentReports'
      },
      {},
      next
    )
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0][0]).toBeUndefined()
    expect(sessionStorage.getItem('role')).toBe('admin')
    expect(localStorage.getItem('role')).toBe('admin')
  })
})
