import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Employee from '../src/models/Employee.js';

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in the environment');
  process.exit(1);
}

async function seed() {
  await connectDB(process.env.MONGODB_URI);

  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('ADMIN_USERNAME and ADMIN_PASSWORD must be provided');
    process.exit(1);
  }

  const users = [
    { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'admin' }
  ];

  for (const data of users) {
    const existing = await User.findOne({ username: data.username });
    if (!existing) {
      const employee = await Employee.create({
        name: data.username,
        email: `${data.username}@example.com`,
        role: data.role,
        idNumber: '',
        birthDate: new Date('1990-01-01'),
        contact: '',
        licenses: [],
        trainings: []
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
