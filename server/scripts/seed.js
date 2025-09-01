import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { seedSampleData, seedTestUsers, seedApprovalTemplates } from '../src/index.js';

dotenv.config({override:true});

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in the environment');
  process.exit(1);
}

async function seed() {
  await connectDB(process.env.MONGODB_URI);
  await seedSampleData();
  await seedTestUsers();
  await seedApprovalTemplates();
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Error seeding data:', err);
  process.exit(1);
});
