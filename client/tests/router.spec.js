import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let capturedGuard
vi.mock('vue-router', () => ({
  createRouter: ({ routes }) => ({
    getRoutes: () => routes,
    beforeEach: fn => { capturedGuard = fn }
  }),
  createWebHistory: () => ({})
}))

import router from '../src/router/index.js'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
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

  it('front child routes define role meta', () => {
    const front = router.getRoutes().find(r => r.name === 'FrontLayout')
    const childRoles = front.children.map(r => ({ name: r.name, roles: r.meta && r.meta.roles }))
    expect(childRoles.find(c => c.name === 'Attendance').roles).toEqual(['employee', 'supervisor', 'hr', 'admin'])
    expect(childRoles.find(c => c.name === 'Leave').roles).toEqual(['employee', 'supervisor', 'hr', 'admin'])
    expect(childRoles.find(c => c.name === 'Schedule').roles).toEqual(['supervisor', 'hr', 'admin'])
    expect(childRoles.find(c => c.name === 'Approval').roles).toEqual(['supervisor', 'hr', 'admin'])
  })

  it('role guard blocks unauthorized user', () => {
    localStorage.setItem('role', 'employee')
    const next = vi.fn()
    capturedGuard({ meta: { roles: ['supervisor'] } }, {}, next)
    expect(next).toHaveBeenCalledWith({ name: 'Forbidden' })
  })

  it('role guard allows authorized user', () => {
    localStorage.setItem('role', 'supervisor')
    const next = vi.fn()
    capturedGuard({ meta: { roles: ['supervisor', 'admin'] } }, {}, next)
    expect(next).toHaveBeenCalled()
    expect(next.mock.calls[0][0]).toBeUndefined()
  })
})
