# Server

This directory contains the Express backend for the HR system.

## Setup

\`\`\`bash
npm install
\`\`\`

Create a `.env` file based on `.env.example` and set the following variables:

- `PORT` – port for the HTTP server
- `MONGODB_URI` – MongoDB connection string
- `JWT_SECRET` – (optional) secret used to sign JSON Web Tokens

To run the unit tests:

\`\`\`bash
npm test
\`\`\`

## Development

\`\`\`bash
npm run dev
\`\`\`

This starts the server with nodemon enabled.

### Seeding example data

This repository provides a seeding script under `scripts/seed.js` to insert sample data into MongoDB. Make sure your `.env` file includes a valid `MONGODB_URI` and run it with:

```bash
node scripts/seed.js
```

The server does not automatically insert any data. Executing the script will create comprehensive test data including:

- **9 employees**: 3 supervisors and 6 regular employees with diverse salary configurations
- **Organizational structure**: 2 organizations, 4 departments, and 12 sub-departments
- **Attendance records**: 60 working days (approx. 2 months) with clock-in/out, breaks, and shift assignments
- **Approval records**: **Every person has leave, overtime, and bonus applications for 2 months** (all approved)
- **Payroll records**: 2 months of salary records with leave deductions, overtime pay, and bonuses

> **Important for testing**: The seed script ensures that every person has approved leave and overtime applications in both months, allowing testers to verify that the payroll calculation correctly captures these adjustments.

All test accounts use the password `password`. The complete list of accounts will be exported to `scripts/seed-accounts.json` after running the seed script.

For detailed information about the test data structure and validation methods, see [Test Data Guide](../docs/TEST_DATA_GUIDE.md).

### Verifying test data

After running the seed script, you can verify that all employees have the required approval records:

```bash
node scripts/verifyTestData.js
```

This script will check that every person has leave, overtime, and bonus applications for both months and output a detailed report.

透過 API 新增部門時，請在 payload 中加入 `organization` 欄位，以指定其所屬機構；
新增小單位則需帶入 `department` 欄位對應上層部門。

### 資料轉換腳本

若既有資料的 `organization` 欄位為名稱，可執行以下腳本轉換為對應的 `_id`：

```bash
node scripts/migrate-organization-ids.js
```
