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
import { purgeLegacyRocWeekendHolidays } from './controllers/holidayController.js';
import { migrateHolidayCalendarKinds, ensureHolidayCalendarIndexes } from './services/holidayCalendarMigration.js';
import { startHolidayCalendarWatcher } from './services/companyCalendarService.js';
import { syncRecentHolidayCompensations } from './services/holidayCompensationService.js';
import { migrateIndigenousLeaveQuota } from './services/leavePolicyService.js';
import { migrateLeaveFormSemantics, migrateLeaveKeywordForms } from './controllers/approvalTemplateController.js';
import { normalizeStoredSignTags } from './controllers/employeeController.js';
import { migrateAnnualLeaveToHours, migrateLeaveFormsToHours } from './services/leaveHoursMigration.js';
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
import holidayLedgerRoutes from './routes/holidayLedgerRoutes.js';
import companyCalendarRoutes from './routes/companyCalendarRoutes.js';
import holidayCalendarViewRoutes from './routes/holidayCalendarViewRoutes.js';
import HolidayRestResolution from './models/HolidayRestResolution.js';

import attendanceSettingRoutes from './routes/attendanceSettingRoutes.js';
import shiftRoutes from './routes/shiftRoutes.js';
import deptManagerRoutes from './routes/deptManagerRoutes.js';
import { ensureDefaultSupervisorReports } from './services/supervisorReportSeed.js';
import { initializeLaborInsuranceRates } from './services/laborInsuranceService.js';
import privateUploadGuard from './middleware/privateUploadGuard.js';
import {
  apiErrorHandler,
  apiMutationRateLimiter,
  apiNotFound,
  apiRateLimiter,
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
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  // 跨網域部署時前端要讀得到清單的分頁與截斷提示（排班頁「相關簽核」超過 500 筆的提醒、簽核清單的總筆數）
  exposedHeaders: ['X-Approvals-Truncated', 'X-Total-Count', 'X-Page', 'X-Limit']
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
app.use('/api', apiRateLimiter);
app.use('/api', apiMutationRateLimiter);
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
// 排班頁面用的假日讀取開放給所有已登入使用者；寫入（新增、修改、刪除、匯入）仍只有管理員
app.use(
  '/api/holidays-public',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return authorizeRoles('admin')(req, res, next);
  },
  holidayRoutes
);
// 行事曆設定（年度草稿、政府資料差異、核定）只有管理員；國定假日的標示與年度狀態給所有已登入使用者讀取
app.use('/api/company-calendar', authenticate, authorizeRoles('admin'), companyCalendarRoutes);
app.use('/api/holiday-calendar', authenticate, authorizeRoles('employee', 'supervisor', 'admin'), holidayCalendarViewRoutes);

app.use('/api/salary-settings', authenticate, authorizeRoles('admin'), salarySettingRoutes);
app.use('/api/holiday-move-settings', authenticate, authorizeRoles('admin'), holidayMoveSettingRoutes);
// 國定假日休假紀錄：查詢依班表的權限範圍（員工只看自己）；匯出與登記處理方式只有主管、管理員（路由檔內再擋一次）
app.use(
  '/api/holiday-ledger',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET' && !req.path?.startsWith('/export')) {
      return authorizeRoles('employee', 'supervisor', 'admin')(req, res, next);
    }
    return authorizeRoles('supervisor', 'admin')(req, res, next);
  },
  holidayLedgerRoutes
);

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
    // 員工身上已存的簽核標籤統一成同一種寫法（全形轉半形、去空白、去重；冪等）：刪除員工前的影響盤點等以資料庫比對標籤的地方才對得上
    try {
      const normalizedSignTags = await normalizeStoredSignTags();
      if (normalizedSignTags) {
        console.log(`Normalized sign tags for ${normalizedSignTags} employees`);
      }
    } catch (normalizeError) {
      console.error('Failed to normalize sign tags', normalizeError?.name ?? 'Error');
    }
    const migratedShiftSemantics = await migrateMissingShiftSemantics();
    if (migratedShiftSemantics) {
      console.log(`Migrated semantic types for ${migratedShiftSemantics} shifts`);
    }
    // 舊版國定假日匯入把每個週末都存成「國定假日」，會讓排班檢核與加班費誤判；啟動時清掉（冪等）
    try {
      const purgedWeekendHolidays = await purgeLegacyRocWeekendHolidays();
      if (purgedWeekendHolidays) {
        console.log(`Removed ${purgedWeekendHolidays} legacy weekend holiday entries`);
      }
    } catch (purgeError) {
      console.error('Failed to purge legacy weekend holidays', purgeError?.name ?? 'Error');
    }
    // 舊版行事曆資料補上類型（國定假日／公務機關補假／調整放假…），轉換過的年度成為待核定的草稿（冪等，只記錄筆數）
    try {
      const calendarMigration = await migrateHolidayCalendarKinds();
      if (calendarMigration?.rows) console.log(`Migrated holiday calendar kinds for ${calendarMigration.rows} rows in ${calendarMigration.years} years (statutory ${calendarMigration.statutory}, government make-up days ${calendarMigration.govMakeupOff}, bridge days ${calendarMigration.govBridgeOff}, workdays ${calendarMigration.workdays}, company rest days ${calendarMigration.companyOff}, added ${calendarMigration.added}, duplicates archived ${calendarMigration.duplicates}, to review ${calendarMigration.needsReview})`);
      if (calendarMigration?.orphanResolutions) console.log(`Holiday rest resolutions on non-statutory dates: ${calendarMigration.orphanResolutions}`);
      if (calendarMigration?.orphanMoves) console.log(`Holiday moves whose source is not a statutory holiday: ${calendarMigration.orphanMoves}`);
      if (calendarMigration?.normalizedDates) console.log(`Normalized ${calendarMigration.normalizedDates} legacy holiday dates to Taipei calendar days`);
    } catch (calendarError) { console.error('Failed to migrate holiday calendar kinds', calendarError?.name ?? 'Error'); }
    try { await ensureHolidayCalendarIndexes(); } catch (indexError) { console.error('Failed to ensure holiday calendar indexes', indexError?.name ?? 'Error'); }
    // 名稱看起來是請假單、表單性質卻還是預設「一般」的舊表單（例如客戶的「休假/事假/公假申請單」）補成請假（冪等）
    try {
      const migratedLeaveForms = await migrateLeaveFormSemantics();
      if (migratedLeaveForms) {
        console.log(`Migrated semantic types for ${migratedLeaveForms} leave forms`);
      }
    } catch (migrateError) {
      console.error('Failed to migrate leave form semantics', migrateError?.name ?? 'Error');
    }
    // 名稱含「假別」的舊請假表單（例如「(全)假別申請單」）補成請假，每張表單只處理一次
    try {
      const migratedKeywordForms = await migrateLeaveKeywordForms();
      if (migratedKeywordForms) {
        console.log(`Migrated semantic types for ${migratedKeywordForms} leave forms (假別)`);
      }
    } catch (keywordError) {
      console.error('Failed to migrate leave keyword forms', keywordError?.name ?? 'Error');
    }
    // 請假改以「小時」為單位：員工特休從天數欄位搬成時數欄位（冪等：已有時數欄位的員工不會再動，只記錄筆數）
    try {
      const annualLeaveMigration = await migrateAnnualLeaveToHours();
      if (annualLeaveMigration?.migrated) {
        console.log(
          `Migrated annual leave to hours for ${annualLeaveMigration.migrated} employees ` +
          `(days x8: ${annualLeaveMigration.fromDays}, already hours: ${annualLeaveMigration.alreadyHours}, repaired: ${annualLeaveMigration.repaired})`
        );
      }
    } catch (annualLeaveError) {
      console.error('Failed to migrate annual leave to hours', annualLeaveError?.name ?? 'Error');
    }
    // 請假表單補上「時數」欄位並停用舊的「天數」欄位（每張表單只處理一次）
    try {
      const leaveFormMigration = await migrateLeaveFormsToHours();
      if (leaveFormMigration?.forms) {
        console.log(
          `Added leave hours field to ${leaveFormMigration.added} leave forms ` +
          `(deactivated days field on ${leaveFormMigration.deactivated}, forms checked: ${leaveFormMigration.forms})`
        );
      }
    } catch (leaveHoursError) {
      console.error('Failed to migrate leave forms to hours', leaveHoursError?.name ?? 'Error');
    }
    // 原民假（原住民族歲時祭儀）由每年 1 日改為 3 日：只改仍是舊預設值的設定（冪等，只記錄筆數）
    try { const indigenousQuota = await migrateIndigenousLeaveQuota(); if (indigenousQuota?.updated) console.log(`Updated indigenous leave quota to 3 days in ${indigenousQuota.updated} stored leave policies`); } catch (quotaError) { console.error('Failed to migrate indigenous leave quota', quotaError?.name ?? 'Error'); }
    // 國定假日休假紀錄的處理方式集合：確保唯一索引存在（冪等；失敗不擋啟動，之後寫入時 Mongoose 仍會再試建立）
    try {
      await HolidayRestResolution.createIndexes();
    } catch (indexError) {
      console.error('Failed to ensure holiday rest resolution indexes', indexError?.name ?? 'Error');
    }
    await ensureAdminUser();
    await ensureDefaultSupervisorReports();
    await initializeLaborInsuranceRates();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      // 每天檢查政府辦公日曆表（5 月起）並重新計算國定假日補假；HOLIDAY_CALENDAR_WATCHER=off 可停用
      if (process.env.HOLIDAY_CALENDAR_WATCHER !== 'off') startHolidayCalendarWatcher({ dailyTasks: [syncRecentHolidayCompensations] });
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
