import jwt from 'jsonwebtoken'
import Employee from '../models/Employee.js'
import { isTokenBlacklisted } from '../utils/tokenBlacklist.js'

const INACTIVE_EMPLOYMENT_STATUSES = new Set(['離職員工', '留職停薪'])

function readBearerToken(req) {
  const authHeader = req.headers.authorization
  if (typeof authHeader !== 'string') return null

  const [scheme, token, extra] = authHeader.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) return null
  return token
}

function isActiveEmployee(employee) {
  return Boolean(
    employee &&
    employee.accountEnabled !== false &&
    !INACTIVE_EMPLOYMENT_STATUSES.has(employee.status)
  )
}

export async function authenticate(req, res, next) {
  const token = readBearerToken(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'hr-system',
      audience: 'hr-system-api',
      clockTolerance: 5,
    })
    const employeeId = decoded?.sub ?? decoded?.id
    if (!employeeId || !decoded?.role) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (await isTokenBlacklisted(token)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const query = Employee.findById(employeeId)
    const employee = typeof query?.select === 'function'
      ? await query.select('role status accountEnabled authVersion')
      : await query

    const tokenVersion = Number(decoded.ver ?? 0)
    const currentVersion = Number(employee?.authVersion ?? 0)
    if (
      !isActiveEmployee(employee) ||
      employee.role !== decoded.role ||
      tokenVersion !== currentVersion
    ) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    req.user = {
      ...decoded,
      id: String(employeeId),
      role: employee.role,
      ver: currentVersion,
    }
    return next()
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError' || err?.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.error('Authentication lookup failed', { error: err?.name ?? 'Error' })
    return res.status(503).json({ error: 'Authentication service unavailable' })
  }
}

export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
