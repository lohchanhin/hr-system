import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { connectDB } from '../src/config/db.js';
import { ensureDefaultSupervisorReports } from '../src/services/supervisorReportSeed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const {
  seedSampleData,
  seedTestUsers,
  seedApprovalTemplates,
  seedApprovalRequests,
  SEED_TEST_PASSWORD,
} = await import('../src/seedUtils.js');

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in the environment');
  process.exit(1);
}

async function seed() {
  await connectDB(process.env.MONGODB_URI);
  const structure = await seedSampleData();
  await ensureDefaultSupervisorReports();
  if (structure?.organizations?.length) {
    console.log(`Seeded organizations: ${structure.organizations.map((org) => org.name).join(', ')}`);
  }
  const { supervisors, employees } = await seedTestUsers();

  const accounts = [];
  const formatUserAccount = (user) => ({
    username: user.username,
    password: SEED_TEST_PASSWORD,
    name: user.name,
    title: user.title ?? '',
    role: user.role,
    signTags: Array.isArray(user.signTags) ? [...user.signTags] : [],
  });

  supervisors.forEach((supervisor) => {
    accounts.push(formatUserAccount(supervisor));
  });

  employees.forEach((employee) => {
    accounts.push(formatUserAccount(employee));
  });

  if (process.env.DEFAULT_ADMIN_USERNAME) {
    accounts.unshift({
      username: process.env.DEFAULT_ADMIN_USERNAME,
      password: process.env.DEFAULT_ADMIN_PASSWORD ?? SEED_TEST_PASSWORD,
      name: process.env.DEFAULT_ADMIN_NAME ?? '系統管理員',
      title: process.env.DEFAULT_ADMIN_TITLE ?? '系統管理員',
      role: 'admin',
      signTags: [],
    });
  }

  const outputPath = path.resolve(__dirname, 'seed-accounts.json');
  await writeFile(outputPath, JSON.stringify(accounts, null, 2), 'utf8');
  console.log(`種子帳號資訊已輸出至 ${outputPath}`);

  await seedApprovalTemplates();
  await seedApprovalRequests({ supervisors, employees });
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Error seeding data:', err);
  process.exit(1);
});
