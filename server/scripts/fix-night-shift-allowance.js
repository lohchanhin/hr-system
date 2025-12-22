/**
 * Migration script to fix night shift allowance configuration
 * 
 * This script checks all shifts with hasAllowance=true and ensures they have
 * a valid allowanceType and either allowanceMultiplier > 0 or fixedAllowanceAmount > 0
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import AttendanceSetting from '../src/models/AttendanceSetting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not defined in environment variables');
    process.exit(1);
  }
  
  try {
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

async function fixNightShiftAllowances() {
  console.log('\n🔍 Checking night shift allowance configurations...\n');
  
  const settings = await AttendanceSetting.find();
  
  if (settings.length === 0) {
    console.log('⚠️  No attendance settings found');
    return;
  }
  
  let fixedCount = 0;
  let issuesFound = 0;
  
  for (const setting of settings) {
    if (!setting.shifts || setting.shifts.length === 0) {
      continue;
    }
    
    let modified = false;
    
    for (const shift of setting.shifts) {
      // Check if this is a night shift with allowance enabled
      if (shift.isNightShift && shift.hasAllowance) {
        // Ensure allowanceType is set
        if (!shift.allowanceType) {
          console.log(`📝 Shift "${shift.name}" (${shift.code}): Setting default allowanceType to 'multiplier'`);
          shift.allowanceType = 'multiplier';
          modified = true;
        }
        
        // Check if the configuration is valid
        if (shift.allowanceType === 'multiplier') {
          if (!shift.allowanceMultiplier || shift.allowanceMultiplier <= 0) {
            console.log(`⚠️  Shift "${shift.name}" (${shift.code}): hasAllowance=true but allowanceMultiplier=${shift.allowanceMultiplier}`);
            console.log(`   Fixing: Set allowanceMultiplier to 0.34 (34% allowance - Taiwan standard)`);
            shift.allowanceMultiplier = 0.34; // 34% default - standard Taiwan night shift allowance
            modified = true;
            fixedCount++;
          }
        } else if (shift.allowanceType === 'fixed') {
          if (!shift.fixedAllowanceAmount || shift.fixedAllowanceAmount <= 0) {
            console.log(`⚠️  Shift "${shift.name}" (${shift.code}): hasAllowance=true but fixedAllowanceAmount=${shift.fixedAllowanceAmount}`);
            console.log(`   Fixing: Set fixedAllowanceAmount to 200 (default NT$200 per night shift)`);
            shift.fixedAllowanceAmount = 200; // Default NT$200 per night shift
            modified = true;
            fixedCount++;
          }
        }
      } else if (shift.isNightShift && !shift.hasAllowance) {
        // Night shift without allowance enabled - enable it with default settings
        console.log(`📝 Shift "${shift.name}" (${shift.code}): isNightShift=true but hasAllowance=false`);
        console.log(`   Fixing: Enabling allowance with 0.34 multiplier (34% - Taiwan standard)`);
        shift.hasAllowance = true;
        shift.allowanceType = 'multiplier';
        shift.allowanceMultiplier = 0.34;
        modified = true;
        fixedCount++;
      }
    }
    
    if (modified) {
      await setting.save();
      fixedCount++;
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`   Settings checked: ${settings.length}`);
  console.log(`   Shifts fixed: ${fixedCount}`);
  
  if (fixedCount > 0) {
    console.log('\n✅ Fixed night shift allowance configurations!');
    console.log('   Default values set:');
    console.log('   - Multiplier type: 0.34 (34% of hourly wage - Taiwan standard)');
    console.log('   - Fixed type: NT$200 per night shift');
    console.log('\n   You can adjust these values through the UI if needed.');
  } else {
    console.log('\n✅ All night shift allowance configurations are already valid!');
  }
}

async function main() {
  try {
    await connectDB();
    await fixNightShiftAllowances();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

main();
