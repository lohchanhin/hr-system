import './config/env.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import Employee from './models/Employee.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { migrateMissingShiftSemantics } from './services/shiftSemanticService.js';
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

import salarySettingRoutes from './routes/salarySettingRoutes.js';
import holidayMoveSettingRoutes from './routes/holidayMoveSettingRoutes.js';

import attendanceSettingRoutes from './routes/attendanceSettingRoutes.js';
import shiftRoutes from './routes/shiftRoutes.js';
import deptManagerRoutes from './routes/deptManagerRoutes.js';
import { ensureDefaultSupervisorReports } from './services/supervisorReportSeed.js';
import { initializeLaborInsuranceRates } from './services/laborInsuranceService.js';
import privateUploadGuard from './middleware/privateUploadGuard.js';
import {
  apiErrorHandler,
  apiNotFound,
  configureTrustProxy,
  disableApiCaching,
  requestContext,
  secureHttpHeaders,
} from './middleware/httpSecurity.js';

const BOOTSTRAP_PASSWORD_MIN_LENGTH = 15;

function getAdminBootstrapConfig() {
  const username = process.env.DEFAULT_ADMIN_USERNAME?.trim();
  const email = process.env.DEFAULT_ADMIN_EMAIL?.trim();
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  const missing = [
    ['DEFAULT_ADMIN_USERNAME', username],
    ['DEFAULT_ADMIN_EMAIL', email],
    ['DEFAULT_ADMIN_PASSWORD', password],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    throw new Error(
      `No administrator exists. Set ${missing.join(', ')} to create the first administrator securely.`
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('DEFAULT_ADMIN_EMAIL must be a valid email address.');
  }

  const normalizedPassword = password.toLowerCase();
  const commonPasswords = new Set(['password', 'password123', 'admin123', 'changeme']);
  if (
    password.length < BOOTSTRAP_PASSWORD_MIN_LENGTH ||
    commonPasswords.has(normalizedPassword) ||
    normalizedPassword.startsWith('replace-') ||
    normalizedPassword.includes(username.toLowerCase())
  ) {
    throw new Error(
      `DEFAULT_ADMIN_PASSWORD must be at least ${BOOTSTRAP_PASSWORD_MIN_LENGTH} characters and must not contain the username or a common password.`
    );
  }

  return { username, email, password };
}

export async function ensureAdminUser() {
  const existing = await Employee.findOne({ role: 'admin' });
  if (existing) {
    console.log('Admin user already exists');
    return;
  }
  const { username, email, password } = getAdminBootstrapConfig();
  await Employee.create({
    name: username,
    email,
    username,
    password,
    role: 'admin',
    accountEnabled: true,
  });
  console.log('Created bootstrap administrator account');
}

export function assertSecureRuntimeConfig() {
  if (process.env.NODE_ENV === 'test') return;

  const secret = process.env.JWT_SECRET ?? '';
  const insecureValues = new Set(['secret', 'your_jwt_secret', 'password', 'changeme']);
  if (
    Buffer.byteLength(secret, 'utf8') < 32 ||
    insecureValues.has(secret.toLowerCase()) ||
    secret.toLowerCase().startsWith('replace-')
  ) {
    throw new Error('JWT_SECRET must be a unique secret of at least 32 bytes.');
  }
}

// Load .env file from server directory (handles both dev and PM2 production scenarios)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
const uploadPath = path.join(__dirname, '..', '..', 'upload');

const requiredEnv = ['PORT', 'MONGODB_URI', 'JWT_SECRET'];
const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

export const app = express();
const PORT = process.env.PORT;

app.disable('x-powered-by');
configureTrustProxy(app);
app.use(requestContext);
app.use(secureHttpHeaders);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.URLENCODED_BODY_LIMIT || '256kb',
  parameterLimit: 500,
}));

// 設定 CORS - 支援環境變數配置
const allowedOrigins = [
  "http://localhost:5173", // 開發用 Vite 伺服器
  "http://localhost:3000"  // 生產用（PM2 等）
];

// 如果有設定 FRONTEND_URL 環境變數，加入允許清單
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: "GET,POST,PUT,DELETE,OPTIONS"
}));
app.get('/env.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript');
  const config = {
    apiBaseUrl: process.env.VITE_API_BASE_URL ?? '',
  };
  res.send(`window.__APP_CONFIG__ = ${JSON.stringify(config)};`);
});

// 私密附件與員工照片必須經過物件層授權，不可由靜態目錄直接讀取。
app.use('/upload', privateUploadGuard, express.static(uploadPath));

app.use(express.static(distPath));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.use('/api', disableApiCaching);
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
    const requestPath = req.path ?? '';
    const pathSegments = requestPath.split('/').filter(Boolean);
    const isRespondPost =
      req.method === 'POST' &&
      (pathSegments[0] === 'respond' || pathSegments[1] === 'respond');
    if (isRespondPost) {
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
app.use('/api/holidays-public', authenticate, holidayRoutes); // Public holiday access for schedules

app.use('/api/salary-settings', authenticate, authorizeRoles('admin'), salarySettingRoutes);
app.use('/api/holiday-move-settings', authenticate, authorizeRoles('admin'), holidayMoveSettingRoutes);

app.use('/api', apiNotFound);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use(apiErrorHandler);
async function start() {
  try {
    assertSecureRuntimeConfig();
    await connectDB(process.env.MONGODB_URI);
    const migratedShiftSemantics = await migrateMissingShiftSemantics();
    if (migratedShiftSemantics) {
      console.log(`Migrated semantic types for ${migratedShiftSemantics} shifts`);
    }
    await ensureAdminUser();
    await ensureDefaultSupervisorReports();
    await initializeLaborInsuranceRates();
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
