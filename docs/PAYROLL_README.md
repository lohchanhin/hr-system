# Payroll Calculation System

## Quick Start

### 1. Initialize Labor Insurance Rates
Before using the payroll system, initialize the 28-level labor insurance rate table:

```bash
curl -X POST http://localhost:3000/api/payroll/insurance/initialize
```

### 2. Calculate Employee Payroll
Calculate payroll for a single employee:

```bash
curl -X POST http://localhost:3000/api/payroll/calculate/save \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "YOUR_EMPLOYEE_ID",
    "month": "2025-11-01",
    "customData": {
      "healthInsuranceFee": 710,
      "nightShiftAllowance": 2700
    }
  }'
```

### 3. Export Bank Transfer File
Generate Excel file for bank transfer:

```bash
# Taiwan Business Bank format
curl -X POST "http://localhost:3000/api/payroll/export?month=2025-11-01&bankType=taiwan" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentDate": "20251110",
    "paymentAccount": "52012170505",
    "paymentAccountName": "Company Name",
    "bankCode": "050",
    "branchCode": "5206"
  }' \
  --output payroll_taiwan.xlsx

# Taichung Bank format
curl -X POST "http://localhost:3000/api/payroll/export?month=2025-11-01&bankType=taichung" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "公司名稱",
    "companyCode": "6204",
    "transferAccount": "054-28-0062515",
    "branchName": "埔里",
    "branchFullCode": "054"
  }' \
  --output payroll_taichung.xlsx
```

## Features

### Two-Stage Payroll Processing

#### Stage A: Net Payment (實領金額)
Calculation for the amount transferred to Bank Account A:
```
Net Pay = Base Salary 
          - Labor Insurance Fee (勞保費自付額)
          - Health Insurance Fee (健保費自付額)
          - Labor Pension (勞退個人提繳)
          - Employee Advance (員工借支)
          - Debt Garnishment (債權扣押)
          - Other Deductions (其他)
```

#### Stage B: Bonus Payment (獎金合計)
Calculation for bonus amounts:
```
Total Bonus = Night Shift Allowance (夜班補助津貼)
              + Performance Bonus (人力績效獎金)
              + Other Bonuses (其他)
```

### Labor Insurance Rates (28 Levels)
Automatic determination of appropriate insurance level based on employee salary:

| Level | Salary Range | Worker Fee | Employer Fee |
|-------|--------------|------------|--------------|
| 1     | ≤ 11,100     | 277        | 972          |
| 2     | ≤ 12,540     | 313        | 1,097        |
| ...   | ...          | ...        | ...          |
| 28    | ≤ 45,800     | 1,145      | 4,008        |

### Bank Transfer Export Formats

#### Taiwan Business Bank (臺灣企銀)
- Payer and recipient information
- Bank codes and account numbers
- Email notification support
- Standard transfer format

#### Taichung Bank (台中商銀)
- Transfer delivery slip (薪津轉帳遞送單)
- Detailed transfer list (薪津轉帳清冊)
- Checksum verification
- Company information

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/payroll` | GET | List all payroll records |
| `/api/payroll` | POST | Create payroll record |
| `/api/payroll/:id` | GET | Get specific payroll |
| `/api/payroll/:id` | PUT | Update payroll |
| `/api/payroll/:id` | DELETE | Delete payroll |
| `/api/payroll/calculate` | POST | Calculate (no save) |
| `/api/payroll/calculate/batch` | POST | Batch calculate |
| `/api/payroll/calculate/save` | POST | Calculate & save |
| `/api/payroll/employee/:employeeId` | GET | Employee history |
| `/api/payroll/export` | POST | Generate Excel |
| `/api/payroll/insurance/rates` | GET | Get insurance rates |
| `/api/payroll/insurance/initialize` | POST | Setup insurance rates |

## Documentation

- **[API Documentation](./PAYROLL_API.md)** - Complete API reference with examples
- **[Implementation Summary](./PAYROLL_IMPLEMENTATION.md)** - Technical details and architecture

## Data Requirements

### Employee Configuration
Ensure each employee has the following configured:

```javascript
{
  salaryAmount: Number,        // Base monthly salary
  laborPensionSelf: Number,    // Personal pension contribution
  employeeAdvance: Number,     // Any advance amounts
  salaryAccountA: {            // Primary account (net pay)
    bank: String,
    acct: String
  },
  salaryAccountB: {            // Secondary account (bonuses)
    bank: String,
    acct: String
  }
}
```

## Example: Monthly Payroll Process

```javascript
// 1. Calculate payroll for all employees
const employees = await getActiveEmployees();
const results = await fetch('/api/payroll/calculate/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    employees: employees.map(e => e._id),
    month: '2025-11-01',
    customDataMap: {
      // Employee-specific adjustments
      'emp1': { healthInsuranceFee: 710, nightShiftAllowance: 2700 },
      'emp2': { healthInsuranceFee: 650, performanceBonus: 5000 }
    }
  })
});

// 2. Review and save payroll records
for (const payroll of results) {
  await fetch('/api/payroll/calculate/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employeeId: payroll.employee,
      month: '2025-11-01',
      customData: { /* approved data */ }
    })
  });
}

// 3. Export bank transfer files
// Export for Taiwan Business Bank
await fetch('/api/payroll/export?month=2025-11-01&bankType=taiwan', {
  method: 'POST',
  body: JSON.stringify({ /* company info */ })
});

// Export for Taichung Bank
await fetch('/api/payroll/export?month=2025-11-01&bankType=taichung', {
  method: 'POST',
  body: JSON.stringify({ /* company info */ })
});
```

## Testing

Run the payroll test suite:

```bash
cd server
npm test -- tests/payroll.test.js
```

Expected output:
```
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
✓ All payroll tests passing
```

## Migration from Legacy System

If you have existing payroll records with only the `amount` field:

1. **No action required** - Backward compatibility maintained
2. New fields default to 0
3. Gradually migrate by updating records with new calculation endpoints
4. Legacy `amount` field continues to work

## Security & Performance

### Implemented Safeguards
- ✅ Prevents negative net pay
- ✅ Warns when deductions exceed salary
- ✅ Unique constraint on employee-month combinations
- ✅ Optimized database indexes for fast lookups
- ✅ Input validation on all endpoints

### Recommended (Infrastructure Level)
- Add rate limiting middleware
- Implement authentication/authorization
- Use HTTPS in production
- Regular database backups

## Support

For detailed API documentation, see [PAYROLL_API.md](./PAYROLL_API.md)

For technical implementation details, see [PAYROLL_IMPLEMENTATION.md](./PAYROLL_IMPLEMENTATION.md)
