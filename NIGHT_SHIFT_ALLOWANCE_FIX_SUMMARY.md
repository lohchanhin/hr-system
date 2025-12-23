# Night Shift Allowance Fix - Summary

## Issue Summary
**Problem**: Employee worked 14 days of night shifts, system shows 0 NT$ allowance instead of 7,000 NT$ (14 × 500)

**Root Cause**: Night shift configurations in database have `isNightShift: true` but:
- `hasAllowance` is set to `false`, OR
- `fixedAllowanceAmount` is 0 or not set

## Solution Implemented

### 1. Updated Fix Script (`server/scripts/fix-night-shift-allowance.js`)
- Changed default allowance from 200 NT$ to **500 NT$** (matching user's requirement)
- Fixed counter logic to properly track shifts fixed vs settings saved
- Improved reporting with separate counters for shifts and settings

### 2. Updated Documentation
- **NIGHT_SHIFT_FIX_README.md**: Updated to reflect current fixed-allowance-only implementation
- **FIX_NIGHT_SHIFT_ALLOWANCE_ZERO.md**: Comprehensive Chinese guide with:
  - Step-by-step fix instructions
  - Manual UI fix method
  - Troubleshooting guide
  - Technical implementation details

## How to Fix the Issue

### Option 1: Run the Fix Script (Recommended)

```bash
cd server
node scripts/fix-night-shift-allowance.js
```

The script will:
1. Connect to MongoDB database
2. Find all shifts with `isNightShift: true`
3. Enable `hasAllowance: true` if disabled
4. Set `fixedAllowanceAmount: 500` if missing or zero
5. Save changes and report results

**Expected Output:**
```
✅ Connected to MongoDB
🔍 Checking night shift allowance configurations...

📝 Shift "夜班" (NIGHT): isNightShift=true but hasAllowance=false
⚠️  Shift "夜班" (NIGHT): hasAllowance=true but fixedAllowanceAmount=0
   Fixing: Set fixedAllowanceAmount to 500 (default NT$500 per night shift)

📊 Summary:
   Settings checked: 1
   Shifts fixed: 1
   Settings saved: 1

✅ Fixed night shift allowance configurations!
   Default values set:
   - Fixed allowance: NT$500 per night shift

   You can adjust this value through the UI if needed.

✅ Disconnected from MongoDB
```

### Option 2: Manual Fix via UI

1. Go to **排班與班別管理設定** (Shift Schedule Settings)
2. Click on **班別** (Shifts) tab
3. Find night shift and click **編輯** (Edit)
4. Set:
   - ☑️ **是否為夜班** = Yes
   - ☑️ **是否有夜班津貼** = Yes
   - **固定津貼金額** = 500
5. Click **儲存** (Save)

## Verification

After running the fix script:

1. Refresh the salary management page
2. View employee details
3. Check night shift statistics:

**Before Fix:**
```
夜班統計
├─ 夜班天數: 14 天
├─ 夜班時數: 98.00 小時
└─ 夜班津貼: NT$ 0 ⚠️
```

**After Fix:**
```
夜班統計
├─ 夜班天數: 14 天
├─ 夜班時數: 98.00 小時
└─ 夜班津貼: NT$ 7,000 ✅
```

Calculation: 14 days × NT$ 500/day = NT$ 7,000

## Future Prevention

The existing validation in `shiftController.js` prevents this issue:
- When `isNightShift: true` is set, `hasAllowance` is automatically enabled
- When `hasAllowance: true`, system requires `fixedAllowanceAmount > 0`
- Otherwise, error: "啟用夜班津貼時，固定津貼金額必須大於 0"

## Files Changed
1. `server/scripts/fix-night-shift-allowance.js` - Updated default allowance to 500, fixed counter logic
2. `server/scripts/NIGHT_SHIFT_FIX_README.md` - Updated documentation
3. `docs/FIX_NIGHT_SHIFT_ALLOWANCE_ZERO.md` - New comprehensive guide

## No Code Changes Required
All existing validation and calculation logic is correct. The issue is purely data configuration, which the fix script resolves.

## Next Steps for User
1. Run the fix script: `cd server && node scripts/fix-night-shift-allowance.js`
2. Refresh the salary management page
3. Verify night shift allowance displays correctly as 7,000 NT$

For detailed instructions in Chinese, see: `docs/FIX_NIGHT_SHIFT_ALLOWANCE_ZERO.md`
