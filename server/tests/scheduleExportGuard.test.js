import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

// 班表匯出要有排班權限。以前這個檢查只在 index.js 依路徑判斷（req.path 以 /export 開頭），router 本身沒有擋：
// Express 比對路徑不分大小寫，所以 /api/schedules/EXPORT 不符合 index.js 的判斷、
// 卻照樣對到匯出的處理函式，沒有排班權限的員工也能匯出。
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

const controllerNames = [
  'listSchedules', 'createSchedule', 'getSchedule', 'updateSchedule', 'deleteSchedule', 'exportSchedules',
  'listMonthlySchedules', 'createSchedulesBatch', 'deleteOldSchedules', 'listLeaveApprovals', 'listSupervisorSummary',
  'listScheduleOverview', 'exportScheduleOverview', 'publishSchedules', 'finalizeSchedules', 'respondToSchedule',
  'respondToSchedulesBulk', 'validateScheduleRules', 'validateScheduleCompleteness', 'getIncompleteSchedules',
  'checkCanFinalize', 'getIncludeSelfPreference', 'updateIncludeSelfPreference', 'importSchedules',
  'deleteSchedulesBatch', 'listScheduleDayMemos', 'upsertScheduleDayMemo',
]
const controllers = Object.fromEntries(
  controllerNames.map((name) => [name, jest.fn((_req, res) => res.json({ handler: name }))]),
)

let currentUser = null

jest.unstable_mockModule('../src/controllers/scheduleController.js', () => controllers)
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!currentUser) return res.status(401).json({ error: 'Unauthorized' })
    req.user = currentUser
    return next()
  },
  authorizeRoles: (...roles) => (req, res, next) => (
    roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden' })
  ),
}))
// 排班權限：這裡用 req.user.canSchedule 代表（管理員、被指定的排班人員…），規則本身在 scheduleAccessService 的測試
jest.unstable_mockModule('../src/middleware/scheduleAccess.js', () => ({
  requireScheduleAccess: ({ allowRoles = [] } = {}) => (req, res, next) => (
    req.user && (allowRoles.includes(req.user.role) || req.user.canSchedule)
      ? next()
      : res.status(403).json({ error: 'Forbidden' })
  ),
}))
jest.unstable_mockModule('../src/middleware/supervisor.js', () => ({
  verifySupervisor: (req, res, next) => (req.user?.canSchedule ? next() : res.status(403).json({ error: 'Forbidden' })),
}))

const { default: scheduleRoutes } = await import('../src/routes/scheduleRoutes.js')
const { app: realApp } = await import('../src/index.js')

const plainEmployee = { id: 'e1', role: 'employee', canSchedule: false }
const scheduler = { id: 'e2', role: 'employee', canSchedule: true }

beforeEach(() => {
  Object.values(controllers).forEach((handler) => handler.mockClear())
})

describe('schedule export guard', () => {
  // 只掛 router、不經過 index.js 的路徑判斷：router 自己就要擋
  const routerOnly = express()
  routerOnly.use((req, _res, next) => {
    req.user = currentUser
    next()
  })
  routerOnly.use('/api/schedules', scheduleRoutes)

  it('refuses the export on the router itself for an employee without schedule access', async () => {
    currentUser = plainEmployee

    const res = await request(routerOnly).get('/api/schedules/export?month=2031-03')

    expect(res.status).toBe(403)
    expect(controllers.exportSchedules).not.toHaveBeenCalled()
  })

  it('still lets a scheduler export', async () => {
    currentUser = scheduler

    const res = await request(routerOnly).get('/api/schedules/export?month=2031-03')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ handler: 'exportSchedules' })
  })

  it.each([
    '/api/schedules/export',
    '/api/schedules/EXPORT',
    '/api/schedules/Export/',
    '/api/schedules/eXpOrT',
  ])('refuses %s through the real app for an employee without schedule access', async (path) => {
    currentUser = plainEmployee

    const res = await request(realApp).get(`${path}?month=2031-03`).set('Authorization', 'Bearer any')

    expect(res.status).toBe(403)
    expect(controllers.exportSchedules).not.toHaveBeenCalled()
  })

  it('never reaches the export handler through a percent-encoded path', async () => {
    currentUser = plainEmployee

    await request(realApp).get('/api/schedules/%65xport?month=2031-03').set('Authorization', 'Bearer any')
    await request(realApp).get('/api/schedules/e%78port?month=2031-03').set('Authorization', 'Bearer any')

    expect(controllers.exportSchedules).not.toHaveBeenCalled()
  })

  it('serves the export through the real app for a scheduler, and plain reads stay open to every employee', async () => {
    currentUser = scheduler
    expect((await request(realApp).get('/api/schedules/export?month=2031-03').set('Authorization', 'Bearer any')).status).toBe(200)

    currentUser = plainEmployee
    const monthly = await request(realApp).get('/api/schedules/monthly?month=2031-03').set('Authorization', 'Bearer any')
    expect(monthly.status).toBe(200)
    expect(monthly.body).toEqual({ handler: 'listMonthlySchedules' })
  })
})
