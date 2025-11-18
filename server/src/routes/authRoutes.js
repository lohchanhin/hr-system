import { Router } from 'express'
import jwt from 'jsonwebtoken'
import Employee from '../models/Employee.js'
import { blacklistToken } from '../utils/tokenBlacklist.js'
import { authenticate } from '../middleware/auth.js'

const router = Router();

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
    organizationName,
    departmentName: getName(department),
    subDepartmentName: getName(subDepartment),
  }
}

router.post('/login', async (req, res) => {
  const { username, password, role } = req.body
  const employee = await Employee.findOne({ username }).select('+passwordHash')
  if (!employee) return res.status(401).json({ error: 'Invalid credentials' })

  const match = employee.verifyPassword(password)
  if (!match) return res.status(401).json({ error: 'Invalid credentials' })

  if (role !== employee.role) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (typeof employee.populate === 'function') {
    try {
      await employee.populate([
        { path: 'department', populate: { path: 'organization' } },
        { path: 'subDepartment' },
      ])
    } catch (err) {
      // population 失敗時採用原始資料，避免登入流程中斷
    }
  }

  const profile = buildUserProfile(employee)

  const token = jwt.sign(
    { id: employee._id, role: employee.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '1h' }
  )
  res.json({
    token,
    user: profile
  })
})

router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization
  if (auth) {
    const token = auth.split(' ')[1]
    await blacklistToken(token)
  }
  res.status(204).end()
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
