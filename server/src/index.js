import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Employee from './models/Employee.js';
import Organization from './models/Organization.js';
import Department from './models/Department.js';
import SubDepartment from './models/SubDepartment.js';
import FormTemplate from './models/form_template.js';
import FormField from './models/form_field.js';
import ApprovalWorkflow from './models/approval_workflow.js';
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
import menuRoutes from './routes/menuRoutes.js';
import userRoutes from './routes/userRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import subDepartmentRoutes from './routes/subDepartmentRoutes.js';
import holidayRoutes from './routes/holidayRoutes.js';
import deptScheduleRoutes from './routes/deptScheduleRoutes.js';
import roleRoutes from './routes/roleRoutes.js';

import salarySettingRoutes from './routes/salarySettingRoutes.js';
import breakSettingRoutes from './routes/breakSettingRoutes.js';
import holidayMoveSettingRoutes from './routes/holidayMoveSettingRoutes.js';

import attendanceShiftRoutes from './routes/attendanceShiftRoutes.js';
import shiftRoutes from './routes/shiftRoutes.js';
import deptManagerRoutes from './routes/deptManagerRoutes.js';

export async function seedSampleData() {
  let org = await Organization.findOne({ name: '示範機構' });
  if (!org) {
    org = await Organization.create({
      name: '示範機構',
      systemCode: 'ORG001',
      unitName: '總院',
      orgCode: '001',
      taxIdNumber: '12345678',
      phone: '02-12345678',
      address: '台北市信義路1號',
      principal: '示範負責人'
    });
    console.log('Created sample organization');
  }

  let dept = await Department.findOne({ code: 'HR' });
  if (!dept) {
    dept = await Department.create({
      name: '人力資源部',
      code: 'HR',
      organization: org._id,
      unitName: '人力資源',
      location: '台北',
      phone: '02-23456789',
      manager: 'supervisor'
    });
    console.log('Created sample department');
  }

  const subDeptExists = await SubDepartment.findOne({ code: 'HR1' });
  if (!subDeptExists) {
    await SubDepartment.create({
      department: dept._id,
      code: 'HR1',
      name: '招聘組',
      unitName: '招聘組',
      location: '台北',
      phone: '02-23456789',
      manager: 'supervisor'
    });
    console.log('Created sample sub-department');
  }
}
export async function seedTestUsers() {
  const users = [
    { username: 'user', password: 'password', role: 'employee' },
    { username: 'supervisor', password: 'password', role: 'supervisor' },
    { username: 'admin', password: 'password', role: 'admin' },
    { username: 'scheduler', password: 'password', role: 'supervisor', signTags: ['排班負責人'] },
    { username: 'supportHead', password: 'password', role: 'supervisor', signTags: ['支援單位主管'] },
    { username: 'salesHead', password: 'password', role: 'supervisor', signTags: ['業務主管'] },
    { username: 'salesManager', password: 'password', role: 'supervisor', signTags: ['業務負責人'] },
    { username: 'hr', password: 'password', role: 'admin', signTags: ['人資'] }
  ];
  let supervisorId = null;
  for (const data of users) {
    const existing = await User.findOne({ username: data.username });
    if (!existing) {
      const employee = await Employee.create({
        name: data.username,
        email: `${data.username}@example.com`,
        role: data.role,
        organization: '示範機構',
        department: '人力資源部',
        subDepartment: '招聘組',
        title: 'Staff',
        status: '在職',
        signTags: data.signTags ?? []
      });
      await User.create({
        ...data,
        organization: employee.organization,
        department: employee.department,
        subDepartment: employee.subDepartment,
        employee: employee._id
      });
      if (data.role === 'supervisor') supervisorId = employee._id;
      console.log(`Created test user ${data.username}`);
    }
  }
  if (supervisorId) {
    await Employee.updateMany({ role: 'employee' }, { supervisor: supervisorId });
  }
}

export async function seedApprovalTemplates() {
  const templates = [
    {
      name: '支援申請',
      category: '人事',
      fields: [
        { label: '申請事由', type_1: 'textarea', required: true, order: 1 },
        { label: '開始日期', type_1: 'date', required: true, order: 2 },
        { label: '結束日期', type_1: 'date', required: true, order: 3 },
        { label: '附件', type_1: 'file', order: 4 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '支援單位主管' },
        { step_order: 3, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '特休保留',
      category: '人事',
      fields: [
        { label: '年度', type_1: 'text', required: true, order: 1 },
        { label: '保留天數', type_1: 'number', required: true, order: 2 },
        { label: '理由', type_1: 'textarea', order: 3 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '在職證明',
      category: '人事',
      fields: [
        { label: '用途', type_1: 'text', required: true, order: 1 },
        { label: '開立日期', type_1: 'date', required: true, order: 2 },
      ],
      steps: [
        { step_order: 1, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '離職證明',
      category: '人事',
      fields: [
        { label: '用途', type_1: 'text', order: 1 },
        { label: '離職日期', type_1: 'date', required: true, order: 2 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ],
    },
  ];

  for (const t of templates) {
    let form = await FormTemplate.findOne({ name: t.name });
    if (!form) {
      form = await FormTemplate.create({ name: t.name, category: t.category, description: t.description });
      console.log(`Created form template ${t.name}`);
    }

    for (const field of t.fields) {
      const exists = await FormField.findOne({ form: form._id, label: field.label });
      if (!exists) {
        await FormField.create({ ...field, form: form._id });
      }
    }

    let workflow = await ApprovalWorkflow.findOne({ form: form._id });
    if (!workflow) {
      await ApprovalWorkflow.create({ form: form._id, steps: t.steps });
    }
  }
}

dotenv.config();

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
app.use(cors());
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
      return authorizeRoles('admin', 'supervisor')(req, res, next);
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
  (req, res, next) => {
    if (req.method === 'GET') {
      return authorizeRoles('supervisor', 'admin')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  attendanceShiftRoutes
);

app.use(
  '/api/shifts',
  authenticate,
  (req, res, next) => {
    if (req.method === 'GET') {
      return authorizeRoles('supervisor', 'admin')(req, res, next);
    }
    return authorizeRoles('admin')(req, res, next);
  },
  shiftRoutes
);


app.use('/api/leaves', authenticate, authorizeRoles('employee', 'supervisor', 'admin'), leaveRoutes);
app.use('/api/schedules', authenticate, authorizeRoles('supervisor', 'admin'), scheduleRoutes);
app.use('/api/payroll', authenticate, authorizeRoles('admin'), payrollRoutes);
app.use('/api/reports', authenticate, authorizeRoles('admin'), reportRoutes);
app.use('/api/insurance', authenticate, authorizeRoles('admin'), insuranceRoutes);
app.use('/api/approvals', authenticate, approvalRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/users', authenticate, authorizeRoles('admin'), userRoutes);
app.use('/api/departments', authenticate, authorizeRoles('admin'), departmentRoutes);
app.use('/api/organizations', authenticate, authorizeRoles('admin'), organizationRoutes);
app.use('/api/sub-departments', authenticate, authorizeRoles('admin'), subDepartmentRoutes);
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
    await seedSampleData();
    await seedTestUsers();
    await seedApprovalTemplates();
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
