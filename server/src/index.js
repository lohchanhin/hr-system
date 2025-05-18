import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { authenticate, authorizeRoles } from './middleware/auth.js';
import leaveRoutes from './routes/leaveRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import insuranceRoutes from './routes/insuranceRoutes.js';
import approvalRoutes from './routes/approvalRoutes.js';

async function seedTestUsers() {
  const users = [
    { username: 'user', password: 'password', role: 'employee' },
    { username: 'supervisor', password: 'password', role: 'supervisor' },
    { username: 'hr', password: 'password', role: 'hr' },
    { username: 'admin', password: 'password', role: 'admin' }
  ];
  for (const data of users) {
    const existing = await User.findOne({ username: data.username });
    if (!existing) {
      await User.create(data);
      console.log(`Created test user ${data.username}`);
    }
  }
}

dotenv.config();

const requiredEnv = ['PORT', 'MONGODB_URI'];
const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT;

app.use(express.json());
app.use(cors());

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});


app.use('/api', authRoutes);
app.use('/api/employees', authenticate, authorizeRoles('admin', 'hr'), employeeRoutes);
app.use('/api/attendance', authenticate, authorizeRoles('employee', 'supervisor', 'hr', 'admin'), attendanceRoutes);


app.use('/api/leaves', authenticate, authorizeRoles('employee', 'supervisor', 'hr', 'admin'), leaveRoutes);
app.use('/api/schedules', authenticate, authorizeRoles('supervisor', 'hr', 'admin'), scheduleRoutes);
app.use('/api/payroll', authenticate, authorizeRoles('hr', 'admin'), payrollRoutes);
app.use('/api/reports', authenticate, authorizeRoles('hr', 'admin'), reportRoutes);
app.use('/api/insurance', authenticate, authorizeRoles('hr', 'admin'), insuranceRoutes);
app.use('/api/approvals', authenticate, authorizeRoles('supervisor', 'hr', 'admin'), approvalRoutes);


async function start() {
  try {
    await connectDB(process.env.MONGODB_URI);
    await seedTestUsers();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
