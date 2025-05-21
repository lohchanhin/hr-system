# Server

This directory contains the Express backend for the HR system.

## Setup

```bash
npm install
```

Create a `.env` file based on `.env.example` and set the following variables:

- `PORT` – port for the HTTP server
- `MONGODB_URI` – MongoDB connection string
- `JWT_SECRET` – (optional) secret used to sign JSON Web Tokens

To run the unit tests:

```bash
npm test
```

## Development

```bash
npm run dev
```

This starts the server with nodemon enabled.

### Seeding initial data

The project includes a seeding script under `scripts/seed.js` which creates an initial admin user.  Provide `ADMIN_USERNAME` and `ADMIN_PASSWORD` in your `.env` and run:

```bash
node scripts/seed.js
```

When the server starts it will also attempt to create this admin account automatically if it does not already exist.

## Employee form fields

The `Employee` model stores the following fields:

| Field       | Type    | Description        |
|-------------|---------|--------------------|
| `name`      | String  | Employee name      |
| `email`     | String  | Email address      |
| `role`      | String  | one of `employee`, `supervisor`, `hr`, `admin` |
| `department`| String  | Department name    |
| `title`     | String  | Job title          |
| `idNumber`  | String  | National ID number |
| `birthDate` | Date    | Date of birth      |
| `contact`   | String  | Contact info       |
| `licenses`  | [String]| Licenses list      |
| `trainings` | [String]| Training records   |
| `status`    | String  | Employment status  |

No additional environment variables are required for these fields.
