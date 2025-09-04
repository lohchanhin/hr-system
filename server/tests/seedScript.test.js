import { jest } from '@jest/globals';
import path from 'path';

test('seed script loads env from server/.env', async () => {
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  const configMock = jest.fn();

  await jest.unstable_mockModule('dotenv', () => ({ default: { config: configMock } }));
  await jest.unstable_mockModule('../src/config/db.js', () => ({ connectDB: jest.fn() }));
  await jest.unstable_mockModule('../src/seedUtils.js', () => ({
    seedSampleData: jest.fn(),
    seedTestUsers: jest.fn(),
    seedApprovalTemplates: jest.fn()
  }));
  await jest.unstable_mockModule('mongoose', () => ({ default: { disconnect: jest.fn() } }));

  await import('../scripts/seed.js');

  expect(configMock).toHaveBeenCalledWith({ path: path.resolve(process.cwd(), '.env') });
});
