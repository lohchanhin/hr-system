# Night Shift Allowance Fix Script

## Problem
Night shifts are being counted in the monthly salary overview but no allowance is being calculated. This happens when:
- A shift has `isNightShift: true` and `hasAllowance: true`
- But `allowanceMultiplier` is 0 or not set (for multiplier type)
- Or `fixedAllowanceAmount` is 0 or not set (for fixed type)

## Solution
This script checks all shift configurations and:
1. Sets default `allowanceType: 'multiplier'` if not set
2. Reports any shifts with invalid allowance configuration
3. Provides guidance on how to fix them

## Usage

### Check for issues without fixing
```bash
cd server
node scripts/fix-night-shift-allowance.js
```

### Fix the issue
To automatically set a default multiplier (e.g., 0.34 for 34% allowance), uncomment lines 76-78 in the script:
```javascript
// shift.allowanceMultiplier = 0.34; // 34% default
// modified = true;
// fixedCount++;
```

Then run:
```bash
node scripts/fix-night-shift-allowance.js
```

## Manual Fix via UI
1. Go to 考勤設定 (Attendance Settings)
2. Find the night shift班別 (Shift)
3. Ensure the following are set:
   - ☑️ 是否為夜班 (Is Night Shift)
   - ☑️ 是否有夜班津貼 (Has Allowance)
   - If using "倍率計算" (Multiplier): Set 津貼倍數 > 0 (e.g., 0.34)
   - If using "固定津貼" (Fixed): Set 固定津貼金額 > 0 (e.g., 200)

## Changes Made
The following fixes were implemented:

### 1. nightShiftAllowanceService.js
- Added logging when shifts have invalid configuration
- Handle undefined `allowanceType` by defaulting to 'multiplier'

### 2. shiftController.js
- Added handling for `allowanceType` and `fixedAllowanceAmount` fields
- Added validation: when creating/updating shifts with `hasAllowance=true`, require valid allowance configuration

### 3. Validation
Now when creating or updating a shift via API with `hasAllowance: true`:
- If `allowanceType` is 'multiplier': `allowanceMultiplier` must be > 0
- If `allowanceType` is 'fixed': `fixedAllowanceAmount` must be > 0
- Otherwise, an error is returned: "啟用夜班津貼時，倍率必須大於 0" or "啟用夜班津貼時，固定津貼金額必須大於 0"
