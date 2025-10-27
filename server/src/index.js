import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import Employee from './models/Employee.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { authenticate, authorizeRoles } from './middleware/auth.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import insuranceRoutes from './routes/insuranceRoutes.js';
import approvalRoutes from './routes/approvalRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import subDepartmentRoutes from './routes/subDepartmentRoutes.js';
import holidayRoutes from './routes/holidayRoutes.js';
import deptScheduleRoutes from './routes/deptScheduleRoutes.js';
import roleRoutes from './routes/roleRoutes.js';
import otherControlSettingRoutes from './routes/otherControlSettingRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';

import salarySettingRoutes from './routes/salarySettingRoutes.js';
import breakSettingRoutes from './routes/breakSettingRoutes.js';
import holidayMoveSettingRoutes from './routes/holidayMoveSettingRoutes.js';

import attendanceSettingRoutes from './routes/attendanceSettingRoutes.js';
import shiftRoutes from './routes/shiftRoutes.js';
import deptManagerRoutes from './routes/deptManagerRoutes.js';
import { ensureDefaultSupervisorReports } from './services/supervisorReportSeed.js';

export async function ensureAdminUser() {
  const existing = await Employee.findOne({ role: 'admin' });
  if (existing) {
    console.log('Admin user already exists');
    return;
  }
  const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'password';
  await Employee.create({
    name: username,
    email: `${username}@example.com`,
    username,
    password,
    role: 'admin',
  });
  console.log(`Created default admin user ${username}`);
}

dotenv.config();
dotenv.config({override:true});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');

const requiredEnv = ['PORT', 'MONGODB_URI', 'JWT_SECRET'];
const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT;

app.use(express.json());
app.use(cors({
  origin: [
    "https://hr-system-d7fc5ea7aab1.herokuapp.com", // 前端 domain
    "http://localhost:5173" // 開發用
  ],
  credentials: true,
  methods: "GET,POST,PUT,DELETE,OPTIONS"
}));
app.get('/env.js', (req, res) => {
  res.type('application/javascript');
  const config = {
    apiBaseUrl: process.env.VITE_API_BASE_URL ?? '',
  };
  res.send(`window.__APP_CONFIG__ = ${JSON.stringify(config)};`);
});

app.use(express.static(distPath));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});


app.use('/api', authRoutes);
app.use(
  '/api/employees',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  employeeRoutes
);
app.use('/api/attendance', authenticate, authorizeRoles('employee', 'supervisor', 'admin'), attendanceRoutes);
app.use('/api/roles', authenticate, authorizeRoles('admin', 'supervisor'), roleRoutes);
app.use(
  '/api/attendance-settings',
  authenticate,
  authorizeRoles('admin'),
  attendanceSettingRoutes
);

app.use(
  '/api/shifts',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  shiftRoutes
);


app.use(
  '/api/schedules',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      if (req.path?.startsWith('/export')) {
        return authorizeRoles('admin', 'supervisor')(req, res, next);
      }
      return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
    }
    return authorizeRoles('supervisor', 'admin')(req, res, next);
  },
  scheduleRoutes
);
app.use('/api/payroll', authenticate, authorizeRoles('admin'), payrollRoutes);
app.use(
  '/api/reports',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      if (req.path?.startsWith('/department')) {
        return authorizeRoles('admin', 'supervisor')(req, res, next);
      }
      return authorizeRoles('admin')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  reportRoutes
);
app.use('/api/insurance', authenticate, authorizeRoles('admin'), insuranceRoutes);
app.use('/api/approvals', authenticate, approvalRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use(
  '/api/other-control-settings',
  authenticate,
  authorizeRoles('admin'),
  otherControlSettingRoutes
);
app.use(
  '/api/conversations',
  authenticate,
  authorizeRoles('admin', 'supervisor'),
  conversationRoutes
);
app.use(
  '/api/departments',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  departmentRoutes
);
app.use(
  '/api/organizations',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  organizationRoutes
);
app.use(
  '/api/sub-departments',
  authenticate,
  authorizeRoles('admin', 'supervisor'),
  subDepartmentRoutes
);
app.use('/api/dept-schedules', authenticate, authorizeRoles('admin'), deptScheduleRoutes);

app.use('/api/dept-managers', authenticate, authorizeRoles('admin'), deptManagerRoutes);

app.use('/api/holidays', authenticate, authorizeRoles('admin'), holidayRoutes);

app.use('/api/salary-settings', authenticate, authorizeRoles('admin'), salarySettingRoutes);
app.use('/api/break-settings', authenticate, authorizeRoles('admin'), breakSettingRoutes);
app.use('/api/holiday-move-settings', authenticate, authorizeRoles('admin'), holidayMoveSettingRoutes);


app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});




async function start() {
  try {
    await connectDB(process.env.MONGODB_URI);
    await ensureAdminUser();
    await ensureDefaultSupervisorReports();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
