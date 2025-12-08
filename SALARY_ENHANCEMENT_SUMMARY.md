# Salary Management System Enhancement - Implementation Summary

## Overview

This implementation enhances the HR system's salary management capabilities by integrating:
1. Attendance records (work hours calculation)
2. Leave approval system (leave deductions)
3. Overtime approval system (overtime pay)

## Problem Statement (Original Requirements)

The requirements specified:
1. Need to view monthly salary by organization, department, unit, and employee
2. Salary composition formula:
   - Work days × Work hours = Total work hours
   - Total work hours × Hourly rate = Monthly salary
   - Monthly salary - Deductions = Bank A transfer
   - Bonus portion = Bank B transfer
3. Integration with approval system for leave (different leave types have different calculations)

## Implementation Details

### Phase 1: Backend Enhancement

#### 1. PayrollRecord Model Updates
**File:** `server/src/models/PayrollRecord.js`

Added new fields:
- Work hours tracking: `workDays`, `scheduledHours`, `actualWorkHours`, `hourlyRate`, `dailyRate`
- Leave tracking: `leaveHours`, `paidLeaveHours`, `unpaidLeaveHours`, `sickLeaveHours`, `personalLeaveHours`, `leaveDeduction`
- Overtime tracking: `overtimeHours`, `overtimePay`

#### 2. WorkHoursCalculationService
**File:** `server/src/services/workHoursCalculationService.js`

New service providing:
- `calculateWorkHours()`: Calculates work hours from attendance records and shift schedules
- `calculateLeaveImpact()`: Calculates leave deductions based on leave type:
  - Paid leave (特休, 婚假, 喪假, 產假, 陪產假): No deduction
  - Sick leave (病假): 50% deduction
  - Personal leave (事假): 100% deduction
- `calculateOvertimePay()`: Calculates overtime pay from approved overtime requests (1.5x rate)
- `calculateCompleteWorkData()`: Combines all calculations into complete payroll data

#### 3. PayrollService Updates
**File:** `server/src/services/payrollService.js`

Enhanced `calculateEmployeePayroll()` to:
- Integrate work hours calculation
- Support three salary types:
  - Monthly salary (月薪): Fixed amount
  - Daily salary (日薪): Work days × Daily rate
  - Hourly salary (時薪): Work hours × Hourly rate
- Apply leave deductions automatically
- Include overtime pay in bonuses

#### 4. New API Endpoints
**File:** `server/src/routes/payrollRoutes.js`

Added routes:
- `GET /api/payroll/work-hours/:employeeId/:month` - Work hours breakdown
- `GET /api/payroll/leave-impact/:employeeId/:month` - Leave deductions detail
- `GET /api/payroll/overtime/:employeeId/:month` - Overtime pay detail
- `GET /api/payroll/complete-data/:employeeId/:month` - Complete work data

Enhanced route:
- `GET /api/payroll/overview/monthly` - Now includes work hours, leave, and overtime data

### Phase 2: Frontend Enhancement

#### 1. Monthly Overview Table Updates
**File:** `client/src/components/backComponents/SalaryManagementSetting.vue`

Enhanced the monthly overview table to display:
- **Work Hours Section**: Work days, actual work hours, hourly rate
- **Leave Section**: Leave hours, leave deduction amount
- **Overtime Section**: Overtime hours, overtime pay
- All existing salary components

#### 2. Employee Detail Dialog

Added comprehensive detail dialog showing:

**Basic Information:**
- Employee ID, name, department, unit
- Salary type and month

**Work Hours Statistics:**
- Work days, scheduled hours, actual work hours, hourly rate
- Daily attendance details table with:
  - Date, shift name, scheduled hours, worked hours, attendance status

**Leave Statistics:**
- Total leave hours, paid leave hours, unpaid leave hours
- Leave deduction amount
- Leave records table with:
  - Leave type, dates, days/hours, paid/unpaid status

**Overtime Statistics:**
- Overtime hours, overtime pay
- Overtime records table with:
  - Date, hours, reason

**Salary Calculation Breakdown:**
- Itemized calculation showing:
  - Base salary calculation (varies by salary type)
  - All deductions (leave, insurance, pension, etc.)
  - All bonuses (overtime, night shift, performance, etc.)
  - Final amounts for Bank A (salary) and Bank B (bonuses)

### Phase 3: Documentation

#### 1. User Guide
**File:** `docs/SALARY_CALCULATION_GUIDE.md`

Comprehensive guide covering:
- Salary calculation formulas for all three salary types
- Work hours calculation methodology
- Leave deduction policies by leave type
- Overtime pay calculation
- Bank account distribution (A vs B)
- API endpoint documentation
- Usage instructions
- Troubleshooting guide
- System limitations and future improvements

## Key Features

### 1. Automatic Calculation
- System automatically calculates salary based on attendance records
- No manual data entry required for work hours
- Integrates with existing approval system

### 2. Flexible Salary Types
- Monthly salary: Fixed amount
- Daily salary: Based on work days
- Hourly salary: Based on actual work hours

### 3. Smart Leave Handling
- Different leave types have different pay policies
- Paid leaves: No deduction
- Sick leave: 50% deduction
- Personal leave: Full deduction

### 4. Overtime Integration
- Automatically pulls approved overtime requests
- Calculates overtime pay at 1.5x rate
- Includes in bonus (Bank B) payment

### 5. Dual Bank Account Support
- Bank A: Net salary after deductions
- Bank B: Bonuses (overtime, performance, etc.)

### 6. Detailed Breakdown
- Complete visibility into salary calculation
- Daily attendance records
- Individual leave and overtime records
- Line-by-line calculation breakdown

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vue.js)                        │
│  SalaryManagementSetting.vue                                │
│  - Monthly overview table                                   │
│  - Employee detail dialog                                   │
│  - Filters (organization, department, unit, employee)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Layer (Express)                       │
│  payrollRoutes.js → payrollController.js                    │
│  - GET /overview/monthly                                    │
│  - GET /work-hours/:id/:month                               │
│  - GET /leave-impact/:id/:month                             │
│  - GET /overtime/:id/:month                                 │
│  - GET /complete-data/:id/:month                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Service Layer                              │
│  payrollService.js                                          │
│  - calculateEmployeePayroll()                               │
│                                                             │
│  workHoursCalculationService.js                             │
│  - calculateWorkHours()                                     │
│  - calculateLeaveImpact()                                   │
│  - calculateOvertimePay()                                   │
│  - calculateCompleteWorkData()                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Data Layer (MongoDB)                       │
│  - Employee                                                 │
│  - PayrollRecord                                            │
│  - AttendanceRecord                                         │
│  - ShiftSchedule                                            │
│  - AttendanceSetting                                        │
│  - ApprovalRequest (for leave and overtime)                 │
│  - FormTemplate & FormField                                 │
└─────────────────────────────────────────────────────────────┘
```

## Calculation Flow

```
1. User selects month and filters
                ↓
2. System fetches employees matching filters
                ↓
3. For each employee:
   a. Check if PayrollRecord exists for the month
   b. If not, calculate automatically:
      ↓
      - Fetch shift schedules
      - Fetch attendance records
      - Calculate work hours
      ↓
      - Fetch approved leave requests
      - Calculate leave impact
      ↓
      - Fetch approved overtime requests
      - Calculate overtime pay
      ↓
      - Calculate base salary based on salary type
      - Apply leave deductions
      - Calculate insurance/pension deductions
      - Calculate net pay (Bank A)
      - Calculate bonuses (Bank B)
                ↓
4. Display results in overview table
                ↓
5. User clicks "詳細" to view breakdown
                ↓
6. System fetches complete work data
                ↓
7. Display detailed dialog with all calculations
```

## Data Sources

### Work Hours
- **Source:** ShiftSchedule + AttendanceRecord
- **Calculation:** 
  - Scheduled hours from shift settings
  - Actual hours from clock-in/clock-out records
  - Break time from shift configuration

### Leave Impact
- **Source:** ApprovalRequest (請假 form)
- **Fields Used:**
  - Leave type (假別)
  - Start/end dates
  - Days/hours
- **Status Filter:** status = 'approved'

### Overtime
- **Source:** ApprovalRequest (加班 form)
- **Fields Used:**
  - Overtime date
  - Overtime hours
  - Reason
- **Status Filter:** status = 'approved'
- **Condition:** Employee has autoOvertimeCalc = true

## Formulas

### 1. Base Salary

**Monthly Salary:**
```
baseSalary = employee.salaryAmount
```

**Daily Salary:**
```
baseSalary = workDays × dailyRate
dailyRate = employee.salaryAmount
```

**Hourly Salary:**
```
baseSalary = actualWorkHours × hourlyRate
hourlyRate = employee.salaryAmount
```

### 2. Hourly Rate Conversion

For leave and overtime calculations:

```
// Monthly salary
hourlyRate = salaryAmount ÷ 30 days ÷ 8 hours

// Daily salary
hourlyRate = salaryAmount ÷ 8 hours

// Hourly salary
hourlyRate = salaryAmount
```

### 3. Leave Deduction

```
// Paid leave (特休, 婚假, etc.)
deduction = 0

// Sick leave (病假)
deduction = sickLeaveHours × hourlyRate × 0.5

// Personal leave (事假)
deduction = personalLeaveHours × hourlyRate × 1.0

// Total leave deduction
leaveDeduction = unpaidLeaveHours × hourlyRate
```

### 4. Overtime Pay

```
overtimePay = overtimeHours × hourlyRate × 1.5
```

### 5. Net Pay

```
netPay = baseSalary 
         - leaveDeduction
         - laborInsuranceFee
         - healthInsuranceFee
         - laborPensionSelf
         - employeeAdvance
         - debtGarnishment
         - otherDeductions
```

### 6. Total Bonus

```
totalBonus = overtimePay
            + nightShiftAllowance
            + performanceBonus
            + otherBonuses
```

## System Assumptions

1. **Standard work day:** 8 hours
2. **Standard month:** 30 days
3. **Overtime rate:** 1.5x (simplified, actual labor law has tiered rates)
4. **Sick leave:** 50% pay (simplified, actual rules based on tenure and days)
5. **Break time:** Configured per shift, deducted from work hours

## Known Limitations

1. **Overtime calculation** is simplified to 1.5x for all overtime. Labor law actually specifies:
   - Weekday overtime (first 2 hrs): 1.33x
   - Weekday overtime (after 2 hrs): 1.66x
   - Rest day: 1.33x - 1.66x
   - Holiday: 2x

2. **Sick leave** is simplified to 50% deduction. Labor law specifies:
   - First 30 days: Full or half pay depending on tenure
   - After 30 days: Half pay

3. **Work day assumption** of 8 hours may not fit all companies

4. **Month assumption** of 30 days is simplified

## Future Enhancements

1. **Flexible work hours:** Support configurable daily/weekly hours
2. **Accurate overtime rates:** Implement full labor law compliance
3. **Sick leave tracking:** Annual accumulation with proper pay calculation
4. **Additional leave types:** Public leave, injury leave, etc.
5. **Tax withholding:** Integrate income tax calculation
6. **Compensatory time off:** Allow overtime to be converted to time off
7. **Flexible work schedules:** Support various work arrangements

## Testing Recommendations

### Test Cases

1. **Monthly Salary Employee:**
   - Create employee with 月薪 type
   - Verify base salary equals fixed amount
   - Test leave deduction calculation
   - Test overtime pay addition to bonus

2. **Daily Salary Employee:**
   - Create employee with 日薪 type
   - Verify base salary = work days × daily rate
   - Test with partial month attendance

3. **Hourly Salary Employee:**
   - Create employee with 時薪 type
   - Verify base salary = work hours × hourly rate
   - Test with varying daily hours

4. **Leave Types:**
   - Test paid leave (特休) - should not deduct
   - Test sick leave (病假) - should deduct 50%
   - Test personal leave (事假) - should deduct 100%

5. **Overtime:**
   - Create approved overtime request
   - Verify overtime pay calculation
   - Verify inclusion in total bonus

6. **Bank Account Split:**
   - Verify netPay goes to Bank A
   - Verify totalBonus goes to Bank B

## Security Considerations

1. **Authorization:** Ensure only authorized users can view salary data
2. **Data Privacy:** Implement proper access controls for sensitive salary information
3. **Audit Trail:** Consider logging all salary calculations and modifications
4. **Data Validation:** Validate all input parameters to prevent injection attacks

## Performance Considerations

1. **Caching:** Consider caching calculated payroll records
2. **Batch Processing:** For monthly calculation of all employees, implement batch processing
3. **Database Indexes:** Ensure proper indexes on:
   - Employee queries (organization, department, subDepartment)
   - PayrollRecord queries (month, employee)
   - AttendanceRecord queries (employee, timestamp)
   - ApprovalRequest queries (applicant_employee, createdAt, status)

## Conclusion

This implementation successfully addresses all requirements in the problem statement:

1. ✅ View monthly salary by organization, department, unit, and employee
2. ✅ Salary calculation based on work days × work hours × hourly rate
3. ✅ Deductions subtracted to get Bank A transfer amount
4. ✅ Bonuses sent to Bank B
5. ✅ Integration with approval system for dynamic leave calculation

The system provides a comprehensive, automated salary calculation solution that integrates seamlessly with the existing HR system's attendance and approval workflows.
