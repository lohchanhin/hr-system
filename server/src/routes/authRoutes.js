import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { blacklistToken } from '../utils/tokenBlacklist.js'

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await user.comparePassword(password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const employeeId = user.employee || user.supervisor;
  const token = jwt.sign(
    { id: user._id, role: user.role, employeeId },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '1h' }
  );
  const refreshToken = jwt.sign(
    { id: user._id, role: user.role, employeeId },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );
  res.json({ token, refreshToken, user: { id: user._id, role: user.role, username: user.username, employeeId } });
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Invalid token' });
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET || 'secret');
    const token = jwt.sign(
      { id: payload.id, role: payload.role, employeeId: payload.employeeId },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization
  if (auth) {
    const token = auth.split(' ')[1]
    await blacklistToken(token)
  }
  res.status(204).end()
})

export default router;
