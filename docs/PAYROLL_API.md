# Payroll API Documentation

## Overview
The Payroll API provides comprehensive payroll calculation and management features, including:
- Two-stage payroll calculation (deductions and bonuses)
- Labor insurance rate management (28 levels)
- Bank transfer file generation for Taiwan Business Bank and Taichung Bank
- Employee payroll history tracking

## Base URL
All endpoints are prefixed with `/api/payroll`

---

## Endpoints

### 1. List Payroll Records
**GET** `/api/payroll`

List all payroll records with optional filtering.

**Query Parameters:**
- `month` (optional): Filter by month (format: YYYY-MM-DD)
- `employeeId` (optional): Filter by employee ID

**Response:**
```json
[
  {
    "_id": "payroll_id",
    "employee": {
      "_id": "employee_id",
      "name": "Employee Name",
      "email": "email@example.com"
    },
    "month": "2025-11-01T00:00:00.000Z",
    "baseSalary": 45600,
    "laborInsuranceFee": 1145,
    "healthInsuranceFee": 710,
    "laborPensionSelf": 2748,
    "employeeAdvance": 0,
    "debtGarnishment": 0,
    "otherDeductions": 0,
    "netPay": 42142,
    "nightShiftAllowance": 2700,
    "performanceBonus": 0,
    "otherBonuses": 0,
    "totalBonus": 2700,
    "insuranceLevel": 28
  }
]
```

---

### 2. Create Payroll Record
**POST** `/api/payroll`

Create a new payroll record manually.

**Request Body:**
```json
{
  "employee": "employee_id",
  "month": "2025-11-01",
  "baseSalary": 45600,
  "laborInsuranceFee": 1145,
  "healthInsuranceFee": 710,
  "laborPensionSelf": 2748,
  "netPay": 42142
}
```

**Response:** Created payroll record (201)

---

### 3. Get Payroll Record by ID
**GET** `/api/payroll/:id`

Get a specific payroll record by ID.

**Response:** Single payroll record object

---

### 4. Update Payroll Record
**PUT** `/api/payroll/:id`

Update an existing payroll record.

**Request Body:** Updated payroll fields
**Response:** Updated payroll record

---

### 5. Delete Payroll Record
**DELETE** `/api/payroll/:id`

Delete a payroll record.

**Response:** 
```json
{ "success": true }
```

---

### 6. Calculate Payroll
**POST** `/api/payroll/calculate`

Calculate payroll for a single employee without saving.

**Request Body:**
```json
{
  "employeeId": "employee_id",
  "month": "2025-11-01",
  "customData": {
    "baseSalary": 45600,
    "healthInsuranceFee": 710,
    "nightShiftAllowance": 2700,
    "performanceBonus": 0,
    "otherBonuses": 0
  }
}
```

**Notes:**
- `customData` is optional. If not provided, values from employee record are used.
- `baseSalary`: Override employee's salary amount
- `laborInsuranceFee`: Auto-calculated based on salary if not provided
- `laborPensionSelf`: From employee record if not provided
- `employeeAdvance`: From employee record if not provided

**Response:**
```json
{
  "employee": "employee_id",
  "month": "2025-11-01T00:00:00.000Z",
  "baseSalary": 45600,
  "laborInsuranceFee": 1145,
  "healthInsuranceFee": 710,
  "laborPensionSelf": 2748,
  "employeeAdvance": 0,
  "debtGarnishment": 0,
  "otherDeductions": 0,
  "netPay": 42142,
  "nightShiftAllowance": 2700,
  "performanceBonus": 0,
  "otherBonuses": 0,
  "totalBonus": 2700,
  "insuranceLevel": 28,
  "bankAccountA": {
    "bank": "Taiwan Business Bank",
    "accountNumber": "12345678",
    "accountName": "Employee Name"
  },
  "bankAccountB": {
    "bank": "Taichung Bank",
    "accountNumber": "87654321",
    "accountName": "Employee Name"
  }
}
```

---

### 7. Calculate Batch Payroll
**POST** `/api/payroll/calculate/batch`

Calculate payroll for multiple employees at once.

**Request Body:**
```json
{
  "employees": ["emp_id_1", "emp_id_2", "emp_id_3"],
  "month": "2025-11-01",
  "customDataMap": {
    "emp_id_1": {
      "healthInsuranceFee": 710,
      "nightShiftAllowance": 2700
    },
    "emp_id_2": {
      "healthInsuranceFee": 650,
      "performanceBonus": 5000
    }
  }
}
```

**Response:** Array of calculated payroll objects

---

### 8. Calculate and Save Payroll
**POST** `/api/payroll/calculate/save`

Calculate payroll for an employee and save it to the database.

**Request Body:**
```json
{
  "employeeId": "employee_id",
  "month": "2025-11-01",
  "customData": {
    "healthInsuranceFee": 710,
    "nightShiftAllowance": 2700
  }
}
```

**Response:** Saved payroll record (201)

---

### 9. Get Employee Payroll Records
**GET** `/api/payroll/employee/:employeeId`

Get all payroll records for a specific employee.

**Query Parameters:**
- `month` (optional): Filter by specific month

**Response:** Array of payroll records for the employee

---

### 10. Export Payroll Excel
**POST** `/api/payroll/export?month=YYYY-MM-DD&bankType=taiwan|taichung`

Generate Excel file for bank transfer in Taiwan Business Bank or Taichung Bank format.

**Query Parameters:**
- `month` (required): Month to export (format: YYYY-MM-DD)
- `bankType` (required): Either "taiwan" or "taichung"

**Request Body (Company Information):**
```json
{
  "companyName": "Company Name",
  "companyCode": "6204",
  "paymentAccount": "52012170505",
  "paymentAccountName": "Company Account Name",
  "bankCode": "050",
  "branchCode": "5206",
  "paymentDate": "20251110",
  "transferAccount": "054-28-0062515",
  "branchName": "埔里",
  "branchFullCode": "054"
}
```

**Response:** Excel file (.xlsx)

**Taiwan Business Bank Format Includes:**
- Payer information
- Recipient details for each employee
- Bank account information
- ID numbers and email addresses

**Taichung Bank Format Includes:**
- Transfer delivery slip (薪津轉帳遞送單)
- Transfer list (薪津轉帳清冊)
- Checksum verification
- Total amounts

---

### 11. Get Labor Insurance Rates
**GET** `/api/payroll/insurance/rates`

Get all 28 levels of labor insurance rates.

**Response:**
```json
[
  {
    "level": 1,
    "ordinaryRate": 11.5,
    "employmentInsuranceRate": 1.0,
    "insuredSalary": 11100,
    "workerFee": 277,
    "employerFee": 972
  },
  {
    "level": 2,
    "ordinaryRate": 11.5,
    "employmentInsuranceRate": 1.0,
    "insuredSalary": 12540,
    "workerFee": 313,
    "employerFee": 1097
  },
  ...
]
```

---

### 12. Initialize Labor Insurance Rates
**POST** `/api/payroll/insurance/initialize`

Initialize or update the labor insurance rates table with the 28 standard levels.

**Response:**
```json
{
  "success": true,
  "count": 28,
  "message": "Labor insurance rates initialized"
}
```

---

## Data Models

### PayrollRecord Schema

```javascript
{
  employee: ObjectId,           // Reference to Employee
  month: Date,                  // Payroll month
  
  // Stage A: Deductions
  baseSalary: Number,           // Base salary (合計)
  laborInsuranceFee: Number,    // Labor insurance fee (勞保費自付額)
  healthInsuranceFee: Number,   // Health insurance fee (健保費自付額)
  laborPensionSelf: Number,     // Labor pension contribution (勞退個人提繳)
  employeeAdvance: Number,      // Employee advance (員工借支)
  debtGarnishment: Number,      // Debt garnishment (債權扣押)
  otherDeductions: Number,      // Other deductions (其他)
  netPay: Number,               // Net payment (實領金額)
  
  // Stage B: Bonuses
  nightShiftAllowance: Number,  // Night shift allowance (夜班補助津貼)
  performanceBonus: Number,     // Performance bonus (人力績效獎金)
  otherBonuses: Number,         // Other bonuses (其他)
  totalBonus: Number,           // Total bonus (獎金合計)
  
  // Bank accounts
  bankAccountA: {
    bank: String,
    bankCode: String,
    branchCode: String,
    accountNumber: String,
    accountName: String
  },
  bankAccountB: {
    bank: String,
    bankCode: String,
    branchCode: String,
    accountNumber: String,
    accountName: String
  },
  
  insuranceLevel: Number,       // Labor insurance level (1-28)
  notes: String                 // Additional notes
}
```

### LaborInsuranceRate Schema

```javascript
{
  level: Number,                    // Level (1-28)
  ordinaryRate: Number,             // Ordinary rate (%)
  employmentInsuranceRate: Number,  // Employment insurance rate (%)
  insuredSalary: Number,            // Insured salary (投保薪資)
  workerFee: Number,                // Worker fee (勞工應負擔保費金額)
  employerFee: Number               // Employer fee (單位應負擔保費金額)
}
```

---

## Calculation Logic

### Payroll Calculation Flow

1. **Retrieve Employee Data**: Get base salary and bank account info from employee record
2. **Determine Insurance Level**: Find appropriate labor insurance level based on salary
3. **Calculate Stage A (Deductions)**:
   - Labor Insurance Fee: Auto-calculated from insurance level
   - Health Insurance Fee: Provided or 0
   - Labor Pension: From employee record
   - Employee Advance: From employee record
   - Other Deductions: Provided or 0
   - **Net Pay** = Base Salary - Total Deductions

4. **Calculate Stage B (Bonuses)**:
   - Night Shift Allowance: Provided or 0
   - Performance Bonus: Provided or 0
   - Other Bonuses: Provided or 0
   - **Total Bonus** = Sum of all bonuses

5. **Store Bank Information**: Copy from employee's two bank accounts

---

## Usage Examples

### Example 1: Calculate and Save Monthly Payroll

```javascript
// Calculate payroll for November 2025
const response = await fetch('/api/payroll/calculate/save', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    employeeId: '507f1f77bcf86cd799439011',
    month: '2025-11-01',
    customData: {
      healthInsuranceFee: 710,
      nightShiftAllowance: 2700
    }
  })
});

const payroll = await response.json();
console.log(`Net Pay: ${payroll.netPay}, Total Bonus: ${payroll.totalBonus}`);
```

### Example 2: Batch Calculate for All Employees

```javascript
const employeeIds = ['emp1', 'emp2', 'emp3'];
const response = await fetch('/api/payroll/calculate/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    employees: employeeIds,
    month: '2025-11-01',
    customDataMap: {
      'emp1': { healthInsuranceFee: 710, nightShiftAllowance: 2700 },
      'emp2': { healthInsuranceFee: 650, performanceBonus: 5000 },
      'emp3': { healthInsuranceFee: 800 }
    }
  })
});

const results = await response.json();
```

### Example 3: Export Taiwan Business Bank Transfer File

```javascript
const response = await fetch('/api/payroll/export?month=2025-11-01&bankType=taiwan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    paymentDate: '20251110',
    paymentAccount: '52012170505',
    paymentAccountName: '和泰護理之家林麗君',
    bankCode: '050',
    branchCode: '5206'
  })
});

const blob = await response.blob();
// Download or save the Excel file
```

### Example 4: Initialize Labor Insurance Rates

```javascript
const response = await fetch('/api/payroll/insurance/initialize', {
  method: 'POST'
});

const result = await response.json();
console.log(`Initialized ${result.count} insurance rate levels`);
```

---

## Error Handling

All endpoints return appropriate HTTP status codes:
- **200**: Success
- **201**: Created
- **400**: Bad Request (missing or invalid parameters)
- **404**: Not Found
- **500**: Internal Server Error

Error responses include an error message:
```json
{
  "error": "Error message description"
}
```

---

## Notes

1. **Two-Stage Process**: The system separates salary calculation into two stages:
   - **Stage A**: Net payment after deductions (transferred to Bank A)
   - **Stage B**: Bonus payments (transferred separately)

2. **Labor Insurance**: The system automatically determines the appropriate insurance level based on the employee's salary and applies the correct worker fee.

3. **Bank Accounts**: Each employee can have two bank accounts configured for different payment purposes.

4. **Excel Formats**: Two different Excel formats are supported for different banks' transfer requirements.

5. **Month Format**: Always use YYYY-MM-DD format, typically the first day of the month (e.g., '2025-11-01' for November 2025).

---

## Migration Guide

If you have existing payroll records with only the `amount` field, they will continue to work. New fields have default values of 0, and the legacy `amount` field is maintained for backward compatibility.
