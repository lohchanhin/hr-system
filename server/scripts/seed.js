import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Employee from '../src/models/Employee.js';
import Organization from '../src/models/Organization.js';
import Department from '../src/models/Department.js';
import SubDepartment from '../src/models/SubDepartment.js';

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in the environment');
  process.exit(1);
}

async function seed() {
  await connectDB(process.env.MONGODB_URI);

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

  const users = [
    { username: 'user', password: 'password', role: 'employee' },
    { username: 'supervisor', password: 'password', role: 'supervisor' },
    { username: 'hr', password: 'password', role: 'hr' },
    { username: 'admin', password: 'password', role: 'admin' }
  ];

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
      console.log(`Created user ${data.username}`);
    } else {
      console.log(`User ${data.username} already exists`);
    }
  }

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Error seeding data:', err);
  process.exit(1);
});
