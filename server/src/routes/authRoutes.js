import '../config/env.js'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import Employee from '../models/Employee.js'
import { blacklistToken } from '../utils/tokenBlacklist.js'
import { authenticate } from '../middleware/auth.js'

const router = Router();
const JWT_OPTIONS = {
  issuer: 'hr-system',
  audience: 'hr-system-api',
}
const INACTIVE_EMPLOYMENT_STATUSES = new Set(['離職員工', '留職停薪'])

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
    username: employee.username,
    name: employee.name ?? '',
    photo: employee.photo ?? '',
    organizationName,
    departmentName: getName(department),
    subDepartmentName: getName(subDepartment),
  }
}

router.post('/login', loginIpRateLimiter, loginAccountRateLimiter, async (req, res) => {
  try {
    const { username, password, role } = req.body ?? {}
    const normalizedUsername = typeof username === 'string' ? username.trim() : ''
    const validRole = ['employee', 'supervisor', 'admin'].includes(role)
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
    if (!employee || !activeAccount || !employee.verifyPassword(password) || role !== employee.role) {
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

    const profile = buildUserProfile(employee)
    const employeeId = employee._id?.toString?.() ?? String(employee._id)
    const token = jwt.sign(
      {
        id: employeeId,
        sub: employeeId,
        role: employee.role,
        ver: Number(employee.authVersion ?? 0),
      },
      process.env.JWT_SECRET,
      { ...JWT_OPTIONS, expiresIn: '1h' }
    )
    return res.json({ token, user: profile })
  } catch (error) {
    console.error('Login failed', { error: error?.name ?? 'Error' })
    return res.status(500).json({ error: 'Unable to sign in' })
  }
})

router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization
  const [scheme, token, extra] = typeof auth === 'string' ? auth.trim().split(/\s+/) : []
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET, {
      ...JWT_OPTIONS,
      algorithms: ['HS256'],
      clockTolerance: 5,
    })
    await blacklistToken(token)
    return res.status(204).end()
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError' || error?.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    return res.status(503).json({ error: 'Authentication service unavailable' })
  }
})

router.post('/change-password', authenticate, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '請提供舊密碼與新密碼' })
  }

  const strengthError = validatePasswordStrength(newPassword)
  if (strengthError) {
    return res.status(400).json({ error: strengthError })
  }

  const employee = await Employee.findById(req.user?.id).select('+passwordHash')
  if (!employee) {
    return res.status(404).json({ error: '找不到使用者' })
  }

  const match = employee.verifyPassword(oldPassword)
  if (!match) {
    return res.status(400).json({ error: '舊密碼不正確' })
  }

  employee.setPassword(newPassword)
  await employee.save()

  const auth = req.headers.authorization
  if (auth) {
    const token = auth.split(' ')[1]
    await blacklistToken(token)
  }

  res.json({ message: '密碼已更新，請重新登入' })
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

    const profile = buildUserProfile(employee)
    res.json(profile)
  } catch (error) {
    if (error?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid employee id' })
    }
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

export default router;
