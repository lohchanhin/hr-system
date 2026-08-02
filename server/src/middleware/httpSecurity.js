import '../config/env.js'
import crypto from 'crypto'
import helmet from 'helmet'

const slowRequestThresholdMs = (() => {
  const value = Number.parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS, 10)
  return Number.isInteger(value) && value > 0 ? value : 500
})()

export function configureTrustProxy(app) {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10)
  if (Number.isInteger(hops) && hops >= 1 && hops <= 10) {
    app.set('trust proxy', hops)
  }
}

export const secureHttpHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: process.env.ENABLE_HSTS === 'true'
    ? { maxAge: 31_536_000, includeSubDomains: true }
    : false,
  referrerPolicy: { policy: 'no-referrer' },
})

export function requestContext(req, res, next) {
  const requestId = crypto.randomUUID()
  const startedAt = process.hrtime.bigint()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  res.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()'
  )

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    if (durationMs >= slowRequestThresholdMs) {
      console.warn('Slow request', {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      })
    }
  })

  next()
}

export function disableApiCaching(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

export function apiNotFound(req, res) {
  res.status(404).json({ error: 'Not found', requestId: req.requestId })
}

export function apiErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)

  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large', requestId: req.requestId })
  }
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid request body', requestId: req.requestId })
  }

  console.error('Unhandled request error', {
    requestId: req.requestId,
    error: error?.name ?? 'Error',
  })
  return res.status(500).json({ error: 'Internal server error', requestId: req.requestId })
}
