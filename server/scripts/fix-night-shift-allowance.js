/**
 * Migration script to fix night shift allowance configuration
 *
 * This script checks all shifts with hasAllowance=true and ensures they have
 * a valid fixedAllowanceAmount > 0 (fixed allowance only)
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
  
  let shiftsFixed = 0;
  let settingsSaved = 0;
  
  for (const setting of settings) {
    if (!setting.shifts || setting.shifts.length === 0) {
      continue;
    }
    
    let modified = false;
    
    for (const shift of setting.shifts) {
      // Check if this is a night shift with allowance enabled
      if (shift.isNightShift) {
        let shiftNeedsFixing = false;
        
        if (!shift.hasAllowance) {
          console.log(`📝 Shift "${shift.name}" (${shift.code}): isNightShift=true but hasAllowance=false`);
          shift.hasAllowance = true;
          modified = true;
          shiftNeedsFixing = true;
        }

        if (!shift.fixedAllowanceAmount || shift.fixedAllowanceAmount <= 0) {
          console.log(`⚠️  Shift "${shift.name}" (${shift.code}): hasAllowance=true but fixedAllowanceAmount=${shift.fixedAllowanceAmount}`);
          console.log('   Fixing: Set fixedAllowanceAmount to 500 (default NT$500 per night shift)');
          shift.fixedAllowanceAmount = 500; // Default NT$500 per night shift
          modified = true;
          shiftNeedsFixing = true;
        }
        
        if (shiftNeedsFixing) {
          shiftsFixed++;
        }
      }
    }
    
    if (modified) {
      await setting.save();
      settingsSaved++;
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`   Settings checked: ${settings.length}`);
  console.log(`   Shifts fixed: ${shiftsFixed}`);
  console.log(`   Settings saved: ${settingsSaved}`);
  
  if (shiftsFixed > 0) {
    console.log('\n✅ Fixed night shift allowance configurations!');
    console.log('   Default values set:');
    console.log('   - Fixed allowance: NT$500 per night shift');
    console.log('\n   You can adjust this value through the UI if needed.');
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
