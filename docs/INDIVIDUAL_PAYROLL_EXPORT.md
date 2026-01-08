# Individual Payroll Export Feature - Implementation Documentation

## Overview
This document describes the implementation of the individual payroll export feature (個人薪資表匯出) that generates Excel files with employee payroll statements in a specific format.

## Feature Summary
The feature allows exporting individual employee payroll statements in Excel format with the following structure:

### Excel Structure
1. **Header Row**: Contains period, payment date, organization, employee ID, and name
2. **Table Headers**: Three columns - 應稅所得 (Taxable Income), 免稅所得 (Tax-Free Income), 應扣項目 (Deductions)
3. **Data Rows**: Lists all income and deduction items
4. **Subtotal Row**: Shows totals for each column
5. **Footer Rows**: Insurance levels, pension contributions, and leave information

## API Endpoint

### Request
```
GET /api/payroll/export/individual
```

### Query Parameters
- `employeeId` (required): The ID of the employee
- `month` (required): The payroll month in YYYY-MM-DD format
- `paymentDate` (optional): Custom payment date in YYYY-MM-DD format
- `organizationName` (optional): Custom organization name to display

### Authentication
Requires Bearer token with admin role authorization.

### Example Request
```bash
curl -X GET "http://localhost:3000/api/payroll/export/individual?employeeId=507f1f77bcf86cd799439011&month=2025-10-01" \
  -H "Authorization: Bearer <your-token>"
```

### Response
Returns an Excel file (.xlsx) as attachment with proper headers:
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="個人薪資表_<employee-name>_<month>.xlsx"`

## Implementation Details

### Files Modified
1. **server/src/services/payrollExportService.js**
   - Added `generateIndividualPayrollExcel()` function
   - Uses ExcelJS library to create formatted Excel files
   - Converts Gregorian dates to ROC (民國) dates
   - Extracts supervisor allowance from employee salary items
   - Calculates leave deductions based on hourly rate

2. **server/src/controllers/payrollController.js**
   - Added `exportIndividualPayrollExcel()` controller function
   - Handles employee lookup and validation
   - Retrieves or calculates payroll data
   - Sanitizes filenames for security
   - Proper error handling with context

3. **server/src/routes/payrollRoutes.js**
   - Added GET endpoint route
   - Protected by authentication and admin authorization middleware

### Key Features
- **ROC Date Conversion**: Automatically converts Gregorian calendar dates to Republic of China (Taiwan) calendar format
- **Dynamic Data**: Retrieves data from employee records and payroll calculations
- **Fallback Calculation**: If no payroll record exists, automatically calculates one
- **Security**: Filename sanitization, array bounds checking, safe date calculations
- **Error Handling**: Comprehensive try-catch blocks with meaningful error messages

### Data Sources
The export pulls data from:
- `PayrollRecord` collection (if exists)
- `Employee` collection for basic info and annual leave
- Calculated payroll data (if no record exists)
- Employee salary items for allowances

## Excel Format Details

### Header (Row 1)
```
| 114 年 10 月 (支付日期：114.11.10) | | 機構別：和泰護理之家 | | 編號：H0001 | 姓名：江玉琴 |
```

### Table Structure (Rows 3-10)
```
| 應稅所得        | 金額    | 免稅所得        | 金額 | 應扣項目        | 金額   |
|----------------|---------|----------------|------|----------------|--------|
| 本薪           | 45,000  | 工作日加班      | 0    | 勞保費自付額    | 1,200  |
| 組長加給        | 0       | 休息日加班      | 0    | 健保費自付額    | 800    |
| 事假扣薪        | -1,600  | 國定假日出勤    | 0    | 勞退個人提繳    | 2,748  |
| 病假扣薪        | -400    | 颱風停班出勤    | 0    | 員工借支        | 0      |
| 遲到早退扣薪    | 0       | 選舉投票日出勤  | 0    | 債權扣押        | 0      |
| 曠職扣薪        | 0       | 特休未休工資    | 0    | 其他：          | 0      |
| 其他：          | 0       |                |      | 其他：          | 0      |
```

### Subtotal Row (Row 11)
```
| 小計 | 43,000 | 合計 | 0 | 實領金額 | 38,500 |
```

### Footer Information (Rows 13-14)
```
| 勞健保級距：職退健 45,800 | | | 雇主勞退 6% 提繳：2,748 | | |
| 特別休假時數：120 | | 加班補休時數：0 | | 請休期限：115 年 7 月 31 日 | |
```

## Testing

### Tested Scenarios
✅ Employee with existing payroll record
✅ Employee without payroll record (fallback calculation)
✅ Custom payment date
✅ Custom organization name
✅ ROC date conversion for different months including December
✅ Filename sanitization with special characters
✅ Array bounds for salary items

### Test Data Example
```javascript
{
  employeeId: 'H0001',
  name: '江玉琴',
  organization: '和泰護理之家',
  month: '2025-10-01',
  baseSalary: 45000,
  netPay: 38500
}
```

## Security Considerations

### Implemented Protections
1. **Authentication**: Requires valid JWT token
2. **Authorization**: Admin role required
3. **Filename Sanitization**: Prevents directory traversal attacks
4. **Array Bounds Checking**: Prevents undefined access
5. **Safe Date Calculations**: Avoids month overflow issues
6. **Error Context**: Provides meaningful error messages

### Known Limitations
- Rate limiting not implemented (consistent with other exports)
- Employee ID exposed in query string (acceptable for authenticated admin requests)

## Future Enhancements

### Potential Improvements
1. **Tax-Free Income Items**: Implement detailed overtime breakdown when data available
2. **Overtime Compensation Hours**: Integrate with attendance/leave system
3. **Dynamic Allowances**: Auto-detect all salary items dynamically
4. **Rate Limiting**: Add endpoint-specific rate limiting
5. **Batch Export**: Allow exporting multiple employees at once
6. **PDF Format**: Add PDF export option alongside Excel

### Required Data
For full functionality, the following data should be available:
- Detailed overtime breakdown by type
- Attendance records for late arrival/early departure
- Absence records
- Overtime compensation hour balances

## Troubleshooting

### Common Issues

#### Employee Not Found
```json
{
  "error": "Employee not found"
}
```
**Solution**: Verify the employeeId exists in the database

#### Invalid Month Format
```json
{
  "error": "month is required"
}
```
**Solution**: Provide month in YYYY-MM-DD format (e.g., 2025-10-01)

#### Unauthorized Access
```json
{
  "error": "Unauthorized"
}
```
**Solution**: Ensure valid JWT token and admin role

#### Payroll Calculation Error
```json
{
  "error": "無法計算員工薪資記錄: <details>"
}
```
**Solution**: Check employee data completeness and insurance level configuration

## Maintenance

### Code Locations
- Export logic: `server/src/services/payrollExportService.js:495-750`
- Controller: `server/src/controllers/payrollController.js:164-252`
- Route: `server/src/routes/payrollRoutes.js:49`

### Constants
- `SICK_LEAVE_DEDUCTION_RATE = 0.5` (50% deduction for sick leave)

### Dependencies
- ExcelJS: For Excel file generation
- Mongoose: For database operations
- JWT: For authentication

## Support
For issues or questions, refer to:
- Main README: `/README.md`
- Payroll API docs: `/docs/PAYROLL_API.md`
- Test data guide: `/docs/TEST_DATA_GUIDE.md`
