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

This repository provides a seeding script under `scripts/seed.js` to insert the default test users into MongoDB. Make sure your `.env` file includes a valid `MONGODB_URI` and run it with:

\`\`\`bash
node scripts/seed.js
\`\`\`

When running in development, the server automatically seeds a few test users if they do not already exist.  Each user is also given a matching record in the `Employee` collection, and the employee id will be returned when logging in:

| Username    | Role       |
|-------------|-----------|
| `user`      | employee  |
| `supervisor`| supervisor|
| `admin`     | admin     |

All test accounts use the password `password`.

The seeding process also creates an example organization named `示範機構` with a
`人力資源部` department and a `招聘組` sub-department.  These records provide
basic reference data when the application is started for the first time.

透過 API 新增部門時，請在 payload 中加入 `organization` 欄位，以指定其所屬機構；
新增小單位則需帶入 `department` 欄位對應上層部門。

### 資料轉換腳本

若既有資料的 `organization` 欄位為名稱，可執行以下腳本轉換為對應的 `_id`：

```bash
node scripts/migrate-organization-ids.js
```
