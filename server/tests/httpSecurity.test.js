import express from 'express'
import request from 'supertest'
import {
  apiErrorHandler,
  apiNotFound,
  disableApiCaching,
  rejectQueryOperators,
  requestContext,
  requireObjectIdQuery,
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

// 查詢字串的 Mongo 運算子：Express 把 ?employee[$exists]=true 解析成物件，原樣進到查詢條件就是運算子。
// 主管的打卡查詢曾因此在通過「是不是我的部屬」的檢查後查到全公司的打卡記錄。
describe('rejectQueryOperators', () => {
  const guarded = express()
  guarded.use(requestContext)
  guarded.use('/api', rejectQueryOperators)
  guarded.get('/api/list', (req, res) => res.json({ query: req.query }))

  test.each([
    'employee[$exists]=true',
    'employee[$gte]=64b000000000000000000001',
    'employee[$ne]=x',
    'department[$nin][]=64b000000000000000000001',
    'department[$in][]=a&department[$in][]=b',
    'filter[employee][$regex]=.*',
    'ids[][$gt]=',
    '$where=1',
  ])('answers 400 for ?%s', async (query) => {
    const response = await request(guarded).get(`/api/list?${query}`)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Invalid query parameter', requestId: expect.any(String) })
  })

  test('lets ordinary parameters through, including repeated values and a $ inside a value', async () => {
    const response = await request(guarded)
      .get('/api/list?month=2026-11&employee=64b000000000000000000001&ids[]=a&ids[]=b&q=%24100&page=2')

    expect(response.status).toBe(200)
    expect(response.body.query).toEqual({
      month: '2026-11',
      employee: '64b000000000000000000001',
      ids: ['a', 'b'],
      q: '$100',
      page: '2',
    })
  })
})

describe('requireObjectIdQuery', () => {
  const guarded = express()
  guarded.use(requestContext)
  guarded.get('/api/list', requireObjectIdQuery('organization', 'department'), (req, res) => res.json({ ok: true }))

  test('accepts a missing, empty or well-formed id', async () => {
    expect((await request(guarded).get('/api/list')).status).toBe(200)
    expect((await request(guarded).get('/api/list?organization=')).status).toBe(200)
    expect((await request(guarded).get('/api/list?organization=64b000000000000000000001&department=64B00000000000000000000A')).status).toBe(200)
  })

  test('answers 400 naming the parameter when it is not an id', async () => {
    const response = await request(guarded).get('/api/list?organization=64b000000000000000000001&department=zzz')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Invalid department filter', requestId: expect.any(String) })
    expect((await request(guarded).get('/api/list?organization[]=a&organization[]=b')).status).toBe(400)
  })
})
