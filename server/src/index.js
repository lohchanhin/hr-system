import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Employee from './models/Employee.js';
import Organization from './models/Organization.js';
import Department from './models/Department.js';
import SubDepartment from './models/SubDepartment.js';
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

import salarySettingRoutes from './routes/salarySettingRoutes.js';

import attendanceSettingRoutes from './routes/attendanceSettingRoutes.js';

async function seedSampleData() {
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
async function seedTestUsers() {
  const users = [
    { username: 'user', password: 'password', role: 'employee' },
    { username: 'supervisor', password: 'password', role: 'supervisor' },
    { username: 'admin', password: 'password', role: 'admin' }
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
        status: '在職'
      });
      await User.create({ ...data, employee: employee._id });
      if (data.role === 'supervisor') supervisorId = employee._id;
      console.log(`Created test user ${data.username}`);
    }
  }
  if (supervisorId) {
    await Employee.updateMany({ role: 'employee' }, { supervisor: supervisorId });
  }
}

dotenv.config();

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});


app.use('/api', authRoutes);
app.use('/api/employees', authenticate, authorizeRoles('admin'), employeeRoutes);
app.use('/api/attendance', authenticate, authorizeRoles('employee', 'supervisor', 'admin'), attendanceRoutes);
app.use('/api/attendance-settings', authenticate, authorizeRoles('admin'), attendanceSettingRoutes);


app.use('/api/leaves', authenticate, authorizeRoles('employee', 'supervisor', 'admin'), leaveRoutes);
app.use('/api/schedules', authenticate, authorizeRoles('supervisor', 'admin'), scheduleRoutes);
app.use('/api/payroll', authenticate, authorizeRoles('admin'), payrollRoutes);
app.use('/api/reports', authenticate, authorizeRoles('admin'), reportRoutes);
app.use('/api/insurance', authenticate, authorizeRoles('admin'), insuranceRoutes);
app.use('/api/approvals', authenticate, authorizeRoles('supervisor', 'admin'), approvalRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/users', authenticate, authorizeRoles('admin'), userRoutes);
app.use('/api/departments', authenticate, authorizeRoles('admin'), departmentRoutes);
app.use('/api/organizations', authenticate, authorizeRoles('admin'), organizationRoutes);
app.use('/api/sub-departments', authenticate, authorizeRoles('admin'), subDepartmentRoutes);

app.use('/api/salary-settings', authenticate, authorizeRoles('admin'), salarySettingRoutes);




async function start() {
  try {
    await connectDB(process.env.MONGODB_URI);
    await seedSampleData();
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
