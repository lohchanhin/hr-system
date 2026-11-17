import '../config/env.js'
import { Router } from 'express'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import Employee from '../models/Employee.js'
import RefreshToken from '../models/RefreshToken.js'
import { blacklistToken } from '../utils/tokenBlacklist.js'
import { authenticate } from '../middleware/auth.js'
import { getScheduleAccessSummary } from '../services/scheduleAccessService.js'
import { ALL_ROLES, BACKOFFICE_ROLES, getPermissionsForRole } from '../config/rbac.js'
import {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotp,
} from '../services/totpService.js'
import { recordAuditEvent } from '../services/auditService.js'
import { getSettings as getOtherControlSettings } from '../services/otherControlSettingsStore.js'

const router = Router();
const JWT_OPTIONS = {
  issuer: 'hr-system',
  audience: 'hr-system-api',
}
const INACTIVE_EMPLOYMENT_STATUSES = new Set(['離職員工', '留職停薪'])
const LOGIN_ROLES = ALL_ROLES
const REFRESH_COOKIE_NAME = 'hr_refresh_token'
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const loginRateLimitResponse = (_req, res) => {
  res.status(429).json({ error: 'Too many login attempts. Please try again later.' })
}

const loginIpRateLimiter = rateLimit({
  windowMs: positiveInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  limit: positiveInteger(process.env.LOGIN_RATE_LIMIT_IP_MAX, 50),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: loginRateLimitResponse,
})

const loginAccountRateLimiter = rateLimit({
  windowMs: positiveInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  limit: positiveInteger(process.env.LOGIN_RATE_LIMIT_ACCOUNT_MAX, 5),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const username = typeof req.body?.username === 'string'
      ? req.body.username.trim().toLowerCase().slice(0, 100)
      : '<invalid>'
    return `${ipKeyGenerator(req.ip)}:${username}`
  },
  handler: loginRateLimitResponse,
})

// 舊密碼打錯的次數上限（以帳號計，不看 IP）：拿到別人沒登出的畫面或 token 的人，不能用這支 API 一直猜密碼。
// 只計「舊密碼不正確」的嘗試；變更成功、新密碼格式不符都不算。
const changePasswordRateLimiter = rateLimit({
  windowMs: positiveInteger(process.env.CHANGE_PASSWORD_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  limit: positiveInteger(process.env.CHANGE_PASSWORD_RATE_LIMIT_MAX, 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.locals.oldPasswordRejected !== true,
  keyGenerator: (req) => `change-password:${req.user?.id ?? ipKeyGenerator(req.ip)}`,
  handler: (_req, res) => {
    res.status(429).json({ error: '舊密碼錯誤次數過多，請稍後再試' })
  },
})

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') return '密碼不可為空'
  if (password.length < 8) return '密碼長度需至少 8 碼'
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /\d/.test(password)
  if (!(hasUpper && hasLower && hasNumber)) {
    return '密碼需包含大小寫字母與數字'
  }
  return null
}

function buildUserProfile(employee) {
  if (!employee) return null

  const getName = (entity) => {
    if (!entity || typeof entity !== 'object') return ''
    if ('name' in entity && entity.name) return entity.name
    if ('unitName' in entity && entity.unitName) return entity.unitName
    return ''
  }

  const department = employee.department
  const subDepartment = employee.subDepartment

  const organizationDoc =
    department && typeof department === 'object' && 'organization' in department
      ? department.organization
      : null

  const organizationName =
    (organizationDoc &&
    typeof organizationDoc === 'object' &&
    'name' in organizationDoc
      ? organizationDoc.name ?? ''
      : '') || department?.unitName || employee.organization || ''

  const idString = employee._id?.toString?.() ?? employee.id ?? ''
  const employeeNumber = employee.employeeId ? String(employee.employeeId) : ''

  return {
    id: idString,
    employeeId: idString,
    employeeNumber,
    role: employee.role,
    permissions: getPermissionsForRole(employee.role),
    twoFactorEnabled: Boolean(employee.twoFactor?.enabled),
    username: employee.username,
    name: employee.name ?? '',
    photo: employee.photo ?? '',
    organizationName,
    departmentName: getName(department),
    subDepartmentName: getName(subDepartment),
  }
}

// 排班權限（前台用來決定要不要顯示排班頁與選單）：被指定為排班人員的員工任何角色都能排班。
// 讀不到時回傳 null 不附上，前台退回依角色判斷；各排班 API 仍會再檢查
async function buildScheduleAccessProfile(employee) {
  try {
    const access = await getScheduleAccessSummary({ id: employee?._id ?? employee?.id, role: employee?.role })
    return {
      canSchedule: access.canSchedule,
      supervisorScope: access.supervisorScope,
      subDepartmentIds: access.subDepartmentIds,
      departmentIds: access.departmentIds,
      wholeDepartmentIds: access.wholeDepartmentIds,
    }
  } catch (error) {
    console.error('Failed to resolve schedule access for profile', { error: error?.name ?? 'Error' })
    return null
  }
}

async function withScheduleAccess(profile, employee) {
  if (!profile) return profile
  const scheduleAccess = await buildScheduleAccessProfile(employee)
  return scheduleAccess ? { ...profile, scheduleAccess } : profile
}

function parseCookies(req) {
  const header = req.headers?.cookie
  if (!header || typeof header !== 'string') return {}
  const cookies = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val)
      } catch {
        cookies[key] = val
      }
    }
  }
  return cookies
}

function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex')
}

/*
 * 續期 cookie 只有在 HTTPS 才加 Secure：以前 NODE_ENV=production 就一律 Secure，正式站目前是 http://，
 * 瀏覽器不存 Secure cookie，續期永遠失敗，登入 15 分鐘（access token 到期）就被踢回登入頁。
 * 經過反向代理的 HTTPS 要設 TRUST_PROXY 讓 req.secure 正確，或直接設 COOKIE_SECURE=true。
 */
function setRefreshCookie(res, req, rawToken) {
  const isSecure = Boolean(req?.secure || process.env.COOKIE_SECURE === 'true')
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/api',
    maxAge: REFRESH_TTL_MS,
  })
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api' })
}

function signAccessToken(employee) {
  const employeeId = employee._id?.toString?.() ?? String(employee._id)
  return jwt.sign(
    {
      id: employeeId,
      sub: employeeId,
      role: employee.role,
      ver: Number(employee.authVersion ?? 0),
    },
    process.env.JWT_SECRET,
    // jwtid：同一秒內重複登入也拿到不同的 token，登出其中一個不會連帶作廢另一個
    { ...JWT_OPTIONS, expiresIn: process.env.ACCESS_TOKEN_TTL || '15m', jwtid: crypto.randomUUID() }
  )
}

// 換發後這段時間內再拿舊 token 來續期，當成同一個瀏覽器的重複請求（多分頁同時續期），不整串作廢
const REFRESH_REUSE_GRACE_MS = 60 * 1000

function isRecentRotation(token) {
  const revokedAt = token?.revokedAt ? new Date(token.revokedAt).getTime() : 0
  return Boolean(token?.replacedByHash) && revokedAt > 0 && Date.now() - revokedAt < REFRESH_REUSE_GRACE_MS
}

/** 作廢這位員工所有的續期 token（改密碼後其他裝置都要重新登入）；失敗只記錄 */
async function revokeEmployeeRefreshTokens(employeeId) {
  if (!employeeId) return
  try {
    await RefreshToken.updateMany({ employee: employeeId, revokedAt: null }, { $set: { revokedAt: new Date() } })
  } catch (err) {
    console.error('Revoke refresh tokens failed', { error: err?.name || 'Error' })
  }
}

async function issueRefreshToken(employee, req, existingFamilyId = null, presetRawToken = null) {
  const rawToken = presetRawToken || crypto.randomBytes(48).toString('hex')
  const tokenHash = hashRefreshToken(rawToken)
  const familyId = existingFamilyId || crypto.randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
  const canPersist = mongoose.connection.readyState === 1 || typeof RefreshToken.create?.mock === 'object'
  if (canPersist) {
    try {
      await RefreshToken.create({
        employee: employee._id ?? employee.id,
        tokenHash,
        familyId,
        expiresAt,
        // 改密碼、改權限或停用帳號時登入版本會加一：續期時比對，版本不同就不再發新的 token
        authVersion: Number(employee.authVersion ?? 0),
        userAgent: typeof req?.get === 'function' ? req.get('user-agent') || '' : '',
        ip: req?.ip || '',
      })
    } catch (err) {
      // Allow unit tests with mocked Employee & no MongoDB connection to proceed gracefully
      if (process.env.NODE_ENV !== 'test') {
        throw err
      }
    }
  }
  return { rawToken, tokenHash, familyId }
}

async function getSecuritySignals(employee) {
  let twoFactorSetupRequired = false
  let passwordExpired = false
  const canQuerySettings = mongoose.connection.readyState === 1 || typeof getOtherControlSettings?.mock === 'object'
  if (!canQuerySettings) {
    return { twoFactorSetupRequired, passwordExpired }
  }
  try {
    const settings = await getOtherControlSettings()
    const security = settings?.security || {}
    if (security.enforce2FA && BACKOFFICE_ROLES.includes(employee.role) && !employee.twoFactor?.enabled) {
      twoFactorSetupRequired = true
    }
    if (security.passwordExpiration && Number(security.passwordExpireDays) > 0 && employee.passwordChangedAt) {
      const expireMs = Number(security.passwordExpireDays) * 24 * 60 * 60 * 1000
      if (Date.now() - new Date(employee.passwordChangedAt).getTime() > expireMs) {
        passwordExpired = true
      }
    }
  } catch {
    // Non-blocking fallback when settings store is unavailable in unit tests
  }
  return { twoFactorSetupRequired, passwordExpired }
}

router.post('/login', loginIpRateLimiter, loginAccountRateLimiter, async (req, res) => {
  try {
    const { username, password, role } = req.body ?? {}
    const normalizedUsername = typeof username === 'string' ? username.trim() : ''
    // role 可以不帶（2026/11 起登入頁不再讓使用者自己選角色）：沒帶就以帳號本身的角色登入；
    // 有帶（舊版前端、驗證腳本）維持原本的檢查——必須是有效角色且與帳號的角色相符
    const roleProvided = role !== undefined
    const validRole = !roleProvided || LOGIN_ROLES.includes(role)
    if (
      !normalizedUsername ||
      normalizedUsername.length > 100 ||
      typeof password !== 'string' ||
      !password ||
      password.length > 1024 ||
      !validRole
    ) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const employee = await Employee.findOne({ username: normalizedUsername }).select('+passwordHash')
    const activeAccount =
      employee?.accountEnabled !== false &&
      !INACTIVE_EMPLOYMENT_STATUSES.has(employee?.status)
    if (
      !employee ||
      !activeAccount ||
      !employee.verifyPassword(password) ||
      !LOGIN_ROLES.includes(employee.role) ||
      (roleProvided && role !== employee.role)
    ) {
      await recordAuditEvent({
        req,
        actor: { id: employee?._id ? String(employee._id) : '', username: normalizedUsername, role: employee?.role || '' },
        action: 'AUTH_LOGIN_FAILED',
        resourceType: 'Employee',
        resourceId: employee?._id ? String(employee._id) : '',
        status: 'denied',
      })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (typeof employee.populate === 'function') {
      try {
        await employee.populate([
          { path: 'department', populate: { path: 'organization' } },
          { path: 'subDepartment' },
        ])
      } catch {
        // Optional profile population must not interrupt a valid login.
      }
    }

    const employeeId = employee._id?.toString?.() ?? String(employee._id)

    if (employee.twoFactor?.enabled) {
      const challengeToken = jwt.sign(
        {
          id: employeeId,
          sub: employeeId,
          role: employee.role,
          ver: Number(employee.authVersion ?? 0),
          purpose: '2fa_challenge',
        },
        process.env.JWT_SECRET,
        { ...JWT_OPTIONS, expiresIn: '5m', jwtid: crypto.randomUUID() }
      )
      return res.json({
        requires2fa: true,
        challengeToken,
        user: { id: employeeId, role: employee.role, username: employee.username, name: employee.name ?? '' },
      })
    }

    const profile = await withScheduleAccess(buildUserProfile(employee), employee)
    const token = signAccessToken(employee)
    const { rawToken } = await issueRefreshToken(employee, req)
    setRefreshCookie(res, req, rawToken)
    const signals = await getSecuritySignals(employee)

    await recordAuditEvent({
      req,
      actor: { id: employeeId, username: employee.username || '', role: employee.role },
      action: 'AUTH_LOGIN_SUCCESS',
      resourceType: 'Employee',
      resourceId: employeeId,
      status: 'success',
    })

    return res.json({
      token,
      user: profile,
      ...(signals.twoFactorSetupRequired ? { twoFactorSetupRequired: true } : {}),
      ...(signals.passwordExpired ? { passwordExpired: true } : {}),
    })
  } catch (error) {
    console.error('Login failed', { error: error?.name ?? 'Error' })
    return res.status(500).json({ error: 'Unable to sign in' })
  }
})

router.post('/auth/2fa/setup', authenticate, async (req, res) => {
  try {
    const employee = await Employee.findById(req.user.id).select('+twoFactor.secretEncrypted')
    if (!employee) return res.status(404).json({ error: '找不到使用者' })
    const secret = generateTotpSecret()
    employee.twoFactor = {
      ...(employee.twoFactor || {}),
      enabled: Boolean(employee.twoFactor?.enabled),
      secretEncrypted: encryptTotpSecret(secret),
    }
    await employee.save({ validateModifiedOnly: true })
    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: employee.username || employee.email || String(employee._id),
    })
    return res.json({ secret, otpauthUrl })
  } catch (err) {
    console.error('2FA setup failed', { error: err?.name || 'Error' })
    return res.status(500).json({ error: '無法產生 2FA 設定' })
  }
})

router.post('/auth/2fa/confirm', authenticate, async (req, res) => {
  try {
    const { code } = req.body ?? {}
    const employee = await Employee.findById(req.user.id).select('+twoFactor.secretEncrypted +twoFactor.backupCodesHash')
    if (!employee) return res.status(404).json({ error: '找不到使用者' })
    const secret = decryptTotpSecret(employee.twoFactor?.secretEncrypted)
    if (!secret || !verifyTotp(secret, code)) {
      return res.status(400).json({ error: '驗證碼無效或已過期' })
    }
    const backupCodes = generateBackupCodes(8)
    employee.twoFactor.enabled = true
    employee.twoFactor.verifiedAt = new Date()
    employee.twoFactor.backupCodesHash = backupCodes.map(hashBackupCode)
    await employee.save({ validateModifiedOnly: true })

    await recordAuditEvent({
      req,
      action: 'AUTH_2FA_ENABLED',
      resourceType: 'Employee',
      resourceId: String(employee._id),
      status: 'success',
    })
    return res.json({ enabled: true, backupCodes })
  } catch (err) {
    console.error('2FA confirm failed', { error: err?.name || 'Error' })
    return res.status(500).json({ error: '啟用 2FA 失敗' })
  }
})

router.post('/auth/2fa/verify', async (req, res) => {
  try {
    const { challengeToken, code } = req.body ?? {}
    if (!challengeToken || !code) {
      return res.status(400).json({ error: '請提供驗證資訊與驗證碼' })
    }
    let decoded
    try {
      decoded = jwt.verify(challengeToken, process.env.JWT_SECRET, {
        ...JWT_OPTIONS,
        algorithms: ['HS256'],
        clockTolerance: 5,
      })
    } catch {
      return res.status(401).json({ error: '驗證已逾時，請重新登入' })
    }
    if (decoded?.purpose !== '2fa_challenge') {
      return res.status(401).json({ error: 'Invalid challenge token' })
    }

    const employee = await Employee.findById(decoded.sub || decoded.id)
      .select('+twoFactor.secretEncrypted +twoFactor.backupCodesHash')
    if (
      !employee ||
      employee.accountEnabled === false ||
      INACTIVE_EMPLOYMENT_STATUSES.has(employee.status) ||
      Number(employee.authVersion ?? 0) !== Number(decoded.ver ?? 0)
    ) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const secret = decryptTotpSecret(employee.twoFactor?.secretEncrypted)
    let verified = secret ? verifyTotp(secret, code) : false
    let usedBackupCode = false
    if (!verified && Array.isArray(employee.twoFactor?.backupCodesHash)) {
      const codeHash = hashBackupCode(code)
      const idx = employee.twoFactor.backupCodesHash.indexOf(codeHash)
      if (idx !== -1) {
        verified = true
        usedBackupCode = true
        employee.twoFactor.backupCodesHash.splice(idx, 1)
        await employee.save({ validateModifiedOnly: true })
      }
    }

    if (!verified) {
      await recordAuditEvent({
        req,
        actor: { id: String(employee._id), username: employee.username || '', role: employee.role },
        action: 'AUTH_2FA_FAILED',
        resourceType: 'Employee',
        resourceId: String(employee._id),
        status: 'denied',
      })
      return res.status(401).json({ error: '驗證碼不正確' })
    }

    if (typeof employee.populate === 'function') {
      try {
        await employee.populate([
          { path: 'department', populate: { path: 'organization' } },
          { path: 'subDepartment' },
        ])
      } catch {
        // Optional profile population
      }
    }

    const profile = await withScheduleAccess(buildUserProfile(employee), employee)
    const token = signAccessToken(employee)
    const { rawToken } = await issueRefreshToken(employee, req)
    setRefreshCookie(res, req, rawToken)
    const signals = await getSecuritySignals(employee)

    await recordAuditEvent({
      req,
      actor: { id: String(employee._id), username: employee.username || '', role: employee.role },
      action: 'AUTH_LOGIN_SUCCESS',
      resourceType: 'Employee',
      resourceId: String(employee._id),
      status: 'success',
      summary: { twoFactor: true, usedBackupCode },
    })

    return res.json({
      token,
      user: profile,
      ...(signals.passwordExpired ? { passwordExpired: true } : {}),
    })
  } catch (err) {
    console.error('2FA verify failed', { error: err?.name || 'Error' })
    return res.status(500).json({ error: '2FA 驗證失敗' })
  }
})

router.post('/auth/2fa/disable', authenticate, async (req, res) => {
  try {
    const { password, code } = req.body ?? {}
    const employee = await Employee.findById(req.user.id).select('+passwordHash +twoFactor.secretEncrypted +twoFactor.backupCodesHash')
    if (!employee) return res.status(404).json({ error: '找不到使用者' })

    const passwordOk = password ? employee.verifyPassword(password) : false
    const secret = decryptTotpSecret(employee.twoFactor?.secretEncrypted)
    const totpOk = code && secret ? verifyTotp(secret, code) : false
    if (!passwordOk && !totpOk) {
      return res.status(400).json({ error: '請提供正確的密碼或 2FA 驗證碼' })
    }

    employee.twoFactor = {
      enabled: false,
      secretEncrypted: undefined,
      backupCodesHash: [],
      verifiedAt: undefined,
    }
    await employee.save({ validateModifiedOnly: true })

    await recordAuditEvent({
      req,
      action: 'AUTH_2FA_DISABLED',
      resourceType: 'Employee',
      resourceId: String(employee._id),
      status: 'success',
    })
    return res.json({ enabled: false })
  } catch (err) {
    console.error('2FA disable failed', { error: err?.name || 'Error' })
    return res.status(500).json({ error: '停用 2FA 失敗' })
  }
})

router.post('/auth/refresh', async (req, res) => {
  try {
    const cookies = parseCookies(req)
    const rawToken = cookies[REFRESH_COOKIE_NAME]
    if (!rawToken) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const tokenHash = hashRefreshToken(rawToken)
    const existing = await RefreshToken.findOne({ tokenHash })
    if (!existing) {
      clearRefreshCookie(res)
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (existing.revokedAt && isRecentRotation(existing)) {
      // 剛換過（同一個瀏覽器另一個分頁同時續期、或上一次的回應沒收到）：不當成被盜用，也不清 cookie，
      // 瀏覽器已經存了新的 cookie，前端重新讀取另一個分頁拿到的 token 或再試一次
      return res.status(401).json({ error: 'Refresh token already rotated', code: 'REFRESH_ROTATED' })
    }

    // Reuse detection: if an already-revoked/rotated token is presented, revoke entire family
    if (existing.revokedAt) {
      await RefreshToken.updateMany(
        { familyId: existing.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      )
      await recordAuditEvent({
        req,
        actor: { id: String(existing.employee), username: '', role: '' },
        action: 'AUTH_REFRESH_REUSE_DETECTED',
        resourceType: 'RefreshToken',
        resourceId: existing.familyId,
        status: 'denied',
      })
      clearRefreshCookie(res)
      return res.status(401).json({ error: 'Session revoked due to token reuse' })
    }

    if (existing.expiresAt <= new Date()) {
      clearRefreshCookie(res)
      return res.status(401).json({ error: 'Refresh token expired' })
    }

    const employee = await Employee.findById(existing.employee)
    const activeAccount =
      employee &&
      employee.accountEnabled !== false &&
      !INACTIVE_EMPLOYMENT_STATUSES.has(employee.status)
    // 改了密碼、權限或停用過帳號（登入版本變了）：這一串續期全部作廢，要重新登入
    const versionChanged =
      employee && existing.authVersion != null && Number(existing.authVersion) !== Number(employee.authVersion ?? 0)
    if (!activeAccount || versionChanged) {
      await RefreshToken.updateMany(
        { familyId: existing.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      )
      clearRefreshCookie(res)
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // 先以「比對再改」佔用這個 token（只有還沒作廢的才改得到）：兩個請求同時續期時只有一個成功，
    // 另一個當成「剛換過」，不會兩個都發新 token、也不會被誤判成盜用而整串作廢
    const nextRawToken = crypto.randomBytes(48).toString('hex')
    const nextHash = hashRefreshToken(nextRawToken)
    const claimed = await RefreshToken.findOneAndUpdate(
      { _id: existing._id, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedByHash: nextHash } },
      { new: true }
    )
    if (!claimed) {
      return res.status(401).json({ error: 'Refresh token already rotated', code: 'REFRESH_ROTATED' })
    }
    await issueRefreshToken(employee, req, existing.familyId, nextRawToken)
    setRefreshCookie(res, req, nextRawToken)

    const token = signAccessToken(employee)
    return res.json({ token })
  } catch (err) {
    console.error('Refresh token failed', { error: err?.name || 'Error' })
    return res.status(500).json({ error: 'Unable to refresh session' })
  }
})

/** 登出時作廢瀏覽器帶來的續期 cookie 那一串；不需要有效的 access token（過期後才按登出也要作廢） */
async function revokeRefreshFamilyFromCookie(req) {
  const rawRefresh = parseCookies(req)[REFRESH_COOKIE_NAME]
  if (!rawRefresh) return false
  try {
    const found = RefreshToken.findOne({ tokenHash: hashRefreshToken(rawRefresh) })
    const stored = typeof found?.lean === 'function' ? await found.lean() : await found
    if (!stored?.familyId) return false
    await RefreshToken.updateMany({ familyId: stored.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } })
    return true
  } catch {
    // Non-blocking in unit tests without MongoDB
    return false
  }
}

router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization
  const [scheme, token, extra] = typeof auth === 'string' ? auth.trim().split(/\s+/) : []
  const hasBearer = scheme?.toLowerCase() === 'bearer' && Boolean(token) && !extra
  if (!hasBearer) {
    // access token 已過期被清掉、只剩續期 cookie：一樣作廢續期，否則登出後還能續期回來
    const revoked = await revokeRefreshFamilyFromCookie(req)
    clearRefreshCookie(res)
    return revoked ? res.status(204).end() : res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    try {
      jwt.verify(token, process.env.JWT_SECRET, {
        ...JWT_OPTIONS,
        algorithms: ['HS256'],
        clockTolerance: 5,
      })
    } catch (verifyError) {
      if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(verifyError?.name)) {
        const revoked = await revokeRefreshFamilyFromCookie(req)
        clearRefreshCookie(res)
        return revoked ? res.status(204).end() : res.status(401).json({ error: 'Unauthorized' })
      }
      throw verifyError
    }
    await blacklistToken(token)
    await revokeRefreshFamilyFromCookie(req)
    clearRefreshCookie(res)
    return res.status(204).end()
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError' || error?.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    return res.status(503).json({ error: 'Authentication service unavailable' })
  }
})

router.post('/change-password', authenticate, changePasswordRateLimiter, async (req, res) => {
  // 整段包在 try 裡：Express 4 不會接住 async 處理函式丟出的錯誤，以前資料庫錯誤或存檔驗證失敗
  // 會變成未處理的 rejection，整個服務直接結束
  try {
    const { oldPassword, newPassword } = req.body || {}
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '請提供舊密碼與新密碼' })
    }

    const strengthError = validatePasswordStrength(newPassword)
    if (strengthError) {
      return res.status(400).json({ error: strengthError })
    }
    if (newPassword === oldPassword) {
      return res.status(400).json({ error: '新密碼不可與舊密碼相同' })
    }

    const employee = await Employee.findById(req.user?.id).select('+passwordHash')
    if (!employee) {
      return res.status(404).json({ error: '找不到使用者' })
    }

    const match = employee.verifyPassword(oldPassword)
    if (!match) {
      res.locals.oldPasswordRejected = true
      return res.status(400).json({ error: '舊密碼不正確' })
    }

    employee.setPassword(newPassword)
    // 只驗證這次改到的欄位（密碼、登入版本）：舊資料的其他欄位不符合現在的格式（例如性別存成中文）時，
    // 整份驗證會失敗，員工永遠改不了密碼
    await employee.save({ validateModifiedOnly: true })
    // 其他裝置的續期 token 也作廢（續期時也會比對登入版本，這裡直接作廢比較乾淨）
    await revokeEmployeeRefreshTokens(employee._id)
    clearRefreshCookie(res)

    // 密碼存檔時登入版本已經加一，舊 token 全部失效；這裡再把目前這個 token 列入黑名單，失敗不影響結果
    const auth = req.headers.authorization
    if (auth) {
      const token = auth.split(' ')[1]
      try {
        await blacklistToken(token)
      } catch (blacklistError) {
        console.error('Failed to blacklist token after password change', { error: blacklistError?.name ?? 'Error' })
      }
    }

    return res.json({ message: '密碼已更新，請重新登入' })
  } catch (error) {
    console.error('Change password failed', { error: error?.name ?? 'Error' })
    return res.status(500).json({ error: '變更密碼失敗，請稍後再試' })
  }
})

router.get('/profile', authenticate, async (req, res) => {
  try {
    const { employeeId } = req.query
    const normalizedUserId = req.user?.id ? String(req.user.id) : null
    if (employeeId && employeeId !== normalizedUserId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const targetId = employeeId || normalizedUserId
    if (!targetId) {
      return res.status(400).json({ error: 'Missing employee id' })
    }

    let employee = await Employee.findById(targetId)
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' })
    }

    if (typeof employee.populate === 'function') {
      try {
        employee = await employee.populate([
          { path: 'department', populate: { path: 'organization' } },
          { path: 'subDepartment' },
        ])
      } catch (err) {
        // 忽略 population 失敗的情況，改用原始欄位
      }
    }

    const profile = await withScheduleAccess(buildUserProfile(employee), employee)
    res.json(profile)
  } catch (error) {
    if (error?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid employee id' })
    }
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

export default router;
