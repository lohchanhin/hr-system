# Night Shift Allowance Fix Instructions

## Problem Summary

### Issue
When viewing employee salary details, the night shift statistics showed:
- ✅ Night shift days: 14 days (correctly calculated)
- ✅ Night shift hours: 98.00 hours (correctly calculated)
- ❌ Night shift allowance: NT$ 0 (incorrect - should be > 0)

This happened because shift configurations in the database had `isNightShift: true` and `hasAllowance: true` but `allowanceMultiplier: 0`, resulting in zero allowance being calculated.

### Root Cause
1. **Historical data**: Shifts created before validation was added had invalid default values (`allowanceMultiplier: 0`)
2. **Model defaults**: The `AttendanceSetting` model originally set `allowanceMultiplier` default to 0
3. **Controller defaults**: The `shiftController` also used 0 as fallback when values were not provided

## Solution Implemented

### 1. Updated Model Defaults (AttendanceSetting.js)
Changed the default values to reasonable Taiwan standards:
```javascript
allowanceMultiplier: { type: Number, default: 0.34 }  // 34% of hourly wage
fixedAllowanceAmount: { type: Number, default: 200 }  // NT$200 per night shift
```

### 2. Updated Controller Defaults (shiftController.js)
Updated the controller to use the same reasonable defaults when creating/updating shifts:
```javascript
allowanceMultiplier: ... ?? 0.34  // Taiwan standard
fixedAllowanceAmount: ... ?? 200  // NT$200 default
```

### 3. Enhanced Fix Script (fix-night-shift-allowance.js)
The migration script now:
- ✅ Automatically fixes shifts with `hasAllowance: true` but invalid multiplier/amount
- ✅ Enables allowance for night shifts that have `isNightShift: true` but `hasAllowance: false`
- ✅ Sets Taiwan standard defaults (0.34 multiplier or NT$200 fixed)
- ✅ Reports all changes made

## How to Apply the Fix

### For Existing Database
Run the migration script to fix all existing shift configurations:

```bash
cd server
node scripts/fix-night-shift-allowance.js
```

This will:
1. Connect to your MongoDB database
2. Find all shifts with invalid night shift allowance configuration
3. Automatically fix them by setting reasonable defaults
4. Save the updated configurations
5. Display a summary of changes made

### Expected Output
```
🔍 Checking night shift allowance configurations...

📝 Shift "夜班" (N1): isNightShift=true but hasAllowance=false
   Fixing: Enabling allowance with 0.34 multiplier (34% - Taiwan standard)

⚠️  Shift "夜班A" (NA): hasAllowance=true but allowanceMultiplier=0
   Fixing: Set allowanceMultiplier to 0.34 (34% allowance - Taiwan standard)

📊 Summary:
   Settings checked: 1
   Shifts fixed: 2

✅ Fixed night shift allowance configurations!
   Default values set:
   - Multiplier type: 0.34 (34% of hourly wage - Taiwan standard)
   - Fixed type: NT$200 per night shift

   You can adjust these values through the UI if needed.
```

## Verification

After running the fix script, verify the changes:

1. **Check the UI**: Go to Salary Management Setting → Monthly Overview
2. **View employee details**: Click on an employee with night shifts
3. **Verify allowance**: The night shift allowance should now show a non-zero value
4. **Check calculation method**: Should show "根據排班計算" (Calculated based on schedule)

### Example Expected Result
```
夜班統計
├─ 夜班天數: 14 天
├─ 夜班時數: 98.00 小時
└─ 夜班津貼: NT$ 3,293
   └─ 根據排班計算
```

## Understanding the Calculation

### Multiplier Type (Default)
```
Night Shift Allowance = Hourly Rate × Night Shift Hours × Multiplier

Example:
- Monthly Salary: 40,000
- Hourly Rate: 40,000 ÷ 30 days ÷ 8 hours = 166.67
- Night Shift Hours: 98 hours
- Multiplier: 0.34 (34%)
- Allowance: 166.67 × 98 × 0.34 = 5,556
```

### Fixed Type
```
Night Shift Allowance = Fixed Amount × Number of Night Shifts

Example:
- Fixed Amount: NT$200 per night shift
- Number of Night Shifts: 14 days
- Allowance: 200 × 14 = 2,800
```

## Adjusting Allowance Rates

You can adjust the allowance rates for individual shifts through the UI:

1. Go to **Attendance Settings** (考勤設定)
2. Find the shift you want to modify
3. Edit the shift settings
4. Under "Night Shift Allowance" section:
   - **Enable Allowance**: Check the box
   - **Allowance Type**: Choose "Multiplier" or "Fixed"
   - **Multiplier**: Set the rate (e.g., 0.34 for 34%)
   - **Fixed Amount**: Set the fixed amount (e.g., 200 for NT$200)
5. Save the changes

## Taiwan Labor Standards

The default 34% (0.34) multiplier is based on common Taiwan labor standards for night shift compensation:
- **Night shift hours**: Typically 22:00 - 06:00
- **Standard allowance**: 34% of hourly wage
- **Calculation method**: Based on actual hours worked during night shift periods

Some organizations may use different rates or fixed amounts based on their specific policies. The system is flexible to accommodate these variations.

## Troubleshooting

### Issue: Allowance still shows 0 after running the script
**Solution**: 
1. Check if the shift has `isNightShift: true` in the database
2. Verify the script completed successfully without errors
3. Clear any cached payroll records
4. Recalculate the payroll for the affected month

### Issue: Script shows "No attendance settings found"
**Solution**: 
1. Ensure your attendance settings are configured
2. Create at least one shift through the UI
3. Run the script again

### Issue: Different allowance rate needed
**Solution**: 
1. After running the fix script, adjust rates through the UI
2. Alternatively, modify the script defaults before running:
   ```javascript
   shift.allowanceMultiplier = 0.40; // 40% instead of 34%
   shift.fixedAllowanceAmount = 250; // NT$250 instead of NT$200
   ```

## Technical Notes

### Validation
The system now validates night shift allowance configuration at multiple levels:
1. **Model level**: Reasonable defaults set in schema
2. **Controller level**: Validation prevents invalid configurations
3. **Service level**: Detects and reports configuration issues

### Backward Compatibility
- Existing shifts with valid configurations are not modified
- The fix only updates invalid configurations
- Custom allowance rates are preserved
- New shifts automatically get reasonable defaults

### Future Prevention
With the changes made:
- ✅ New shifts cannot be created with invalid allowance configuration
- ✅ Model defaults prevent 0 values
- ✅ Controller validation enforces rules
- ✅ Clear error messages guide users to fix issues

## Related Files Modified

1. `server/src/models/AttendanceSetting.js` - Model defaults
2. `server/src/controllers/shiftController.js` - Controller defaults and validation
3. `server/scripts/fix-night-shift-allowance.js` - Migration script

## Support

If you encounter any issues with the night shift allowance calculation:
1. Check the employee detail dialog for "夜班津貼" section
2. Look for configuration issue warnings (red alert boxes)
3. Review the shift settings in Attendance Settings
4. Run the fix script if needed
5. Contact system administrator if issues persist
