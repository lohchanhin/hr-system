# Night Shift Allowance Fix Script

## Problem
Night shifts are being counted in the monthly salary overview but no allowance is being calculated. This happens when:
- A shift has `isNightShift: true` and `hasAllowance: true`
- But `fixedAllowanceAmount` is 0 or not set

## Solution
This script checks all shift configurations and:
1. Automatically enables `hasAllowance: true` for all shifts marked as `isNightShift: true`
2. Sets `fixedAllowanceAmount: 500` (NT$500 per night shift) for shifts with missing or zero allowance amounts
3. Reports all fixes made

## Usage

### Run the fix script
```bash
cd server
node scripts/fix-night-shift-allowance.js
```

The script will:
- Connect to the MongoDB database specified in `.env` file
- Find all shifts with `isNightShift: true`
- Enable `hasAllowance: true` if it's disabled
- Set `fixedAllowanceAmount: 500` if it's 0 or missing
- Save changes and report the number of shifts fixed

### Expected Output
```
✅ Connected to MongoDB
🔍 Checking night shift allowance configurations...

📝 Shift "夜班" (NIGHT): isNightShift=true but hasAllowance=false
⚠️  Shift "夜班" (NIGHT): hasAllowance=true but fixedAllowanceAmount=0
   Fixing: Set fixedAllowanceAmount to 500 (default NT$500 per night shift)

📊 Summary:
   Settings checked: 1
   Shifts fixed: 1

✅ Fixed night shift allowance configurations!
   Default values set:
   - Fixed allowance: NT$500 per night shift

   You can adjust this value through the UI if needed.

✅ Disconnected from MongoDB
```

## Manual Fix via UI
If you prefer to manually configure the allowance:

1. Go to **排班與班別管理設定** (Shift Schedule Settings)
2. Click on **班別** (Shifts) tab
3. Find the night shift and click **編輯** (Edit)
4. Ensure the following are set:
   - ☑️ **是否為夜班** (Is Night Shift) = Yes
   - ☑️ **是否有夜班津貼** (Has Allowance) = Yes
   - **固定津貼金額** (Fixed Allowance Amount) > 0 (e.g., 500)
5. Click **儲存** (Save)

## Changes Made
The following fixes were implemented:

### 1. nightShiftAllowanceService.js
- Calculates night shift allowance based on `fixedAllowanceAmount` per shift
- Logs configuration issues when shifts have invalid settings
- Returns detailed breakdown with `configurationIssues` array

### 2. shiftController.js
- Validates that `fixedAllowanceAmount > 0` when `hasAllowance: true`
- Automatically enables `hasAllowance` when a shift is marked as `isNightShift`
- Prevents saving invalid configurations

### 3. fix-night-shift-allowance.js
- Automatically fixes all night shifts with missing allowance configuration
- Sets default value to NT$500 per night shift (can be adjusted in the script)

### 4. Validation
Now when creating or updating a shift via API with `hasAllowance: true`:
- `fixedAllowanceAmount` must be > 0
- Otherwise, an error is returned: "啟用夜班津貼時，固定津貼金額必須大於 0"
