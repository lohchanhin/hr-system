import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

// Express 4 不會接住 async 處理函式丟出的錯誤：請求一直掛著，Node 把未處理的 rejection 當成致命錯誤，
// 整個服務直接結束。forwardAsyncErrors 把這些錯誤交給 apiErrorHandler（回 500），服務繼續運作。
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

const listRoles = jest.fn()

jest.unstable_mockModule('../src/controllers/roleController.js', () => ({ listRoles }))
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin' }
    next()
  },
  authorizeRoles: () => (_req, _res, next) => next(),
}))

const { apiErrorHandler, forwardAsyncErrors, requestContext } = await import('../src/middleware/httpSecurity.js')

let consoleError
const unhandled = []
const onUnhandled = (reason) => unhandled.push(reason)

beforeAll(() => {
  process.on('unhandledRejection', onUnhandled)
})

afterAll(() => {
  process.off('unhandledRejection', onUnhandled)
})

beforeEach(() => {
  unhandled.length = 0
  listRoles.mockReset()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

function buildApp(configure) {
  const app = express()
  app.use(requestContext)
  configure(app)
  app.use(apiErrorHandler)
  return forwardAsyncErrors(app)
}

describe('forwardAsyncErrors', () => {
  it('answers 500 with a request id when an async route handler rejects, without leaking the error', async () => {
    const app = buildApp((instance) => {
      const router = express.Router()
      router.get('/boom', async () => {
        throw new Error('Employee validation failed: gender: `女` is not a valid enum value')
      })
      instance.use('/api/things', router)
    })

    const res = await request(app).get('/api/things/boom')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error', requestId: expect.any(String) })
    expect(JSON.stringify(res.body)).not.toContain('gender')
    await settle()
    expect(unhandled).toEqual([])
  })

  it('also covers async middleware in front of a handler and routers nested in routers', async () => {
    const reached = jest.fn()
    const app = buildApp((instance) => {
      const inner = express.Router()
      inner.post(
        '/save',
        async () => {
          await Promise.resolve()
          throw new TypeError('db down')
        },
        (_req, res) => {
          reached()
          res.json({ ok: true })
        },
      )
      const outer = express.Router()
      outer.use('/inner', inner)
      instance.use('/api', outer)
    })

    const res = await request(app).post('/api/inner/save').send({})

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
    expect(reached).not.toHaveBeenCalled()
    await settle()
    expect(unhandled).toEqual([])
  })

  it('leaves working handlers alone (sync, async, and ones that call next)', async () => {
    const app = buildApp((instance) => {
      instance.get('/api/sync', (_req, res) => res.json({ kind: 'sync' }))
      instance.get('/api/async', async (_req, res) => res.json({ kind: 'async' }))
      instance.get('/api/chain', async (_req, _res, next) => next(), (_req, res) => res.json({ kind: 'chain' }))
    })

    expect((await request(app).get('/api/sync')).body).toEqual({ kind: 'sync' })
    expect((await request(app).get('/api/async')).body).toEqual({ kind: 'async' })
    expect((await request(app).get('/api/chain')).body).toEqual({ kind: 'chain' })
  })

  it('only logs when the handler rejects after the response was already sent', async () => {
    const app = buildApp((instance) => {
      instance.get('/api/late', async (_req, res) => {
        res.json({ ok: true })
        throw new Error('cleanup failed')
      })
    })

    const res = await request(app).get('/api/late')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    await settle()
    expect(unhandled).toEqual([])
    expect(consoleError).toHaveBeenCalledWith(
      'Unhandled rejection after response',
      expect.objectContaining({ error: 'Error' }),
    )
  })

  it('can be applied twice without wrapping handlers twice', async () => {
    const calls = jest.fn()
    const app = buildApp((instance) => {
      instance.get('/api/once', async (_req, res) => {
        calls()
        res.json({ ok: true })
      })
    })
    forwardAsyncErrors(app)

    const res = await request(app).get('/api/once')

    expect(res.status).toBe(200)
    expect(calls).toHaveBeenCalledTimes(1)
  })
})

describe('the real app (src/index.js)', () => {
  let app

  beforeAll(async () => {
    ;({ app } = await import('../src/index.js'))
  })

  it('turns a rejecting controller into a 500 JSON response instead of an unhandled rejection', async () => {
    listRoles.mockImplementation(async () => {
      throw new Error('connection lost')
    })

    const res = await request(app).get('/api/roles').set('Authorization', 'Bearer whatever')

    expect(listRoles).toHaveBeenCalled()
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error', requestId: expect.any(String) })
    await settle()
    expect(unhandled).toEqual([])
  })

  it('still serves the route normally when the controller succeeds', async () => {
    listRoles.mockImplementation(async (_req, res) => res.json(['employee', 'supervisor', 'admin']))

    const res = await request(app).get('/api/roles').set('Authorization', 'Bearer whatever')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(['employee', 'supervisor', 'admin'])
  })
})
