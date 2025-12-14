import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from '../src/config/db.js';
import {
  generateDiverseScheduleTestData,
  generateDiverseAttendanceTestData,
  generateDiverseApprovalTestData,
} from '../src/services/testDataGenerationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  try {
    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI is not defined in the environment');
      process.exit(1);
    }

    await connectDB(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const month = process.argv[2] || '2024-01';
    console.log(`Generating diverse test data for month: ${month}`);

    console.log('\n1. Generating diverse schedule test data...');
    await generateDiverseScheduleTestData(month);

    console.log('\n2. Generating diverse attendance test data...');
    await generateDiverseAttendanceTestData(month);

    console.log('\n3. Generating diverse approval test data...');
    await generateDiverseApprovalTestData();

    console.log('\n✓ All diverse test data generated successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error generating test data:', error);
    process.exit(1);
  }
}

main();
