import { Router } from 'express'
import jwt from 'jsonwebtoken'
import Employee from '../models/Employee.js'
import { blacklistToken } from '../utils/tokenBlacklist.js'

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password, role } = req.body
  const employee = await Employee.findOne({ username }).select('+passwordHash')
  if (!employee) return res.status(401).json({ error: 'Invalid credentials' })

  const match = employee.verifyPassword(password)
  if (!match) return res.status(401).json({ error: 'Invalid credentials' })

  if (role !== employee.role) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const token = jwt.sign(
    { id: employee._id, role: employee.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '1h' }
  )
  res.json({
    token,
    user: {
      id: employee._id,
      employeeId: employee._id,
      role: employee.role,
      username: employee.username
    }
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

export default router;
