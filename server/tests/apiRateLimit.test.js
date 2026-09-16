import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

// Small limits so the tests trip the limiter in a handful of requests
// instead of hundreds. Must be set before httpSecurity.js is imported, since
// the limiters read these env vars once at module-load time.
process.env.API_RATE_LIMIT_MAX = '3'
process.env.API_RATE_LIMIT_WINDOW_MS = '60000'
process.env.API_MUTATION_RATE_LIMIT_MAX = '2'
process.env.API_MUTATION_RATE_LIMIT_WINDOW_MS = '60000'

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
  app.post('/api/echo', (req, res) => res.json({ ok: true }))
  return app
}

describe('API rate limiting', () => {
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
})
