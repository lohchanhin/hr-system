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

### Seeding example data

This repository provides a seeding script under `scripts/seed.js` to insert the default test users into MongoDB. Make sure your `.env` file includes a valid `MONGODB_URI` and run it with:

```bash
node scripts/seed.js
```

When running in development, the server automatically seeds a few test users if they do not already exist.  Each user is also given a matching record in the `Employee` collection, and the employee id will be returned when logging in:

| Username    | Role       |
|-------------|-----------|
| `user`      | employee  |
| `supervisor`| supervisor|
| `hr`        | hr        |
| `admin`     | admin     |

All test accounts use the password `password`.

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
