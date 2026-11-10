import '../config/env.js'
import crypto from 'crypto'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'

const slowRequestThresholdMs = (() => {
  const value = Number.parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS, 10)
  return Number.isInteger(value) && value > 0 ? value : 500
})()

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const rateLimitExceededResponse = (req, res) => {
  res.status(429).json({ error: 'Too many requests. Please slow down and try again later.', code: 'RATE_LIMITED', requestId: req.requestId })
}

// /api 底下的相對路徑：/employees/<id>/photo
const EMPLOYEE_PHOTO_PATH = /^\/employees\/[^/]+\/photo\/?$/

const VERIFIED_SUBJECT = Symbol('rateLimitSubject')

// token 簽章有效（未過期、issuer／audience 相符）時回傳帳號 id，其餘回傳 null。
// 只用來決定流量上限算在誰頭上，不代表已通過登入檢查（黑名單、帳號狀態仍由 authenticate 檢查）。
function verifiedTokenSubject(req) {
  if (req[VERIFIED_SUBJECT] !== undefined) return req[VERIFIED_SUBJECT]
  let subject = null
  const header = req.headers?.authorization
  const secret = process.env.JWT_SECRET
  if (typeof header === 'string' && secret) {
    const [scheme, token, extra] = header.trim().split(/\s+/)
    if (scheme?.toLowerCase() === 'bearer' && token && !extra) {
      try {
        const decoded = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          issuer: 'hr-system',
          audience: 'hr-system-api',
          clockTolerance: 5,
        })
        const id = decoded?.sub ?? decoded?.id
        if (typeof id === 'string' && id && id.length <= 64) subject = id
      } catch {
        subject = null
      }
    }
  }
  req[VERIFIED_SUBJECT] = subject
  return subject
}

/*
 * 流量上限算在誰頭上：已登入的請求以帳號計，沒登入（登入頁）或 token 無效／過期的請求以 IP 計。
 * 以前一律以 IP 計：同一個機構的員工共用一個對外 IP（院內 Wi-Fi、NAT），所有人合用每分鐘 60 次寫入、300 次請求，
 * 交班時段大家同時打卡，第 61 位開始就被擋下（429），一個人的操作也會讓其他同事連登入都不行。
 * 只認簽章驗證過的 token，所以不能靠偽造 token 換出無限多個額度。
 */
export function rateLimitKey(req) {
  const subject = verifiedTokenSubject(req)
  return subject ? `user:${subject}` : ipKeyGenerator(req.ip)
}

// Blanket safety net for every API call (GET included), so a single client
// can't hammer the server without limit. Generous by default — this is not
// meant to police normal usage, only clearly abusive traffic. Counted per
// signed-in account, or per IP when the request carries no valid token.
export const apiRateLimiter = rateLimit({
  windowMs: positiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  limit: positiveInteger(process.env.API_RATE_LIMIT_MAX, 300),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // 大頭照是頁面上每個頭像各一個請求（含 304），一頁幾十個；算進每分鐘 300 次會把同一個 IP 後面的人
  // 一起擋在門外（429）。照片路徑一定要登入，且回應是小檔案，不計入這個上限。
  skip: (req) => req.method === 'GET' && EMPLOYEE_PHOTO_PATH.test(req.path),
  keyGenerator: rateLimitKey,
  handler: rateLimitExceededResponse,
})

// Tighter limit on state-changing requests specifically (POST/PUT/PATCH/DELETE) --
// bulk imports, payroll recalculation, approval submissions, etc. -- since
// those are the ones that do real work per request and had no throttling at
// all before this (only /api/auth/login did).
export const apiMutationRateLimiter = rateLimit({
  windowMs: positiveInteger(process.env.API_MUTATION_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  limit: positiveInteger(process.env.API_MUTATION_RATE_LIMIT_MAX, 60),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
  keyGenerator: rateLimitKey,
  handler: rateLimitExceededResponse,
})

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

function hasOperatorKey(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false
  if (Array.isArray(value)) return value.some((item) => hasOperatorKey(item, depth + 1))
  return Object.keys(value).some((key) => key.startsWith('$') || hasOperatorKey(value[key], depth + 1))
}

/**
 * 查詢字串不接受 Mongo 運算子（?employee[$exists]=true、?department[$nin][]=...）。
 * Express 會把這種寫法解析成物件，原樣放進資料庫查詢條件就變成運算子：主管的打卡查詢
 * 用 ?employee[$gte]=<部屬的編號> 通過「這位員工是不是我的部屬」的檢查後，查到的卻是全公司的打卡記錄。
 * 沒有任何畫面會送出這種參數，一律回 400。
 */
export function rejectQueryOperators(req, res, next) {
  if (hasOperatorKey(req.query)) {
    return res.status(400).json({ error: 'Invalid query parameter', requestId: req.requestId })
  }
  return next()
}

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

/**
 * 查詢字串裡當作資料編號（ObjectId）用的參數：有帶就必須是 24 碼的編號，否則回 400。
 * 用在會把參數原樣放進查詢條件的清單 API，格式不對時不再回 500 與資料庫的錯誤訊息。
 */
export function requireObjectIdQuery(...names) {
  return (req, res, next) => {
    const invalid = names.find((name) => {
      const value = req.query?.[name]
      if (value === undefined || value === '') return false
      return typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)
    })
    if (invalid) {
      return res.status(400).json({ error: `Invalid ${invalid} filter`, requestId: req.requestId })
    }
    return next()
  }
}

export function disableApiCaching(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

const ASYNC_FORWARDED = Symbol('asyncErrorsForwarded')

function forwardRejection(handler) {
  if (typeof handler !== 'function' || handler.length > 3 || handler[ASYNC_FORWARDED]) return handler
  const wrapped = function forwardAsyncErrorsHandler(req, res, next) {
    const result = handler.call(this, req, res, next)
    if (result && typeof result.then === 'function') {
      result.then(undefined, (error) => {
        if (res.headersSent) {
          // 回應已經送出（例如送出後的收尾工作失敗）：只記錄，不能再回一次
          console.error('Unhandled rejection after response', {
            requestId: req.requestId,
            error: error?.name ?? 'Error',
          })
          return
        }
        next(error ?? new Error('Unhandled rejection'))
      })
    }
    return result
  }
  wrapped[ASYNC_FORWARDED] = true
  return wrapped
}

function forwardStack(stack) {
  if (!Array.isArray(stack)) return
  for (const layer of stack) {
    if (!layer) continue
    if (layer.route && Array.isArray(layer.route.stack)) {
      forwardStack(layer.route.stack)
    } else if (typeof layer.handle === 'function' && Array.isArray(layer.handle.stack)) {
      forwardStack(layer.handle.stack) // 子 router：往下處理它的每一層，本身不包
    } else {
      layer.handle = forwardRejection(layer.handle)
    }
  }
}

/**
 * Express 4 不會接住 async 處理函式丟出的錯誤（rejected promise）：請求會一直掛著，
 * 而 Node 預設把未處理的 rejection 當成致命錯誤，整個服務直接結束（所有人斷線，等 PM2 重啟）。
 * 所有路由掛好之後呼叫一次：把每個處理函式回傳的 promise 的錯誤交給 next()，
 * 由 apiErrorHandler 回 500（附 requestId），服務繼續運作。可以重複呼叫。
 */
export function forwardAsyncErrors(app) {
  forwardStack((app?._router ?? app?.router ?? app)?.stack)
  return app
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
