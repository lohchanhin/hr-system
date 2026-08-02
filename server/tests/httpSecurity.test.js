import express from 'express'
import request from 'supertest'
import {
  apiErrorHandler,
  apiNotFound,
  disableApiCaching,
  requestContext,
  secureHttpHeaders,
} from '../src/middleware/httpSecurity.js'

const app = express()
app.disable('x-powered-by')
app.use(requestContext)
app.use(secureHttpHeaders)
app.use(express.json({ limit: '1kb' }))
app.use('/api', disableApiCaching)
app.post('/api/echo', (req, res) => res.json(req.body))
app.use('/api', apiNotFound)
app.use(apiErrorHandler)

test('sets browser security headers and disables API caching', async () => {
  const response = await request(app).post('/api/echo').send({ ok: true })

  expect(response.status).toBe(200)
  expect(response.headers['x-powered-by']).toBeUndefined()
  expect(response.headers['content-security-policy']).toContain("default-src 'self'")
  expect(response.headers['x-content-type-options']).toBe('nosniff')
  expect(response.headers['x-frame-options']).toBe('SAMEORIGIN')
  expect(response.headers['referrer-policy']).toBe('no-referrer')
  expect(response.headers['permissions-policy']).toContain('camera=()')
  expect(response.headers['cache-control']).toBe('no-store')
  expect(response.headers['x-request-id']).toBeDefined()
})

test('returns a generic JSON error for malformed JSON', async () => {
  const response = await request(app)
    .post('/api/echo')
    .set('Content-Type', 'application/json')
    .send('{')

  expect(response.status).toBe(400)
  expect(response.body).toMatchObject({ error: 'Invalid request body' })
  expect(response.body.requestId).toBeDefined()
})

test('rejects an oversized body without leaking parser details', async () => {
  const response = await request(app)
    .post('/api/echo')
    .send({ value: 'x'.repeat(2048) })

  expect(response.status).toBe(413)
  expect(response.body).toMatchObject({ error: 'Request body too large' })
})

test('returns a consistent JSON 404 for unknown API routes', async () => {
  const response = await request(app).get('/api/unknown')

  expect(response.status).toBe(404)
  expect(response.body).toMatchObject({ error: 'Not found' })
  expect(response.body.requestId).toBeDefined()
})
