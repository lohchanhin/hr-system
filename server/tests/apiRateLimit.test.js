import { jest } from '@jest/globals'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'

// Small limits so the tests trip the limiter in a handful of requests
// instead of hundreds. Must be set before httpSecurity.js is imported, since
// the limiters read these env vars once at module-load time.
process.env.API_RATE_LIMIT_MAX = '3'
process.env.API_RATE_LIMIT_WINDOW_MS = '60000'
process.env.API_MUTATION_RATE_LIMIT_MAX = '2'
process.env.API_MUTATION_RATE_LIMIT_WINDOW_MS = '60000'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

const tokenFor = (id, { secret = process.env.JWT_SECRET, expiresIn = '1h' } = {}) => jwt.sign(
  { id, sub: id, role: 'employee', ver: 0 },
  secret,
  { issuer: 'hr-system', audience: 'hr-system-api', expiresIn },
)
const bearer = (token) => ({ Authorization: `Bearer ${token}` })

// Each test gets a fresh module instance (via resetModules + a dynamic
// import) so the in-memory rate-limit counters don't carry over between
// tests -- all requests here come from the same supertest client "IP", so a
// shared limiter instance would let earlier tests exhaust later ones' quota.
async function buildApp() {
  jest.resetModules()
  const { apiRateLimiter, apiMutationRateLimiter } = await import('../src/middleware/httpSecurity.js')
  const app = express()
  app.use(express.json())
  app.use('/api', apiRateLimiter)
  app.use('/api', apiMutationRateLimiter)
  app.get('/api/ping', (req, res) => res.json({ ok: true }))
  app.get('/api/employees/:id/photo', (req, res) => res.json({ ok: true }))
  app.post('/api/echo', (req, res) => res.json({ ok: true }))
  return app
}

describe('API rate limiting', () => {
  it('does not count employee photo requests (one per avatar) against the general limit, and still limits everything else', async () => {
    const app = await buildApp()

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).get('/api/employees/abc123/photo')
      expect(res.status).toBe(200)
    }
    // 照片請求不佔額度：一般請求仍然有完整的 3 次
    const statuses = []
    for (let i = 0; i < 4; i += 1) statuses.push((await request(app).get('/api/ping')).status)
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('allows GET requests up to the general limit, then returns 429', async () => {
    const app = await buildApp()

    const first = await request(app).get('/api/ping')
    const second = await request(app).get('/api/ping')
    const third = await request(app).get('/api/ping')
    const fourth = await request(app).get('/api/ping')

    expect([first.status, second.status, third.status]).toEqual([200, 200, 200])
    expect(fourth.status).toBe(429)
    expect(fourth.body).toMatchObject({ error: expect.stringContaining('Too many requests') })
  })

  it('throttles state-changing requests at a tighter limit than plain GETs', async () => {
    const app = await buildApp()

    const first = await request(app).post('/api/echo').send({})
    const second = await request(app).post('/api/echo').send({})
    const third = await request(app).post('/api/echo').send({})

    // Mutation limit is 2/window, stricter than the general 3/window limit,
    // so the 3rd POST is rejected even though the general limiter alone
    // would still have one request of headroom left.
    expect([first.status, second.status]).toEqual([200, 200])
    expect(third.status).toBe(429)
  })

  it('does not count GET requests against the mutation-only limit', async () => {
    const app = await buildApp()

    // A GET (unaffected by the mutation limiter) followed by 2 POSTs (right
    // at the mutation limit) should all succeed independently.
    const getRes = await request(app).get('/api/ping')
    const postOne = await request(app).post('/api/echo').send({})
    const postTwo = await request(app).post('/api/echo').send({})

    expect(getRes.status).toBe(200)
    expect(postOne.status).toBe(200)
    expect(postTwo.status).toBe(200)
  })

  // 同一個機構的員工共用一個對外 IP（院內 Wi-Fi／NAT）：以前所有人合用同一份額度，
  // 一位同事用完每分鐘的寫入次數，其他人打卡就被擋下（429）
  it('counts signed-in requests per account, so one account using up its quota does not block a colleague behind the same IP', async () => {
    const app = await buildApp()
    const nurseA = bearer(tokenFor('aaaaaaaaaaaaaaaaaaaaaaaa'))
    const nurseB = bearer(tokenFor('bbbbbbbbbbbbbbbbbbbbbbbb'))

    const writesA = []
    for (let i = 0; i < 3; i += 1) writesA.push((await request(app).post('/api/echo').set(nurseA).send({})).status)
    expect(writesA).toEqual([200, 200, 429])

    // 同一個 IP 的另一個帳號：寫入與讀取的額度都還是完整的
    const writesB = []
    for (let i = 0; i < 3; i += 1) writesB.push((await request(app).post('/api/echo').set(nurseB).send({})).status)
    expect(writesB).toEqual([200, 200, 429])

    // 沒登入的請求（登入頁）另外以 IP 計，不受上面兩個帳號影響
    expect((await request(app).post('/api/echo').send({})).status).toBe(200)
  })

  it('still limits each account on its own', async () => {
    const app = await buildApp()
    const nurseA = bearer(tokenFor('aaaaaaaaaaaaaaaaaaaaaaaa'))

    const statuses = []
    for (let i = 0; i < 4; i += 1) statuses.push((await request(app).get('/api/ping').set(nurseA)).status)
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('does not hand out a fresh quota for tokens that are forged, expired or malformed: those are counted by IP', async () => {
    const app = await buildApp()
    const headers = [
      bearer(tokenFor('cccccccccccccccccccccccc', { secret: 'some-other-secret-that-is-not-the-server-secret' })),
      bearer(tokenFor('dddddddddddddddddddddddd', { secret: 'yet-another-secret-that-is-not-the-server-one' })),
      bearer(tokenFor('eeeeeeeeeeeeeeeeeeeeeeee', { expiresIn: -60 })),
      bearer('not-a-jwt'),
    ]

    const statuses = []
    for (const header of headers) statuses.push((await request(app).get('/api/ping').set(header)).status)
    // 一般請求的上限是 3：四個不同的假 token 共用同一個 IP 的額度，第四個被擋下
    expect(statuses).toEqual([200, 200, 200, 429])
  })
})
